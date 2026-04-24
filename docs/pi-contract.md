# Pi ↔ Backend Contract

Reference for how the Raspberry Pi, the Cloudflare Worker backend, the SvelteKit frontend, and Supabase interact.

This document is the source of truth for decisions about data flow, wake/sleep behavior, and the split of responsibility between Process A (sampler) and Process B (broker/persister). Update it before changing behavior, not after.

---

## Components

| Component          | Role                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Process A**      | Reads ADCs, emits `est_grams` over UDP. Owns sampling cadence (wake / sleep), local wake triggers, and inactivity sleep. |
| **Process B**      | UDP listener, SQLite queue for offline persistence, HTTP client to backend, command polling, forwards wake to Process A. |
| **Worker backend** | `POST /telemetry` (Pi → backend), `GET /commands` (Pi polls). Service-role Supabase client.                              |
| **Supabase**       | Postgres + RLS. Source of truth for shelf state, product catalog, weight logs, pi_commands.                              |
| **Frontend**       | Reads shelf state directly from Supabase via `supabase-js`. Writes `pi_commands` rows directly (RLS-gated).              |

---

## Authentication

Two separate auth mechanisms. They do not overlap.

### Pi ↔ Worker (machine-to-machine)

- Shared secret: `PI_API_KEY`.
- Sent as `Authorization: Bearer <key>` on every request to the Worker.
- Verified with a timing-safe comparison in `requireDeviceAuth`.
- Every authenticated request also bumps `shelves.last_seen` (via `X-Shelf-Id` header) for presence detection on the frontend.

### Frontend ↔ Supabase (user auth)

- Standard Supabase user JWT (email/password or OAuth flow - frontend's problem, not backend).
- RLS policies on every table enforce "user must be a member of the shelf" via a `shelf_members` join.
- Worker never sees or verifies user JWTs today (Option A - see [Enqueuing wake commands](#enqueuing-wake-commands) below).

---

## `POST /telemetry` - Pi → Worker

Pi pushes batches of weight readings.

### Request

```http
POST /telemetry
Authorization: Bearer <PI_API_KEY>
X-Shelf-Id: <shelf UUIDv4>
Content-Type: application/json

{
  "shelf_id": "32700001-a11c-4ab2-930c-1d4dd23f17cb",
  "sampled_at": "2026-04-24T10:30:00Z",
  "metadata": { "battery": 88, "rssi": -65 },
  "readings": [
    { "reading_id": "<UUIDv4>", "scale_index": 0, "est_grams": 750 }
  ]
}
```

- `shelf_id` (UUIDv4, required): scope for the batch.
- `sampled_at` (ISO 8601 with timezone, required): Pi-side timestamp.
- `metadata` (optional): `battery` (0–100) and/or `rssi` (-120–0). Merged into `shelves.metadata` jsonb.
- `readings` (1–100 items): each with a Process-B-generated `reading_id` (UUIDv4, the dedup key), `scale_index` (non-negative int), and `est_grams` (non-negative finite number).

### Response

```json
{ "accepted": 1, "skipped": [] }
```

- `accepted`: number of rows actually inserted into `weight_logs` (excludes duplicates by `reading_id`).
- `skipped`: per-reading rejections with a reason. Current reasons: `unknown_scale` (no `shelf_items` row matches the `shelf_id` + `scale_index`).

### Semantics

- **Idempotent.** `reading_id` is the dedup key; replaying the same batch returns `accepted: 0` and inserts nothing new.
- **State computation is backend-side.** Pi never sees `full_weight_g` / `tare_weight_g`; the Worker computes `state = clamp((est_grams - tare) / (full - tare), 0, 1)` using values from `product_catalog`. `state` is `null` if product catalog weights are missing.
- **Partial batches.** Unknown `scale_index` skips the individual reading, not the whole batch.
- **Future-clock rejection.** `sampled_at` more than 1 hour in the future → 400. Prevents clock-skew bugs from polluting "recent readings" queries.
- **Side effects** (fire-and-forget via `waitUntil`):
  - Latest reading per item mirrored into `shelf_items.current_weight_g`, `device_timestamp`, `server_timestamp`.
  - `shelves.metadata` merged with `battery` / `rssi` if provided, plus `device_metadata_updated_at`.
  - `shelves.last_seen` bumped (via the auth middleware).

---

## `GET /commands` — Pi → Worker

Pi short-polls this endpoint every ~3 seconds to receive pending commands.

### Request

```http
GET /commands
Authorization: Bearer <PI_API_KEY>
X-Shelf-Id: <shelf UUIDv4>
```

### Response

```json
{
	"commands": [
		{
			"id": "<uuid>",
			"command": "wake",
			"payload": null,
			"expires_at": "2026-04-24T10:30:30Z"
		}
	]
}
```

Empty array when nothing is pending.

### Semantics

- **Supported commands:** `wake` only. Sleep is **not** a backend command — see [Wake/sleep behavior](#wakesleep-behavior).
- **At-most-once delivery.** A single atomic SQL `UPDATE pi_commands SET delivered_at = now() WHERE shelf_id = ? AND delivered_at IS NULL AND expires_at > now() RETURNING *` both filters and stamps. Two concurrent polls cannot return the same row twice.
- **Expired rows ignored.** A stale `wake` that sat in the queue for an hour while the Pi was offline does not fire when the Pi reconnects.
- **Poll cadence:** ~3 seconds. Chosen as MVP after evaluating MQTT; see `wake-mode` design notes for the tradeoff analysis.

---

## Enqueuing wake commands

### Decision: direct Supabase write from the frontend (Option A)

The frontend inserts `pi_commands` rows **directly** via `supabase-js`, without going through the Worker. RLS policies on `pi_commands` gate writes to shelf members only.

```ts
// Frontend — when user taps a shelf to "wake"
const WAKE_COMMAND_TTL_MS = 30_000;

async function enqueueWake(shelfId: string) {
	const { error } = await supabase.from('pi_commands').insert({
		shelf_id: shelfId,
		command: 'wake',
		expires_at: new Date(Date.now() + WAKE_COMMAND_TTL_MS).toISOString(),
	});
	if (error) throw error;
}
```

- **TTL: 30 seconds.** With 3-second polling, that's ~10 polls' worth of headroom before the command is considered stale. Long enough to absorb transient network hiccups; short enough that a user who changed their mind doesn't cause a surprise wake a minute later.
- **No client-side deduping** (MVP). Two taps → two rows. The Pi claiming both is harmless because `wake` is idempotent.
- **Keep the call site trivial.** If frontend-side logic starts growing (rate-limit, dedupe, per-shelf throttling), that is a signal to switch to Option B - a Worker-mediated `POST /commands` - and migrate the server-side validation there.

### Why not route through the Worker (Option B)?

- RLS already enforces "shelf members only can insert", which is the main security concern.
- No business logic needs to live on the server today (no rate limiting, no deduping, no audit).
- Adding a Worker endpoint means adding user-JWT verification in the Worker. That's future work if we need it; premature now.

### Migration path if we ever need Option B

The frontend call site is a single function. Swap the Supabase insert for a `fetch(POST /commands)` and you're done. The Pi side, schema, and RLS policies do not change. Estimated cost: half a day (handler + tests + frontend one-line change).

---

## Wake/sleep behavior

The wake/sleep state lives in Process A. The backend only influences it indirectly via `pi_commands`.

### Triggers

| Trigger                                      | Source             |
| -------------------------------------------- | ------------------ |
| User opens the frontend → enqueues `wake`    | Frontend           |
| Pi polls, receives `wake`, forwards to A     | Process B          |
| Significant weight change during low-cadence | Process A directly |
| No activity for N seconds → self-sleep       | Process A directly |

### Offline behavior

- If the Pi is offline when the frontend enqueues `wake`, the row sits in `pi_commands` until either (a) the Pi comes back and polls within `expires_at`, or (b) `expires_at` passes and the command is ignored.
- Weight-change detection in Process A is the offline fallback — someone physically interacting with the shelf wakes the Pi locally, without needing the backend.
- Telemetry generated while offline is buffered in Process B's SQLite and drained when connectivity returns.

---

## IPC between Process A and Process B

Separate from the Pi ↔ Worker contract, but documented here because it's tightly coupled to the wake flow.

- **A → B: weight readings.** UDP. Process A sends `{scale_index, est_grams, ...}` datagrams to Process B on a fixed port.
- **B → A: wake signal.** UDP. Process B sends `{"type": "wake"}` to Process A on a separate control port whenever `GET /commands` returns a `wake`. No ack needed — wake is idempotent, and a lost datagram falls back to the local weight-change trigger.

---

## Out of scope for the current design

- **Sleep as a backend command.** Could be added later if we want an admin "force sleep" action. Would be a new entry in `CommandNameSchema`, a `CHECK` constraint on `pi_commands.command`, and a UI affordance.
- **Multi-shelf Pis.** Schema supports it (Process B can poll multiple `X-Shelf-Id`s), but untested. We'll exercise the path when a second shelf is wired up.
- **Push-based wake (MQTT / websocket).** Considered, deferred. Polling is adequate for human-speed interactions.
- **`POST /commands` on the Worker.** Deferred per the Option A decision above. Migration notes are in this doc should we need it.

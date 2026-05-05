# ShelfAware Backend

Cloudflare Worker (Hono) that ingests telemetry from the ShelfAware Raspberry Pi hardware and writes it to Supabase (PostgreSQL). The SvelteKit frontend reads from Supabase directly via `supabase-js`; it does not go through this Worker.

## Stack

- [Hono](https://hono.dev/) on Cloudflare Workers
- Supabase (PostgreSQL) for storage
- Vitest + `@cloudflare/vitest-pool-workers` for tests

## Prerequisites

- Node.js 20+
- A Cloudflare account, logged in via `npx wrangler login`
- Access to the Supabase project

## Setup

```bash
npm install
```

Create a `.dev.vars` file in the project root for local secrets (this file is gitignored):

```
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key
PI_API_KEY=any-string-for-local-dev
```

`PI_API_KEY` is the shared secret the Raspberry Pi uses to authenticate against the backend (`Authorization: Bearer <key>`). In production it's set via Cloudflare secrets; in CI it's pushed by the deploy workflow from the `PI_API_KEY` GitHub secret.

Non-secret config lives in `wrangler.jsonc` under `vars`. After changing `vars`, secrets, or bindings, regenerate the `Env` type:

```bash
npm run cf-typegen
```

## Scripts

| Command                                   | What it does                                                 |
| ----------------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                             | Start the Worker locally via Wrangler (loads `.dev.vars`)    |
| `npm test`                                | Run Vitest suite inside the Workers runtime                  |
| `npm run typecheck`                       | `tsc --noEmit`                                               |
| `npm run format` / `npm run format:check` | Prettier                                                     |
| `npm run deploy`                          | Deploy to Cloudflare                                         |
| `npm run cf-typegen`                      | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |

## Routes

| Method | Path                 | Auth                | Description                                                               |
| ------ | -------------------- | ------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/`                  | none                | Service identity string                                                   |
| `GET`  | `/health`            | none                | Liveness probe; returns `{ status, timestamp }`                           |
| `POST` | `/telemetry`         | `Bearer PI_API_KEY` | Pi pushes a batch of weight readings. Idempotent by `reading_id`.         |
| `GET`  | `/commands`          | `Bearer PI_API_KEY` | Pi short-polls for pending `wake` commands. At-most-once delivery.        |
| `POST` | `/shelves`           | `Bearer PI_API_KEY` | Pi self-registers, binding the shelf to a user. Idempotent on `shelf_id`. |
| `GET`  | `/shelves/:shelf_id` | `Bearer <user JWT>` | Companion app reads shelf membership + items. 404 if not a member.        |

See:

- [`docs/pi-contract.md`](docs/pi-contract.md) — Pi ↔ backend data contract for `/telemetry` and `/commands`.
- [`docs/shelves-contract.md`](docs/shelves-contract.md) — provisioning + shelf-detail contract for `/shelves`.

## Project layout

```
src/
  index.ts              # Hono app: middleware, health, error handling, route mounting
  lib/
    supabase.ts         # getSupabase(env) factory (service-role client)
    state.ts            # computeState() — est_grams → fullness ratio
  middleware/
    auth.ts             # requireDeviceAuth + shelves.last_seen presence bump
    userAuth.ts         # requireUserAuth — verifies Supabase user JWTs
  routes/
    telemetry.ts        # POST /telemetry
    commands.ts         # GET /commands
    shelves.ts          # POST /shelves + GET /shelves/:shelf_id
  schemas/
    telemetry.ts        # Zod schema for the telemetry payload
    commands.ts         # Zod schema / DTOs for the commands response
    shelves.ts          # Zod schemas / DTOs for the shelves endpoints
  types/
    supabase.ts         # Generated Database types from Supabase
test/
  index.spec.ts             # Smoke tests against the Hono app
  lib/state.spec.ts         # computeState unit tests
  lib/supabase.spec.ts      # Supabase client helper
  middleware/auth.spec.ts   # M2M auth middleware
  routes/telemetry.spec.ts  # POST /telemetry integration tests
  routes/commands.spec.ts   # GET /commands integration tests
  routes/shelves.spec.ts    # POST /shelves + GET /shelves/:shelf_id tests
  schemas/telemetry.spec.ts # Telemetry Zod schema unit tests
docs/
  pi-contract.md            # Pi ↔ backend data contract (telemetry + commands)
  shelves-contract.md       # /shelves provisioning + read contract
wrangler.jsonc              # Worker config + non-secret vars
worker-configuration.d.ts   # Generated Env type (from cf-typegen)
```

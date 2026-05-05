import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { requireDeviceAuth, type DeviceAuthEnv } from '../middleware/auth';
import { requireUserAuth, type UserAuthVariables } from '../middleware/userAuth';
import { getSupabase } from '../lib/supabase';
import {
	ShelfRegistrationPayloadSchema,
	ShelfIdParamSchema,
	type ShelfResponse,
	type ShelfItemDTO,
	type ShelfListResponse,
	type ShelfSummaryDTO,
} from '../schemas/shelves';

/**
 * New self-registered shelves get this role on shelf_members. The user that
 * provisioned the Pi is, by definition, the owner — they're the one who
 * burned credentials onto the device. Future invite flows that grant access
 * to additional users should default to 'member'.
 */
const DEFAULT_OWNER_ROLE = 'owner';

/**
 * Generate a default human-readable name for a freshly-registered shelf.
 * The user can rename it from the UI later; this is just so the row's
 * required `name` column has something sensible without forcing the Pi
 * to send a name it doesn't have.
 */
function defaultShelfName(shelfId: string): string {
	return `Shelf ${shelfId.slice(0, 6)}`;
}

const shelves = new Hono<{ Bindings: DeviceAuthEnv; Variables: UserAuthVariables }>();

/**
 * POST /shelves — Pi self-registration.
 *
 * Called by Process B on every Pi startup. Idempotent on `shelf_id`. Replaces
 * the shelf's membership entirely with the supplied user — this is the
 * "factory provisioning" semantic: whoever just provisioned the Pi via the
 * captive portal owns it now.
 *
 * The handler performs three writes; we don't get a real DB transaction
 * (Supabase JS doesn't expose one), so the steps are ordered to be safe under
 * partial failure:
 *  1. Upsert `shelves` first — must exist before `shelf_members` can FK to it.
 *  2. Delete then insert `shelf_members` — old membership cleared, new owner
 *     written. A failure between delete and insert leaves the shelf orphaned;
 *     the Pi will retry on next startup, which fixes it.
 *  3. (`shelf_items` auto-create is intentionally skipped — items are attached
 *     via the barcode/scan flow.)
 *
 * Auth is the shared PI_API_KEY (same as /telemetry). The `user_id` in the
 * body is checked against `auth.users` so a misconfigured Pi can't bind a
 * shelf to a nonexistent account.
 */
shelves.post('/shelves', requireDeviceAuth, zValidator('json', ShelfRegistrationPayloadSchema), async (c) => {
	const { shelf_id, user_id } = c.req.valid('json');
	const supabase = getSupabase(c.env);

	const { data: userLookup, error: userLookupError } = await supabase.auth.admin.getUserById(user_id);
	if (userLookupError || !userLookup?.user) {
		// admin.getUserById returns an error for "not found" rather than a null user;
		// either signal means "no such user" from our perspective.
		throw new HTTPException(404, { message: 'user_not_found' });
	}

	const { error: shelfUpsertError } = await supabase
		.from('shelves')
		.upsert({ id: shelf_id, name: defaultShelfName(shelf_id) }, { onConflict: 'id', ignoreDuplicates: true });

	if (shelfUpsertError) {
		console.error('shelves upsert failed', shelfUpsertError);
		throw new HTTPException(500, { message: 'Failed to register shelf' });
	}

	// Replace existing membership. We delete first rather than upsert because the
	// membership table has a synthetic `id` PK, not (shelf_id, user_id) — so two
	// concurrent calls with different user_ids would otherwise leave both rows.
	const { error: deleteError } = await supabase.from('shelf_members').delete().eq('shelf_id', shelf_id);
	if (deleteError) {
		console.error('shelf_members delete failed', deleteError);
		throw new HTTPException(500, { message: 'Failed to clear existing membership' });
	}

	const { error: insertError } = await supabase.from('shelf_members').insert({ shelf_id, user_id, role: DEFAULT_OWNER_ROLE });
	if (insertError) {
		console.error('shelf_members insert failed', insertError);
		throw new HTTPException(500, { message: 'Failed to write membership' });
	}

	return c.json({ shelf_id });
});

/**
 * GET /shelves — list all shelves the authenticated user is a member of.
 *
 * Primary use case (today): the companion app's provisioning poller takes a
 * snapshot of `shelf_id`s before the user joins the Pi's captive portal, then
 * polls this endpoint every few seconds during provisioning. The first
 * `shelf_id` that appears in the polled list but wasn't in the snapshot is
 * the freshly registered Pi.
 *
 * Snapshot-diff is preferred over a `created_at > <provisioning_started>`
 * filter because:
 *  - Set difference on UUIDs is immune to clock skew between the browser and
 *    the database.
 *  - It tolerates a friend inviting the user to an unrelated shelf
 *    mid-provisioning — the new shelf still appears as a single-element delta.
 *
 * Secondary use case (future): power the main UI's shelf-list page. That's
 * why we include `name` and `created_at` even though the poller only needs
 * `shelf_id`.
 *
 * Ordered by `shelves.created_at DESC` so the most recently registered shelf
 * (the one the user is provisioning right now) is at index 0 — a small
 * affordance for naive consumers that don't bother with snapshot-diffing.
 */
shelves.get('/shelves', requireUserAuth, async (c) => {
	const userId = c.get('userId');
	const supabase = getSupabase(c.env);

	// Single round-trip: pull membership rows for this user and inline-join
	// the shelves they refer to. We project only the fields ShelfSummaryDTO
	// needs, since this endpoint is intended for frequent polling.
	const { data, error } = await supabase.from('shelf_members').select('shelves!inner(id, name, created_at)').eq('user_id', userId);

	if (error) {
		console.error('shelf_members list failed', error);
		throw new HTTPException(500, { message: 'Failed to list shelves' });
	}

	// Supabase types the joined relation as either a single row or an array
	// depending on the FK; defensively normalise so we never silently drop a
	// shelf if the inferred shape changes after a future schema regeneration.
	const summaries: ShelfSummaryDTO[] = [];
	for (const row of data ?? []) {
		const joined = (row as { shelves: unknown }).shelves;
		const shelfRow = (Array.isArray(joined) ? joined[0] : joined) as
			| { id: string; name: string; created_at: string | null }
			| null
			| undefined;
		if (!shelfRow) continue;
		summaries.push({ shelf_id: shelfRow.id, name: shelfRow.name, created_at: shelfRow.created_at });
	}

	// Most recent first. We sort in JS (rather than asking Postgres to ORDER BY
	// shelves.created_at) because Supabase's PostgREST doesn't expose ordering
	// on joined columns cleanly — and the typical user has <10 shelves.
	summaries.sort((a, b) => {
		const aT = a.created_at ?? '';
		const bT = b.created_at ?? '';
		return bT.localeCompare(aT);
	});

	const response: ShelfListResponse = { shelves: summaries };
	return c.json(response);
});

/**
 * GET /shelves/:shelf_id — used by the companion app to detect provisioning
 * success (404 → 200 transition) and by the main UI to render shelf details.
 *
 * Returns 404 — never 403 — when the user isn't a member, deliberately
 * conflating "doesn't exist" with "not yours" so we don't leak the existence
 * of shelves owned by other users.
 */
shelves.get('/shelves/:shelfId', requireUserAuth, async (c) => {
	const parsed = ShelfIdParamSchema.safeParse(c.req.param('shelfId'));
	if (!parsed.success) {
		// Path didn't match the UUID pattern — treat as not found rather than 400.
		// A malformed ID can't possibly be a shelf the user has access to, and 404
		// keeps responses indistinguishable from "exists but not yours".
		throw new HTTPException(404, { message: 'Not Found' });
	}
	const shelfId = parsed.data;
	const userId = c.get('userId');

	const supabase = getSupabase(c.env);

	const { data: membership, error: membershipError } = await supabase
		.from('shelf_members')
		.select('shelf_id')
		.eq('shelf_id', shelfId)
		.eq('user_id', userId)
		.limit(1)
		.maybeSingle();

	if (membershipError) {
		console.error('shelf_members lookup failed', membershipError);
		throw new HTTPException(500, { message: 'Failed to verify membership' });
	}

	if (!membership) {
		throw new HTTPException(404, { message: 'Not Found' });
	}

	const { data: itemRows, error: itemsError } = await supabase
		.from('shelf_items')
		.select('scale_index, current_weight_g')
		.eq('shelf_id', shelfId)
		.order('scale_index', { ascending: true });

	if (itemsError) {
		console.error('shelf_items lookup failed', itemsError);
		throw new HTTPException(500, { message: 'Failed to load shelf items' });
	}

	const items: ShelfItemDTO[] = (itemRows ?? []).map((row) => ({
		scale_index: row.scale_index,
		// `current_weight_g` is non-null in the schema but defaults to 0 for
		// freshly-attached items; expose null externally for "no reading yet"
		// once we wire that semantic in. For now mirror the column verbatim.
		current_weight_g: row.current_weight_g,
	}));

	const response: ShelfResponse = { shelf_id: shelfId, items };
	return c.json(response);
});

export default shelves;

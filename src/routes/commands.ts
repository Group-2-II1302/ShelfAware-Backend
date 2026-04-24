import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireDeviceAuth, type DeviceAuthEnv } from '../middleware/auth';
import { getSupabase } from '../lib/supabase';
import { ShelfIdHeaderSchema, type CommandDTO, type CommandName, type CommandsResponse } from '../schemas/commands';

const commands = new Hono<{ Bindings: DeviceAuthEnv }>();

/**
 * GET /commands — the Pi short-polls this endpoint (~every 3s) to receive
 * pending `wake` commands.
 *
 * Delivery is at-most-once: the same atomic UPDATE both filters by
 * `delivered_at IS NULL` and stamps `delivered_at = now()`, so two concurrent
 * polls cannot return the same row twice. `wake` is idempotent on the Pi side
 * (re-entering wake mode is a no-op), so losing a retry window is acceptable;
 * reliability comes from the command being re-enqueued by the frontend if the
 * Pi doesn't act within `expires_at`.
 *
 * Expired commands (`expires_at <= now()`) are ignored entirely — a stale
 * `wake` sitting in the queue from an hour ago should not fire when the Pi
 * finally comes back online.
 */
commands.get('/commands', requireDeviceAuth, async (c) => {
	const shelfIdHeader = c.req.header('X-Shelf-Id');
	const parsed = ShelfIdHeaderSchema.safeParse(shelfIdHeader);
	if (!parsed.success) {
		throw new HTTPException(400, { message: 'X-Shelf-Id header is required and must be a UUIDv4' });
	}
	const shelfId = parsed.data;

	const supabase = getSupabase(c.env);
	const nowIso = new Date().toISOString();

	// Atomic claim: only rows that are still undelivered AND not expired become ours.
	// The .select() after .update() returns exactly the rows we just claimed.
	const { data, error } = await supabase
		.from('pi_commands')
		.update({ delivered_at: nowIso })
		.eq('shelf_id', shelfId)
		.is('delivered_at', null)
		.gt('expires_at', nowIso)
		.select('id, command, payload, expires_at');

	if (error) {
		console.error('pi_commands claim failed', error);
		throw new HTTPException(500, { message: 'Failed to fetch commands' });
	}

	const claimed: CommandDTO[] = (data ?? []).map((row) => ({
		id: row.id as string,
		// The DB column is `text`, not an enum — narrow it defensively so a bad row
		// in the DB doesn't silently ship an unknown command to the Pi.
		command: row.command as CommandName,
		payload: row.payload,
		expires_at: row.expires_at as string,
	}));

	const response: CommandsResponse = { commands: claimed };
	return c.json(response);
});

export default commands;

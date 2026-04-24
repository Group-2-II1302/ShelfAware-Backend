import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { getSupabase, type SupabaseEnv } from '../lib/supabase';

export interface DeviceAuthEnv extends SupabaseEnv {
	PI_API_KEY: string;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Constant-time comparison of two strings. Prevents timing attacks that would
 * otherwise leak the API key one byte at a time via response-time differences.
 *
 * Returns false immediately on length mismatch. That's fine — length is not
 * considered secret for our API keys, and any real attacker can guess the length
 * from the issued key format anyway.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware that requires a valid Bearer token matching the PI_API_KEY binding.
 * Use to protect endpoints the Raspberry Pi posts to (e.g. POST /telemetry).
 *
 * On successful auth, also bumps `shelves.last_seen = now()` for the shelf named
 * in the `X-Shelf-Id` header (if present). This powers the frontend's online/offline
 * indicator without needing a dedicated heartbeat endpoint — every authenticated
 * Pi request is itself a heartbeat.
 *
 * The DB write runs via `waitUntil` so it never adds latency to the Pi's response.
 * If the shelf_id is unknown (or the row doesn't exist), the update affects 0 rows
 * and silently no-ops — a rogue key holder cannot create shelves this way.
 */
export const requireDeviceAuth = createMiddleware<{ Bindings: DeviceAuthEnv }>(async (c, next) => {
	const header = c.req.header('Authorization');
	if (!header || !header.startsWith(BEARER_PREFIX)) {
		throw new HTTPException(401, { message: 'Unauthorized' });
	}

	const token = header.slice(BEARER_PREFIX.length);
	const expected = c.env.PI_API_KEY;

	if (!expected || !timingSafeEqual(token, expected)) {
		throw new HTTPException(401, { message: 'Unauthorized' });
	}

	const shelfIdHeader = c.req.header('X-Shelf-Id');
	if (shelfIdHeader && UUID_PATTERN.test(shelfIdHeader) && c.env.SUPABASE_URL && c.env.SUPABASE_SERVICE_ROLE_KEY) {
		const supabase = getSupabase(c.env);
		// Wrap the Supabase builder's PromiseLike in a real Promise for waitUntil,
		// which only accepts a proper Promise.
		const update = Promise.resolve(supabase.from('shelves').update({ last_seen: new Date().toISOString() }).eq('id', shelfIdHeader)).then(
			() => undefined,
		);
		c.executionCtx.waitUntil(update);
	}

	await next();
});

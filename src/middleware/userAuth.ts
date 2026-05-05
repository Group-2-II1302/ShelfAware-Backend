import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';
import type { SupabaseEnv } from '../lib/supabase';

const BEARER_PREFIX = 'Bearer ';

/**
 * Request-scoped values populated by requireUserAuth. Routes can read these
 * via c.get('userId') after the middleware runs.
 *
 * Keep this in sync with the Variables type in src/index.ts.
 */
export interface UserAuthVariables {
	userId: string;
}

/**
 * Middleware that requires a valid Supabase user JWT in `Authorization: Bearer ...`.
 *
 * Verification strategy: hand the token to Supabase's `auth.getUser()`. This
 * costs one HTTP round-trip per request but lets Supabase do the JWT crypto
 * (signature + expiry + revocation) for us — no JWKS handling, no jose
 * dependency, and revoked tokens stop working immediately.
 *
 * If/when latency matters more than simplicity, swap to local JWKS verification
 * with `jose` and verify against the project's signing key. The middleware
 * surface (sets `userId` on the context) won't change, so callers stay the same.
 *
 * On any failure (missing header, invalid token, expired, revoked), we return
 * a uniform 401 — never leak whether the token was malformed vs. simply not
 * recognized.
 */
export const requireUserAuth = createMiddleware<{
	Bindings: SupabaseEnv;
	Variables: UserAuthVariables;
}>(async (c, next) => {
	const header = c.req.header('Authorization');
	if (!header || !header.startsWith(BEARER_PREFIX)) {
		throw new HTTPException(401, { message: 'Unauthorized' });
	}

	const token = header.slice(BEARER_PREFIX.length);
	if (!token) {
		throw new HTTPException(401, { message: 'Unauthorized' });
	}

	if (!c.env.PUBLIC_SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
		console.error('Supabase env missing in requireUserAuth');
		throw new HTTPException(500, { message: 'Server misconfigured' });
	}

	// Build a per-request client scoped to the caller's token. Using getUser()
	// on a service-role client also works, but binding the token here keeps
	// the contract narrow: this client cannot impersonate other users via
	// admin APIs.
	const supabase = createClient<Database, 'public'>(c.env.PUBLIC_SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: { headers: { Authorization: header } },
	});

	const { data, error } = await supabase.auth.getUser(token);
	if (error || !data?.user) {
		throw new HTTPException(401, { message: 'Unauthorized' });
	}

	c.set('userId', data.user.id);
	await next();
});

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

export interface DeviceAuthEnv {
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

/**
 * Middleware that requires a valid Bearer token matching the PI_API_KEY binding.
 * Use to protect endpoints the Raspberry Pi posts to (e.g. POST /telemetry).
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

	await next();
});

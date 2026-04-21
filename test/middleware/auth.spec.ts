import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireDeviceAuth, type DeviceAuthEnv } from '../../src/middleware/auth';

const VALID_KEY = 'test-pi-key-123';

function makeApp() {
	const app = new Hono<{ Bindings: DeviceAuthEnv }>();
	app.use('*', requireDeviceAuth);
	app.get('/protected', (c) => c.json({ ok: true }));
	return app;
}

async function callProtected(headers: HeadersInit = {}) {
	const app = makeApp();
	return app.request('/protected', { headers }, { PI_API_KEY: VALID_KEY });
}

describe('requireDeviceAuth', () => {
	it('returns 401 when the Authorization header is missing', async () => {
		const res = await callProtected();
		expect(res.status).toBe(401);
	});

	it('returns 401 when the Authorization header is not a Bearer token', async () => {
		const res = await callProtected({ Authorization: VALID_KEY });
		expect(res.status).toBe(401);
	});

	it('returns 401 when the Bearer token does not match PI_API_KEY', async () => {
		const res = await callProtected({ Authorization: 'Bearer wrong-key' });
		expect(res.status).toBe(401);
	});

	it('calls next() when the Bearer token matches PI_API_KEY', async () => {
		const res = await callProtected({ Authorization: `Bearer ${VALID_KEY}` });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});

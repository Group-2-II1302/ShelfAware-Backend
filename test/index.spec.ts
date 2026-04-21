import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('ShelfAware API', () => {
	it('GET / responds with the service name (unit style)', async () => {
		const request = new IncomingRequest('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ShelfAware API');
	});

	it('GET /health returns ok (integration style)', async () => {
		const response = await SELF.fetch('https://example.com/health');
		expect(response.status).toBe(200);
		const body = (await response.json()) as { status: string; timestamp: string };
		expect(body.status).toBe('ok');
		expect(typeof body.timestamp).toBe('string');
		expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
	});

	it('unknown routes return a JSON 404', async () => {
		const response = await SELF.fetch('https://example.com/does-not-exist');
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: 'Not Found' });
	});
});

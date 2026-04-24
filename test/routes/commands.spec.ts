import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Same mock-supabase pattern as telemetry.spec.ts: a chainable builder that
 * records every method call and returns a programmed response. /commands only
 * ever calls one query (update->select), so the mock here is slimmer than
 * telemetry's, but kept stylistically consistent.
 */

type MockRow = Record<string, unknown>;
type MockResult = { data: MockRow[] | MockRow | null; error: { message: string } | null };

interface ProgrammedResponses {
	pi_commands_update?: MockResult;
}

interface MockCall {
	table: string;
	op: string;
	args?: unknown;
}

const mockCalls: MockCall[] = [];
let programmed: ProgrammedResponses = {};

function resetMock(responses: ProgrammedResponses = {}) {
	mockCalls.length = 0;
	programmed = responses;
}

function buildQuery(table: string, op: string, args?: unknown): PromiseLike<MockResult> & Record<string, unknown> {
	mockCalls.push({ table, op, args });

	const resolveWith = (): MockResult => {
		const key = `${table}_${op}` as keyof ProgrammedResponses;
		return programmed[key] ?? { data: [], error: null };
	};

	const builder: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'is', 'gt', 'order', 'limit']) {
		builder[method] = (..._args: unknown[]) => {
			mockCalls.push({ table, op: `${op}:${method}`, args: _args });
			return builder;
		};
	}
	builder.single = () => Promise.resolve(resolveWith());
	builder.then = (onFulfilled: (value: MockResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
		Promise.resolve(resolveWith()).then(onFulfilled, onRejected);

	return builder as PromiseLike<MockResult> & Record<string, unknown>;
}

function makeMockClient() {
	return {
		from(table: string) {
			return {
				select: (cols?: unknown) => buildQuery(table, 'select', cols),
				update: (patch: unknown) => buildQuery(table, 'update', patch),
				insert: (rows: unknown) => buildQuery(table, 'insert', rows),
				upsert: (rows: unknown, opts?: unknown) => buildQuery(table, 'upsert', { rows, opts }),
			};
		},
	};
}

vi.mock('../../src/lib/supabase', () => ({
	getSupabase: () => makeMockClient(),
}));

import app from '../../src/index';

const PI_API_KEY = 'test-pi-key-123';
const ENV = {
	PI_API_KEY,
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

const SHELF_ID = '550e8400-e29b-41d4-a716-446655440000';
const COMMAND_ID_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function commandsRequest(headers: Record<string, string> = {}) {
	return app.request(
		'/commands',
		{
			method: 'GET',
			headers: {
				Authorization: `Bearer ${PI_API_KEY}`,
				...headers,
			},
		},
		ENV,
	);
}

describe('GET /commands', () => {
	beforeEach(() => {
		resetMock();
	});

	it('returns 401 when Authorization header is missing', async () => {
		const res = await app.request('/commands', { method: 'GET', headers: { 'X-Shelf-Id': SHELF_ID } }, ENV);
		expect(res.status).toBe(401);
	});

	it('returns 400 when X-Shelf-Id header is missing', async () => {
		const res = await commandsRequest();
		expect(res.status).toBe(400);
	});

	it('returns 400 when X-Shelf-Id is not a UUIDv4', async () => {
		const res = await commandsRequest({ 'X-Shelf-Id': 'not-a-uuid' });
		expect(res.status).toBe(400);
	});

	it('returns an empty list when no commands are pending', async () => {
		resetMock({ pi_commands_update: { data: [], error: null } });

		const res = await commandsRequest({ 'X-Shelf-Id': SHELF_ID });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { commands: unknown[] };
		expect(body.commands).toEqual([]);
	});

	it('returns pending commands and claims them in a single update', async () => {
		resetMock({
			pi_commands_update: {
				data: [{ id: COMMAND_ID_1, command: 'wake', payload: null, expires_at: '2099-01-01T00:00:00Z' }],
				error: null,
			},
		});

		const res = await commandsRequest({ 'X-Shelf-Id': SHELF_ID });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { commands: Array<{ id: string; command: string }> };
		expect(body.commands).toHaveLength(1);
		expect(body.commands[0]).toMatchObject({ id: COMMAND_ID_1, command: 'wake' });

		const updateCall = mockCalls.find((c) => c.table === 'pi_commands' && c.op === 'update');
		expect(updateCall).toBeDefined();
		expect(updateCall!.args).toMatchObject({ delivered_at: expect.any(String) });
	});

	it('filters on shelf_id, delivered_at IS NULL, and expires_at > now()', async () => {
		resetMock({ pi_commands_update: { data: [], error: null } });

		await commandsRequest({ 'X-Shelf-Id': SHELF_ID });

		const chainedOps = mockCalls.filter((c) => c.table === 'pi_commands').map((c) => c.op);
		expect(chainedOps).toContain('update:eq');
		expect(chainedOps).toContain('update:is');
		expect(chainedOps).toContain('update:gt');

		const eqArgs = mockCalls.find((c) => c.table === 'pi_commands' && c.op === 'update:eq')!.args as unknown[];
		expect(eqArgs).toEqual(['shelf_id', SHELF_ID]);

		const isArgs = mockCalls.find((c) => c.table === 'pi_commands' && c.op === 'update:is')!.args as unknown[];
		expect(isArgs).toEqual(['delivered_at', null]);

		const gtArgs = mockCalls.find((c) => c.table === 'pi_commands' && c.op === 'update:gt')!.args as unknown[];
		expect(gtArgs[0]).toBe('expires_at');
		expect(typeof gtArgs[1]).toBe('string');
	});

	it('returns 500 when the Supabase claim fails', async () => {
		resetMock({
			pi_commands_update: { data: null, error: { message: 'boom' } },
		});

		const res = await commandsRequest({ 'X-Shelf-Id': SHELF_ID });
		expect(res.status).toBe(500);
	});
});

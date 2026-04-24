import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * We mock `../../src/lib/supabase` so handler tests don't require a live Supabase.
 * The mock is a minimal chainable builder that records every method call, lets
 * tests program per-table responses, and returns predictable shapes.
 */

type MockRow = Record<string, unknown>;
type MockResult = { data: MockRow[] | MockRow | null; error: { message: string } | null };

interface ProgrammedResponses {
	shelf_items_select?: MockResult;
	weight_logs_upsert?: MockResult;
	shelf_items_update?: MockResult;
	shelves_select?: MockResult;
	shelves_update?: MockResult;
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
	// All chain methods just record themselves and return the same builder so
	// the caller can keep chaining. The promise resolution happens when
	// someone awaits, calls .single(), or calls .then().
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
				upsert: (rows: unknown, opts?: unknown) => buildQuery(table, 'upsert', { rows, opts }),
				update: (patch: unknown) => buildQuery(table, 'update', patch),
				insert: (rows: unknown) => buildQuery(table, 'insert', rows),
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
const ITEM_ID_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const READING_1 = '11111111-1111-4111-8111-111111111111';
const READING_2 = '22222222-2222-4222-8222-222222222222';

function telemetryRequest(body: unknown, headers: Record<string, string> = {}) {
	return app.request(
		'/telemetry',
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${PI_API_KEY}`,
				'Content-Type': 'application/json',
				...headers,
			},
			body: JSON.stringify(body),
		},
		ENV,
	);
}

const validPayload = {
	shelf_id: SHELF_ID,
	sampled_at: '2026-04-21T10:30:00Z',
	readings: [{ reading_id: READING_1, scale_index: 0, est_grams: 500 }],
};

describe('POST /telemetry', () => {
	beforeEach(() => {
		resetMock();
	});

	it('returns 401 when Authorization header is missing', async () => {
		const res = await app.request(
			'/telemetry',
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validPayload) },
			ENV,
		);
		expect(res.status).toBe(401);
	});

	it('returns 400 for a malformed payload', async () => {
		resetMock();
		const res = await telemetryRequest({ shelf_id: 'not-a-uuid', readings: [] });
		expect(res.status).toBe(400);
	});

	it('accepts a reading for a configured scale and inserts it into weight_logs', async () => {
		resetMock({
			shelf_items_select: {
				data: [{ id: ITEM_ID_A, scale_index: 0, product_catalog: { full_weight_g: 1000, tare_weight_g: 50 } }],
				error: null,
			},
			weight_logs_upsert: {
				data: [{ reading_id: READING_1 }],
				error: null,
			},
		});

		const res = await telemetryRequest(validPayload);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { accepted: number; skipped: unknown[] };
		expect(body.accepted).toBe(1);
		expect(body.skipped).toEqual([]);

		const upsertCall = mockCalls.find((c) => c.table === 'weight_logs' && c.op === 'upsert');
		expect(upsertCall).toBeDefined();
		const { rows } = upsertCall!.args as { rows: Array<Record<string, unknown>> };
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			item_id: ITEM_ID_A,
			reading_id: READING_1,
			weight_g: 500,
			sampled_at: '2026-04-21T10:30:00Z',
		});
		// State = (500 - 50) / (1000 - 50) ≈ 0.4737
		expect(rows[0].state).toBeCloseTo(0.4737, 3);
	});

	it('skips readings with an unknown scale_index and records the reason', async () => {
		resetMock({
			shelf_items_select: {
				data: [{ id: ITEM_ID_A, scale_index: 0, product_catalog: null }],
				error: null,
			},
			weight_logs_upsert: { data: [{ reading_id: READING_1 }], error: null },
		});

		const res = await telemetryRequest({
			...validPayload,
			readings: [
				{ reading_id: READING_1, scale_index: 0, est_grams: 500 },
				{ reading_id: READING_2, scale_index: 7, est_grams: 300 },
			],
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { accepted: number; skipped: Array<{ reading_id: string; reason: string }> };
		expect(body.accepted).toBe(1);
		expect(body.skipped).toEqual([{ reading_id: READING_2, scale_index: 7, reason: 'unknown_scale' }]);
	});

	it('stores state as null when the product catalog is missing full_weight_g', async () => {
		resetMock({
			shelf_items_select: {
				data: [{ id: ITEM_ID_A, scale_index: 0, product_catalog: { full_weight_g: null, tare_weight_g: null } }],
				error: null,
			},
			weight_logs_upsert: { data: [{ reading_id: READING_1 }], error: null },
		});

		const res = await telemetryRequest(validPayload);
		expect(res.status).toBe(200);
		const upsertCall = mockCalls.find((c) => c.table === 'weight_logs' && c.op === 'upsert');
		const { rows } = upsertCall!.args as { rows: Array<Record<string, unknown>> };
		expect(rows[0].state).toBeNull();
	});

	it('returns accepted=0 when the same reading_id is already stored (idempotent)', async () => {
		resetMock({
			shelf_items_select: {
				data: [{ id: ITEM_ID_A, scale_index: 0, product_catalog: { full_weight_g: 1000, tare_weight_g: 0 } }],
				error: null,
			},
			// Empty data mimics Supabase's `ignoreDuplicates` response when the row already exists
			weight_logs_upsert: { data: [], error: null },
		});

		const res = await telemetryRequest(validPayload);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { accepted: number; skipped: unknown[] };
		expect(body.accepted).toBe(0);
		expect(body.skipped).toEqual([]);
	});

	it('rejects a payload whose sampled_at is too far in the future', async () => {
		const farFuture = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
		const res = await telemetryRequest({ ...validPayload, sampled_at: farFuture });
		expect(res.status).toBe(400);
	});
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Mock Supabase for the shelves route. Two clients are involved:
 *  - getSupabase()         → the per-request service-role client used by the handler
 *  - createClient(...)     → the per-request token-scoped client used by requireUserAuth
 *
 * Both routes share the same chainable mock builder. Programmed responses are
 * keyed by `${table}_${op}` so each test can pre-load exactly the rows / errors
 * the handler will encounter.
 *
 * `auth.admin.getUserById` and `auth.getUser` are stubbed via dedicated handles
 * the test sets per-case.
 */

type MockRow = Record<string, unknown>;
type MockResult = { data: MockRow[] | MockRow | null; error: { message: string } | null };

interface ProgrammedResponses {
	shelves_upsert?: MockResult;
	shelf_members_delete?: MockResult;
	shelf_members_insert?: MockResult;
	shelf_members_select?: MockResult;
	shelf_items_select?: MockResult;
}

interface MockCall {
	table: string;
	op: string;
	args?: unknown;
}

const mockCalls: MockCall[] = [];
let programmed: ProgrammedResponses = {};

let adminGetUserByIdImpl: (id: string) => Promise<{ data: { user: { id: string } } | null; error: { message: string } | null }> = async (
	id,
) => ({
	data: { user: { id } },
	error: null,
});

let getUserImpl: (token: string) => Promise<{ data: { user: { id: string } } | null; error: { message: string } | null }> = async () => ({
	data: { user: { id: DEFAULT_USER_ID } },
	error: null,
});

const DEFAULT_USER_ID = '11111111-1111-4111-8111-111111111111';

function resetMock(responses: ProgrammedResponses = {}) {
	mockCalls.length = 0;
	programmed = responses;
	adminGetUserByIdImpl = async (id) => ({ data: { user: { id } }, error: null });
	getUserImpl = async () => ({ data: { user: { id: DEFAULT_USER_ID } }, error: null });
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
	builder.maybeSingle = () => Promise.resolve(resolveWith());
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
				delete: () => buildQuery(table, 'delete'),
			};
		},
		auth: {
			admin: {
				getUserById: (id: string) => adminGetUserByIdImpl(id),
			},
			getUser: (token: string) => getUserImpl(token),
		},
	};
}

vi.mock('../../src/lib/supabase', () => ({
	getSupabase: () => makeMockClient(),
}));

vi.mock('@supabase/supabase-js', () => ({
	createClient: () => makeMockClient(),
}));

import app from '../../src/index';

const PI_API_KEY = 'test-pi-key-123';
const ENV = {
	PI_API_KEY,
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
};

const SHELF_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = DEFAULT_USER_ID;
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const USER_TOKEN = 'fake-user-jwt';

function postShelves(body: unknown, headers: Record<string, string> = {}) {
	return app.request(
		'/shelves',
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${PI_API_KEY}`,
				'Content-Type': 'application/json',
				...headers,
			},
			body: typeof body === 'string' ? body : JSON.stringify(body),
		},
		ENV,
	);
}

function getShelf(shelfId: string, headers: Record<string, string> = {}) {
	return app.request(
		`/shelves/${shelfId}`,
		{
			method: 'GET',
			headers: {
				Authorization: `Bearer ${USER_TOKEN}`,
				...headers,
			},
		},
		ENV,
	);
}

describe('POST /shelves', () => {
	beforeEach(() => {
		resetMock();
	});

	it('returns 401 when Authorization header is missing', async () => {
		const res = await app.request(
			'/shelves',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ shelf_id: SHELF_ID, user_id: USER_ID }),
			},
			ENV,
		);
		expect(res.status).toBe(401);
	});

	it('returns 400 when payload is missing required fields', async () => {
		const res = await postShelves({ shelf_id: SHELF_ID });
		expect(res.status).toBe(400);
	});

	it('returns 400 when shelf_id is not a UUID', async () => {
		const res = await postShelves({ shelf_id: 'not-a-uuid', user_id: USER_ID });
		expect(res.status).toBe(400);
	});

	it('returns 404 when user_id is not a known auth user', async () => {
		adminGetUserByIdImpl = async () => ({ data: null, error: { message: 'User not found' } });

		const res = await postShelves({ shelf_id: SHELF_ID, user_id: USER_ID });
		expect(res.status).toBe(404);
	});

	it('creates the shelf, clears existing membership, and inserts the owner', async () => {
		const res = await postShelves({ shelf_id: SHELF_ID, user_id: USER_ID });
		expect(res.status).toBe(200);

		const body = (await res.json()) as { shelf_id: string };
		expect(body.shelf_id).toBe(SHELF_ID);

		// shelves upsert with the generated default name
		const upsertCall = mockCalls.find((c) => c.table === 'shelves' && c.op === 'upsert');
		expect(upsertCall).toBeDefined();
		expect(upsertCall!.args).toMatchObject({ rows: { id: SHELF_ID, name: expect.stringContaining('Shelf ') } });

		// membership cleared, then inserted with role=owner
		const deleteCall = mockCalls.find((c) => c.table === 'shelf_members' && c.op === 'delete');
		expect(deleteCall).toBeDefined();
		const deleteEqArgs = mockCalls.find((c) => c.table === 'shelf_members' && c.op === 'delete:eq')!.args as unknown[];
		expect(deleteEqArgs).toEqual(['shelf_id', SHELF_ID]);

		const insertCall = mockCalls.find((c) => c.table === 'shelf_members' && c.op === 'insert');
		expect(insertCall).toBeDefined();
		expect(insertCall!.args).toMatchObject({ shelf_id: SHELF_ID, user_id: USER_ID, role: 'owner' });
	});

	it('replaces membership cleanly when called with a different user_id', async () => {
		await postShelves({ shelf_id: SHELF_ID, user_id: USER_ID });
		mockCalls.length = 0;

		const res = await postShelves({ shelf_id: SHELF_ID, user_id: OTHER_USER_ID });
		expect(res.status).toBe(200);

		const insertCall = mockCalls.find((c) => c.table === 'shelf_members' && c.op === 'insert');
		expect(insertCall!.args).toMatchObject({ shelf_id: SHELF_ID, user_id: OTHER_USER_ID });
	});

	it('is idempotent when called with the same payload twice', async () => {
		const first = await postShelves({ shelf_id: SHELF_ID, user_id: USER_ID });
		const second = await postShelves({ shelf_id: SHELF_ID, user_id: USER_ID });
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
	});

	it('returns 500 when shelves upsert fails', async () => {
		resetMock({ shelves_upsert: { data: null, error: { message: 'boom' } } });

		const res = await postShelves({ shelf_id: SHELF_ID, user_id: USER_ID });
		expect(res.status).toBe(500);
	});
});

describe('GET /shelves/:shelfId', () => {
	beforeEach(() => {
		resetMock();
	});

	it('returns 401 when Authorization header is missing', async () => {
		const res = await app.request(`/shelves/${SHELF_ID}`, { method: 'GET' }, ENV);
		expect(res.status).toBe(401);
	});

	it('returns 401 when the user JWT is rejected by Supabase', async () => {
		getUserImpl = async () => ({ data: null, error: { message: 'invalid' } });

		const res = await getShelf(SHELF_ID);
		expect(res.status).toBe(401);
	});

	it('returns 404 when the user is not a member of the shelf', async () => {
		resetMock({
			shelf_members_select: { data: null, error: null },
		});

		const res = await getShelf(SHELF_ID);
		expect(res.status).toBe(404);
	});

	it('returns 404 when the shelf_id is malformed', async () => {
		const res = await getShelf('not-a-uuid');
		expect(res.status).toBe(404);
	});

	it('returns 200 with items when the user is a member', async () => {
		resetMock({
			shelf_members_select: { data: { shelf_id: SHELF_ID }, error: null },
			shelf_items_select: {
				data: [
					{ scale_index: 0, current_weight_g: 0 },
					{ scale_index: 1, current_weight_g: 247.3 },
				],
				error: null,
			},
		});

		const res = await getShelf(SHELF_ID);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { shelf_id: string; items: Array<{ scale_index: number; current_weight_g: number }> };
		expect(body.shelf_id).toBe(SHELF_ID);
		expect(body.items).toHaveLength(2);
		expect(body.items[0]).toEqual({ scale_index: 0, current_weight_g: 0 });
		expect(body.items[1]).toEqual({ scale_index: 1, current_weight_g: 247.3 });
	});

	it('returns an empty items array when the shelf has no attached products yet', async () => {
		resetMock({
			shelf_members_select: { data: { shelf_id: SHELF_ID }, error: null },
			shelf_items_select: { data: [], error: null },
		});

		const res = await getShelf(SHELF_ID);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { items: unknown[] };
		expect(body.items).toEqual([]);
	});

	it('scopes the membership lookup to the authenticated user', async () => {
		resetMock({
			shelf_members_select: { data: null, error: null },
		});
		getUserImpl = async () => ({ data: { user: { id: OTHER_USER_ID } }, error: null });

		await getShelf(SHELF_ID);

		const eqCalls = mockCalls.filter((c) => c.table === 'shelf_members' && c.op === 'select:eq');
		const userIdEq = eqCalls.find((c) => Array.isArray(c.args) && (c.args as unknown[])[0] === 'user_id');
		expect(userIdEq).toBeDefined();
		expect((userIdEq!.args as unknown[])[1]).toBe(OTHER_USER_ID);
	});
});

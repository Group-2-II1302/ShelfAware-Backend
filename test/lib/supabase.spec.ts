import { describe, it, expect } from 'vitest';
import { getSupabase } from '../../src/lib/supabase';

describe('getSupabase', () => {
	it('constructs a typed client from env without throwing', () => {
		const client = getSupabase({
			SUPABASE_URL: 'https://example.supabase.co',
			SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
		});

		expect(client).toBeDefined();
		expect(typeof client.from).toBe('function');
	});

	it('returns a fresh client on each call (no module-level caching)', () => {
		const env = {
			SUPABASE_URL: 'https://example.supabase.co',
			SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
		};
		const a = getSupabase(env);
		const b = getSupabase(env);
		expect(a).not.toBe(b);
	});
});

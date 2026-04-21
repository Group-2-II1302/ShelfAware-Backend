import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

export type ShelfAwareSupabaseClient = SupabaseClient<Database>;

export interface SupabaseEnv {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
}

/**
 * Build a Supabase client for the current request.
 *
 * A new client is created per request because Workers are stateless: module-level
 * clients would leak auth state across requests in the same isolate.
 */
export function getSupabase(env: SupabaseEnv): ShelfAwareSupabaseClient {
	return createClient<Database, 'public'>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});
}

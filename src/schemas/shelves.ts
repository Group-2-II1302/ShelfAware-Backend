import { z } from 'zod';

/**
 * JSON contract for POST /shelves (Pi self-registration).
 *
 * Process B sends this on every Pi startup. The handler is idempotent on
 * `shelf_id` and treats every call as authoritative for ownership — the
 * Pi is the source of truth for "who owns this device" because the user
 * just provisioned it via the captive portal.
 *
 * For multi-user invites (a separate user posts a `shelf_members` row to
 * grant a friend access), build a different endpoint that does NOT replace
 * existing membership.
 */
export const ShelfRegistrationPayloadSchema = z
	.object({
		shelf_id: z.string().uuid(),
		user_id: z.string().uuid().describe('Supabase auth.users.id of the user who provisioned the Pi'),
	})
	.strict();

export type ShelfRegistrationPayload = z.infer<typeof ShelfRegistrationPayloadSchema>;

/**
 * Path-parameter schema for GET /shelves/:shelf_id.
 *
 * Hono passes path params as strings; reject non-UUIDs early so the handler
 * never reaches Supabase with a malformed identifier (which would surface as
 * a confusing 5xx instead of a clean 404).
 */
export const ShelfIdParamSchema = z.string().uuid();

/**
 * The single item shape returned by GET /shelves/:shelf_id.
 *
 * Intentionally minimal: the companion app only polls this to detect the
 * 404 → 200 transition after provisioning, and the shelf-detail UI primarily
 * cares about per-slot weight. Add fields here as actual consumers need them
 * — don't speculate.
 */
export interface ShelfItemDTO {
	scale_index: number;
	current_weight_g: number | null;
}

export interface ShelfResponse {
	shelf_id: string;
	items: ShelfItemDTO[];
}

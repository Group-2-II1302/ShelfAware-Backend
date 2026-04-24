import { z } from 'zod';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the `X-Shelf-Id` header sent by the Pi on every authenticated request.
 * Kept as a standalone schema so both /telemetry and /commands can share it.
 */
export const ShelfIdHeaderSchema = z.string().regex(UUID_PATTERN, 'X-Shelf-Id must be a UUIDv4');

/**
 * Supported command names. Keep this union in sync with whatever the Pi's Process A
 * actually reacts to — unknown commands should be a contract violation, not silently
 * ignored by the Pi.
 *
 * Only `wake` is modeled for now. Sleep is intentionally left out: Process A self-sleeps
 * via a local inactivity timer, which avoids needing the backend to track frontend
 * sessions. Declared as an enum (not a string) so adding commands later is an explicit
 * contract change visible to both sides.
 */
export const CommandNameSchema = z.enum(['wake']);

export type CommandName = z.infer<typeof CommandNameSchema>;

export interface CommandDTO {
	id: string;
	command: CommandName;
	payload: unknown;
	expires_at: string;
}

export interface CommandsResponse {
	commands: CommandDTO[];
}

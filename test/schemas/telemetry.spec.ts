import { describe, it, expect } from 'vitest';
import { TelemetryPayloadSchema } from '../../src/schemas/telemetry';

const VALID_SHELF = '550e8400-e29b-41d4-a716-446655440000';
const VALID_READING_ID = '123e4567-e89b-12d3-a456-426614174000';

function basePayload(overrides: Partial<Parameters<typeof TelemetryPayloadSchema.parse>[0]> = {}) {
	return {
		shelf_id: VALID_SHELF,
		sampled_at: '2026-04-21T10:30:00Z',
		readings: [{ reading_id: VALID_READING_ID, scale_index: 0, est_grams: 500 }],
		...overrides,
	};
}

describe('TelemetryPayloadSchema', () => {
	it('accepts a minimal valid payload', () => {
		const result = TelemetryPayloadSchema.safeParse(basePayload());
		expect(result.success).toBe(true);
	});

	it('accepts optional metadata fields', () => {
		const result = TelemetryPayloadSchema.safeParse(basePayload({ metadata: { battery: 88, rssi: -65 } }));
		expect(result.success).toBe(true);
	});

	it('rejects a non-UUID shelf_id', () => {
		const result = TelemetryPayloadSchema.safeParse(basePayload({ shelf_id: 'PI_SHELF_01' }));
		expect(result.success).toBe(false);
	});

	it('rejects a timestamp without timezone info', () => {
		const result = TelemetryPayloadSchema.safeParse(basePayload({ sampled_at: '2026-04-21T10:30:00' }));
		expect(result.success).toBe(false);
	});

	it('rejects an empty readings array', () => {
		const result = TelemetryPayloadSchema.safeParse(basePayload({ readings: [] }));
		expect(result.success).toBe(false);
	});

	it('rejects negative weights (the Pi should clamp these before sending)', () => {
		const result = TelemetryPayloadSchema.safeParse(
			basePayload({ readings: [{ reading_id: VALID_READING_ID, scale_index: 0, est_grams: -10 }] }),
		);
		expect(result.success).toBe(false);
	});

	it('rejects battery > 100', () => {
		const result = TelemetryPayloadSchema.safeParse(basePayload({ metadata: { battery: 150 } }));
		expect(result.success).toBe(false);
	});

	it('rejects unknown top-level fields (strict mode catches typos)', () => {
		const result = TelemetryPayloadSchema.safeParse({ ...basePayload(), device_id: 'PI_SHELF_01' });
		expect(result.success).toBe(false);
	});

	it('rejects batches larger than MAX_BATCH_SIZE', () => {
		const readings = Array.from({ length: 101 }, (_, i) => ({
			reading_id: `123e4567-e89b-12d3-a456-${String(i).padStart(12, '0')}`,
			scale_index: 0,
			est_grams: 500,
		}));
		const result = TelemetryPayloadSchema.safeParse(basePayload({ readings }));
		expect(result.success).toBe(false);
	});
});

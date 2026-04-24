import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { requireDeviceAuth, type DeviceAuthEnv } from '../middleware/auth';
import { getSupabase } from '../lib/supabase';
import { computeState } from '../lib/state';
import { TelemetryPayloadSchema, TELEMETRY_LIMITS, type TelemetryPayload, type TelemetryReading } from '../schemas/telemetry';
import type { Json } from '../types/supabase';

type SkipReason = 'unknown_scale' | 'future_timestamp';

interface SkippedReading {
	reading_id: string;
	scale_index: number;
	reason: SkipReason;
}

interface TelemetryResponse {
	accepted: number;
	skipped: SkippedReading[];
}

/**
 * Shelf-items joined to their product_catalog row. We fetch all configured
 * slots for a shelf in a single query rather than per-reading because:
 *  - A batch often contains readings from multiple scales on the same shelf
 *  - Most batches contain <10 readings, so we're looking at ~3 slots max
 *  - One join is cheaper than N round-trips
 */
interface ShelfItemLookup {
	id: string;
	scale_index: number;
	full_weight_g: number | null;
	tare_weight_g: number | null;
}

const telemetry = new Hono<{ Bindings: DeviceAuthEnv }>();

telemetry.post('/telemetry', requireDeviceAuth, zValidator('json', TelemetryPayloadSchema), async (c) => {
	const payload = c.req.valid('json') as TelemetryPayload;

	// Hard-reject batches with a future sampled_at. A skewed clock is a bug,
	// not a retry-able condition — keeping them out of the DB prevents "now" queries
	// from returning phantom rows timestamped tomorrow.
	const sampledAtMs = Date.parse(payload.sampled_at);
	if (sampledAtMs - Date.now() > TELEMETRY_LIMITS.MAX_FUTURE_SKEW_MS) {
		throw new HTTPException(400, { message: 'sampled_at is too far in the future' });
	}

	const supabase = getSupabase(c.env);

	const { data: items, error: itemsError } = await supabase
		.from('shelf_items')
		.select('id, scale_index, product_catalog(full_weight_g, tare_weight_g)')
		.eq('shelf_id', payload.shelf_id);

	if (itemsError) {
		console.error('shelf_items lookup failed', itemsError);
		throw new HTTPException(500, { message: 'Failed to resolve shelf items' });
	}

	const lookupByScale = new Map<number, ShelfItemLookup>();
	for (const row of items ?? []) {
		// product_catalog is typed as an array when the FK isn't declared as one-to-one,
		// but the FK here is barcode → product_catalog (1:1-ish), so Supabase returns
		// either a single row or null. Normalize to handle both shapes defensively.
		const productRaw = (row as { product_catalog: unknown }).product_catalog;
		const product = Array.isArray(productRaw) ? productRaw[0] : productRaw;
		const typedProduct = product as { full_weight_g: number | null; tare_weight_g: number | null } | null | undefined;

		lookupByScale.set(row.scale_index, {
			id: row.id,
			scale_index: row.scale_index,
			full_weight_g: typedProduct?.full_weight_g ?? null,
			tare_weight_g: typedProduct?.tare_weight_g ?? null,
		});
	}

	interface PreparedRow {
		reading: TelemetryReading;
		item: ShelfItemLookup;
		state: number | null;
	}

	const prepared: PreparedRow[] = [];
	const skipped: SkippedReading[] = [];

	for (const reading of payload.readings) {
		const item = lookupByScale.get(reading.scale_index);
		if (!item) {
			skipped.push({ reading_id: reading.reading_id, scale_index: reading.scale_index, reason: 'unknown_scale' });
			continue;
		}

		prepared.push({
			reading,
			item,
			state: computeState({
				est_grams: reading.est_grams,
				full_weight_g: item.full_weight_g,
				tare_weight_g: item.tare_weight_g,
			}),
		});
	}

	let accepted = 0;

	if (prepared.length > 0) {
		const insertRows = prepared.map(({ reading, item, state }) => ({
			item_id: item.id,
			reading_id: reading.reading_id,
			weight_g: reading.est_grams,
			state,
			sampled_at: payload.sampled_at,
		}));

		const { data: inserted, error: insertError } = await supabase
			.from('weight_logs')
			.upsert(insertRows, { onConflict: 'reading_id', ignoreDuplicates: true })
			.select('reading_id');

		if (insertError) {
			console.error('weight_logs upsert failed', insertError);
			throw new HTTPException(500, { message: 'Failed to persist readings' });
		}

		accepted = inserted?.length ?? 0;

		// Mirror the latest reading per item into shelf_items.current_weight_g so the
		// frontend can read "current state" in a single query. We only need one update
		// per item even if the batch has multiple readings for the same scale — take
		// the last one (which is the most recent within the batch's sampled_at window).
		const latestByItemId = new Map<string, PreparedRow>();
		for (const row of prepared) {
			latestByItemId.set(row.item.id, row);
		}

		const serverTimestamp = new Date().toISOString();
		await Promise.all(
			Array.from(latestByItemId.values()).map(({ reading, item }) =>
				supabase
					.from('shelf_items')
					.update({
						current_weight_g: reading.est_grams,
						device_timestamp: payload.sampled_at,
						server_timestamp: serverTimestamp,
					})
					.eq('id', item.id),
			),
		);
	}

	// Merge device health metrics (battery/rssi) into shelves.metadata. Fire-and-forget
	// via waitUntil so the Pi's response isn't delayed by this "nice to have" update.
	if (payload.metadata) {
		const shelfId = payload.shelf_id;
		const nextMetadata = payload.metadata;
		c.executionCtx.waitUntil(mergeShelfMetadata(supabase, shelfId, nextMetadata));
	}

	const response: TelemetryResponse = { accepted, skipped };
	return c.json(response);
});

/**
 * Merge device metrics into shelves.metadata without clobbering unrelated fields.
 *
 * Uses read-modify-write rather than jsonb concat because the Supabase JS client
 * doesn't expose `||` cleanly. The race window (two concurrent telemetry POSTs
 * from the same Pi) is essentially zero for an MVP: one Pi, ~1 Hz max cadence,
 * serialized through the outbox. Upgrade to a Postgres RPC if this ever matters.
 */
async function mergeShelfMetadata(
	supabase: ReturnType<typeof getSupabase>,
	shelfId: string,
	incoming: { battery?: number; rssi?: number },
): Promise<void> {
	const { data, error } = await supabase.from('shelves').select('metadata').eq('id', shelfId).single();

	if (error) {
		console.error('shelves metadata read failed', error);
		return;
	}

	const existing = (data?.metadata as Record<string, unknown> | null) ?? {};
	const merged: Record<string, Json> = {
		...(existing as Record<string, Json>),
		...(incoming.battery !== undefined ? { battery: incoming.battery } : {}),
		...(incoming.rssi !== undefined ? { rssi: incoming.rssi } : {}),
		device_metadata_updated_at: new Date().toISOString(),
	};

	const { error: updateError } = await supabase.from('shelves').update({ metadata: merged }).eq('id', shelfId);
	if (updateError) {
		console.error('shelves metadata update failed', updateError);
	}
}

export default telemetry;

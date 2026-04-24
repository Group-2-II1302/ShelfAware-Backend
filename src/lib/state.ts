/**
 * Shelf-item "fullness" state, computed server-side from the Pi's cleaned
 * `est_grams` reading and the product catalog's reference weights.
 *
 * We compute state on the backend (not the Pi) so Process A never needs to
 * call the backend for `full_weight_g` during sampling. Process A stays
 * offline-capable; it only emits physical measurements.
 */

export interface StateInputs {
	/** Cleaned weight in grams from the Pi. Required. */
	est_grams: number;
	/** Full content + packaging weight from product_catalog. Nullable in schema. */
	full_weight_g: number | null;
	/** Packaging-only weight. Nullable; treated as 0 when unknown. */
	tare_weight_g: number | null;
}

/**
 * Compute fill ratio in [0, 1], or null if we can't.
 *
 * Formula:
 *     state = (est_grams - tare) / (full - tare)
 *
 * The tare subtraction matters: an empty 50 g peanut-butter jar should read
 * 0% full, not ~10% full just because the glass has mass.
 *
 * Returns null when:
 *  - full_weight_g is missing (no calibration → undefined denominator)
 *  - full_weight_g <= tare_weight_g (bad catalog data; would divide by <=0)
 *
 * A null `tare_weight_g` is treated as 0 — a common case for products where
 * tare wasn't captured during catalog entry.
 */
export function computeState({ est_grams, full_weight_g, tare_weight_g }: StateInputs): number | null {
	if (full_weight_g === null || full_weight_g === undefined) return null;

	const tare = tare_weight_g ?? 0;
	const denominator = full_weight_g - tare;
	if (denominator <= 0) return null;

	const ratio = (est_grams - tare) / denominator;
	if (!Number.isFinite(ratio)) return null;

	// Clamp to [0, 1]: readings slightly over full (overfilled, calibration drift)
	// or slightly under tare (sensor noise at empty) shouldn't produce out-of-range
	// state values. Frontend can always check `est_grams` directly for raw truth.
	if (ratio < 0) return 0;
	if (ratio > 1) return 1;
	return ratio;
}

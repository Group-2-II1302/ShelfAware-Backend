import { describe, it, expect } from 'vitest';
import { computeState } from '../../src/lib/state';

describe('computeState', () => {
	it('computes a fill ratio using tare-aware math', () => {
		// 50 g jar containing 500 g / 1000 g of content = 50% full content-wise
		const state = computeState({ est_grams: 550, full_weight_g: 1050, tare_weight_g: 50 });
		expect(state).toBeCloseTo(0.5, 5);
	});

	it('treats a null tare as zero', () => {
		const state = computeState({ est_grams: 500, full_weight_g: 1000, tare_weight_g: null });
		expect(state).toBe(0.5);
	});

	it('returns 0 for an empty jar (equal to tare)', () => {
		const state = computeState({ est_grams: 50, full_weight_g: 1050, tare_weight_g: 50 });
		expect(state).toBe(0);
	});

	it('returns 1 for a full jar', () => {
		const state = computeState({ est_grams: 1050, full_weight_g: 1050, tare_weight_g: 50 });
		expect(state).toBe(1);
	});

	it('clamps overfilled readings to 1', () => {
		const state = computeState({ est_grams: 1200, full_weight_g: 1050, tare_weight_g: 50 });
		expect(state).toBe(1);
	});

	it('clamps noise-below-tare readings to 0', () => {
		const state = computeState({ est_grams: 40, full_weight_g: 1050, tare_weight_g: 50 });
		expect(state).toBe(0);
	});

	it('returns null when full_weight_g is missing', () => {
		expect(computeState({ est_grams: 500, full_weight_g: null, tare_weight_g: 0 })).toBeNull();
	});

	it('returns null for bad catalog data where tare >= full', () => {
		expect(computeState({ est_grams: 500, full_weight_g: 50, tare_weight_g: 100 })).toBeNull();
	});

	it('returns null when the computed ratio is non-finite', () => {
		// full == tare would divide by zero; guarded by the <= 0 check and returns null
		expect(computeState({ est_grams: 500, full_weight_g: 100, tare_weight_g: 100 })).toBeNull();
	});
});

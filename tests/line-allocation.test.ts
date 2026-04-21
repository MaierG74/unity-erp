import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateLinesByArea } from '../lib/orders/line-allocation';

test('allocates proportionally by cutlist area', () => {
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: 4_000_000 },
      { order_detail_id: 2, area_mm2: 6_000_000 },
    ],
    800, // total_nested_cost (20% saving vs 1000 padded)
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].order_detail_id, 1);
  assert.equal(Math.round(result[0].line_share_amount * 100) / 100, 320);
  assert.equal(Math.round(result[0].allocation_pct * 10) / 10, 40);
  assert.equal(Math.round(result[1].line_share_amount * 100) / 100, 480);
  assert.equal(Math.round(result[1].allocation_pct * 10) / 10, 60);
});

test('allocation shares sum exactly to total_nested_cost (rounding-safe)', () => {
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: 3_333_333 },
      { order_detail_id: 2, area_mm2: 3_333_333 },
      { order_detail_id: 3, area_mm2: 3_333_334 },
    ],
    1000,
  );
  const sum = result.reduce((s, a) => s + a.line_share_amount, 0);
  assert.equal(Math.round(sum * 100) / 100, 1000);
});

test('empty lines returns empty allocation', () => {
  const result = allocateLinesByArea([], 500);
  assert.deepEqual(result, []);
});

test('zero-area lines excluded from allocation (not split evenly)', () => {
  // Two cutlist lines + one non-cutlist-only line.
  // Nested cost only splits across the two cutlist lines.
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: 5_000_000 },
      { order_detail_id: 2, area_mm2: 5_000_000 },
      { order_detail_id: 3, area_mm2: 0 }, // non-cutlist-only line
    ],
    600,
  );
  assert.equal(result.length, 3);
  const byId = new Map(result.map((r) => [r.order_detail_id, r]));
  assert.equal(byId.get(1)!.line_share_amount, 300);
  assert.equal(byId.get(2)!.line_share_amount, 300);
  assert.equal(byId.get(3)!.line_share_amount, 0);
  assert.equal(byId.get(3)!.allocation_pct, 0);
});

test('all zero-area lines return all-zero allocation (defensive)', () => {
  // Should not happen in practice (a plan can't exist without cutlist parts),
  // but be defensive: return zero shares, don't divide by zero.
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: 0 },
      { order_detail_id: 2, area_mm2: 0 },
    ],
    100,
  );
  assert.equal(result[0].line_share_amount, 0);
  assert.equal(result[1].line_share_amount, 0);
  assert.equal(result[0].allocation_pct, 0);
});

test('non-finite areas treated as zero', () => {
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: Number.NaN },
      { order_detail_id: 2, area_mm2: Number.POSITIVE_INFINITY },
      { order_detail_id: 3, area_mm2: 5_000_000 },
    ],
    200,
  );
  assert.equal(result[0].line_share_amount, 0);
  assert.equal(result[1].line_share_amount, 0);
  assert.equal(result[2].line_share_amount, 200);
});

test('single cutlist line gets the entire nested cost', () => {
  const result = allocateLinesByArea(
    [{ order_detail_id: 1, area_mm2: 5_000_000 }],
    750,
  );
  assert.equal(result[0].line_share_amount, 750);
  assert.equal(result[0].allocation_pct, 100);
});

import { describe, expect, it } from 'vitest';
import { resolveCutlistSurcharge } from '@/lib/orders/cutlist-surcharge';

function computeCutlistSurchargeLikeSql(input: {
  kind?: string | null;
  value?: number | null;
  quantity?: number | null;
  unitPrice?: number | null;
}) {
  const value = input.value ?? 0;
  const quantity = input.quantity ?? 0;
  const unitPrice = input.unitPrice ?? 0;
  const raw = input.kind === 'percentage'
    ? unitPrice * quantity * value / 100
    : value * quantity;

  if (raw === 0) return 0;
  return Math.sign(raw) * Math.round(Math.abs(raw) * 100) / 100;
}

describe('resolveCutlistSurcharge', () => {
  const parityFixtures = [
    { name: 'fixed positive', kind: 'fixed', value: 200, quantity: 3, unitPrice: 1000, expected: 600 },
    { name: 'fixed negative', kind: 'fixed', value: -100, quantity: 2, unitPrice: 1000, expected: -200 },
    { name: 'fixed zero', kind: 'fixed', value: 0, quantity: 3, unitPrice: 1000, expected: 0 },
    { name: 'percentage 0%', kind: 'percentage', value: 0, quantity: 2, unitPrice: 1000, expected: 0 },
    { name: 'percentage 7%', kind: 'percentage', value: 7, quantity: 2, unitPrice: 1000, expected: 140 },
    { name: 'percentage 100%', kind: 'percentage', value: 100, quantity: 2, unitPrice: 500, expected: 1000 },
    { name: 'percentage with unit_price=0', kind: 'percentage', value: 15, quantity: 3, unitPrice: 0, expected: 0 },
    { name: 'percentage with quantity=0', kind: 'percentage', value: 15, quantity: 0, unitPrice: 2000, expected: 0 },
    { name: 'decimal unit_price', kind: 'percentage', value: 15, quantity: 1, unitPrice: 1234.56, expected: 185.18 },
    { name: 'NULL value', kind: 'percentage', value: null, quantity: 2, unitPrice: 1000, expected: 0 },
    { name: 'negative half-cent mirrors Postgres rounding', kind: 'fixed', value: -1.005, quantity: 1, unitPrice: 0, expected: -1 },
  ];

  for (const fixture of parityFixtures) {
    it(`matches SQL formula for ${fixture.name}`, () => {
      const sqlLike = computeCutlistSurchargeLikeSql(fixture);
      expect(sqlLike).toBe(fixture.expected);
      expect(resolveCutlistSurcharge(fixture)).toBe(sqlLike);
    });
  }

  it('normalizes empty string surcharge values to zero', () => {
    expect(resolveCutlistSurcharge({
      kind: 'percentage',
      value: '',
      quantity: 2,
      unitPrice: 1000,
    })).toBe(0);
  });

  it('coalesces NaN-ish inputs to zero instead of returning NaN', () => {
    expect(resolveCutlistSurcharge({
      kind: 'fixed',
      value: 'not numeric',
      quantity: 2,
      unitPrice: 1000,
    })).toBe(0);
  });
});

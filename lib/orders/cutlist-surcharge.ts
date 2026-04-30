export type CutlistSurchargeKind = 'fixed' | 'percentage';

function coerceNumeric(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundPostgresNumeric(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Math.sign(value) * Math.round(Math.abs(value) * 100) / 100;
}

export function resolveCutlistSurcharge(input: {
  kind?: CutlistSurchargeKind | string | null;
  value?: number | string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
}): number {
  const kind = input.kind === 'percentage' ? 'percentage' : 'fixed';
  const value = coerceNumeric(input.value);
  const quantity = coerceNumeric(input.quantity);
  const unitPrice = coerceNumeric(input.unitPrice);

  if (kind === 'percentage') {
    return roundPostgresNumeric(unitPrice * quantity * value / 100);
  }
  return roundPostgresNumeric(value * quantity);
}

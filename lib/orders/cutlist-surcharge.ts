export type CutlistSurchargeKind = 'fixed' | 'percentage';

export function resolveCutlistSurcharge(input: {
  kind?: CutlistSurchargeKind | string | null;
  value?: number | string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
}): number {
  const kind = input.kind === 'percentage' ? 'percentage' : 'fixed';
  const value = Number(input.value ?? 0);
  const quantity = Number(input.quantity ?? 0);
  const unitPrice = Number(input.unitPrice ?? 0);

  if (!Number.isFinite(value) || !Number.isFinite(quantity) || quantity <= 0) return 0;
  if (kind === 'percentage') {
    if (!Number.isFinite(unitPrice)) return 0;
    return Math.round((unitPrice * quantity * (value / 100)) * 100) / 100;
  }
  return Math.round((value * quantity) * 100) / 100;
}

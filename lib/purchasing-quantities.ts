const QUANTITY_ROUNDING_SCALE = 6;
const QUANTITY_DISPLAY_SCALE = 4;
const QUANTITY_EPSILON = 0.000001;

type QuantityLike = number | string | null | undefined;

export function toQuantityNumber(value: QuantityLike): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeQuantity(value: QuantityLike, scale = QUANTITY_ROUNDING_SCALE): number {
  return Number(toQuantityNumber(value).toFixed(scale));
}

export function formatQuantity(value: QuantityLike, scale = QUANTITY_DISPLAY_SCALE): string {
  return normalizeQuantity(value, scale).toFixed(scale).replace(/\.?0+$/, '');
}

export function quantitiesEqual(left: QuantityLike, right: QuantityLike): boolean {
  return Math.abs(toQuantityNumber(left) - toQuantityNumber(right)) < QUANTITY_EPSILON;
}

export function isPositiveQuantity(value: QuantityLike): boolean {
  return toQuantityNumber(value) > QUANTITY_EPSILON;
}

export function getRemainingQuantity(ordered: QuantityLike, received: QuantityLike, closed: QuantityLike = 0): number {
  return normalizeQuantity(Math.max(toQuantityNumber(ordered) - toQuantityNumber(received) - toQuantityNumber(closed), 0));
}

export function getOutstandingQuantity(ordered: QuantityLike, received: QuantityLike, closed: QuantityLike = 0): number {
  return getRemainingQuantity(ordered, received, closed);
}

export function hasOutstandingQuantity(ordered: QuantityLike, received: QuantityLike, closed: QuantityLike = 0): boolean {
  return isPositiveQuantity(getRemainingQuantity(ordered, received, closed));
}

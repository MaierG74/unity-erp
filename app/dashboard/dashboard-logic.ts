type NumericLike = number | string | null | undefined;

type LowStockLike = {
  quantity_on_hand?: NumericLike;
  quantity_reserved?: NumericLike;
  reorder_level?: NumericLike;
};

function toNumberValue(value: NumericLike) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Available stock = on-hand minus the hard picking hold (inventory.quantity_reserved).
 * Dashboard low-stock alerts trigger on available, not raw on-hand, so reserved
 * (held) units don't mask a shortfall.
 */
export function getAvailableQuantity(item: LowStockLike) {
  return toNumberValue(item.quantity_on_hand) - toNumberValue(item.quantity_reserved);
}

export function isLowStockItem(item: LowStockLike) {
  const reorderLevel = toNumberValue(item.reorder_level);
  return reorderLevel > 0 && getAvailableQuantity(item) <= reorderLevel;
}

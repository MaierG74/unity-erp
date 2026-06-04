type NumericLike = number | string | null | undefined;

type LowStockLike = {
  quantity_on_hand?: NumericLike;
  reorder_level?: NumericLike;
};

function toNumberValue(value: NumericLike) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isLowStockItem(item: LowStockLike) {
  const reorderLevel = toNumberValue(item.reorder_level);
  return reorderLevel > 0 && toNumberValue(item.quantity_on_hand) <= reorderLevel;
}

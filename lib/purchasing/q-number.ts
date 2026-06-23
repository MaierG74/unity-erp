const PURCHASE_ORDER_Q_NUMBER_PATTERN = /^Q\d{2}-\d{3,}$/;

export function isPurchaseOrderQNumber(value: string): boolean {
  return PURCHASE_ORDER_Q_NUMBER_PATTERN.test(value.trim());
}

export function suggestPurchaseOrderQNumber(
  purchaseOrderId: number | string,
  date: Date = new Date()
): string {
  const year = date.getFullYear().toString().slice(-2);
  const sequence = String(purchaseOrderId).trim().padStart(3, '0');

  return `Q${year}-${sequence}`;
}

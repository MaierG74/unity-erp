/**
 * Shared formatting utility functions.
 */

/** Format a numeric amount as South-African Rand (R x.xx). Returns 'N/A' for null/undefined. */
export function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return 'N/A';
  return `R ${amount.toFixed(2)}`;
}

/** Format a quantity value — integers stay whole, decimals show two places. */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0';
  }
  const numeric = Number(value);
  if (Math.abs(numeric - Math.round(numeric)) < 0.001) {
    return Math.round(numeric).toString();
  }
  return numeric.toFixed(2);
}

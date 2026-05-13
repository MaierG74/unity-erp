export function targetReservable(required: number, available: number): number {
  const req = Number.isFinite(required) ? required : 0;
  const avail = Number.isFinite(available) ? available : 0;
  return Math.max(0, Math.min(req, avail));
}

export function canReserveMore(
  required: number,
  available: number,
  reservedThisOrder: number
): boolean {
  if (!Number.isFinite(required) || !Number.isFinite(available)) return false;
  const reserved = Number.isFinite(reservedThisOrder) ? reservedThisOrder : 0;
  return targetReservable(required, available) > reserved;
}

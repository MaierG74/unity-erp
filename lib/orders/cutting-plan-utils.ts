import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Compute a hash of order details state for stale-save detection.
 * Inputs: detail IDs, quantities, and cutlist snapshot content.
 */
export function computeSourceRevision(
  details: Array<{
    order_detail_id: number;
    quantity: number;
    cutlist_snapshot: unknown;
  }>
): string {
  const payload = details
    .sort((a, b) => a.order_detail_id - b.order_detail_id)
    .map((d) => `${d.order_detail_id}:${d.quantity}:${JSON.stringify(d.cutlist_snapshot ?? null)}`)
    .join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Mark the cutting plan as stale for a given order.
 * Safe to call when no cutting plan exists (no-op via Postgres function).
 */
export async function markCuttingPlanStale(
  orderId: number,
  supabase: SupabaseClient
) {
  await supabase.rpc('mark_cutting_plan_stale', { p_order_id: orderId });
}

/**
 * Mark the cutting plan as stale for the order that owns a given order_detail.
 * Convenience wrapper — accepts the order_id directly.
 */
export async function markCuttingPlanStaleForDetail(
  detailOrderId: number,
  supabase: SupabaseClient
) {
  await supabase.rpc('mark_cutting_plan_stale', { p_order_id: detailOrderId });
}

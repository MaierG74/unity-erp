import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaterialAssignments } from './material-assignment-types';

/**
 * Compute a hash of order details + material assignments state for stale-save detection.
 * Inputs: detail IDs, quantities, cutlist snapshot content, AND the assignments JSONB.
 * Canonicalised: every assignments array is sorted so reordering doesn't affect the hash.
 */
export function computeSourceRevision(
  details: Array<{
    order_detail_id: number;
    quantity: number;
    cutlist_snapshot: unknown;
  }>,
  assignments: MaterialAssignments | null,
): string {
  const detailsPayload = [...details]
    .sort((a, b) => a.order_detail_id - b.order_detail_id)
    .map((d) => `${d.order_detail_id}:${d.quantity}:${JSON.stringify(d.cutlist_snapshot ?? null)}`)
    .join('|');

  // Normalise to a canonical shape so null and empty hash identically and all
  // array orders produce the same payload.
  const a = assignments ?? {
    version: 1 as const,
    assignments: [],
    backer_default: null,
    edging_defaults: [],
    edging_overrides: [],
  };

  // Guard against malformed JSONB — match the Array.isArray pattern used in
  // line-material-cost.ts and cutting-plan-aggregate.ts.
  const rawAssignments = Array.isArray(a.assignments) ? a.assignments : [];
  const rawEdgingDefaults = Array.isArray(a.edging_defaults) ? a.edging_defaults : [];
  const rawEdgingOverrides = Array.isArray(a.edging_overrides) ? a.edging_overrides : [];

  // Use plain `<`/`>` comparison (not localeCompare) for locale-independent determinism —
  // ICU locale variation could otherwise produce different hashes across environments.
  const fpCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const roleKey = (r: { order_detail_id: number; board_type: string; part_name: string; length_mm: number; width_mm: number }) =>
    `${r.order_detail_id}|${r.board_type}|${r.part_name}|${r.length_mm}|${r.width_mm}`;

  const sortedAssignments = [...rawAssignments].sort((x, y) => fpCompare(roleKey(x), roleKey(y)));
  const sortedEdgingDefaults = [...rawEdgingDefaults].sort(
    (x, y) => x.board_component_id - y.board_component_id,
  );
  const sortedEdgingOverrides = [...rawEdgingOverrides].sort((x, y) => fpCompare(roleKey(x), roleKey(y)));

  const assignmentsPayload = JSON.stringify({
    assignments: sortedAssignments,
    backer_default: a.backer_default ?? null,
    edging_defaults: sortedEdgingDefaults,
    edging_overrides: sortedEdgingOverrides,
  });

  return crypto
    .createHash('sha256')
    .update(detailsPayload + '||' + assignmentsPayload)
    .digest('hex')
    .slice(0, 16);
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

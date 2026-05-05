import type { SheetLayout } from '@/lib/cutlist/types';

// ─── Persisted JSONB shape on orders.cutting_plan ────────────────────────

export type CuttingPlanOverride = {
  component_id: number;
  quantity: number;
  // 'sheets' for primary/backer boards, 'm' for edging (purchasing unit).
  // 'mm' is legacy — historic plans may still carry it; readers that honor
  // unit must convert mm → m when computing purchasing demand.
  unit: 'sheets' | 'm' | 'mm';
  source: 'cutlist_primary' | 'cutlist_backer' | 'cutlist_edging';
};

export type CuttingPlanEdgingEntry = {
  component_id: number;
  component_name: string;
  thickness_mm: number;
  length_mm: number;
  unit: 'mm';
};

export type CuttingPlanMaterialGroupKind = 'primary' | 'backer';

export type CuttingPlanMaterialGroup = {
  kind: CuttingPlanMaterialGroupKind;
  sheet_thickness_mm: number;
  material_id: number;
  material_name: string;
  sheets_required: number;
  edging_by_material: CuttingPlanEdgingEntry[];
  total_parts: number;
  waste_percent: number;
  bom_estimate_sheets: number;
  layouts: SheetLayout[];
  stock_sheet_spec: { length_mm: number; width_mm: number };
};

// ─── Line-level cost allocation (area-weighted, substitution-safe) ────────
export type CuttingPlanLineAllocation = {
  order_detail_id: number;
  /** Sum of (length_mm × width_mm × quantity) for this line's cutlist parts.
   *  Used as the allocation weight. Non-cutlist-only lines have area_mm2 = 0
   *  and are excluded from nested allocation (share = 0). */
  area_mm2: number;
  /** Share of total nested cost allocated to this line */
  line_share_amount: number;
  /** Allocation percentage (0-100) — `area_mm2 / sum(area_mm2) * 100` */
  allocation_pct: number;
};

export type CuttingPlanStaleReason = 'source_changed';

export type CuttingPlan = {
  version: 2;
  generated_at: string;
  optimization_quality: 'fast' | 'balanced' | 'quality';
  stale: boolean;
  stale_reason: CuttingPlanStaleReason | null;
  source_revision: string;
  material_groups: CuttingPlanMaterialGroup[];
  component_overrides: CuttingPlanOverride[];
  /** Total nested cost across all material groups, in the org's currency */
  total_nested_cost: number;
  /** Per-line allocation of the total nested cost */
  line_allocations: CuttingPlanLineAllocation[];
};

export type DisplayPlanState =
  | { kind: 'none' }
  | {
      kind: 'legacy';
      persistedVersion: number;
      generated_at: string | null;
      source_revision: string | null;
    }
  | { kind: 'current'; plan: CuttingPlan };

// ─── Aggregate endpoint response ─────────────────────────────────────────

export type AggregatedPartGroup = {
  kind: CuttingPlanMaterialGroupKind;
  sheet_thickness_mm: number;
  material_id: number;
  material_name: string;
  parts: AggregatedPart[];
};

export type AggregatedPart = {
  id: string;                // namespaced: `${order_detail_id}-${original_id}`
  original_id: string;
  order_detail_id: number;
  product_name: string;
  source_board_type: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  lamination_config?: unknown;
  material_thickness?: number;
  edging_material_id?: string;
  material_label?: string;
  effective_board_id?: number | null;
  effective_board_name?: string | null;
  effective_thickness_mm?: number | null;
  effective_edging_id?: number | null;
  effective_edging_name?: string | null;
  effective_backer_id?: number | null;
  effective_backer_name?: string | null;
  is_overridden?: boolean;
};

export type AggregateResponse = {
  order_id: number;
  source_revision: string;
  material_groups: AggregatedPartGroup[];
  total_parts: number;
  has_cutlist_items: boolean;
};

export type BackerThicknessInvalidReason = 'wrong_category' | 'null' | 'out_of_range';

export type BackerThicknessInvalidEntry = {
  component_id: number;
  parsed_value: number | null;
  reason: BackerThicknessInvalidReason;
};

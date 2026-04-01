import type { SheetLayout, StockSheetSpec } from '@/lib/cutlist/types';

// ─── Persisted JSONB shape on orders.cutting_plan ────────────────────────

export type CuttingPlanOverride = {
  component_id: number;
  quantity: number;
  unit: 'sheets' | 'mm';
  source: 'cutlist_primary' | 'cutlist_backer' | 'cutlist_edging';
};

export type CuttingPlanEdgingEntry = {
  component_id: number;
  component_name: string;
  thickness_mm: number;
  length_mm: number;
  unit: 'mm';
};

export type CuttingPlanMaterialGroup = {
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  sheets_required: number;
  backer_sheets_required: number;
  edging_by_material: CuttingPlanEdgingEntry[];
  total_parts: number;
  waste_percent: number;
  bom_estimate_sheets: number;
  bom_estimate_backer_sheets: number;
  layouts: SheetLayout[];
  stock_sheet_spec: { length_mm: number; width_mm: number };
};

export type CuttingPlan = {
  version: 1;
  generated_at: string;
  optimization_quality: 'fast' | 'balanced' | 'quality';
  stale: boolean;
  source_revision: string;
  material_groups: CuttingPlanMaterialGroup[];
  component_overrides: CuttingPlanOverride[];
};

// ─── Aggregate endpoint response ─────────────────────────────────────────

export type AggregatedPartGroup = {
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: AggregatedPart[];
};

export type AggregatedPart = {
  id: string;                // namespaced: `${order_detail_id}-${original_id}`
  original_id: string;
  order_detail_id: number;
  product_name: string;
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
};

export type AggregateResponse = {
  order_id: number;
  source_revision: string;
  material_groups: AggregatedPartGroup[];
  total_parts: number;
  has_cutlist_items: boolean;
};

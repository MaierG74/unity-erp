export type BomSnapshotSwapKind = 'default' | 'alternative' | 'removed';

export type BomSnapshotEntry = {
  source_bom_id: number;
  component_id: number;
  component_code: string;
  component_description: string | null;
  category_id: number | null;
  category_name: string | null;
  supplier_component_id: number | null;
  supplier_name: string | null;
  unit_price: number;
  quantity_required: number;
  line_total: number;
  swap_kind: BomSnapshotSwapKind;
  is_removed: boolean;
  effective_component_id: number;
  effective_component_code: string;
  effective_quantity_required: number;
  effective_unit_price: number;
  effective_line_total: number;
  default_unit_price: number;
  surcharge_amount: number;
  surcharge_label: string | null;
  is_substituted: boolean;
  default_component_id: number;
  default_component_code: string;
  is_cutlist_item: boolean;
  cutlist_category: string | null;
  cutlist_group_link: number | null;
  note: string | null;
};

export type CutlistSnapshotPart = {
  id: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  material_label?: string;
  material_thickness?: number;
  edging_material_id?: string;
  effective_board_id?: number | null;
  effective_board_name?: string | null;
  effective_thickness_mm?: number | null;
  effective_edging_id?: number | null;
  effective_edging_name?: string | null;
  is_overridden?: boolean;
};

export type CutlistSnapshotGroup = {
  source_group_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  effective_backer_id?: number | null;
  effective_backer_name?: string | null;
  parts: CutlistSnapshotPart[];
};

export type CutlistPartOverride = {
  part_id?: string | null;
  part_name?: string | null;
  board_type?: string | null;
  length_mm?: number | null;
  width_mm?: number | null;
  board_component_id?: number | null;
  board_component_name?: string | null;
  edging_component_id?: number | null;
  edging_component_name?: string | null;
};

export type CutlistLineMaterial = {
  component_id: number;
  component_name: string | null;
} | null;

export type BoardEdgingPairLookup = Map<string, { component_id: number; component_name: string | null }>;

export function cutlistOverrideKey(
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
  partId?: string | null,
): string {
  return `${boardType}|${partId ?? ''}|${partName}|${lengthMm}|${widthMm}`;
}

export function boardEdgingPairKey(boardComponentId: number, thicknessMm: number | null | undefined): string {
  return `${boardComponentId}|${thicknessMm ?? 0}`;
}

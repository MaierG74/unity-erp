/**
 * Cutlist Types
 *
 * Consolidated type definitions for the cutlist system.
 * Used across /cutlist page, quotes, and product BOM contexts.
 */

// =============================================================================
// Grain & Orientation
// =============================================================================

/**
 * Grain orientation for packing algorithm.
 * - 'any': can rotate 0° or 90° (subject to global rotation option)
 * - 'length': keep part length aligned with sheet length (0° only)
 * - 'width': keep part length aligned with sheet width (90° only)
 */
export type GrainOrientation = 'any' | 'length' | 'width';

/** Alias for backwards compatibility with cutlistDimensions */
export type CutlistGrain = GrainOrientation;

// =============================================================================
// Edge Banding
// =============================================================================

/**
 * Edge banding configuration for a part.
 * Each edge can independently have banding applied.
 */
export interface BandEdges {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

/** Alias for backwards compatibility */
export type CutlistBandEdges = BandEdges;

// =============================================================================
// Board Types (for lamination)
// =============================================================================

/**
 * Board type for grouped cutlist parts.
 * - '16mm': Standard single board, 16mm edging
 * - '32mm-both': 2× same board laminated, both sides visible (e.g., desk legs)
 * - '32mm-backer': 1× primary + 1× backer board, only top visible (e.g., desk tops)
 */
export type BoardType = '16mm' | '32mm-both' | '32mm-backer';

/**
 * Finish side configuration for cutlist dimensions.
 */
export type CutlistFinishSide = 'single' | 'double' | 'none';

// =============================================================================
// Lamination Types (Part-Level)
// =============================================================================

/**
 * Lamination type for individual parts.
 * - 'none': Single 16mm board, 16mm edging
 * - 'with-backer': 32mm (1× primary + 1× backer), 32mm edging
 * - 'same-board': 32mm (2× primary board), 32mm edging
 * - 'custom': 48mm+ (multiple layers via CustomLaminationModal)
 */
export type LaminationType = 'none' | 'with-backer' | 'same-board' | 'custom';

/**
 * A single layer in a custom lamination configuration.
 */
export interface LaminationLayer {
  materialId: string;
  materialName: string;
  isPrimary: boolean; // true = primary board, false = backer
}

/**
 * Custom lamination configuration for 48mm+ parts.
 */
export interface CustomLaminationConfig {
  layers: LaminationLayer[];
  finalThickness: number; // calculated (layers × 16mm)
  edgeThickness: number; // same as finalThickness
}

// =============================================================================
// Part Specifications
// =============================================================================

/**
 * Part specification for the packing algorithm.
 * This is the core part type used by the sheet nesting logic.
 */
export interface PartSpec {
  id: string;
  /** Length in mm (Y dimension on sheet) */
  length_mm: number;
  /** Width in mm (X dimension on sheet) */
  width_mm: number;
  /** Quantity of this part */
  qty: number;
  /** Grain orientation preference */
  grain?: GrainOrientation;
  /** @deprecated Use grain='length' instead */
  require_grain?: boolean;
  /** Edge banding configuration */
  band_edges?: BandEdges;
  /** @deprecated Use lamination_type instead */
  laminate?: boolean;
  /** Lamination type for this part (defaults to 'none') */
  lamination_type?: LaminationType;
  /** Custom lamination configuration (only for lamination_type='custom') */
  lamination_config?: CustomLaminationConfig;
  /** Material ID for grouping by material */
  material_id?: string | null;
  /** Optional label for display */
  label?: string;
  /** Lamination group ID - parts with same group are laminated together */
  lamination_group?: string;
}

/**
 * Part definition for the CutlistBuilder drag-and-drop interface.
 * Similar to PartSpec but with additional display properties.
 */
export interface CutlistPart {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  quantity: number;
  grain: GrainOrientation;
  band_edges: Required<BandEdges>;
  material_label?: string;
  /** Material ID for grouping and costing */
  material_id?: string;
  /** Lamination type (defaults to 'none') */
  lamination_type?: LaminationType;
  /** Custom lamination configuration (only for lamination_type='custom') */
  lamination_config?: CustomLaminationConfig;
  /** Lamination group ID - parts with same group are laminated together */
  lamination_group?: string;
  /** Edging material ID override — when set, this part uses a specific edging material instead of the default for its thickness */
  edging_material_id?: string;
}

// =============================================================================
// Stock Sheet Specifications
// =============================================================================

/**
 * Stock sheet specification for the packing algorithm.
 */
export interface StockSheetSpec {
  id: string;
  /** Length in mm (Y dimension) */
  length_mm: number;
  /** Width in mm (X dimension) */
  width_mm: number;
  /** Quantity available */
  qty: number;
  /** Blade kerf in mm (defaults to 0) */
  kerf_mm?: number;
  /** Cost per sheet (optional, for costing) */
  cost?: number;
  /** Material identifier (optional) */
  material?: string;
}

// =============================================================================
// Layout Results (from packing algorithm)
// =============================================================================

/**
 * A single part placement on a sheet.
 */
export interface Placement {
  part_id: string;
  /** Display label for the part (user-friendly name like "top#35") */
  label?: string;
  /** X position (from left edge) */
  x: number;
  /** Y position (from top edge) */
  y: number;
  /** Placed width */
  w: number;
  /** Placed height */
  h: number;
  /** Rotation applied (0° or 90°) */
  rot: 0 | 90;
}

/**
 * Layout of parts on a single sheet.
 */
export interface SheetLayout {
  sheet_id: string;
  placements: Placement[];
  /** Total used area on this sheet in mm² */
  used_area_mm2?: number;
  /** Stock sheet length for this sheet (when materials have different board sizes) */
  stock_length_mm?: number;
  /** Stock sheet width for this sheet (when materials have different board sizes) */
  stock_width_mm?: number;
  /** Material name label for this sheet (when multiple materials are used) */
  material_label?: string;
}

/**
 * Edge banding requirement for a specific thickness.
 */
export interface EdgingRequirement {
  /** Edge thickness in mm (16, 32, 48, etc.) */
  thickness_mm: number;
  /** Total length required in mm */
  length_mm: number;
}

/**
 * Aggregate statistics from the packing result.
 */
export interface LayoutStats {
  /** Total used area across all sheets in mm² */
  used_area_mm2: number;
  /** Total waste area across all sheets in mm² */
  waste_area_mm2: number;
  /** Number of cuts required */
  cuts: number;
  /** Total cut length in mm */
  cut_length_mm: number;
  /** Total edgebanding length in mm (all thicknesses combined) */
  edgebanding_length_mm?: number;
  /** 16mm edgebanding length in mm */
  edgebanding_16mm_mm?: number;
  /** 32mm edgebanding length in mm */
  edgebanding_32mm_mm?: number;
  /** Edging requirements by thickness (for custom lamination support) */
  edging_by_thickness?: EdgingRequirement[];
}

/**
 * Reason why a part couldn't be placed.
 */
export type UnplacedReason = 'too_large_for_sheet' | 'insufficient_sheet_capacity';

/**
 * Information about parts that couldn't be placed.
 */
export interface UnplacedPart {
  part: PartSpec;
  count: number;
  reason: UnplacedReason;
}

/**
 * Complete result from the packing algorithm.
 */
export interface LayoutResult {
  sheets: SheetLayout[];
  stats: LayoutStats;
  unplaced?: UnplacedPart[];
}

/**
 * Options for the packing algorithm.
 */
export interface PackOptions {
  /** Only use a single sheet (for feasibility checks) */
  singleSheetOnly?: boolean;
  /** Allow 90° rotation (default: true) */
  allowRotation?: boolean;
}

/**
 * Expanded part for packing - includes original part reference and layer info.
 */
export interface ExpandedPart extends PartSpec {
  /** Original part ID before expansion */
  original_part_id: string;
  /** Layer number (0-indexed, for custom lamination) */
  layer_index?: number;
  /** Whether this is a backer layer */
  is_backer?: boolean;
}

/**
 * Result from expanding parts based on lamination type.
 */
export interface LaminationExpansionResult {
  /** Primary board parts grouped by material */
  primaryPartsByMaterial: Map<string, ExpandedPart[]>;
  /** Backer board parts grouped by material */
  backerPartsByMaterial: Map<string, ExpandedPart[]>;
  /** Edging requirements by thickness */
  edgingByThickness: Map<number, number>;
  /** Summary statistics */
  summary: {
    totalPrimaryParts: number;
    totalBackerParts: number;
    partsProcessed: number;
  };
}

/**
 * Combined packing result with primary and backer boards.
 */
export interface CombinedPackingResult {
  /** Primary board layouts by material */
  primaryResults: Map<string, LayoutResult>;
  /** Backer board layouts by material */
  backerResults: Map<string, LayoutResult>;
  /** Aggregated edging requirements */
  edgingByThickness: EdgingRequirement[];
  /** Summary */
  summary: {
    totalPrimarySheets: number;
    totalBackerSheets: number;
    totalEdgingLength: number;
  };
}

// =============================================================================
// Grouping (for CutlistBuilder)
// =============================================================================

/**
 * A group of parts with shared board type and material.
 */
export interface CutlistGroup {
  id: string;
  name: string;
  boardType: BoardType;
  primaryMaterialId?: string;
  primaryMaterialName?: string;
  backerMaterialId?: string;
  backerMaterialName?: string;
  parts: CutlistPart[];
}

/**
 * A set of parts for a specific material (output from board expansion).
 */
export interface MaterialPartSet {
  materialId: string | undefined;
  materialName: string | undefined;
  parts: PartSpec[];
  isBackerMaterial: boolean;
}

/**
 * Result from expanding groups into part specifications.
 */
export interface BoardCalculation {
  /** Primary board parts grouped by material */
  primarySets: MaterialPartSet[];
  /** Backer board parts grouped by material (only for 32mm-backer groups) */
  backerSets: MaterialPartSet[];
  /** Total 16mm edging in mm */
  edging16mm: number;
  /** Total 32mm edging in mm */
  edging32mm: number;
  /** Summary for display */
  summary: {
    totalPrimaryParts: number;
    totalBackerParts: number;
    groupsProcessed: number;
  };
}

// =============================================================================
// Cutlist Dimensions (for BOM storage)
// =============================================================================

/**
 * Lamination options for cutlist dimensions.
 */
export interface CutlistLaminateOptions {
  enabled?: boolean;
  backer_component_id?: number | null;
}

/**
 * Full cutlist dimensions as stored in BOM.
 * This is the JSONB structure stored in product_bom.cutlist_dimensions.
 */
export interface CutlistDimensions {
  length_mm?: number;
  width_mm?: number;
  thickness_mm?: number;
  quantity_per?: number;
  grain?: CutlistGrain;
  band_edges?: CutlistBandEdges;
  laminate?: CutlistLaminateOptions;
  material_code?: string;
  material_label?: string;
  colour_family?: string;
  finish_side?: CutlistFinishSide;
  notes?: string;
}

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Options for validating cutlist dimensions.
 */
export interface ValidateCutlistDimensionsOptions {
  requireDimensions?: boolean;
}

/**
 * Result from validating cutlist dimensions.
 */
export interface ValidateCutlistDimensionsResult {
  valid: boolean;
  value: CutlistDimensions | null;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// Costing Types (for CutlistTool)
// =============================================================================

/**
 * Material definition for costing palette.
 */
export interface CutlistMaterialDefinition {
  id: string;
  name: string;
  sheetDescription: string;
  pricePerSheet: number | '';
  band16Description: string;
  band16Price: number | '';
  band32Description: string;
  band32Price: number | '';
  component_id?: number;
  supplier_component_id?: number;
  unit_cost?: number | null;
}

/**
 * Summary of cutlist results for a specific material.
 */
export interface CutlistMaterialSummary {
  materialId: string;
  materialName: string;
  sheetsUsed: number;
  sheetsBillable: number;
  edgebanding16mm: number;
  edgebanding32mm: number;
  totalBanding: number;
  sheetCost: number;
  band16Cost: number;
  band32Cost: number;
  backerSheets: number;
  backerCost: number;
  totalCost: number;
}

/**
 * Overall cutlist summary (passed via onSummaryChange callback).
 */
export interface CutlistSummary {
  result: LayoutResult;
  backerResult: LayoutResult | null;
  primarySheetsUsed: number;
  primarySheetsBillable: number;
  backerSheetsUsed: number;
  backerSheetsBillable: number;
  edgebanding16mm: number;
  edgebanding32mm: number;
  edgebandingTotal: number;
  laminationOn: boolean;
  materials?: CutlistMaterialSummary[];
  /** Per-edging-material breakdown for export (one entry per unique edging material used) */
  edgingByMaterial?: EdgingSummaryEntry[];
}

/** Summary entry for a single edging material used across parts */
export interface EdgingSummaryEntry {
  materialId: string;
  name: string;
  thickness_mm: number;
  length_mm: number;
  cost_per_meter: number;
  component_id?: number;
}

// =============================================================================
// Sheet Override Types (for billing adjustments)
// =============================================================================

/**
 * Billing override mode for a sheet.
 */
export type SheetBillingMode = 'auto' | 'full' | 'manual';

/**
 * Billing override for a single sheet.
 */
export interface SheetBillingOverride {
  mode: SheetBillingMode;
  manualPct: number;
}

// =============================================================================
// Persistence Types
// =============================================================================

/**
 * Selected component reference for costing.
 */
export interface SelectedComponent {
  description: string;
  component_id?: number;
  supplier_component_id?: number;
  unit_cost?: number | null;
}

/**
 * Line references for exported cutlist lines.
 */
export interface CutlistLineRefs {
  primary?: string | null;
  backer?: string | null;
  band16?: string | null;
  band32?: string | null;
  /** Dynamic edging line refs keyed by slot name (e.g., 'edging_materialId') */
  [key: string]: string | null | undefined;
}

/**
 * Input for creating/updating a cutlist costing line.
 */
export interface CutlistLineInput {
  description: string;
  qty: number;
  unit_cost?: number | null;
  component_id?: number;
}

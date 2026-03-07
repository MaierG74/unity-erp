/**
 * Board Calculator for Cutlist Builder
 *
 * IMPORTANT: Qty = Pieces to Cut
 * The quantity field always represents actual pieces to cut from sheet goods.
 * Lamination type is assembly metadata that affects edge thickness, NOT quantity.
 *
 * Part-Level Lamination:
 * - none: Single 16mm board, 16mm edging
 * - with-backer: 1× primary + 1× backer (same qty each), 32mm edging
 * - same-board: Pieces will be paired during assembly, 32mm edging (NO quantity doubling)
 * - custom: 48mm+ (multiple layers via CustomLaminationModal)
 *
 * Group-Level Board Types (LEGACY, for grouped mode):
 * - 16mm Single: Parts as-is, 16mm edging
 * - 32mm Both Sides: Parts paired during assembly, 32mm edging (NO quantity doubling)
 * - 32mm With Backer: Parts for primary + duplicate for backer, 32mm edging
 */

// Import and re-export types from consolidated types file
export type {
  BoardType,
  CutlistPart,
  CutlistGroup,
  MaterialPartSet,
  BoardCalculation,
  GrainOrientation,
  LaminationType,
  LaminationLayer,
  CustomLaminationConfig,
  ExpandedPart,
  LaminationExpansionResult,
} from '@/lib/cutlist/types';

import type {
  PartSpec,
  CutlistPart,
  CutlistGroup,
  MaterialPartSet,
  BoardCalculation,
  BoardType,
  LaminationType,
  CustomLaminationConfig,
  ExpandedPart,
  LaminationExpansionResult,
  BandEdges,
} from '@/lib/cutlist/types';

// ============================================================================
// Constants
// ============================================================================

const LAYER_THICKNESS_MM = 16;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate edge banding length for a single part (legacy function).
 * Convention: top/bottom edges = length dimension, left/right edges = width dimension.
 */
function calculateEdgeBanding(
  part: CutlistPart,
  quantity: number
): { length16mm: number; length32mm: number } {
  const { length_mm, width_mm, band_edges } = part;

  let edgeLength = 0;
  if (band_edges.top) edgeLength += length_mm;
  if (band_edges.bottom) edgeLength += length_mm;
  if (band_edges.left) edgeLength += width_mm;
  if (band_edges.right) edgeLength += width_mm;

  return {
    length16mm: edgeLength * quantity,
    length32mm: 0, // Will be set by caller based on board type
  };
}

/**
 * Calculate edge banding length for a part with specific edge config.
 * Convention: top/bottom edges = length dimension, left/right edges = width dimension.
 */
function calculateEdgeLengthMm(
  length_mm: number,
  width_mm: number,
  band_edges: BandEdges | Required<BandEdges>,
  quantity: number
): number {
  let edgeLength = 0;
  if (band_edges.top) edgeLength += length_mm;
  if (band_edges.bottom) edgeLength += length_mm;
  if (band_edges.left) edgeLength += width_mm;
  if (band_edges.right) edgeLength += width_mm;
  return edgeLength * quantity;
}

/**
 * Get the edge thickness based on lamination type and material thickness.
 * @param materialThickness - Sheet thickness in mm (defaults to 16 for backwards compat)
 */
function getEdgeThickness(
  laminationType: LaminationType | undefined,
  materialThickness: number = 16,
  laminationConfig?: CustomLaminationConfig
): number {
  switch (laminationType) {
    case 'none':
    case undefined:
      return materialThickness;
    case 'with-backer':
    case 'same-board':
      return materialThickness * 2;
    case 'custom':
      return laminationConfig?.edgeThickness || materialThickness * 3;
  }
}

/**
 * Convert CutlistPart to PartSpec for packing algorithm (legacy)
 */
function toPartSpec(part: CutlistPart, quantity: number, laminate: boolean): PartSpec {
  return {
    id: part.id,
    length_mm: part.length_mm,
    width_mm: part.width_mm,
    qty: quantity,
    grain: part.grain,
    laminate,
    band_edges: { ...part.band_edges },
  };
}

/**
 * Convert CutlistPart to ExpandedPart for packing algorithm (new)
 */
function toExpandedPart(
  part: CutlistPart,
  quantity: number,
  options: {
    isBacker?: boolean;
    layerIndex?: number;
    idSuffix?: string;
    materialId?: string;
  } = {}
): ExpandedPart {
  const { isBacker = false, layerIndex, idSuffix = '', materialId } = options;

  return {
    id: `${part.id}${idSuffix}`,
    original_part_id: part.id,
    length_mm: part.length_mm,
    width_mm: part.width_mm,
    qty: quantity,
    grain: part.grain,
    band_edges: { ...part.band_edges },
    lamination_type: part.lamination_type,
    lamination_config: part.lamination_config,
    material_id: materialId || part.material_id,
    is_backer: isBacker,
    layer_index: layerIndex,
    label: part.name,
  };
}

// ============================================================================
// Part-Level Lamination Expansion (NEW)
// ============================================================================

/**
 * Expands parts based on their individual lamination types.
 *
 * This is the NEW approach that works with part-level lamination settings.
 * Each part can have its own lamination type and configuration.
 *
 * @param parts - Array of CutlistParts with lamination_type and optional lamination_config
 * @param defaultMaterialId - Default material ID for parts without material_id
 * @param defaultBackerMaterialId - Default backer material ID for with-backer parts
 * @returns LaminationExpansionResult with parts grouped by material and edging requirements
 */
export function expandPartsWithLamination(
  parts: CutlistPart[],
  defaultMaterialId?: string,
  defaultBackerMaterialId?: string
): LaminationExpansionResult {
  const primaryPartsByMaterial = new Map<string, ExpandedPart[]>();
  const backerPartsByMaterial = new Map<string, ExpandedPart[]>();
  const edgingByThickness = new Map<number, number>();

  let totalPrimaryParts = 0;
  let totalBackerParts = 0;

  for (const part of parts) {
    const laminationType = part.lamination_type || 'none';
    const materialKey = part.material_id || defaultMaterialId || 'unassigned';
    const baseQty = part.quantity;

    // Calculate edge thickness based on lamination type and material thickness
    const materialThickness = part.material_thickness || 16;
    const edgeThickness = getEdgeThickness(laminationType, materialThickness, part.lamination_config);

    // Helper to add edging with correct quantity
    const addEdging = (finishedPartCount: number) => {
      // Edge banding goes on FINISHED parts, not individual pieces
      const edgeLength = calculateEdgeLengthMm(
        part.length_mm,
        part.width_mm,
        part.band_edges,
        finishedPartCount
      );
      if (edgeLength > 0) {
        const currentEdging = edgingByThickness.get(edgeThickness) || 0;
        edgingByThickness.set(edgeThickness, currentEdging + edgeLength);
      }
    };

    switch (laminationType) {
      case 'none': {
        // Single board - each piece is a finished part
        // Edge qty = piece qty
        addEdging(baseQty);
        const expandedPart = toExpandedPart(part, baseQty, { materialId: materialKey });
        addToMaterialMap(primaryPartsByMaterial, materialKey, expandedPart);
        totalPrimaryParts += baseQty;
        break;
      }

      case 'same-board': {
        // Same board lamination - pieces are paired during assembly
        // Qty = pieces to cut, Finished parts = Qty ÷ 2
        // Example: Qty=4 pieces → 2 finished 32mm legs → edge for 2 parts
        const finishedParts = Math.floor(baseQty / 2);
        addEdging(finishedParts);
        const expandedPart = toExpandedPart(part, baseQty, { materialId: materialKey });
        addToMaterialMap(primaryPartsByMaterial, materialKey, expandedPart);
        totalPrimaryParts += baseQty;
        break;
      }

      case 'with-backer': {
        // 1× primary + 1× backer per finished part
        // Each piece becomes a finished part (primary + backer)
        // Edge qty = piece qty (edging goes on the assembled part)
        addEdging(baseQty);
        const backerKey = defaultBackerMaterialId || materialKey;

        // Primary part
        const primaryPart = toExpandedPart(part, baseQty, { materialId: materialKey });
        addToMaterialMap(primaryPartsByMaterial, materialKey, primaryPart);
        totalPrimaryParts += baseQty;

        // Backer part
        const backerPart = toExpandedPart(part, baseQty, {
          isBacker: true,
          idSuffix: '-backer',
          materialId: backerKey,
        });
        addToMaterialMap(backerPartsByMaterial, backerKey, backerPart);
        totalBackerParts += baseQty;
        break;
      }

      case 'custom': {
        // Custom lamination - count layers by material type
        const config = part.lamination_config;
        if (!config || !config.layers || config.layers.length === 0) {
          // Fallback to single board if no config
          addEdging(baseQty);
          const expandedPart = toExpandedPart(part, baseQty, { materialId: materialKey });
          addToMaterialMap(primaryPartsByMaterial, materialKey, expandedPart);
          totalPrimaryParts += baseQty;
          break;
        }

        // Custom lamination: each "part" becomes one finished multi-layer assembly
        // Edge qty = baseQty (one finished part per entry)
        addEdging(baseQty);

        // Process each layer
        for (let layerIdx = 0; layerIdx < config.layers.length; layerIdx++) {
          const layer = config.layers[layerIdx];
          const layerMaterialKey = layer.materialId || (layer.isPrimary ? materialKey : defaultBackerMaterialId || materialKey);

          const expandedPart = toExpandedPart(part, baseQty, {
            isBacker: !layer.isPrimary,
            layerIndex: layerIdx,
            idSuffix: `-layer${layerIdx}`,
            materialId: layerMaterialKey,
          });

          if (layer.isPrimary) {
            addToMaterialMap(primaryPartsByMaterial, layerMaterialKey, expandedPart);
            totalPrimaryParts += baseQty;
          } else {
            addToMaterialMap(backerPartsByMaterial, layerMaterialKey, expandedPart);
            totalBackerParts += baseQty;
          }
        }
        break;
      }
    }
  }

  return {
    primaryPartsByMaterial,
    backerPartsByMaterial,
    edgingByThickness,
    summary: {
      totalPrimaryParts,
      totalBackerParts,
      partsProcessed: parts.length,
    },
  };
}

/**
 * Helper to add a part to a material map
 */
function addToMaterialMap(
  map: Map<string, ExpandedPart[]>,
  materialKey: string,
  part: ExpandedPart
): void {
  const existing = map.get(materialKey) || [];
  existing.push(part);
  map.set(materialKey, existing);
}

/**
 * Convert ExpandedPart[] to PartSpec[] for the packing algorithm.
 * The packing algorithm expects the older PartSpec interface.
 */
export function expandedPartsToPartSpecs(expandedParts: ExpandedPart[]): PartSpec[] {
  return expandedParts.map((ep) => ({
    id: ep.id,
    length_mm: ep.length_mm,
    width_mm: ep.width_mm,
    qty: ep.qty,
    grain: ep.grain,
    band_edges: ep.band_edges,
    laminate: ep.lamination_type !== 'none' && ep.lamination_type !== undefined,
    lamination_type: ep.lamination_type,
    lamination_config: ep.lamination_config,
    material_id: ep.material_id,
    label: ep.label,
  }));
}

// ============================================================================
// Board Type Helpers
// ============================================================================

/**
 * Parse the sheet thickness in mm from a board_type string.
 * e.g., '16mm' → 16, '32mm-both' → 16 (half because it's laminated),
 * '22mm' → 22, '44mm-both' → 22
 */
export function parseSheetThickness(boardType: string): number {
  const match = boardType.match(/^(\d+)mm/);
  if (!match) return 16;
  const totalThickness = parseInt(match[1], 10);
  // For laminated types, the sheet thickness is half the total
  if (boardType.includes('-both') || boardType.includes('-backer')) {
    return Math.round(totalThickness / 2);
  }
  return totalThickness;
}

/**
 * Derive lamination type from a board_type string.
 * Replaces the old hardcoded BOARD_TYPE_TO_LAMINATION map.
 */
export function boardTypeToLamination(boardType: string): LaminationType {
  if (boardType.endsWith('-both')) return 'same-board';
  if (boardType.endsWith('-backer')) return 'with-backer';
  return 'none';
}

// ============================================================================
// Group-Level Expansion (LEGACY - for backward compatibility)
// ============================================================================

/**
 * Expands groups into part specifications for sheet packing.
 *
 * LEGACY: This function works with group-level board types.
 * For new code, use expandPartsWithLamination() instead.
 *
 * Board Type Expansion:
 * - 16mm: Parts as-is with 16mm edging
 * - 32mm-both: Each part qty doubled (2× same board), 32mm edging
 * - 32mm-backer: Original parts → primary, duplicate → backer, 32mm edging
 */
export function expandGroupsToPartSpecs(groups: CutlistGroup[]): BoardCalculation {
  const primaryByMaterial = new Map<string, PartSpec[]>();
  const backerByMaterial = new Map<string, { parts: PartSpec[]; materialName?: string }>();

  const edgingByThicknessMap = new Map<number, number>();
  let totalPrimaryParts = 0;
  let totalBackerParts = 0;

  for (const group of groups) {
    if (group.parts.length === 0) continue;

    const materialKey = group.primaryMaterialId || 'unassigned';
    const backerKey = group.backerMaterialId || group.primaryMaterialId || 'unassigned-backer';
    const sheetThickness = parseSheetThickness(group.boardType);
    const lamType = boardTypeToLamination(group.boardType);

    for (const part of group.parts) {
      const baseQty = part.quantity;

      switch (lamType) {
        case 'none': {
          // Simple: parts as-is, edging = sheet thickness
          const partSpec = toPartSpec(part, baseQty, false);
          const existing = primaryByMaterial.get(materialKey) || [];
          existing.push(partSpec);
          primaryByMaterial.set(materialKey, existing);

          const edging = calculateEdgeBanding(part, baseQty);
          const edgeThick = sheetThickness;
          edgingByThicknessMap.set(edgeThick, (edgingByThicknessMap.get(edgeThick) || 0) + edging.length16mm);
          totalPrimaryParts += baseQty;
          break;
        }

        case 'same-board': {
          // Same board lamination - pieces are paired during assembly
          // Qty = pieces to cut, Finished parts = Qty ÷ 2
          const partSpec = toPartSpec(part, baseQty, true);
          const existing = primaryByMaterial.get(materialKey) || [];
          existing.push(partSpec);
          primaryByMaterial.set(materialKey, existing);

          // Edging is for FINISHED parts, not pieces
          const finishedParts = Math.floor(baseQty / 2);
          const edging = calculateEdgeBanding(part, finishedParts);
          const edgeThick = sheetThickness * 2;
          edgingByThicknessMap.set(edgeThick, (edgingByThicknessMap.get(edgeThick) || 0) + edging.length16mm);
          totalPrimaryParts += baseQty;
          break;
        }

        case 'with-backer': {
          // Split: original → primary, duplicate → backer, doubled edging
          const primarySpec = toPartSpec(part, baseQty, true);
          const existingPrimary = primaryByMaterial.get(materialKey) || [];
          existingPrimary.push(primarySpec);
          primaryByMaterial.set(materialKey, existingPrimary);

          const backerSpec = toPartSpec(
            { ...part, id: `${part.id}-backer` },
            baseQty,
            true
          );
          const existingBacker = backerByMaterial.get(backerKey) || {
            parts: [],
            materialName: group.backerMaterialName,
          };
          existingBacker.parts.push(backerSpec);
          backerByMaterial.set(backerKey, existingBacker);

          const edging = calculateEdgeBanding(part, baseQty);
          const edgeThick = sheetThickness * 2;
          edgingByThicknessMap.set(edgeThick, (edgingByThicknessMap.get(edgeThick) || 0) + edging.length16mm);
          totalPrimaryParts += baseQty;
          totalBackerParts += baseQty;
          break;
        }
      }
    }
  }

  // Convert maps to arrays
  const primarySets: MaterialPartSet[] = [];
  for (const [materialId, parts] of primaryByMaterial) {
    // Find the group that uses this material to get the name
    const matchingGroup = groups.find((g) => (g.primaryMaterialId || 'unassigned') === materialId);
    primarySets.push({
      materialId: materialId === 'unassigned' ? undefined : materialId,
      materialName: matchingGroup?.primaryMaterialName,
      parts,
      isBackerMaterial: false,
    });
  }

  const backerSets: MaterialPartSet[] = [];
  for (const [materialId, data] of backerByMaterial) {
    backerSets.push({
      materialId: materialId.includes('unassigned') ? undefined : materialId,
      materialName: data.materialName,
      parts: data.parts,
      isBackerMaterial: true,
    });
  }

  // Backwards compat: extract 16mm and 32mm from the map
  const edging16mm = edgingByThicknessMap.get(16) || 0;
  const edging32mm = edgingByThicknessMap.get(32) || 0;

  return {
    primarySets,
    backerSets,
    edging16mm,
    edging32mm,
    edgingByThickness: edgingByThicknessMap,
    summary: {
      totalPrimaryParts,
      totalBackerParts,
      groupsProcessed: groups.length,
    },
  };
}

/**
 * Alias for expandGroupsToPartSpecs for backward compatibility with index exports.
 */
export const expandGroupsToPartSets = expandGroupsToPartSpecs;

// ============================================================================
// Display Helpers
// ============================================================================

/**
 * Get display label for board type.
 */
export function getBoardTypeLabel(boardType: BoardType): string {
  if (boardType.endsWith('-both')) {
    const thickness = parseInt(boardType, 10);
    return `${thickness}mm Both Sides`;
  }
  if (boardType.endsWith('-backer')) {
    const thickness = parseInt(boardType, 10);
    return `${thickness}mm With Backer`;
  }
  return `${parseInt(boardType, 10) || boardType}mm Single`;
}

/**
 * Get description for board type.
 */
export function getBoardTypeDescription(boardType: BoardType): string {
  const sheetThickness = parseSheetThickness(boardType);
  if (boardType.endsWith('-both')) {
    return `2× ${sheetThickness}mm paired during assembly, both sides visible`;
  }
  if (boardType.endsWith('-backer')) {
    return `${sheetThickness}mm primary + ${sheetThickness}mm backer, top side visible`;
  }
  return `Standard ${sheetThickness}mm single board, ${sheetThickness}mm edging`;
}

/**
 * Get display label for lamination type (new)
 */
export function getLaminationTypeLabel(
  laminationType: LaminationType | undefined,
  laminationConfig?: CustomLaminationConfig
): string {
  switch (laminationType) {
    case undefined:
    case 'none':
      return 'None';
    case 'with-backer':
      return 'With Backer';
    case 'same-board':
      return 'Same Board';
    case 'custom':
      if (laminationConfig) {
        return `${laminationConfig.finalThickness}mm Custom`;
      }
      return 'Custom';
  }
}

/**
 * Get description for lamination type (new)
 */
export function getLaminationTypeDescription(
  laminationType: LaminationType | undefined,
  laminationConfig?: CustomLaminationConfig
): string {
  switch (laminationType) {
    case undefined:
    case 'none':
      return 'Single 16mm board, 16mm edging';
    case 'with-backer':
      return '1× primary + 1× backer board, 32mm edging';
    case 'same-board':
      return 'Paired during assembly (32mm finished), 32mm edging';
    case 'custom':
      if (laminationConfig) {
        const layerCount = laminationConfig.layers.length;
        return `${layerCount} layers, ${laminationConfig.finalThickness}mm edging`;
      }
      return 'Custom multi-layer lamination';
  }
}

/**
 * Calculate the final thickness based on lamination type.
 */
export function calculateFinalThickness(
  laminationType: LaminationType | undefined,
  laminationConfig?: CustomLaminationConfig
): number {
  switch (laminationType) {
    case undefined:
    case 'none':
      return LAYER_THICKNESS_MM;
    case 'with-backer':
    case 'same-board':
      return LAYER_THICKNESS_MM * 2;
    case 'custom':
      return laminationConfig?.finalThickness || LAYER_THICKNESS_MM * 3;
  }
}

/**
 * Get the number of primary boards needed for a lamination type.
 */
export function getPrimaryBoardCount(
  laminationType: LaminationType | undefined,
  laminationConfig?: CustomLaminationConfig
): number {
  switch (laminationType) {
    case undefined:
    case 'none':
      return 1;
    case 'with-backer':
      return 1;
    case 'same-board':
      return 2;
    case 'custom':
      if (laminationConfig) {
        return laminationConfig.layers.filter((l) => l.isPrimary).length;
      }
      return 1;
  }
}

/**
 * Get the number of backer boards needed for a lamination type.
 */
export function getBackerBoardCount(
  laminationType: LaminationType | undefined,
  laminationConfig?: CustomLaminationConfig
): number {
  switch (laminationType) {
    case undefined:
    case 'none':
    case 'same-board':
      return 0;
    case 'with-backer':
      return 1;
    case 'custom':
      if (laminationConfig) {
        return laminationConfig.layers.filter((l) => !l.isPrimary).length;
      }
      return 0;
  }
}

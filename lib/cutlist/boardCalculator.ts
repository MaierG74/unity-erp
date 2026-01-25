/**
 * Board Calculator for Cutlist Builder
 *
 * Handles expansion of parts based on lamination type:
 *
 * Part-Level Lamination (NEW):
 * - none: Single 16mm board, 16mm edging
 * - with-backer: 32mm (1× primary + 1× backer), 32mm edging
 * - same-board: 32mm (2× primary board), 32mm edging
 * - custom: 48mm+ (multiple layers via CustomLaminationModal)
 *
 * Group-Level Board Types (LEGACY, for backward compatibility):
 * - 16mm Single: Parts as-is, 16mm edging
 * - 32mm Both Sides: Parts doubled (same board), 32mm edging
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
 * Calculate edge banding length for a single part
 */
function calculateEdgeBanding(
  part: CutlistPart,
  quantity: number
): { length16mm: number; length32mm: number } {
  const { length_mm, width_mm, band_edges } = part;

  let edgeLength = 0;
  if (band_edges.top) edgeLength += width_mm;
  if (band_edges.bottom) edgeLength += width_mm;
  if (band_edges.left) edgeLength += length_mm;
  if (band_edges.right) edgeLength += length_mm;

  return {
    length16mm: edgeLength * quantity,
    length32mm: 0, // Will be set by caller based on board type
  };
}

/**
 * Calculate edge banding length for a part with specific edge config.
 */
function calculateEdgeLengthMm(
  length_mm: number,
  width_mm: number,
  band_edges: BandEdges | Required<BandEdges>,
  quantity: number
): number {
  let edgeLength = 0;
  if (band_edges.top) edgeLength += width_mm;
  if (band_edges.bottom) edgeLength += width_mm;
  if (band_edges.left) edgeLength += length_mm;
  if (band_edges.right) edgeLength += length_mm;
  return edgeLength * quantity;
}

/**
 * Get the edge thickness based on lamination type.
 */
function getEdgeThickness(
  laminationType: LaminationType | undefined,
  laminationConfig?: CustomLaminationConfig
): number {
  switch (laminationType) {
    case 'none':
    case undefined:
      return 16;
    case 'with-backer':
    case 'same-board':
      return 32;
    case 'custom':
      return laminationConfig?.edgeThickness || 48;
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

    // Calculate edge thickness and add to edging requirements
    const edgeThickness = getEdgeThickness(laminationType, part.lamination_config);
    const edgeLength = calculateEdgeLengthMm(
      part.length_mm,
      part.width_mm,
      part.band_edges,
      baseQty
    );
    if (edgeLength > 0) {
      const currentEdging = edgingByThickness.get(edgeThickness) || 0;
      edgingByThickness.set(edgeThickness, currentEdging + edgeLength);
    }

    switch (laminationType) {
      case 'none': {
        // Single board - 1× primary
        const expandedPart = toExpandedPart(part, baseQty, { materialId: materialKey });
        addToMaterialMap(primaryPartsByMaterial, materialKey, expandedPart);
        totalPrimaryParts += baseQty;
        break;
      }

      case 'same-board': {
        // 2× same board - doubled primary quantity
        const expandedPart = toExpandedPart(part, baseQty * 2, { materialId: materialKey });
        addToMaterialMap(primaryPartsByMaterial, materialKey, expandedPart);
        totalPrimaryParts += baseQty * 2;
        break;
      }

      case 'with-backer': {
        // 1× primary + 1× backer
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
          const expandedPart = toExpandedPart(part, baseQty, { materialId: materialKey });
          addToMaterialMap(primaryPartsByMaterial, materialKey, expandedPart);
          totalPrimaryParts += baseQty;
          break;
        }

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

  let edging16mm = 0;
  let edging32mm = 0;
  let totalPrimaryParts = 0;
  let totalBackerParts = 0;

  for (const group of groups) {
    if (group.parts.length === 0) continue;

    const materialKey = group.primaryMaterialId || 'unassigned';
    const backerKey = group.backerMaterialId || group.primaryMaterialId || 'unassigned-backer';

    for (const part of group.parts) {
      const baseQty = part.quantity;

      switch (group.boardType) {
        case '16mm': {
          // Simple: parts as-is, 16mm edging
          const partSpec = toPartSpec(part, baseQty, false);
          const existing = primaryByMaterial.get(materialKey) || [];
          existing.push(partSpec);
          primaryByMaterial.set(materialKey, existing);

          const edging = calculateEdgeBanding(part, baseQty);
          edging16mm += edging.length16mm;
          totalPrimaryParts += baseQty;
          break;
        }

        case '32mm-both': {
          // Doubled: 2× same board per part, 32mm edging
          const doubledQty = baseQty * 2;
          const partSpec = toPartSpec(part, doubledQty, true);
          const existing = primaryByMaterial.get(materialKey) || [];
          existing.push(partSpec);
          primaryByMaterial.set(materialKey, existing);

          const edging = calculateEdgeBanding(part, baseQty);
          edging32mm += edging.length16mm; // Same edge count, but 32mm width
          totalPrimaryParts += doubledQty;
          break;
        }

        case '32mm-backer': {
          // Split: original → primary, duplicate → backer, 32mm edging
          // Primary parts
          const primarySpec = toPartSpec(part, baseQty, true);
          const existingPrimary = primaryByMaterial.get(materialKey) || [];
          existingPrimary.push(primarySpec);
          primaryByMaterial.set(materialKey, existingPrimary);

          // Backer parts (same dimensions, different material)
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
          edging32mm += edging.length16mm; // Same edge count, but 32mm width
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

  return {
    primarySets,
    backerSets,
    edging16mm,
    edging32mm,
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
 * Get display label for board type (legacy)
 */
export function getBoardTypeLabel(boardType: BoardType): string {
  switch (boardType) {
    case '16mm':
      return '16mm Single';
    case '32mm-both':
      return '32mm Both Sides';
    case '32mm-backer':
      return '32mm With Backer';
  }
}

/**
 * Get description for board type (legacy)
 */
export function getBoardTypeDescription(boardType: BoardType): string {
  switch (boardType) {
    case '16mm':
      return 'Standard single board, 16mm edging';
    case '32mm-both':
      return '2× same board laminated, both sides visible (e.g., desk legs)';
    case '32mm-backer':
      return '1× primary + 1× backer board, only top visible (e.g., desk tops)';
  }
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
      return '2× same board laminated, 32mm edging';
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

/**
 * Board Calculator for Cutlist Builder
 *
 * Handles expansion of grouped parts based on board type:
 * - 16mm Single: Parts as-is, 16mm edging
 * - 32mm Both Sides: Parts doubled (same board), 32mm edging
 * - 32mm With Backer: Parts for primary + duplicate for backer, 32mm edging
 */

import type { PartSpec, GrainOrientation } from '@/components/features/cutlist/packing';

// ============================================================================
// Types
// ============================================================================

export type BoardType = '16mm' | '32mm-both' | '32mm-backer';

export interface CutlistPart {
  id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  quantity: number;
  grain: GrainOrientation;
  band_edges: {
    top: boolean;
    right: boolean;
    bottom: boolean;
    left: boolean;
  };
  material_label?: string;
}

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

export interface MaterialPartSet {
  materialId: string | undefined;
  materialName: string | undefined;
  parts: PartSpec[];
  isBackerMaterial: boolean;
}

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
 * Convert CutlistPart to PartSpec for packing algorithm
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

// ============================================================================
// Main Calculation Function
// ============================================================================

/**
 * Expands groups into part specifications for sheet packing.
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
 * Get display label for board type
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
 * Get description for board type
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

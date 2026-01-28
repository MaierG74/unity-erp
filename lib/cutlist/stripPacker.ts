/**
 * Strip-Based Packer - Cut-Minimizing 2D Bin Packing
 *
 * This algorithm organizes parts into horizontal strips to minimize
 * the number of guillotine cuts required. Key insight: parts in the
 * same strip share horizontal cut lines, and aligning vertical cuts
 * across strips reduces total cuts.
 *
 * Algorithm:
 * 1. Group parts by similar heights (within tolerance)
 * 2. Pack parts into strips (left-to-right, First Fit Decreasing)
 * 3. Stack strips on sheets (top-to-bottom)
 * 4. Optimize cut alignment where possible
 */

import type {
  PartSpec,
  StockSheetSpec,
  Placement,
  SheetLayout,
  LayoutResult,
  LayoutStats,
  UnplacedPart,
  GrainOrientation,
} from './types';

// =============================================================================
// Configuration
// =============================================================================

export interface StripPackerConfig {
  /** Saw blade kerf in mm. Default: 3 */
  kerf_mm: number;
  /** Minimum strip height in mm. Default: 100 */
  minStripHeight_mm: number;
  /** Height tolerance for grouping parts (0-1). Default: 0.15 (15%) */
  heightTolerance: number;
  /** Try to align vertical cuts across strips. Default: true */
  preferAlignedCuts: boolean;
  /** Minimum dimension for usable offcut. Default: 150 */
  minUsableDimension: number;
}

export const DEFAULT_STRIP_CONFIG: StripPackerConfig = {
  kerf_mm: 3,
  minStripHeight_mm: 100,
  heightTolerance: 0.15,
  preferAlignedCuts: true,
  minUsableDimension: 150,
};

// =============================================================================
// Internal Types
// =============================================================================

interface ExpandedPart extends PartSpec {
  uid: string;
  /** Effective width when placed (considering grain) */
  placedWidth: number;
  /** Effective height when placed (considering grain) */
  placedHeight: number;
  /** Whether part is rotated from original orientation */
  rotated: boolean;
}

interface Strip {
  /** Y position of strip on sheet */
  y: number;
  /** Height of the strip (tallest part + kerf) */
  height: number;
  /** Parts placed in this strip */
  parts: PlacedPart[];
  /** Total width used (including kerf) */
  usedWidth: number;
}

interface PlacedPart {
  part: ExpandedPart;
  x: number;
  width: number;
  height: number;
}

interface CutLine {
  type: 'horizontal' | 'vertical';
  position: number;
  start: number;
  end: number;
}

export interface StripPackResult extends LayoutResult {
  /** Strips per sheet (for debugging/visualization) */
  stripsBySheet: Strip[][];
  /** Total guillotine cuts required */
  cutCount: number;
  /** All cut lines (for visualization) */
  cutLines: CutLine[];
  /** Algorithm identifier */
  algorithm: 'strip';
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Expand parts by quantity into individual instances.
 * Also determines placement orientation based on grain constraints.
 */
function expandParts(parts: PartSpec[], sheetWidth: number, sheetHeight: number): ExpandedPart[] {
  const expanded: ExpandedPart[] = [];

  for (const p of parts) {
    const count = Math.max(1, Math.floor(p.qty));

    for (let i = 0; i < count; i++) {
      const grain = p.grain ?? 'any';

      // Determine if part can be rotated
      const canRotate = grain === 'any';

      // For grain='length', part length aligns with sheet length (Y axis)
      // For grain='width', part length aligns with sheet width (X axis) - rotated 90°
      let placedWidth: number;
      let placedHeight: number;
      let rotated: boolean;

      if (grain === 'width') {
        // Part must be rotated 90° - length along X axis
        placedWidth = p.length_mm;
        placedHeight = p.width_mm;
        rotated = true;
      } else {
        // grain='length' or 'any' - try normal orientation first
        // For 'any', we might rotate later for better fit
        placedWidth = p.width_mm;
        placedHeight = p.length_mm;
        rotated = false;
      }

      // For 'any' grain, choose orientation that fits better in strips
      // Prefer wider-than-tall for strip packing efficiency
      if (canRotate && placedHeight > placedWidth) {
        // Swap to make part wider than tall (better for horizontal strips)
        const temp = placedWidth;
        placedWidth = placedHeight;
        placedHeight = temp;
        rotated = true;
      }

      expanded.push({
        ...p,
        uid: `${p.id}#${i + 1}`,
        placedWidth,
        placedHeight,
        rotated,
      });
    }
  }

  return expanded;
}

/**
 * Group parts by similar heights using tolerance-based clustering.
 * Returns groups sorted by height (tallest first).
 */
function groupPartsByHeight(
  parts: ExpandedPart[],
  tolerance: number
): Map<number, ExpandedPart[]> {
  // Sort by height descending
  const sorted = [...parts].sort((a, b) => b.placedHeight - a.placedHeight);

  const groups = new Map<number, ExpandedPart[]>();
  const usedIndices = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (usedIndices.has(i)) continue;

    const leader = sorted[i];
    const groupHeight = leader.placedHeight;
    const group: ExpandedPart[] = [leader];
    usedIndices.add(i);

    // Find similar-height parts
    for (let j = i + 1; j < sorted.length; j++) {
      if (usedIndices.has(j)) continue;

      const candidate = sorted[j];
      const heightDiff = Math.abs(candidate.placedHeight - groupHeight);
      const maxDiff = groupHeight * tolerance;

      if (heightDiff <= maxDiff) {
        group.push(candidate);
        usedIndices.add(j);
      }
    }

    groups.set(groupHeight, group);
  }

  return groups;
}

/**
 * Form strips from a height group.
 * Packs parts left-to-right using First Fit Decreasing (by width).
 */
function formStrips(
  parts: ExpandedPart[],
  sheetWidth: number,
  kerf: number
): Strip[] {
  // Sort by width descending for FFD
  const sorted = [...parts].sort((a, b) => b.placedWidth - a.placedWidth);

  const strips: Strip[] = [];
  const maxStripHeight = Math.max(...sorted.map((p) => p.placedHeight));

  for (const part of sorted) {
    // Try to fit in existing strip
    let placed = false;

    for (const strip of strips) {
      const requiredWidth = part.placedWidth + kerf;
      if (strip.usedWidth + requiredWidth <= sheetWidth) {
        // Fits in this strip
        strip.parts.push({
          part,
          x: strip.usedWidth,
          width: part.placedWidth,
          height: part.placedHeight,
        });
        strip.usedWidth += requiredWidth;
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Create new strip
      strips.push({
        y: 0, // Will be set during sheet stacking
        height: maxStripHeight + kerf,
        parts: [
          {
            part,
            x: 0,
            width: part.placedWidth,
            height: part.placedHeight,
          },
        ],
        usedWidth: part.placedWidth + kerf,
      });
    }
  }

  return strips;
}

/**
 * Stack strips onto sheets using First Fit Decreasing (by height).
 * Returns an array of sheets, each containing an array of strips.
 */
function stackStripsOnSheets(
  strips: Strip[],
  sheetWidth: number,
  sheetHeight: number,
  kerf: number
): Strip[][] {
  // Sort strips by height descending
  const sorted = [...strips].sort((a, b) => b.height - a.height);

  const sheets: Strip[][] = [];

  for (const strip of sorted) {
    let placed = false;

    // Try to fit in existing sheet
    for (const sheet of sheets) {
      const currentY = sheet.reduce((sum, s) => sum + s.height, 0);
      if (currentY + strip.height <= sheetHeight) {
        // Update strip's Y position
        strip.y = currentY;
        sheet.push(strip);
        placed = true;
        break;
      }
    }

    if (!placed) {
      // Create new sheet
      strip.y = 0;
      sheets.push([strip]);
    }
  }

  return sheets;
}

/**
 * Optimize cut alignment across strips.
 * Tries to align vertical cut positions to reduce total cuts.
 * NOTE: Only applies to horizontal strip layouts where parts are placed left-to-right.
 * For vertical layouts, parts already have correct x positions.
 */
function optimizeCutAlignment(
  sheets: Strip[][],
  sheetWidth: number,
  kerf: number,
  preferAligned: boolean
): void {
  if (!preferAligned) return;

  for (const sheet of sheets) {
    // Check if this is a vertical layout (strips have parts at different x positions)
    const firstPartPositions = new Set<number>();
    for (const strip of sheet) {
      if (strip.parts.length > 0) {
        firstPartPositions.add(strip.parts[0].x);
      }
    }
    // If strips have parts at different x origins, this is a vertical layout - skip alignment
    if (firstPartPositions.size > 1) {
      continue;
    }

    // Collect all unique X positions where cuts could be
    const cutPositions = new Set<number>();

    for (const strip of sheet) {
      let x = 0;
      for (const placed of strip.parts) {
        x += placed.width + kerf;
        if (x < sheetWidth) {
          cutPositions.add(x);
        }
      }
    }

    // For each strip, try to align parts to common cut positions
    // This is a greedy approach - could be improved with optimization
    const sortedPositions = Array.from(cutPositions).sort((a, b) => a - b);

    for (const strip of sheet) {
      let currentX = 0;

      for (let i = 0; i < strip.parts.length; i++) {
        const placed = strip.parts[i];
        const idealEndX = currentX + placed.width + kerf;

        // Find nearest common cut position
        let nearestAligned = idealEndX;
        let minDistance = Infinity;

        for (const pos of sortedPositions) {
          const distance = Math.abs(pos - idealEndX);
          if (distance < minDistance && distance < 20) {
            // Within 20mm tolerance
            minDistance = distance;
            nearestAligned = pos;
          }
        }

        // Adjust position if alignment is beneficial
        if (nearestAligned !== idealEndX && minDistance < 10) {
          // Small adjustment - worth aligning
          placed.x = currentX;
          currentX = nearestAligned;
        } else {
          placed.x = currentX;
          currentX = idealEndX;
        }
      }

      // Recalculate used width
      if (strip.parts.length > 0) {
        const lastPart = strip.parts[strip.parts.length - 1];
        strip.usedWidth = lastPart.x + lastPart.width + kerf;
      }
    }
  }
}

/**
 * Convert strips to standard Placement format.
 */
function stripsToPlacement(strips: Strip[]): Placement[] {
  const placements: Placement[] = [];

  for (const strip of strips) {
    for (const placed of strip.parts) {
      placements.push({
        part_id: placed.part.uid,
        label: placed.part.label,
        x: placed.x,
        y: strip.y,
        w: placed.width,
        h: placed.height,
        rot: placed.part.rotated ? 90 : 0,
      });
    }
  }

  return placements;
}

/**
 * Extract cut lines from a sheet layout.
 * Each horizontal and vertical cut that must be made.
 */
function extractCutLines(
  strips: Strip[],
  sheetWidth: number,
  sheetHeight: number,
  kerf: number
): CutLine[] {
  const cuts: CutLine[] = [];

  // Horizontal cuts between strips
  let y = 0;
  for (let i = 0; i < strips.length; i++) {
    const strip = strips[i];
    y += strip.height;

    if (y < sheetHeight && i < strips.length - 1) {
      // Cut needed to separate this strip from next
      cuts.push({
        type: 'horizontal',
        position: y - kerf, // Cut position (before kerf)
        start: 0,
        end: sheetWidth,
      });
    }
  }

  // Vertical cuts within each strip
  for (const strip of strips) {
    let x = 0;
    for (let i = 0; i < strip.parts.length; i++) {
      const placed = strip.parts[i];
      x = placed.x + placed.width + kerf;

      if (x < sheetWidth) {
        // Vertical cut after this part
        // Note: This cut extends through the full strip height
        cuts.push({
          type: 'vertical',
          position: x - kerf,
          start: strip.y,
          end: strip.y + strip.height,
        });
      }
    }
  }

  return cuts;
}

/**
 * Count total guillotine cuts needed for a sheet.
 */
function countCuts(cutLines: CutLine[]): number {
  // Each unique cut line is one cut
  // Note: In practice, some cuts might be able to be combined
  // but this gives a conservative count
  return cutLines.length;
}

// =============================================================================
// Vertical-First Guillotine Packer
// =============================================================================

interface VerticalSection {
  x: number;
  width: number;
  placements: PlacedPart[];
  usedHeight: number;
}

/**
 * Pack using vertical-first guillotine cuts.
 * Makes vertical cuts first to create sections, then stacks parts in each section.
 */
function packVerticalFirst(
  parts: ExpandedPart[],
  sheetWidth: number,
  sheetHeight: number,
  kerf: number
): { sheets: Strip[][]; remaining: ExpandedPart[] } {
  const sheets: Strip[][] = [];
  let remaining = [...parts];

  // Sort by width descending - place widest parts first to establish section widths
  remaining.sort((a, b) => b.placedWidth - a.placedWidth);

  while (remaining.length > 0) {
    const sections: VerticalSection[] = [];
    const placed = new Set<ExpandedPart>();
    let usedWidth = 0;

    // Create sections based on widest parts
    for (const part of remaining) {
      if (placed.has(part)) continue;

      // Check if part fits in existing section
      let fittedInSection = false;
      for (const section of sections) {
        if (
          part.placedWidth <= section.width &&
          section.usedHeight + part.placedHeight + kerf <= sheetHeight
        ) {
          // Fits in this section
          section.placements.push({
            part,
            x: section.x,
            width: part.placedWidth,
            height: part.placedHeight,
          });
          section.usedHeight += part.placedHeight + kerf;
          placed.add(part);
          fittedInSection = true;
          break;
        }
      }

      if (!fittedInSection) {
        // Create new section
        const sectionWidth = part.placedWidth + kerf;
        if (usedWidth + sectionWidth <= sheetWidth + kerf) {
          // New section fits
          const sectionX = usedWidth;
          sections.push({
            x: sectionX,
            width: part.placedWidth,
            placements: [
              {
                part,
                x: sectionX,
                width: part.placedWidth,
                height: part.placedHeight,
              },
            ],
            usedHeight: part.placedHeight + kerf,
          });
          usedWidth += sectionWidth;
          placed.add(part);
        }
      }
    }

    if (placed.size === 0) {
      // No progress - remaining parts don't fit
      break;
    }

    // Convert sections to strips format
    // Each section becomes a "strip" at y=0 with parts stacked vertically
    const sheetStrips: Strip[] = [];

    for (const section of sections) {
      // Create individual strips for each part (for compatibility)
      let y = 0;
      for (const placement of section.placements) {
        // Create a new PlacedPart with the correct x coordinate
        const placedPart: PlacedPart = {
          part: placement.part,
          x: section.x, // Use section.x directly, not from placement
          width: placement.width,
          height: placement.height,
        };
        sheetStrips.push({
          y,
          height: placement.height + kerf,
          parts: [placedPart],
          usedWidth: section.x + placement.width + kerf,
        });
        y += placement.height + kerf;
      }
    }

    sheets.push(sheetStrips);
    remaining = remaining.filter((p) => !placed.has(p));
  }

  return { sheets, remaining };
}

// =============================================================================
// Main Packing Function
// =============================================================================

/**
 * Try to find complementary widths that sum to sheet width.
 * This enables better nesting (e.g., 750 + 1080 = 1830).
 */
function findComplementaryWidths(
  parts: ExpandedPart[],
  sheetWidth: number,
  kerf: number,
  tolerance: number = 10
): Map<ExpandedPart, ExpandedPart[]> {
  const complements = new Map<ExpandedPart, ExpandedPart[]>();

  for (const p1 of parts) {
    // Maximum width for complementary part (must fit with kerf)
    const maxWidth = sheetWidth - p1.placedWidth - kerf;
    // Ideal complementary width (uses full sheet width)
    const idealWidth = maxWidth;

    const matches = parts.filter(
      (p2) =>
        p2 !== p1 &&
        p2.placedWidth <= maxWidth && // MUST fit within sheet
        Math.abs(p2.placedWidth - idealWidth) <= tolerance
    );
    if (matches.length > 0) {
      complements.set(p1, matches);
    }
  }

  return complements;
}

/**
 * Pack using nested guillotine approach for better space utilization.
 * Creates vertical sections when parts have complementary widths.
 */
function packNested(
  parts: ExpandedPart[],
  sheetWidth: number,
  sheetHeight: number,
  kerf: number
): { sheets: Strip[][]; remaining: ExpandedPart[] } {
  const sheets: Strip[][] = [];
  let remaining = [...parts];

  // Sort by area descending (place large parts first)
  remaining.sort((a, b) => b.placedWidth * b.placedHeight - a.placedWidth * a.placedHeight);

  while (remaining.length > 0) {
    const sheetStrips: Strip[] = [];
    let usedHeight = 0;

    // Find complementary widths
    const complements = findComplementaryWidths(remaining, sheetWidth, kerf);

    // Try to place parts with complementary widths side by side
    const placed = new Set<ExpandedPart>();

    for (const [p1, matches] of complements) {
      if (placed.has(p1)) continue;

      // Find best match based on height similarity
      const p2 = matches.find((m) => !placed.has(m));
      if (!p2) continue;

      // Check if both fit in remaining height
      const maxHeight = Math.max(p1.placedHeight, p2.placedHeight);
      if (usedHeight + maxHeight + kerf > sheetHeight) continue;

      // Place both parts as a "wide strip" with two sections
      const stripHeight = maxHeight + kerf;

      // Left section (p1)
      const leftStrip: Strip = {
        y: usedHeight,
        height: stripHeight,
        parts: [
          {
            part: p1,
            x: 0,
            width: p1.placedWidth,
            height: p1.placedHeight,
          },
        ],
        usedWidth: p1.placedWidth + kerf,
      };

      // Try to stack more parts in left section if there's vertical space
      const leftRemainingHeight = p1.placedHeight;
      let leftY = 0;
      for (const candidate of remaining) {
        if (placed.has(candidate) || candidate === p1 || candidate === p2) continue;
        if (
          candidate.placedWidth <= p1.placedWidth &&
          leftY + candidate.placedHeight + kerf <= leftRemainingHeight
        ) {
          // Would need more complex logic for sub-strips
          // For now, skip this optimization
        }
      }

      // Right section starts after p1
      const rightX = p1.placedWidth + kerf;
      const rightStrip: Strip = {
        y: usedHeight,
        height: stripHeight,
        parts: [
          {
            part: p2,
            x: rightX,
            width: p2.placedWidth,
            height: p2.placedHeight,
          },
        ],
        usedWidth: rightX + p2.placedWidth + kerf,
      };

      // Merge into single strip representation
      sheetStrips.push({
        y: usedHeight,
        height: stripHeight,
        parts: [...leftStrip.parts, ...rightStrip.parts],
        usedWidth: sheetWidth,
      });

      usedHeight += stripHeight;
      placed.add(p1);
      placed.add(p2);
    }

    // Place remaining parts in standard horizontal strips
    const unplacedThisRound = remaining.filter((p) => !placed.has(p));
    const heightGroups = groupPartsByHeight(unplacedThisRound, 0.15);

    for (const [, groupParts] of heightGroups) {
      const strips = formStrips(groupParts, sheetWidth, kerf);

      for (const strip of strips) {
        if (usedHeight + strip.height <= sheetHeight) {
          strip.y = usedHeight;
          sheetStrips.push(strip);
          usedHeight += strip.height;
          for (const p of strip.parts) {
            placed.add(p.part);
          }
        }
      }
    }

    if (placed.size === 0) {
      // No progress - remaining parts don't fit
      break;
    }

    sheets.push(sheetStrips);
    remaining = remaining.filter((p) => !placed.has(p));
  }

  return { sheets, remaining };
}

/**
 * Pack parts using strip-based algorithm optimized for cut minimization.
 */
export function packWithStrips(
  parts: PartSpec[],
  stock: StockSheetSpec,
  config: Partial<StripPackerConfig> = {}
): StripPackResult {
  const fullConfig = { ...DEFAULT_STRIP_CONFIG, ...config };
  const kerf = stock.kerf_mm ?? fullConfig.kerf_mm;
  const sheetWidth = stock.width_mm;
  const sheetHeight = stock.length_mm;

  // Expand parts by quantity
  const expanded = expandParts(parts, sheetWidth, sheetHeight);

  // Check for parts too large for sheet
  const unplacedParts: UnplacedPart[] = [];
  const fittingParts: ExpandedPart[] = [];

  for (const part of expanded) {
    const fitsNormal = part.placedWidth <= sheetWidth && part.placedHeight <= sheetHeight;
    const fitsRotated =
      part.grain === 'any' &&
      part.placedHeight <= sheetWidth &&
      part.placedWidth <= sheetHeight;

    if (fitsNormal || fitsRotated) {
      // If rotated fits better, rotate
      if (!fitsNormal && fitsRotated) {
        const temp = part.placedWidth;
        part.placedWidth = part.placedHeight;
        part.placedHeight = temp;
        part.rotated = !part.rotated;
      }
      fittingParts.push(part);
    } else {
      // Part doesn't fit
      const existing = unplacedParts.find((u) => u.part.id === part.id);
      if (existing) {
        existing.count++;
      } else {
        unplacedParts.push({
          part: parts.find((p) => p.id === part.id)!,
          count: 1,
          reason: 'too_large_for_sheet',
        });
      }
    }
  }

  if (fittingParts.length === 0) {
    return {
      sheets: [],
      stats: {
        used_area_mm2: 0,
        waste_area_mm2: 0,
        cuts: 0,
        cut_length_mm: 0,
        edgebanding_length_mm: 0,
      },
      unplaced: unplacedParts.length > 0 ? unplacedParts : undefined,
      stripsBySheet: [],
      cutCount: 0,
      cutLines: [],
      algorithm: 'strip',
    };
  }

  // Try multiple approaches and pick the best one

  // Approach 1: Standard strip packing (horizontal strips)
  const heightGroups = groupPartsByHeight(fittingParts, fullConfig.heightTolerance);
  const allStrips: Strip[] = [];
  for (const [, groupParts] of heightGroups) {
    const strips = formStrips(groupParts, sheetWidth, kerf);
    allStrips.push(...strips);
  }
  const standardSheets = stackStripsOnSheets(allStrips, sheetWidth, sheetHeight, kerf);

  // Approach 2: Nested guillotine (uses complementary widths)
  const { sheets: nestedSheets, remaining: nestedRemaining } = packNested(
    fittingParts,
    sheetWidth,
    sheetHeight,
    kerf
  );

  // Approach 3: Vertical-first guillotine
  const { sheets: verticalSheets, remaining: verticalRemaining } = packVerticalFirst(
    fittingParts,
    sheetWidth,
    sheetHeight,
    kerf
  );

  // Score each approach: fewer sheets wins, then fewer remaining parts, then fewer cut lines
  interface ApproachResult {
    sheets: Strip[][];
    remaining: ExpandedPart[];
    name: string;
    cutCount: number;
  }

  // Calculate cut count for each approach
  const calcCutCount = (sheets: Strip[][]): number => {
    let cuts = 0;
    for (const sheet of sheets) {
      const cutLines = extractCutLines(sheet, sheetWidth, sheetHeight, kerf);
      cuts += cutLines.length;
    }
    return cuts;
  };

  const approaches: ApproachResult[] = [
    { sheets: standardSheets, remaining: [], name: 'horizontal', cutCount: calcCutCount(standardSheets) },
    { sheets: nestedSheets, remaining: nestedRemaining, name: 'nested', cutCount: calcCutCount(nestedSheets) },
    { sheets: verticalSheets, remaining: verticalRemaining, name: 'vertical', cutCount: calcCutCount(verticalSheets) },
  ];

  // Sort by: sheets count, then remaining count, then cut count
  approaches.sort((a, b) => {
    // Primary: fewer sheets
    if (a.sheets.length !== b.sheets.length) {
      return a.sheets.length - b.sheets.length;
    }
    // Secondary: fewer remaining parts
    if (a.remaining.length !== b.remaining.length) {
      return a.remaining.length - b.remaining.length;
    }
    // Tertiary: fewer cuts
    return a.cutCount - b.cutCount;
  });

  // Pick the best approach
  const best = approaches[0];
  let sheets = best.sheets;

  // Add any remaining parts that didn't fit
  if (best.remaining.length > 0) {
    for (const part of best.remaining) {
      const existing = unplacedParts.find((u) => u.part.id === part.id);
      if (existing) {
        existing.count++;
      } else {
        unplacedParts.push({
          part: parts.find((p) => p.id === part.id)!,
          count: 1,
          reason: 'insufficient_sheet_capacity',
        });
      }
    }
  }

  // Optimize cut alignment
  optimizeCutAlignment(sheets, sheetWidth, kerf, fullConfig.preferAlignedCuts);

  // Convert to standard layout format
  const sheetLayouts: SheetLayout[] = [];
  let totalCutCount = 0;
  const allCutLines: CutLine[] = [];

  for (let i = 0; i < sheets.length; i++) {
    const sheetStrips = sheets[i];
    const placements = stripsToPlacement(sheetStrips);
    const usedArea = placements.reduce((sum, p) => sum + p.w * p.h, 0);
    const cutLines = extractCutLines(sheetStrips, sheetWidth, sheetHeight, kerf);

    sheetLayouts.push({
      sheet_id: `${stock.id}:${i + 1}`,
      placements,
      used_area_mm2: usedArea,
    });

    totalCutCount += countCuts(cutLines);
    allCutLines.push(...cutLines);
  }

  // Calculate stats
  const sheetArea = sheetWidth * sheetHeight;
  const totalSheetArea = sheetArea * sheetLayouts.length;
  const usedArea = sheetLayouts.reduce((sum, s) => sum + (s.used_area_mm2 ?? 0), 0);
  const wasteArea = totalSheetArea - usedArea;

  // Calculate cut length
  const cutLength = allCutLines.reduce((sum, cut) => {
    return sum + (cut.type === 'horizontal' ? sheetWidth : cut.end - cut.start);
  }, 0);

  // Calculate edgebanding (simplified)
  let edgebandingLength = 0;
  for (const sheet of sheetLayouts) {
    for (const p of sheet.placements) {
      const originalPart = parts.find((part) => p.part_id.startsWith(part.id));
      if (originalPart?.band_edges) {
        const be = originalPart.band_edges;
        edgebandingLength +=
          (be.top ? p.w : 0) + (be.right ? p.h : 0) + (be.bottom ? p.w : 0) + (be.left ? p.h : 0);
      }
    }
  }

  const stats: LayoutStats = {
    used_area_mm2: usedArea,
    waste_area_mm2: wasteArea,
    cuts: totalCutCount,
    cut_length_mm: cutLength,
    edgebanding_length_mm: edgebandingLength,
  };

  return {
    sheets: sheetLayouts,
    stats,
    unplaced: unplacedParts.length > 0 ? unplacedParts : undefined,
    stripsBySheet: sheets,
    cutCount: totalCutCount,
    cutLines: allCutLines,
    algorithm: 'strip',
  };
}

/**
 * Calculate a score for strip pack result.
 * Higher score = better result.
 */
export function calculateStripScore(result: StripPackResult, sheetArea: number): number {
  const totalSheetArea = result.sheets.length * sheetArea;
  const usedArea = result.stats.used_area_mm2;
  const utilizationPct = totalSheetArea > 0 ? (usedArea / totalSheetArea) * 100 : 0;

  // Scoring hierarchy:
  // 1. Fewer sheets (primary)
  // 2. Fewer cuts (secondary)
  // 3. Higher utilization (tertiary)
  return (
    -result.sheets.length * 10_000 + // Fewer sheets
    -result.cutCount * 100 + // Fewer cuts
    utilizationPct // Higher utilization
  );
}

import type { CutlistPart } from '@/lib/cutlist/types';

/**
 * Configuration for a parametric cupboard.
 */
export interface CupboardConfig {
  /** Overall external width in mm (including top/base overhang) */
  width: number;
  /** Overall external height in mm (including adjusters) */
  height: number;
  /** Overall external depth in mm (including top/base overhang at back) */
  depth: number;
  /** Board thickness in mm (16, 18, or 25) */
  materialThickness: number;
  /** Number of fixed shelves (0-10) */
  shelfCount: number;
  /** Door configuration */
  doorStyle: 'none' | 'single' | 'double';
  /** Whether the cupboard has a back panel */
  hasBack: boolean;
  /** Back panel thickness in mm (3 for hardboard, 16 for melamine) */
  backMaterialThickness: number;
  /** Gap between doors and carcass edges in mm */
  doorGap: number;
  /** Shelf setback from back edge in mm */
  shelfSetback: number;
  /** Adjuster height in mm (space at bottom for levelling feet) */
  adjusterHeight: number;
  /** Top overhang past sides (left + right) in mm. Set to 0 for side-by-side cupboards. */
  topOverhangSides: number;
  /** Top overhang past back in mm */
  topOverhangBack: number;
  /** Base overhang past sides (left + right) in mm. Normally same as top. Set to 0 for side-by-side. */
  baseOverhangSides: number;
  /** Base overhang past back in mm. Normally same as top. */
  baseOverhangBack: number;
  /** Depth of routed slot in top for back panel in mm */
  backSlotDepth: number;
}

export const DEFAULT_CUPBOARD_CONFIG: CupboardConfig = {
  width: 900,
  height: 1800,
  depth: 500,
  materialThickness: 16,
  shelfCount: 3,
  doorStyle: 'double',
  hasBack: true,
  backMaterialThickness: 3,
  doorGap: 2,
  shelfSetback: 2,
  adjusterHeight: 10,
  topOverhangSides: 10,
  topOverhangBack: 10,
  baseOverhangSides: 10,
  baseOverhangBack: 10,
  backSlotDepth: 8,
};

/**
 * A furniture template that generates cutlist parts from a configuration.
 * Extensible for future templates (desk, pedestal, bookshelf, etc.)
 */
export interface FurnitureTemplate<TConfig = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  defaultConfig: TConfig;
  generateParts: (config: TConfig) => CutlistPart[];
}

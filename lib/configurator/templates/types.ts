import type { CutlistPart } from '@/lib/cutlist/types';

export type CupboardTopConstruction = 'single' | 'laminated';
export type CupboardBaseConstruction = 'single' | 'laminated' | 'cleated';

/**
 * Configuration for a parametric cupboard.
 */
export interface CupboardConfig {
  /** Overall external width in mm (including top/base overhang) */
  width: number;
  /** Overall external height in mm (including adjusters) */
  height: number;
  /** Overall external depth in mm (including top/base overhangs at front and back) */
  depth: number;
  /** Board thickness in mm (16, 18, or 25) */
  materialThickness: number;
  /** Top construction mode */
  topConstruction: CupboardTopConstruction;
  /** Base construction mode */
  baseConstruction: CupboardBaseConstruction;
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
  /** Top overhang past front edge in mm */
  topOverhangFront: number;
  /** Top overhang past back in mm */
  topOverhangBack: number;
  /** Base overhang past sides (left + right) in mm. Normally same as top. Set to 0 for side-by-side. */
  baseOverhangSides: number;
  /** Base overhang past front edge in mm. Normally same as top. */
  baseOverhangFront: number;
  /** Base overhang past back in mm. Normally same as top. */
  baseOverhangBack: number;
  /** Depth of routed slot in top for back panel in mm */
  backSlotDepth: number;
  /** Back panel recess from rear edge of sides in mm (0 = flush) */
  backRecess: number;
}

export const DEFAULT_CUPBOARD_CONFIG: CupboardConfig = {
  width: 900,
  height: 1800,
  depth: 500,
  materialThickness: 16,
  topConstruction: 'laminated',
  baseConstruction: 'cleated',
  shelfCount: 3,
  doorStyle: 'double',
  hasBack: true,
  backMaterialThickness: 3,
  doorGap: 2,
  shelfSetback: 2,
  adjusterHeight: 10,
  topOverhangSides: 10,
  topOverhangFront: 0,
  topOverhangBack: 10,
  baseOverhangSides: 10,
  baseOverhangFront: 0,
  baseOverhangBack: 10,
  backSlotDepth: 8,
  backRecess: 0,
};

/**
 * Configuration for a parametric pigeon hole unit.
 * Grid of open cubbies defined by columns × rows.
 */
export interface PigeonholeConfig {
  /** Overall external width in mm */
  width: number;
  /** Overall external height in mm (including adjusters) */
  height: number;
  /** Overall external depth in mm */
  depth: number;
  /** Board thickness in mm (16, 18, or 25) */
  materialThickness: number;
  /** Number of columns (1-6) */
  columns: number;
  /** Number of rows (1-6) */
  rows: number;
  /** Whether top and base are laminated (2× thickness) */
  laminateTopBase: boolean;
  /** Whether the unit has a back panel */
  hasBack: boolean;
  /** Back panel thickness in mm (3 for hardboard, 16 for melamine) */
  backMaterialThickness: number;
  /** Shelf/divider setback from back edge in mm */
  shelfSetback: number;
  /** Adjuster height in mm (space at bottom for levelling feet) */
  adjusterHeight: number;
  /** Top overhang past sides (left + right) in mm */
  topOverhangSides: number;
  /** Top overhang past back in mm */
  topOverhangBack: number;
  /** Base overhang past sides (left + right) in mm */
  baseOverhangSides: number;
  /** Base overhang past back in mm */
  baseOverhangBack: number;
  /** Door configuration: 'none' or 'per-cell' (one door per compartment) */
  doorStyle: 'none' | 'per-cell';
  /** Gap between each door and its cell opening in mm */
  doorGap: number;
  /** Depth of routed slot in top for back panel in mm */
  backSlotDepth: number;
  /** Back panel recess from rear edge of sides in mm (0 = flush) */
  backRecess: number;
}

export const DEFAULT_PIGEONHOLE_CONFIG: PigeonholeConfig = {
  width: 700,
  height: 700,
  depth: 350,
  materialThickness: 16,
  columns: 2,
  rows: 2,
  laminateTopBase: false,
  hasBack: true,
  backMaterialThickness: 16,
  doorStyle: 'none',
  doorGap: 2,
  shelfSetback: 2,
  adjusterHeight: 10,
  topOverhangSides: 0,
  topOverhangBack: 0,
  baseOverhangSides: 0,
  baseOverhangBack: 0,
  backSlotDepth: 8,
  backRecess: 0,
};

/**
 * Configuration for a parametric desk-height pedestal.
 * No top panel — sides extend up as legs under the desk.
 * Drawer fronts stack vertically: optional pencil drawer at top,
 * N equal standard drawers in the middle, optional filing drawer at bottom.
 */
export interface PedestalConfig {
  /** Overall external width in mm */
  width: number;
  /** Overall external height in mm (including adjusters) */
  height: number;
  /** Overall external depth in mm */
  depth: number;
  /** Board thickness in mm (16, 18, or 25) */
  materialThickness: number;
  /** Number of standard (equal-height) drawers */
  drawerCount: number;
  /** Whether to include a shallow pencil drawer at the top */
  hasPencilDrawer: boolean;
  /** Pencil drawer front height in mm */
  pencilDrawerHeight: number;
  /** Whether to include a deep filing drawer at the bottom */
  hasFilingDrawer: boolean;
  /** Filing drawer front height in mm */
  filingDrawerHeight: number;
  /** Gap between each drawer front in mm */
  drawerGap: number;
  /** Whether the pedestal has a back panel */
  hasBack: boolean;
  /** Back panel thickness in mm (3 for hardboard, 16 for melamine) */
  backMaterialThickness: number;
  /** Adjuster height in mm (space at bottom for levelling feet) */
  adjusterHeight: number;
  /** Shelf setback from back edge in mm */
  shelfSetback: number;
  /** Back panel recess from rear edge of sides in mm (0 = flush) */
  backRecess: number;
  /** Depth of routed slot for back panel in mm */
  backSlotDepth: number;
}

export const DEFAULT_PEDESTAL_CONFIG: PedestalConfig = {
  width: 400,
  height: 700,
  depth: 590,
  materialThickness: 16,
  drawerCount: 3,
  hasPencilDrawer: true,
  pencilDrawerHeight: 90,
  hasFilingDrawer: false,
  filingDrawerHeight: 390,
  drawerGap: 2,
  hasBack: true,
  backMaterialThickness: 3,
  adjusterHeight: 10,
  shelfSetback: 2,
  backRecess: 0,
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

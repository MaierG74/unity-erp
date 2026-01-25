/**
 * Cutlist Module
 *
 * Barrel export for all cutlist-related types and utilities.
 *
 * Usage:
 *   import { PartSpec, BoardType, parseSketchUpCsv } from '@/lib/cutlist';
 */

// Types
export * from './types';

// Utilities
export { parseCSVContent, parseDimension } from './csvParser';
export {
  // Legacy group-based expansion
  getBoardTypeLabel,
  getBoardTypeDescription,
  expandGroupsToPartSets,
  expandGroupsToPartSpecs,
  // New part-level lamination expansion
  expandPartsWithLamination,
  expandedPartsToPartSpecs,
  getLaminationTypeLabel,
  getLaminationTypeDescription,
  calculateFinalThickness,
  getPrimaryBoardCount,
  getBackerBoardCount,
} from './boardCalculator';
export {
  validateCutlistDimensions,
  summariseCutlistDimensions,
  cloneCutlistDimensions,
  areCutlistDimensionsEqual,
  CUTLIST_DIMENSIONS_TEMPLATE,
} from './cutlistDimensions';

// Material Defaults Persistence
export {
  loadMaterialDefaults,
  saveMaterialDefaults,
  deleteMaterialDefaults,
  migrateMaterialDefaults,
  createEmptyMaterialDefaults,
  type MaterialDefaults,
} from './materialsDefaults';

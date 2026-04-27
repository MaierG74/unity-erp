import { countCutPieces } from './cutPieces';
import { countEdgeBundles } from './edgeBundles';
import { ACTIVITY_CODES } from './types';
import type { ActivityCode, CountingStrategy } from './types';

export * from './types';
export { countCutPieces } from './cutPieces';
export { countEdgeBundles } from './edgeBundles';

export const STRATEGIES: Record<ActivityCode, CountingStrategy> = {
  [ACTIVITY_CODES.CUT_PIECES]: countCutPieces,
  [ACTIVITY_CODES.EDGE_BUNDLES]: countEdgeBundles,
};

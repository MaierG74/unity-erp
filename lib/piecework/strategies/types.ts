export const ACTIVITY_CODES = {
  CUT_PIECES: 'cut_pieces',
  EDGE_BUNDLES: 'edge_bundles',
} as const;

export type ActivityCode = (typeof ACTIVITY_CODES)[keyof typeof ACTIVITY_CODES];

export type LaminationType = 'none' | 'with-backer' | 'same-board' | 'custom';

export interface PartInBatch {
  partId: string;
  quantity: number;
  lamination: LaminationType;
  bandEdges: { top: boolean; right: boolean; bottom: boolean; left: boolean } | null;
  /**
   * Derived from `cutlist_snapshot[].parts[].lamination_config.layers.length` when present.
   * Only used for `lamination='custom'` rows.
   */
  customLayerCount?: number;
}

export interface CuttingPlanBatch {
  cuttingPlanRunId: string;
  materialColorLabel: string;
  /**
   * Derived from cutting-plan aggregate output rows:
   * `AggregateResponse.material_groups[].parts[]` in `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts`.
   */
  parts: PartInBatch[];
}

export interface CountResult {
  count: number;
  breakdown: {
    perPart: Array<{
      partId: string;
      contributesCut: number;
      contributesEdge: number;
    }>;
  };
}

export type CountingStrategy = (batch: CuttingPlanBatch) => CountResult;

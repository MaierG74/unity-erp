export type LineStatusInput = {
  hasCutlistSnapshot: boolean;
  primaryMaterialId: number | null;
  shortfallCount: number;
};

export type LineStatusKind = 'ready' | 'needs-material' | 'shortfall';

export type LineStatus = {
  kind: LineStatusKind;
  sentence: string;
};

export function computeLineStatus(input: LineStatusInput): LineStatus {
  if (input.shortfallCount > 0) {
    return {
      kind: 'shortfall',
      sentence: `${input.shortfallCount} component${input.shortfallCount === 1 ? '' : 's'} short`,
    };
  }
  if (input.hasCutlistSnapshot && input.primaryMaterialId == null) {
    return { kind: 'needs-material', sentence: 'Needs cutlist material' };
  }
  return { kind: 'ready', sentence: 'Ready to plan' };
}

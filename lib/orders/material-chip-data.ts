import type { CutlistSnapshotGroup } from './snapshot-types';

export type MaterialChipInput = {
  cutlistMaterialSnapshot: CutlistSnapshotGroup[] | null | undefined;
  cutlistPrimaryMaterialId: number | null;
  cutlistPartOverrides: unknown[] | null | undefined;
};

export type MaterialChipState =
  | { kind: 'hidden' }
  | { kind: 'not-configured' }
  | { kind: 'single'; primaries: string[]; overrideCount: number }
  | { kind: 'multiple'; primaries: string[]; overrideCount: number };

function firstResolvedName(group: any): string | null {
  const firstPart = Array.isArray(group?.parts) ? group.parts[0] : null;
  return firstPart?.effective_board_name ?? group?.primary_material_name ?? null;
}

export function resolveMaterialChip(input: MaterialChipInput): MaterialChipState {
  const groups = Array.isArray(input.cutlistMaterialSnapshot) ? input.cutlistMaterialSnapshot : [];
  if (groups.length === 0) return { kind: 'hidden' };

  if (input.cutlistPrimaryMaterialId == null) {
    return { kind: 'not-configured' };
  }

  const overrideCount = Array.isArray(input.cutlistPartOverrides) ? input.cutlistPartOverrides.length : 0;
  const names = new Set<string>();
  for (const group of groups) {
    const name = firstResolvedName(group);
    if (name) names.add(name);
  }

  if (names.size === 0) {
    return {
      kind: 'single',
      primaries: [`Material ${input.cutlistPrimaryMaterialId}`],
      overrideCount,
    };
  }

  const primaries = Array.from(names);
  if (primaries.length === 1) {
    return { kind: 'single', primaries, overrideCount };
  }
  return { kind: 'multiple', primaries, overrideCount };
}

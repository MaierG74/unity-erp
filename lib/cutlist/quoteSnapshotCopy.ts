import type { CutlistLineRefs } from '@/lib/cutlist/types';

type CutlistLineLike = {
  id: string;
  cutlist_slot?: string | null;
};

export function cloneJsonValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildCutlistLineRefsFromLines(lines: readonly CutlistLineLike[]): CutlistLineRefs {
  const refs: CutlistLineRefs = {};

  for (const line of lines) {
    if (typeof line.cutlist_slot === 'string' && line.cutlist_slot.trim().length > 0) {
      refs[line.cutlist_slot] = line.id;
    }
  }

  return refs;
}

export function cloneCutlistLayoutWithLineRefs(layout: unknown, lineRefs: CutlistLineRefs): unknown {
  const layoutClone = cloneJsonValue(layout);

  if (!layoutClone || typeof layoutClone !== 'object' || Array.isArray(layoutClone)) {
    return layoutClone;
  }

  const nextLayout = layoutClone as Record<string, unknown>;

  if (Object.keys(lineRefs).length > 0) {
    nextLayout.lineRefs = lineRefs;
  } else {
    delete nextLayout.lineRefs;
  }

  return nextLayout;
}

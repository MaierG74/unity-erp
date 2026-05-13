export const COLLAPSE_SECTION_IDS = ['overview', 'cutlist-materials', 'readiness', 'next-actions'] as const;
export type CollapseSectionId = typeof COLLAPSE_SECTION_IDS[number];
export type CollapseState = 'open' | 'closed';

const STORAGE_KEY_PREFIX = 'unity-erp.order-panel.sections.';

function storageKey(id: CollapseSectionId): string {
  return `${STORAGE_KEY_PREFIX}${id}`;
}

function isValidState(value: unknown): value is CollapseState {
  return value === 'open' || value === 'closed';
}

export function loadCollapseState(id: CollapseSectionId): CollapseState {
  if (typeof globalThis === 'undefined') return 'closed';
  const storage = (globalThis as any).localStorage;
  if (!storage || typeof storage.getItem !== 'function') return 'closed';
  try {
    const raw = storage.getItem(storageKey(id));
    return isValidState(raw) ? raw : 'closed';
  } catch {
    return 'closed';
  }
}

export function saveCollapseState(id: CollapseSectionId, state: CollapseState): void {
  if (typeof globalThis === 'undefined') return;
  const storage = (globalThis as any).localStorage;
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(storageKey(id), state);
  } catch {
    // Storage quota or privacy mode: collapse persistence is non-critical.
  }
}

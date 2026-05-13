import assert from 'node:assert/strict';

import {
  loadCollapseState,
  saveCollapseState,
  COLLAPSE_SECTION_IDS,
} from './panel-collapse';

declare const test: (name: string, fn: () => void) => void;

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
  clear(): void { this.data.clear(); }
  get length(): number { return this.data.size; }
  key(index: number): string | null { return Array.from(this.data.keys())[index] ?? null; }
}

function withMockStorage(fn: () => void) {
  const previous = (globalThis as any).localStorage;
  (globalThis as any).localStorage = new MemoryStorage();
  try {
    fn();
  } finally {
    (globalThis as any).localStorage = previous;
  }
}

test('loadCollapseState returns "closed" for any section with no entry', () => {
  withMockStorage(() => {
    for (const id of COLLAPSE_SECTION_IDS) {
      assert.equal(loadCollapseState(id), 'closed');
    }
  });
});

test('saveCollapseState persists and loadCollapseState reads it back', () => {
  withMockStorage(() => {
    saveCollapseState('overview', 'open');
    assert.equal(loadCollapseState('overview'), 'open');
    saveCollapseState('overview', 'closed');
    assert.equal(loadCollapseState('overview'), 'closed');
  });
});

test('loadCollapseState falls back to "closed" on malformed localStorage value', () => {
  withMockStorage(() => {
    (globalThis as any).localStorage.setItem('unity-erp.order-panel.sections.overview', 'not-a-valid-state');
    assert.equal(loadCollapseState('overview'), 'closed');
  });
});

test('loadCollapseState is SSR-safe (returns "closed" when localStorage missing)', () => {
  const previous = (globalThis as any).localStorage;
  (globalThis as any).localStorage = undefined;
  try {
    assert.equal(loadCollapseState('overview'), 'closed');
  } finally {
    (globalThis as any).localStorage = previous;
  }
});

test('saveCollapseState is SSR-safe (no throw when localStorage missing)', () => {
  const previous = (globalThis as any).localStorage;
  (globalThis as any).localStorage = undefined;
  try {
    saveCollapseState('overview', 'open');
    assert.equal(true, true);
  } finally {
    (globalThis as any).localStorage = previous;
  }
});

test('COLLAPSE_SECTION_IDS lists exactly the four sections', () => {
  assert.deepEqual([...COLLAPSE_SECTION_IDS].sort(), ['cutlist-materials', 'next-actions', 'overview', 'readiness']);
});

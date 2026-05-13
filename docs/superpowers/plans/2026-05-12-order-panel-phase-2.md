# Order Panel Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Order Line Setup panel so all four sections start collapsed by default with localStorage persistence, the status sentence moves into the panel header, and the Component Readiness section becomes single-line rows with REQ / RES / AVAIL / SHORT columns plus per-row ⟳ swap and 🛒 order action icons (no ＋ reserve in Phase 2). Reserve all button goes in the section header.

**Architecture:** Two new pure helpers (`panel-collapse.ts`, `reservation-predicate.ts`) handle the cross-cutting logic. A new `ReadinessRow` component owns the single-line row layout. The four existing section components get collapse wrappers. `OrderLineSetupPanel` manages collapse state via `useState` synced with localStorage on toggle. `OrderComponentsDialog` gains one new `initialFocusComponentId` prop with a `shortfall > 0` guard so stale clicks don't pre-check For-Stock rows.

**Tech Stack:** Next.js 16 + React 18, TypeScript, Tailwind v4.2, shadcn 4.0, lucide-react, TanStack Query, vitest, Inter font. No new backend, no schema, no new queries.

**Spec:** [docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md](../specs/2026-05-12-order-panel-phase-2-3-design.md) — Phase 2 sections specifically.

**Branch strategy:** Implementation lands on a fresh branch `codex/local-order-panel-phase-2` cut from `origin/codex/integration` (NOT from the spec branch). Phase 3 ships as a separate PR after Phase 2 merges.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `lib/orders/panel-collapse.ts` | Pure helpers `loadCollapseState(sectionId)` / `saveCollapseState(sectionId, state)`. Defaults to `'closed'` for any section with no localStorage entry. SSR-safe (guards `typeof window`). |
| `lib/orders/panel-collapse.test.ts` | Vitest unit tests. Asserts all sections default `'closed'`, persistence works, malformed JSON falls back, SSR-safe. |
| `lib/orders/reservation-predicate.ts` | Pure helpers `targetReservable(required, available): number` and `canReserveMore(required, available, reservedThisOrder): boolean`. Single source of truth for Reserve all visibility AND Phase 3 per-row enable. |
| `lib/orders/reservation-predicate.test.ts` | Vitest unit tests covering edges (zero stock, partial cover, already at max, negative diff). |
| `components/features/orders/setup-panel/ReadinessRow.tsx` | Single-line readiness row: code + description + REQ/RES/AVAIL/SHORT tabular columns + ⟳ swap + 🛒 order icons. |

### Modified files

| File | Change |
|---|---|
| `components/features/orders/setup-panel/OverviewSection.tsx` | Remove the standalone status line (moves to panel header). Add `isOpen` + `onToggle` props for collapse wrapper. |
| `components/features/orders/setup-panel/CutlistMaterialsSection.tsx` | Add collapse wrapper. Add section pill (`<primary>` / `N overrides` / `Not configured`). |
| `components/features/orders/setup-panel/ComponentReadinessSection.tsx` | Replace inline blocks with `ReadinessRow` instances. Add Reserve all button in section header (using `canReserveMore`). Add collapse wrapper. Add section pill (`N short` / `All ready`). |
| `components/features/orders/setup-panel/NextActionsSection.tsx` | Add collapse wrapper. |
| `components/features/orders/OrderLineSetupPanel.tsx` | Move status sentence into header. Manage per-section collapse state with localStorage sync. Pass through new dialog focus prop. |
| `components/features/orders/OrderComponentsDialog.tsx` | Add `initialFocusComponentId?: number` prop. On open with the prop set: locate row, scroll/expand, pre-check ONLY if `component.shortfall > 0`; otherwise open without pre-check + toast. Clear focus on close. |
| `app/orders/[orderId]/page.tsx` | Add `orderComponentsFocus` state. Update 🛒 row click to set focus + open dialog. Update `handleTabChange` to drop `?line=` when leaving Products. Pass focus to dialog. |

### Untouched

- `components/features/shared/CutlistMaterialDialog.tsx` — Phase 1 contract, do not modify.
- `components/features/orders/setup-panel/MaterialChip.tsx` — Phase 1 contract.
- `lib/orders/line-status.ts` / `material-chip-data.ts` — Phase 1 helpers.
- `lib/orders/snapshot-types.ts` — type definitions stay.

---

## Task 1: Create implementation branch

**Files:** none

- [ ] **Step 1.1: Verify clean working tree on integration**

```bash
git fetch origin
git checkout codex/integration
git pull --ff-only origin codex/integration
git status
```

Expected: `nothing to commit, working tree clean`. If untracked files belong to other sessions (e.g. product-collab work), they will travel with branch switches without affecting the new branch — leave them alone. If tracked files are modified, stash them with a labeled message before continuing:

```bash
git stash push --message "codex: pre-phase-2 stash (`<reason>`) — 2026-05-12"
```

- [ ] **Step 1.2: Create the implementation branch**

```bash
git checkout -b codex/local-order-panel-phase-2
```

Expected: `Switched to a new branch 'codex/local-order-panel-phase-2'`.

---

## Task 2: panel-collapse pure helper (TDD)

**Files:**
- Create: `lib/orders/panel-collapse.ts`
- Test: `lib/orders/panel-collapse.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `lib/orders/panel-collapse.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { afterEach, beforeEach } from 'vitest';

import {
  loadCollapseState,
  saveCollapseState,
  COLLAPSE_SECTION_IDS,
  type CollapseSectionId,
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
    saveCollapseState('overview', 'open');  // must not throw
    assert.equal(true, true);
  } finally {
    (globalThis as any).localStorage = previous;
  }
});

test('COLLAPSE_SECTION_IDS lists exactly the four sections', () => {
  assert.deepEqual([...COLLAPSE_SECTION_IDS].sort(), ['cutlist-materials', 'next-actions', 'overview', 'readiness']);
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx vitest run lib/orders/panel-collapse.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement the helper**

Create `lib/orders/panel-collapse.ts`:

```typescript
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

/**
 * Returns 'closed' for any section with no entry (first-visit default).
 * SSR-safe: returns 'closed' when localStorage is unavailable.
 */
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

/**
 * Persists a section's collapse state. SSR-safe: silently no-ops when
 * localStorage is unavailable.
 */
export function saveCollapseState(id: CollapseSectionId, state: CollapseState): void {
  if (typeof globalThis === 'undefined') return;
  const storage = (globalThis as any).localStorage;
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(storageKey(id), state);
  } catch {
    // Storage quota or privacy mode — fail silently.
  }
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npx vitest run lib/orders/panel-collapse.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 2.5: Commit**

```bash
git add lib/orders/panel-collapse.ts lib/orders/panel-collapse.test.ts
git commit -m "feat(orders): add panel-collapse localStorage helper (always-closed default)"
```

---

## Task 3: reservation-predicate pure helper (TDD)

**Files:**
- Create: `lib/orders/reservation-predicate.ts`
- Test: `lib/orders/reservation-predicate.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `lib/orders/reservation-predicate.test.ts`:

```typescript
import assert from 'node:assert/strict';

import { targetReservable, canReserveMore } from './reservation-predicate';

declare const test: (name: string, fn: () => void) => void;

test('targetReservable returns 0 when available is 0', () => {
  assert.equal(targetReservable(4, 0), 0);
});

test('targetReservable returns required when available is plentiful', () => {
  assert.equal(targetReservable(4, 1934), 4);
});

test('targetReservable returns available when partial cover', () => {
  assert.equal(targetReservable(10, 6), 6);
});

test('targetReservable clamps negative available to 0', () => {
  assert.equal(targetReservable(4, -3), 0);
});

test('targetReservable clamps required = 0 to 0', () => {
  assert.equal(targetReservable(0, 1000), 0);
});

test('canReserveMore returns false when target equals already reserved', () => {
  assert.equal(canReserveMore(4, 1934, 4), false);
});

test('canReserveMore returns true when more can still be reserved', () => {
  assert.equal(canReserveMore(10, 6, 3), true);
});

test('canReserveMore returns false when no stock at all', () => {
  assert.equal(canReserveMore(4, 0, 0), false);
});

test('canReserveMore returns false when over-reserved (defensive)', () => {
  assert.equal(canReserveMore(4, 1934, 10), false);
});

test('canReserveMore handles NaN-safe inputs', () => {
  assert.equal(canReserveMore(Number.NaN, 100, 0), false);
  assert.equal(canReserveMore(4, Number.NaN, 0), false);
  assert.equal(canReserveMore(4, 100, Number.NaN), true); // 0-coerce defender
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npx vitest run lib/orders/reservation-predicate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the helper**

Create `lib/orders/reservation-predicate.ts`:

```typescript
/**
 * Maximum quantity that can be reserved for an order given current demand
 * and order-availability ("max(0, in_stock - reserved_by_others)").
 *
 * NaN-safe: any non-finite input coerces to 0.
 */
export function targetReservable(required: number, available: number): number {
  const req = Number.isFinite(required) ? required : 0;
  const avail = Number.isFinite(available) ? available : 0;
  return Math.max(0, Math.min(req, avail));
}

/**
 * Does this order have headroom to reserve more of this component?
 *
 * True iff there's at least one unit of `available` we haven't already
 * earmarked for this order, up to the required amount.
 *
 * NaN-safe: undefined / NaN reservedThisOrder coerces to 0 (defender).
 */
export function canReserveMore(
  required: number,
  available: number,
  reservedThisOrder: number
): boolean {
  if (!Number.isFinite(required) || !Number.isFinite(available)) return false;
  const reserved = Number.isFinite(reservedThisOrder) ? reservedThisOrder : 0;
  return targetReservable(required, available) > reserved;
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
npx vitest run lib/orders/reservation-predicate.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 3.5: Commit**

```bash
git add lib/orders/reservation-predicate.ts lib/orders/reservation-predicate.test.ts
git commit -m "feat(orders): add reservation-predicate helper (targetReservable / canReserveMore)"
```

---

## Task 4: ReadinessRow component

**Files:**
- Create: `components/features/orders/setup-panel/ReadinessRow.tsx`

- [ ] **Step 4.1: Implement the component**

Create the file:

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Replace, ShoppingCart } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/lib/format-utils';

export interface ReadinessRowProps {
  componentId: number | null;
  internalCode: string;
  description: string | null;
  required: number;
  reservedThisOrder: number;
  available: number;
  shortfall: number;
  /** Snapshot entry exists for this component, so swap is reachable. */
  canSwap: boolean;
  /** Whether to render the 🛒 order column (always true in Phase 2). */
  showOrderAction?: boolean;
  onSwap: () => void;
  onOrder: () => void;
}

// Phase 2 grid: 8 columns. Phase 3 will append one 22px slot for ＋ reserve.
// Spec section: "Component Readiness — single-line rows"
const ROW_GRID = 'grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px] items-center gap-x-1.5';

export function ReadinessRow({
  componentId,
  internalCode,
  description,
  required,
  reservedThisOrder,
  available,
  shortfall,
  canSwap,
  showOrderAction = true,
  onSwap,
  onOrder,
}: ReadinessRowProps) {
  const isShort = shortfall > 0;

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          ROW_GRID,
          'px-2 py-2 -mx-2 text-xs rounded-sm',
          'odd:bg-transparent even:bg-black/[0.03]',
          isShort && 'bg-destructive/[0.05] even:bg-destructive/[0.05]'
        )}
      >
        {/* Code */}
        <div className="font-medium text-foreground truncate" title={internalCode}>
          {componentId ? (
            <Link
              href={`/inventory/components/${componentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              data-row-action
            >
              {internalCode}
            </Link>
          ) : (
            internalCode
          )}
        </div>

        {/* Description */}
        {description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-muted-foreground">{description}</span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-sm text-xs leading-relaxed">
              {description}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}

        {/* Numeric columns: REQ / RES / AVAIL / SHORT */}
        <span className="text-right tabular-nums text-muted-foreground">{formatQuantity(required)}</span>
        <span className={cn('text-right tabular-nums', reservedThisOrder > 0 ? 'text-foreground font-medium' : 'text-muted-foreground')}>
          {formatQuantity(reservedThisOrder)}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">{formatQuantity(available)}</span>
        <span className={cn('text-right tabular-nums', isShort ? 'text-destructive font-medium' : 'text-muted-foreground')}>
          {formatQuantity(shortfall)}
        </span>

        {/* ⟳ Swap */}
        {canSwap ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onSwap}
                className="w-[22px] h-[22px] rounded-sm text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground"
                aria-label="Swap component"
                data-row-action
              >
                <Replace className="h-3.5 w-3.5 mx-auto" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="text-xs">Swap component</TooltipContent>
          </Tooltip>
        ) : (
          <span aria-hidden />
        )}

        {/* 🛒 Order */}
        {showOrderAction ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOrder}
                disabled={!isShort}
                className={cn(
                  'w-[22px] h-[22px] rounded-sm',
                  isShort
                    ? 'text-amber-500/90 hover:bg-amber-500/[0.10] hover:text-amber-500'
                    : 'text-muted-foreground/30 cursor-not-allowed'
                )}
                aria-label="Order component"
                data-row-action
              >
                <ShoppingCart className="h-3.5 w-3.5 mx-auto" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="text-xs">
              {isShort ? `Order ${formatQuantity(shortfall)} more` : 'No shortfall — nothing to order'}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span aria-hidden />
        )}
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 4.2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "ReadinessRow" | head
```

Expected: empty.

- [ ] **Step 4.3: Commit**

```bash
git add components/features/orders/setup-panel/ReadinessRow.tsx
git commit -m "feat(orders): add ReadinessRow with REQ/RES/AVAIL/SHORT + ⟳/🛒 actions"
```

---

## Task 5: Update ComponentReadinessSection

**Files:**
- Modify: `components/features/orders/setup-panel/ComponentReadinessSection.tsx`

This task replaces the inline blocks with `ReadinessRow` instances, adds Reserve all button in the section header, and accepts `isOpen` + `onToggle` props for the collapsible wrapper. The Reserve all button visibility uses the new `canReserveMore` helper.

- [ ] **Step 5.1: Replace the file contents**

Overwrite `components/features/orders/setup-panel/ComponentReadinessSection.tsx` with:

```tsx
'use client';

import React from 'react';
import { ChevronRight, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ReadinessRow } from '@/components/features/orders/setup-panel/ReadinessRow';
import { canReserveMore } from '@/lib/orders/reservation-predicate';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';

interface ComponentReadinessSectionProps {
  detail: any;
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  onSwapBomEntry: (entry: BomSnapshotEntry) => void;
  onOrderComponent: (componentId: number) => void;
  onReserveAll: () => void | Promise<void>;
  reservePending: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

export function ComponentReadinessSection({
  detail,
  bomComponents,
  computeComponentMetrics,
  showGlobalContext: _showGlobalContext,
  onSwapBomEntry,
  onOrderComponent,
  onReserveAll,
  reservePending,
  isOpen,
  onToggle,
}: ComponentReadinessSectionProps) {
  const snapshotEntries: BomSnapshotEntry[] = Array.isArray(detail?.bom_snapshot)
    ? (detail.bom_snapshot as BomSnapshotEntry[])
    : [];

  const findSnapshotEntry = (component: any) => {
    const componentId = Number(component.component_id);
    return snapshotEntries.find((entry) =>
      Number(entry.effective_component_id) === componentId ||
      Number(entry.component_id) === componentId ||
      Number(entry.default_component_id) === componentId
    ) ?? null;
  };

  // Pre-compute metrics once for both summary pill and Reserve all visibility.
  const enriched = bomComponents.map((component: any) => {
    const metrics = computeComponentMetrics(component, detail.product_id);
    return { component, metrics };
  });

  const shortCount = enriched.filter(({ metrics }) => metrics.real > 0).length;

  // Reserve all visibility: any row with headroom to reserve more.
  // Spec: lib/orders/reservation-predicate.ts is the single source of truth.
  const reserveAllVisible = enriched.some(({ metrics }) =>
    canReserveMore(
      Number(metrics.required ?? 0),
      Number(metrics.available ?? metrics.inStock ?? 0),
      Number(metrics.reservedThisOrder ?? 0)
    )
  );

  const pill = shortCount > 0
    ? <Badge variant="destructive" className="h-5 text-[10px]">{shortCount} short</Badge>
    : <Badge variant="outline" className="h-5 text-[10px] border-emerald-500/40 text-emerald-500">All ready</Badge>;

  return (
    <section className="border-b border-border/60">
      <header className="flex items-center justify-between gap-2 px-5 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 text-left"
          aria-expanded={isOpen}
          aria-controls="setup-panel-readiness-body"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Component readiness</h3>
          {pill}
        </button>
        {reserveAllVisible && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/[0.06]"
            onClick={(event) => { event.stopPropagation(); onReserveAll(); }}
            disabled={reservePending}
            data-row-action
          >
            {reservePending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Reserve all
          </Button>
        )}
      </header>

      {isOpen && (
        <div id="setup-panel-readiness-body" className="px-5 pb-5">
          {bomComponents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No component requirements.</p>
          ) : (
            <div className="space-y-px">
              {/* Column header */}
              <div className="grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px] items-center gap-x-1.5 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                <span>Code</span>
                <span>Description</span>
                <span className="text-right">Req</span>
                <span className="text-right">Res</span>
                <span className="text-right">Avail</span>
                <span className="text-right">Short</span>
                <span aria-hidden />
                <span aria-hidden />
              </div>

              {enriched.map(({ component, metrics }) => {
                const componentId = component.component_id ? Number(component.component_id) : null;
                const snapshotEntry = findSnapshotEntry(component);
                return (
                  <ReadinessRow
                    key={componentId ?? component.internal_code}
                    componentId={componentId}
                    internalCode={component.internal_code ?? 'Unknown'}
                    description={component.description ?? null}
                    required={Number(metrics.required ?? 0)}
                    reservedThisOrder={Number(metrics.reservedThisOrder ?? 0)}
                    available={Number(metrics.available ?? metrics.inStock ?? 0)}
                    shortfall={Number(metrics.real ?? 0)}
                    canSwap={!!snapshotEntry}
                    onSwap={() => snapshotEntry && onSwapBomEntry(snapshotEntry)}
                    onOrder={() => componentId && onOrderComponent(componentId)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5.2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "ComponentReadinessSection" | head
```

Expected: empty.

- [ ] **Step 5.3: Commit**

```bash
git add components/features/orders/setup-panel/ComponentReadinessSection.tsx
git commit -m "refactor(orders): single-line readiness rows + Reserve all + collapsible"
```

---

## Task 6: Update OverviewSection

**Files:**
- Modify: `components/features/orders/setup-panel/OverviewSection.tsx`

The status sentence moves out (lives in panel header now). The section becomes collapsible.

- [ ] **Step 6.1: Replace the file contents**

Overwrite `components/features/orders/setup-panel/OverviewSection.tsx` with:

```tsx
'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatQuantity } from '@/lib/format-utils';

interface OverviewSectionProps {
  ordered: number;
  reserved: number;
  toBuild: number;
  isOpen: boolean;
  onToggle: () => void;
}

export function OverviewSection({ ordered, reserved, toBuild, isOpen, onToggle }: OverviewSectionProps) {
  return (
    <section className="border-b border-border/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-5 py-3 text-left"
        aria-expanded={isOpen}
        aria-controls="setup-panel-overview-body"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overview</h3>
      </button>

      {isOpen && (
        <div id="setup-panel-overview-body" className="px-5 pb-5 grid grid-cols-3 gap-4">
          <Metric label="Ordered" value={formatQuantity(ordered)} />
          <Metric label="Reserved" value={formatQuantity(reserved)} />
          <Metric label="To build" value={formatQuantity(toBuild)} emphasized />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 tabular-nums', emphasized ? 'text-2xl font-semibold' : 'text-lg')}>
        {value}
      </p>
    </div>
  );
}
```

- [ ] **Step 6.2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "OverviewSection" | head
```

Expected: empty.

- [ ] **Step 6.3: Commit**

```bash
git add components/features/orders/setup-panel/OverviewSection.tsx
git commit -m "refactor(orders): collapsible Overview; status sentence moves to panel header"
```

---

## Task 7: Update CutlistMaterialsSection

**Files:**
- Modify: `components/features/orders/setup-panel/CutlistMaterialsSection.tsx`

Add collapse wrapper + section pill (primary material name or override count). Reuse the existing `namesFromGroup` aggregation from the Phase 1 hotfix.

- [ ] **Step 7.1: Read the existing file to preserve `namesFromGroup`**

```bash
grep -n "namesFromGroup\|function uniqueStrings" components/features/orders/setup-panel/CutlistMaterialsSection.tsx
```

Expected: lines around `function uniqueStrings` and `function namesFromGroup` — preserve those bodies exactly.

- [ ] **Step 7.2: Replace the file contents**

Overwrite `components/features/orders/setup-panel/CutlistMaterialsSection.tsx` with:

```tsx
'use client';

import React from 'react';
import { ChevronRight, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CutlistMaterialDialog } from '@/components/features/shared/CutlistMaterialDialog';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import type { CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';

interface CutlistMaterialsSectionProps {
  detail: any;
  applying: boolean;
  onApply: (value: {
    cutlist_primary_material_id: number | null;
    cutlist_primary_backer_material_id: number | null;
    cutlist_primary_edging_id: number | null;
    cutlist_part_overrides: unknown[];
    cutlist_surcharge_kind: 'fixed' | 'percentage';
    cutlist_surcharge_value: number;
    cutlist_surcharge_label: string | null;
  }) => void | Promise<void>;
  isOpen: boolean;
  onToggle: () => void;
}

const BOARD_TYPE_LABEL: Record<string, string> = {
  '16mm-single': '16mm Single',
  '32mm-both': '32mm Laminated',
  '32mm-backer': '32mm With Backer',
};

function boardTypeLabel(kind: string): string {
  return BOARD_TYPE_LABEL[kind] ?? kind;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// Field shapes per lib/orders/snapshot-types.ts:
//   group has primary_material_name, backer_material_name, effective_backer_name
//   parts have effective_board_name, effective_edging_name (NOT effective_backer_name)
function namesFromGroup(group: any): { primary: string[]; backer: string | null; edging: string[] } {
  const parts: any[] = Array.isArray(group?.parts) ? group.parts : [];
  const boardNames = uniqueStrings(parts.map((p) => p?.effective_board_name));
  const edgingNames = uniqueStrings(parts.map((p) => p?.effective_edging_name));
  if (boardNames.length === 0 && typeof group?.primary_material_name === 'string' && group.primary_material_name.trim()) {
    boardNames.push(group.primary_material_name.trim());
  }
  return {
    primary: boardNames,
    backer: group?.effective_backer_name ?? group?.backer_material_name ?? null,
    edging: edgingNames,
  };
}

export function CutlistMaterialsSection({ detail, applying, onApply, isOpen, onToggle }: CutlistMaterialsSectionProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const groups: CutlistSnapshotGroup[] = Array.isArray(detail?.cutlist_material_snapshot)
    ? detail.cutlist_material_snapshot
    : [];
  const overrideCount = Array.isArray(detail?.cutlist_part_overrides) ? detail.cutlist_part_overrides.length : 0;
  const surcharge = Number(detail?.cutlist_surcharge_resolved ?? 0);

  // Section pill: shows primary material, override count, or "Not configured"
  let pill: React.ReactNode = null;
  if (groups.length > 0) {
    if (overrideCount > 0) {
      pill = <Badge variant="outline" className="h-5 text-[10px]">{overrideCount} override{overrideCount === 1 ? '' : 's'}</Badge>;
    } else {
      const firstPrimary = namesFromGroup(groups[0]).primary[0];
      if (firstPrimary) {
        pill = <Badge variant="outline" className="h-5 text-[10px]">{firstPrimary}</Badge>;
      }
    }
    if (!detail?.cutlist_primary_material_id) {
      pill = <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground/70">Not configured</Badge>;
    }
  }

  return (
    <>
      <section className="border-b border-border/60">
        <header className="flex items-center justify-between gap-2 px-5 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 flex-1 text-left"
            aria-expanded={isOpen}
            aria-controls="setup-panel-materials-body"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cutlist materials</h3>
            {pill}
          </button>
          {groups.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={(event) => { event.stopPropagation(); setDialogOpen(true); }}
              data-row-action
            >
              <Pencil className="h-3 w-3" />
              Edit materials
            </Button>
          )}
        </header>

        {isOpen && (
          <div id="setup-panel-materials-body" className="px-5 pb-5 space-y-3">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">This product has no cutlist parts.</p>
            ) : (
              <>
                {groups.map((group: any, idx: number) => {
                  const partsCount = Array.isArray(group.parts) ? group.parts.length : 0;
                  const names = namesFromGroup(group);
                  const primaryLine = names.primary.length === 0 ? 'Primary not set' : names.primary.join(' · ');
                  const edgingLine = names.edging.length === 0 ? null : names.edging.join(' · ');
                  return (
                    <div key={`${group.board_type ?? 'group'}-${idx}`} className="text-sm">
                      <p className="text-xs font-medium text-muted-foreground">
                        {boardTypeLabel(group.board_type)} · {partsCount} part{partsCount === 1 ? '' : 's'}
                      </p>
                      <p className="mt-0.5 text-sm text-foreground">{primaryLine}</p>
                      {names.backer && (<p className="text-xs text-muted-foreground">+ Backer: {names.backer}</p>)}
                      {edgingLine && (<p className="text-xs text-muted-foreground">Edging: {edgingLine}</p>)}
                    </div>
                  );
                })}
                {(overrideCount > 0 || surcharge !== 0) && (
                  <div className="mt-3 pt-3 border-t border-border/40 text-xs text-muted-foreground space-y-0.5">
                    {overrideCount > 0 && (<p>{overrideCount} part override{overrideCount === 1 ? '' : 's'}</p>)}
                    {surcharge !== 0 && (
                      <p>{surcharge > 0 ? '+' : '-'}{formatCurrency(Math.abs(surcharge))} line surcharge</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <CutlistMaterialDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        detail={detail}
        applying={applying}
        onApply={async (value) => {
          await onApply(value);
          setDialogOpen(false);
        }}
      />
    </>
  );
}
```

- [ ] **Step 7.3: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "CutlistMaterialsSection" | head
```

Expected: empty.

- [ ] **Step 7.4: Commit**

```bash
git add components/features/orders/setup-panel/CutlistMaterialsSection.tsx
git commit -m "refactor(orders): collapsible Cutlist materials with section pill"
```

---

## Task 8: Update NextActionsSection

**Files:**
- Modify: `components/features/orders/setup-panel/NextActionsSection.tsx`

Wrap the four action rows in a collapsible. Keep the existing Phase 1 action callbacks.

- [ ] **Step 8.1: Replace the file contents**

Overwrite `components/features/orders/setup-panel/NextActionsSection.tsx` with:

```tsx
'use client';

import React from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

interface NextActionsSectionProps {
  reservePending: boolean;
  onReserveOrderComponents: () => void | Promise<void>;
  onGenerateCuttingPlan: () => void;
  onIssueStock: () => void;
  onCreateJobCards: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function NextActionsSection({
  reservePending,
  onReserveOrderComponents,
  onGenerateCuttingPlan,
  onIssueStock,
  onCreateJobCards,
  isOpen,
  onToggle,
}: NextActionsSectionProps) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-5 py-3 text-left"
        aria-expanded={isOpen}
        aria-controls="setup-panel-actions-body"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground/60 transition-transform', isOpen && 'rotate-90')} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next actions</h3>
      </button>

      {isOpen && (
        <div id="setup-panel-actions-body" className="px-3 pb-3 space-y-1">
          <ActionRow
            title="Reserve order components"
            description="Earmark on-hand stock across the entire order so other orders can't claim it."
            loading={reservePending}
            disabled={reservePending}
            onClick={onReserveOrderComponents}
          />
          <ActionRow title="Generate cutting plan" description="Open the Cutting Plan tab to nest sheet boards and edging." onClick={onGenerateCuttingPlan} />
          <ActionRow title="Issue stock" description="Pick components or boards from stock against this order." onClick={onIssueStock} />
          <ActionRow title="Create job cards" description="Issue work-pool jobs to staff." onClick={onCreateJobCards} />
        </div>
      )}
    </section>
  );
}

function ActionRow({
  title,
  description,
  disabled,
  loading,
  onClick,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick()}
      className={cn(
        'group flex w-full items-center gap-3 rounded-sm border border-transparent px-3 py-2.5 text-left transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-border/60 hover:bg-muted/40'
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground', disabled && 'opacity-0')} />
      )}
    </button>
  );
}
```

- [ ] **Step 8.2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "NextActionsSection" | head
```

Expected: empty.

- [ ] **Step 8.3: Commit**

```bash
git add components/features/orders/setup-panel/NextActionsSection.tsx
git commit -m "refactor(orders): collapsible Next actions"
```

---

## Task 9: Update OrderLineSetupPanel composer

**Files:**
- Modify: `components/features/orders/OrderLineSetupPanel.tsx`

Move the status sentence into the header, manage collapse state for the four sections via `useState` synced to localStorage on toggle, pass `onOrderComponent` through to readiness.

- [ ] **Step 9.1: Replace the file contents**

Overwrite `components/features/orders/OrderLineSetupPanel.tsx` with:

```tsx
'use client';

import React from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { OverviewSection } from '@/components/features/orders/setup-panel/OverviewSection';
import { CutlistMaterialsSection } from '@/components/features/orders/setup-panel/CutlistMaterialsSection';
import { ComponentReadinessSection } from '@/components/features/orders/setup-panel/ComponentReadinessSection';
import { NextActionsSection } from '@/components/features/orders/setup-panel/NextActionsSection';
import { computeLineStatus, type LineStatusKind } from '@/lib/orders/line-status';
import {
  COLLAPSE_SECTION_IDS,
  loadCollapseState,
  saveCollapseState,
  type CollapseSectionId,
  type CollapseState,
} from '@/lib/orders/panel-collapse';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';
import { cn } from '@/lib/utils';

export interface OrderLineSetupPanelProps {
  detail: any;
  coverage: { ordered: number; reserved: number; remain: number; factor: number };
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  applying: boolean;
  reservePending: boolean;
  onClose: () => void;
  onApplyCutlistMaterial: (value: any) => void | Promise<void>;
  onSwapBomEntry: (entry: BomSnapshotEntry) => void;
  onOrderComponent: (componentId: number) => void;
  onReserveOrderComponents: () => void | Promise<void>;
  onGenerateCuttingPlan: () => void;
  onIssueStock: () => void;
  onCreateJobCards: () => void;
  asSheet?: boolean;
  open?: boolean;
}

const STATUS_COLOR: Record<LineStatusKind, string> = {
  ready: 'text-emerald-500',
  'needs-material': 'text-amber-500',
  shortfall: 'text-destructive',
};

export function OrderLineSetupPanel(props: OrderLineSetupPanelProps) {
  const body = <PanelBody {...props} />;
  if (props.asSheet) {
    return (
      <Sheet open={props.open ?? false} onOpenChange={(next) => { if (!next) props.onClose(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 overflow-y-auto">
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside
      aria-label="Order line setup"
      className={cn(
        'sticky top-4 self-start w-[440px] shrink-0',
        'rounded-md border border-border/60 bg-card overflow-hidden',
        'max-h-[calc(100vh-2rem)] overflow-y-auto'
      )}
    >
      {body}
    </aside>
  );
}

function PanelBody({
  detail,
  coverage,
  bomComponents,
  computeComponentMetrics,
  applying,
  reservePending,
  onClose,
  onApplyCutlistMaterial,
  onSwapBomEntry,
  onOrderComponent,
  onReserveOrderComponents,
  onGenerateCuttingPlan,
  onIssueStock,
  onCreateJobCards,
}: OrderLineSetupPanelProps) {
  const productName = detail?.product?.name ?? 'Order line';
  const qty = Number(detail?.quantity ?? 0);

  // Status sentence — moves into header.
  const shortfallCount = bomComponents.filter((component) => {
    const metrics = computeComponentMetrics(component, detail.product_id);
    return metrics.real > 0.0001;
  }).length;
  const hasCutlistSnapshot = Array.isArray(detail?.cutlist_material_snapshot) && detail.cutlist_material_snapshot.length > 0;
  const status = computeLineStatus({
    hasCutlistSnapshot,
    primaryMaterialId: detail?.cutlist_primary_material_id ?? null,
    shortfallCount,
  });

  // Collapse state — load once on mount per section, write through on toggle.
  // First-visit default is always 'closed' — see lib/orders/panel-collapse.ts.
  const [collapseState, setCollapseState] = React.useState<Record<CollapseSectionId, CollapseState>>(() => ({
    overview: 'closed',
    'cutlist-materials': 'closed',
    readiness: 'closed',
    'next-actions': 'closed',
  }));

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  React.useEffect(() => {
    const next = {} as Record<CollapseSectionId, CollapseState>;
    for (const id of COLLAPSE_SECTION_IDS) next[id] = loadCollapseState(id);
    setCollapseState(next);
  }, []);

  const toggle = React.useCallback((id: CollapseSectionId) => {
    setCollapseState((prev) => {
      const next: CollapseState = prev[id] === 'open' ? 'closed' : 'open';
      saveCollapseState(id, next);
      return { ...prev, [id]: next };
    });
  }, []);

  return (
    <>
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border/60">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Order line setup</p>
          <h2 className="mt-0.5 text-base font-semibold truncate" title={productName}>{productName}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            qty {qty} · <span className={STATUS_COLOR[status.kind]}>{status.sentence}</span>
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 -mr-1" onClick={onClose} aria-label="Close setup panel">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <OverviewSection
        ordered={coverage.ordered}
        reserved={coverage.reserved}
        toBuild={coverage.remain}
        isOpen={collapseState.overview === 'open'}
        onToggle={() => toggle('overview')}
      />

      <CutlistMaterialsSection
        detail={detail}
        applying={applying}
        onApply={onApplyCutlistMaterial}
        isOpen={collapseState['cutlist-materials'] === 'open'}
        onToggle={() => toggle('cutlist-materials')}
      />

      <ComponentReadinessSection
        detail={detail}
        bomComponents={bomComponents}
        computeComponentMetrics={computeComponentMetrics}
        showGlobalContext={false}
        onSwapBomEntry={onSwapBomEntry}
        onOrderComponent={onOrderComponent}
        onReserveAll={onReserveOrderComponents}
        reservePending={reservePending}
        isOpen={collapseState.readiness === 'open'}
        onToggle={() => toggle('readiness')}
      />

      <NextActionsSection
        reservePending={reservePending}
        onReserveOrderComponents={onReserveOrderComponents}
        onGenerateCuttingPlan={onGenerateCuttingPlan}
        onIssueStock={onIssueStock}
        onCreateJobCards={onCreateJobCards}
        isOpen={collapseState['next-actions'] === 'open'}
        onToggle={() => toggle('next-actions')}
      />
    </>
  );
}
```

- [ ] **Step 9.2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep -E "OrderLineSetupPanel|setup-panel" | head
```

Expected: empty.

- [ ] **Step 9.3: Commit**

```bash
git add components/features/orders/OrderLineSetupPanel.tsx
git commit -m "refactor(orders): all-collapsed default + status in header + onOrderComponent prop"
```

---

## Task 10: OrderComponentsDialog focus prop

**Files:**
- Modify: `components/features/orders/OrderComponentsDialog.tsx`

Add `initialFocusComponentId` prop. On open with prop set: locate row, scroll/expand its supplier group, pre-check ONLY when `component.shortfall > 0`. When row exists with `shortfall <= 0` but is present due to global shortfall, open without pre-checking and toast. When row not in data at all, also toast.

- [ ] **Step 10.1: Read the dialog's existing state shape**

```bash
grep -n "supplierData\|supplierGroups\|setSelectedComponents\|setExpandedRows" components/features/orders/OrderComponentsDialog.tsx | head -15
```

Take note of:
- The data shape: `supplierGroups` from `fetchComponentSuppliers`
- State setters: `setSelectedComponents`, `setExpandedRows`
- Each `component` in the groups has `shortfall` and `global_real_shortfall` numeric fields, plus `selectedSupplier.supplier_component_id` as the key used in `selectedComponents`

- [ ] **Step 10.2: Add the prop and focus logic**

Find the component's props interface near the top (around line 40):

```tsx
export const OrderComponentsDialog = ({
  orderId,
  open,
  onOpenChange,
  onCreated
}: {
  orderId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) => {
```

Replace with:

```tsx
export const OrderComponentsDialog = ({
  orderId,
  open,
  onOpenChange,
  onCreated,
  initialFocusComponentId,
}: {
  orderId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  /** When set, on open focus that component: scroll, expand its supplier group, pre-check ONLY if shortfall > 0. */
  initialFocusComponentId?: number;
}) => {
```

Then, after the existing `useEffect` blocks that initialize `selectedComponents` / `orderQuantities` / `allocation` from `supplierGroups`, add the focus effect. Locate the spot just before the return statement and add:

```tsx
  // Phase 2: focus a specific component when the dialog opens with initialFocusComponentId set.
  // Pre-check ONLY when this-order shortfall is positive — never pre-check a row that's present
  // solely because of global shortfall (would create a "For Stock" allocation by surprise).
  React.useEffect(() => {
    if (!open) return;
    if (!initialFocusComponentId) return;
    if (!supplierGroups || supplierGroups.length === 0) return;

    let target: any = null;
    let targetSupplierGroupId: number | null = null;
    for (const group of supplierGroups) {
      const match = group.components.find((c: any) => Number(c.component_id) === Number(initialFocusComponentId));
      if (match) {
        target = match;
        targetSupplierGroupId = group.supplier.supplier_id ?? null;
        break;
      }
    }

    if (!target) {
      toast.info('Component covered by stock — no shortfall to order.');
      return;
    }

    // Expand the supplier group
    if (targetSupplierGroupId != null) {
      setExpandedRows((prev) => ({ ...prev, [targetSupplierGroupId!]: true }));
    }

    // Scroll into view after layout settles
    const targetKey = target.selectedSupplier?.supplier_component_id;
    if (targetKey != null) {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-supplier-component-id="${targetKey}"]`);
        if (el && 'scrollIntoView' in el) {
          (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    // Pre-check only when there's a this-order shortfall.
    const thisOrderShortfall = Number(target.shortfall ?? 0);
    if (thisOrderShortfall > 0 && targetKey != null) {
      setSelectedComponents((prev) => ({ ...prev, [targetKey]: true }));
    } else {
      toast.info('Component covered by stock for this order — opened the procurement view in case you want to top up stock anyway.');
    }
  }, [open, initialFocusComponentId, supplierGroups]);
```

- [ ] **Step 10.3: Add `data-supplier-component-id` to component rows so the scroll target resolves**

Locate the component row render inside the existing supplier-group table (search for `selectedSupplier.supplier_component_id` in the JSX). On the outermost row element (`<TableRow>` or `<tr>` for that component), add the attribute:

```tsx
data-supplier-component-id={component.selectedSupplier.supplier_component_id}
```

- [ ] **Step 10.4: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "OrderComponentsDialog" | head
```

Expected: empty.

- [ ] **Step 10.5: Commit**

```bash
git add components/features/orders/OrderComponentsDialog.tsx
git commit -m "feat(orders): add initialFocusComponentId prop with shortfall>0 pre-check guard"
```

---

## Task 11: Wire it all in page.tsx

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`

Three changes:
1. Add `orderComponentsFocus` state, reset on dialog close.
2. Pass `onOrderComponent` to the panel — sets focus + opens dialog.
3. Update `handleTabChange` to drop `?line=` when leaving Products.

- [ ] **Step 11.1: Add focus state**

Search for the existing `orderComponentsOpen` state and add a sibling state. The line is around `page.tsx:169`:

```tsx
const [orderComponentsOpen, setOrderComponentsOpen] = useState<boolean>(false);
```

Add immediately after:

```tsx
const [orderComponentsFocus, setOrderComponentsFocus] = useState<number | undefined>(undefined);
```

- [ ] **Step 11.2: Update `handleTabChange` to drop `?line=`**

Search for `handleTabChange` (around line 136). Replace its body:

```tsx
const handleTabChange = useCallback((tabId: string) => {
  const params = new URLSearchParams(searchParams?.toString() || '');
  params.set('tab', tabId);
  if (tabId !== 'products') {
    params.delete('line');
  }
  router.replace(`?${params.toString()}`, { scroll: false });
}, [searchParams, router]);
```

- [ ] **Step 11.3: Pass `onOrderComponent` to the panel and wire the dialog focus**

Search for the panel render `<OrderLineSetupPanel` (around line 1585). Add the new callback inside the props:

```tsx
onOrderComponent={(componentId) => {
  setOrderComponentsFocus(componentId);
  setOrderComponentsOpen(true);
}}
```

Then search for `<OrderComponentsDialog` (around line 1866). Add the focus prop and clear-on-close behavior:

```tsx
<OrderComponentsDialog
  orderId={orderId}
  open={orderComponentsOpen}
  onOpenChange={(next) => {
    setOrderComponentsOpen(next);
    if (!next) setOrderComponentsFocus(undefined);
  }}
  initialFocusComponentId={orderComponentsFocus}
  onCreated={() => { /* existing handler */ }}
/>
```

Preserve any existing `onCreated` callback body.

- [ ] **Step 11.4: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep -E "(OrderLineSetupPanel|OrderComponentsDialog|page\.tsx)" | head
```

Expected: empty for new code. Pre-existing errors in unrelated files unchanged.

- [ ] **Step 11.5: Lint**

```bash
npm run lint
```

Expected: 0 errors. Pre-existing warnings unchanged.

- [ ] **Step 11.6: Commit**

```bash
git add app/orders/\[orderId\]/page.tsx
git commit -m "feat(orders): wire focus state + tab change drops line param"
```

---

## Task 12: Browser smoke verification

**Files:** none (verification only)

- [ ] **Step 12.1: Start the dev server**

The preview MCP `next-dev` configuration in `.claude/launch.json` runs from this branch's worktree on port 3000. Use it via `preview_start({ name: 'next-dev' })`. If a server is already running on port 3000 from another worktree, ask Greg before killing it.

- [ ] **Step 12.2: Sign in with the test account**

Per CLAUDE.md verification rule, sign in as `testai@qbutton.co.za` / `ClaudeTest2026!`. Use the existing test order with 1 shortfall + per-part overrides (order 613, line 66) for the main smoke; use order 401 for the no-cutlist-snapshot case.

- [ ] **Step 12.3: Walk every Phase 2 acceptance criterion**

For each, capture a screenshot + console-log snapshot if a check fails. Required scenarios:

- **All sections start collapsed.** Clear localStorage first (`localStorage.clear()` via preview_eval). Open `/orders/613?line=66`. All four sections show `▶` chevrons (closed). Header shows `qty 1 · 1 component short` in destructive color.
- **Persistence.** Open Component Readiness. Reload page. Component Readiness stays open. Other three stay closed.
- **Section pills.** Cutlist Materials shows `10 overrides` pill while collapsed. Component Readiness shows `1 short` pill in destructive color.
- **Single-line readiness rows.** Open Component Readiness. Rows show: code (bold) + description (muted, truncates) + REQ + RES + AVAIL + SHORT (tabular) + ⟳ swap + 🛒 order. Shortfall row tinted destructive.
- **🛒 enables only on shortfall.** Healthy rows show 🛒 faded/disabled with tooltip "No shortfall — nothing to order". RIH1516 row shows 🛒 enabled in amber.
- **🛒 click pre-checks correctly.** Click 🛒 on RIH1516. Dialog opens with RIH1516 row scrolled into view and pre-checked. Close the dialog. Click 🛒 on a different shortfall component if available — focus updates correctly.
- **🛒 click on a since-covered shortfall doesn't pre-check.** Modify the page state via `execute_sql` to bring a component's shortfall to 0 while keeping `global_real_shortfall > 0`. Click 🛒. Dialog opens, no row is pre-checked, toast appears with the "covered for this order" message. (If hard to simulate, document the scenario in the PR as smoke-by-code-reading rather than smoke-by-action.)
- **Reserve all visibility.** With Component Readiness closed, the `＋ Reserve all` button is visible in the header on the shortfall order. Click it — components get reserved (Reserved values in the line's reservation badge update). Reload — Reserve all button hides if everything is at max reservable now.
- **Tab change drops `?line=`.** With `?line=66` in URL, click Components tab. URL becomes `?tab=components` (no `line=`). Click Products tab again. URL is `?tab=products` (no `line=`). Click Product Test row again. URL becomes `?tab=products&line=66`.

- [ ] **Step 12.4: Resize for narrow-viewport check**

`preview_resize({ preset: 'tablet' })` (768×1024). Click a row — panel opens as a Sheet overlay. Section collapse state shared with desktop. Resize back to `desktop`.

- [ ] **Step 12.5: Capture proof screenshots**

Take screenshots of:
- Desktop, all collapsed: `docs/screenshots/2026-05-12-order-panel-phase-2/desktop-all-collapsed.png`
- Desktop, readiness open: `docs/screenshots/2026-05-12-order-panel-phase-2/desktop-readiness-open.png`
- Desktop, materials open with overrides: `docs/screenshots/2026-05-12-order-panel-phase-2/desktop-materials-open.png`
- Narrow sheet: `docs/screenshots/2026-05-12-order-panel-phase-2/narrow-sheet.png`

Create the folder if missing.

- [ ] **Step 12.6: Stop the dev server**

`preview_stop({ serverId })`.

- [ ] **Step 12.7: Commit screenshots**

```bash
git add docs/screenshots/2026-05-12-order-panel-phase-2/
git commit -m "docs(orders): browser smoke screenshots for Phase 2"
```

---

## Task 13: Final verification + push + PR

**Files:** none (verification only)

- [ ] **Step 13.1: Run vitest**

```bash
npx vitest run lib/orders/panel-collapse.test.ts lib/orders/reservation-predicate.test.ts
```

Expected: PASS, 16 tests total (6 + 10).

- [ ] **Step 13.2: Re-run lint + tsc**

```bash
npm run lint
npx tsc --noEmit 2>&1 | grep -E "(setup-panel|OrderLineSetupPanel|OrderComponentsDialog|orders/\[orderId\]/page)" | head
```

Expected: 0 lint errors. Empty tsc output for the touched paths.

- [ ] **Step 13.3: Pre-PR self-check**

```bash
git fetch origin
git diff origin/codex/integration --stat
```

Verify the file surface matches the plan's "Files likely touched". If a file outside that surface appears, stop and surface to Greg — that signals a stale base or wrong branch cut.

- [ ] **Step 13.4: Push the branch**

```bash
git push -u origin codex/local-order-panel-phase-2
```

- [ ] **Step 13.5: Open the PR**

Create a pull request from `codex/local-order-panel-phase-2` into `codex/integration`. PR description must include:

- Spec link: `docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md`
- Plan link: `docs/superpowers/plans/2026-05-12-order-panel-phase-2.md`
- Screenshots from Task 12 step 5
- Acceptance-criteria checklist (copy the Phase 2 list from the spec)
- Any pre-existing lint/tsc failures left untouched
- Reviewer note: this is Phase 2; Phase 3 (per-row ＋ reserve + new RPC/route) follows as a separate PR after this merges.

---

## Self-review checklist

Before declaring the plan ready:

**1. Spec coverage** — each Phase 2 acceptance criterion in the spec maps to at least one task:

- All collapsed on first visit + persistence → Task 2 (helper) + Task 9 (composer wiring) + Task 12 step 3
- Status sentence in header → Task 9
- Section pills → Tasks 5 + 7
- Single-line readiness rows with REQ/RES/AVAIL/SHORT + actions → Task 4 + Task 5
- Zebra `bg-black/[0.03]` + shortfall tint `bg-destructive/[0.05]` → Task 4
- 🛒 click opens dialog with pre-check-when-shortfall>0 guard → Task 10 + Task 11
- Dialog focus state clears on close → Task 11
- Reserve all visibility via `canReserveMore` → Task 3 (helper) + Task 5
- `reservation-predicate.ts` is single source of truth → Task 3
- No new queries or API routes → confirmed across tasks
- No schema/RLS/migration → confirmed across tasks
- `CutlistMaterialDialog` unchanged → confirmed (only imported)

**2. Placeholder scan** — none of "TBD", "TODO", "implement later", "add error handling" appear.

**3. Type consistency** — `CollapseSectionId`, `CollapseState`, `OrderLineSetupPanelProps`, `ReadinessRowProps`, `initialFocusComponentId` all consistent across tasks.

**4. Out-of-scope discipline** — `CutlistMaterialDialog` not touched, no schema, no new queries, no cost numbers, ＋ reserve column intentionally omitted in Phase 2.

---

## Out-of-scope reminders

- Do NOT modify `CutlistMaterialDialog.tsx`.
- Do NOT add the ＋ reserve column or any per-row reserve wiring — that's Phase 3.
- Do NOT introduce new queries or API routes.
- Do NOT touch schema, RLS, or migrations.
- Do NOT surface cost numbers on the Products tab surface.
- Do NOT delete `slideOutProduct` state or its consumers — still unreachable but compiled.
- Do NOT change snapshot semantics on `order_details`.
- Do NOT change the existing `reserve_order_components` RPC — Reserve all still calls it unchanged.

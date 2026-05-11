# Order Products Setup Panel — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline-expand BOM table on the order Products tab with a sticky right-side **Order Line Setup** panel that opens when an operator clicks a product row.

**Architecture:** Two-column page layout. Left column keeps the products table (now compact rows with a material identity chip) plus the existing reservation cards. Right column shows either the existing `OrderSidebar` widgets (no line selected) or the new `OrderLineSetupPanel` composed of four sections — Overview, Cutlist Materials, Component Readiness, Next Actions. Selection persists in the URL as `?line=<order_detail_id>`. On viewports <1024px the panel becomes a right-side sheet overlay. The existing `CutlistMaterialDialog` is reused unchanged for editing materials.

**Tech Stack:** Next.js 16 (app router), React 18, TypeScript, Tailwind CSS v4.2, shadcn 4.0, tw-animate-css, Lucide icons, TanStack Query, Vitest for pure-helper tests.

**Spec:** [docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md](../specs/2026-05-08-order-products-setup-panel-design.md)

**Branch strategy:** This plan is implemented on a fresh branch `codex/local-order-products-setup-panel` cut from `origin/codex/integration` (NOT from the spec branch). The spec branch already lives on origin and is referenced by GPT-5.5 Pro plan review.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `lib/orders/line-status.ts` | Pure helper: derive the one-line status sentence from line state |
| `lib/orders/line-status.test.ts` | Vitest unit tests |
| `lib/orders/material-chip-data.ts` | Pure helper: resolve primary board name(s) and override count for the row chip |
| `lib/orders/material-chip-data.test.ts` | Vitest unit tests |
| `components/features/orders/setup-panel/MaterialChip.tsx` | The hairline chip rendered on the row |
| `components/features/orders/setup-panel/OverviewSection.tsx` | Section 1 of the panel |
| `components/features/orders/setup-panel/CutlistMaterialsSection.tsx` | Section 2; opens `CutlistMaterialDialog` for editing |
| `components/features/orders/setup-panel/ComponentReadinessSection.tsx` | Section 3; refactored from inline BOM expand JSX |
| `components/features/orders/setup-panel/NextActionsSection.tsx` | Section 4 |
| `components/features/orders/OrderLineSetupPanel.tsx` | Top-level panel composer |

### Modified files

| File | Change |
|---|---|
| `components/features/orders/ProductsTableRow.tsx` | Strip inline expand, cutlist material button, surcharge child rows. Add row click, selection styling, MaterialChip slot. |
| `app/orders/[orderId]/page.tsx` | Wire `?line=` URL param, conditionally render `OrderLineSetupPanel` vs `OrderSidebar` in the right column. |

---

## Task 1: Create implementation branch

**Files:** none

- [ ] **Step 1.1: Verify clean working tree on integration**

Run:

```bash
git fetch origin
git checkout codex/integration
git pull --ff-only origin codex/integration
git status
```

Expected: `nothing to commit, working tree clean`. If it isn't, stop and surface the situation rather than overwriting.

- [ ] **Step 1.2: Create the implementation branch**

Run:

```bash
git checkout -b codex/local-order-products-setup-panel
```

Expected: `Switched to a new branch 'codex/local-order-products-setup-panel'`.

---

## Task 2: Status sentence pure helper (TDD)

**Files:**
- Create: `lib/orders/line-status.ts`
- Test: `lib/orders/line-status.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `lib/orders/line-status.test.ts`:

```typescript
import assert from 'node:assert/strict';

import { computeLineStatus, type LineStatusInput } from './line-status';

declare const test: (name: string, fn: () => void) => void;

const baseInput: LineStatusInput = {
  hasCutlistSnapshot: true,
  primaryMaterialId: 1,
  shortfallCount: 0,
};

test('computeLineStatus returns ready when materials configured and no shortfalls', () => {
  const result = computeLineStatus(baseInput);
  assert.equal(result.kind, 'ready');
  assert.equal(result.sentence, 'Ready to plan');
});

test('computeLineStatus returns needs-material when cutlist snapshot exists but primary is null', () => {
  const result = computeLineStatus({ ...baseInput, primaryMaterialId: null });
  assert.equal(result.kind, 'needs-material');
  assert.equal(result.sentence, 'Needs cutlist material');
});

test('computeLineStatus returns shortfall and pluralizes correctly', () => {
  const single = computeLineStatus({ ...baseInput, shortfallCount: 1 });
  assert.equal(single.kind, 'shortfall');
  assert.equal(single.sentence, '1 component short');

  const multi = computeLineStatus({ ...baseInput, shortfallCount: 3 });
  assert.equal(multi.kind, 'shortfall');
  assert.equal(multi.sentence, '3 components short');
});

test('computeLineStatus prioritizes shortfall over needs-material', () => {
  const result = computeLineStatus({
    hasCutlistSnapshot: true,
    primaryMaterialId: null,
    shortfallCount: 2,
  });
  assert.equal(result.kind, 'shortfall');
});

test('computeLineStatus returns ready when product has no cutlist snapshot', () => {
  const result = computeLineStatus({
    hasCutlistSnapshot: false,
    primaryMaterialId: null,
    shortfallCount: 0,
  });
  assert.equal(result.kind, 'ready');
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run:

```bash
npx vitest run lib/orders/line-status.test.ts
```

Expected: FAIL — `Cannot find module './line-status'`.

- [ ] **Step 2.3: Implement the helper**

Create `lib/orders/line-status.ts`:

```typescript
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
```

- [ ] **Step 2.4: Run test to verify it passes**

Run:

```bash
npx vitest run lib/orders/line-status.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 2.5: Commit**

```bash
git add lib/orders/line-status.ts lib/orders/line-status.test.ts
git commit -m "feat(orders): add line-status helper for setup panel"
```

---

## Task 3: Material chip data pure helper (TDD)

**Files:**
- Create: `lib/orders/material-chip-data.ts`
- Test: `lib/orders/material-chip-data.test.ts`

**Resolution rules (read carefully):**

The line-level `cutlist_primary_material_id` is the authoritative signal for whether THIS line is configured. Group-level `primary_material_id` defaults are product-template residue and must not promote a `null` line-primary to "configured". Display names must come from the snapshot itself (`CutlistSnapshotPart.effective_board_name`, falling back to `CutlistSnapshotGroup.primary_material_name`), never from a separately-built `boardNameById` map — the cutlist board may not appear in the BOM/component-requirements set and `boardNameById` would silently produce `Material 999` for valid boards.

- [ ] **Step 3.1: Write the failing test**

Create `lib/orders/material-chip-data.test.ts`:

```typescript
import assert from 'node:assert/strict';

import { resolveMaterialChip } from './material-chip-data';

declare const test: (name: string, fn: () => void) => void;

test('resolveMaterialChip returns hidden when product has no cutlist snapshot', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: null,
    cutlistPrimaryMaterialId: null,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'hidden');
});

test('resolveMaterialChip returns not-configured when snapshot exists but line primary is null', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{ board_type: '16mm-single', parts: [{ name: 'Top' }] } as any],
    cutlistPrimaryMaterialId: null,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'not-configured');
});

test('resolveMaterialChip returns not-configured even when group carries a primary_material_id default', () => {
  // Group-level default must NOT promote a null line-primary to "configured".
  // The line is the authoritative scope.
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      primary_material_id: 42,
      primary_material_name: 'Dark Grey MFC',
      parts: [{ name: 'Top', effective_board_name: 'Dark Grey MFC' }],
    } as any],
    cutlistPrimaryMaterialId: null,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'not-configured');
});

test('resolveMaterialChip prefers part effective_board_name from the snapshot', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      primary_material_id: 42,
      primary_material_name: 'Dark Grey MFC',
      parts: [{ name: 'Top', effective_board_name: 'Oak Veneer' }],
    } as any],
    cutlistPrimaryMaterialId: 42,
    cutlistPartOverrides: [],
  });
  // Snapshot's part-level effective name wins (per-part override case).
  assert.equal(result.kind, 'single');
  assert.deepEqual(result.primaries, ['Oak Veneer']);
  assert.equal(result.overrideCount, 0);
});

test('resolveMaterialChip falls back to group primary_material_name when part has no effective name', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      primary_material_id: 42,
      primary_material_name: 'Dark Grey MFC',
      parts: [{ name: 'Top' }],
    } as any],
    cutlistPrimaryMaterialId: 42,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'single');
  assert.deepEqual(result.primaries, ['Dark Grey MFC']);
});

test('resolveMaterialChip surfaces override count when overrides exist', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      primary_material_id: 42,
      primary_material_name: 'Dark Grey MFC',
      parts: [{ name: 'Top', effective_board_name: 'Dark Grey MFC' }],
    } as any],
    cutlistPrimaryMaterialId: 42,
    cutlistPartOverrides: [{ part_id: 'a' }, { part_id: 'b' }],
  });
  assert.equal(result.kind, 'single');
  assert.equal(result.overrideCount, 2);
});

test('resolveMaterialChip returns multiple primaries when groups carry different effective names', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [
      {
        board_type: '32mm-backer',
        primary_material_id: 7,
        primary_material_name: 'Oak Veneer',
        parts: [{ name: 'Side', effective_board_name: 'Oak Veneer' }],
      } as any,
      {
        board_type: '16mm-single',
        primary_material_id: 42,
        primary_material_name: 'Dark Grey MFC',
        parts: [{ name: 'Top', effective_board_name: 'Dark Grey MFC' }],
      } as any,
    ],
    cutlistPrimaryMaterialId: 42,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'multiple');
  assert.deepEqual(result.primaries.sort(), ['Dark Grey MFC', 'Oak Veneer']);
});

test('resolveMaterialChip falls back to Material <id> only when no snapshot name resolves', () => {
  const result = resolveMaterialChip({
    cutlistMaterialSnapshot: [{
      board_type: '16mm-single',
      // No primary_material_name on group, no effective_board_name on parts.
      parts: [{ name: 'Top' }],
    } as any],
    cutlistPrimaryMaterialId: 999,
    cutlistPartOverrides: [],
  });
  assert.equal(result.kind, 'single');
  assert.deepEqual(result.primaries, ['Material 999']);
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run:

```bash
npx vitest run lib/orders/material-chip-data.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the helper**

Create `lib/orders/material-chip-data.ts`:

```typescript
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
  // Read names directly from the snapshot — never via a separate name map.
  // Field shapes per lib/orders/snapshot-types.ts:
  //   parts: effective_board_name (per-part, may reflect overrides)
  //   group: primary_material_name (group default)
  const firstPart = Array.isArray(group?.parts) ? group.parts[0] : null;
  return firstPart?.effective_board_name ?? group?.primary_material_name ?? null;
}

export function resolveMaterialChip(input: MaterialChipInput): MaterialChipState {
  const groups = Array.isArray(input.cutlistMaterialSnapshot) ? input.cutlistMaterialSnapshot : [];
  if (groups.length === 0) return { kind: 'hidden' };

  // Authoritative line-level check: a null cutlist_primary_material_id means the
  // operator has not picked a material for THIS line yet. Group-level defaults
  // from the product template do NOT promote this to "configured".
  if (input.cutlistPrimaryMaterialId == null) {
    return { kind: 'not-configured' };
  }

  const overrideCount = Array.isArray(input.cutlistPartOverrides) ? input.cutlistPartOverrides.length : 0;

  // Collect display names from the snapshot itself. One name per group; dedupe.
  const names = new Set<string>();
  for (const group of groups) {
    const name = firstResolvedName(group);
    if (name) names.add(name);
  }

  if (names.size === 0) {
    // Snapshot present, line primary set, but no name resolves from snapshot.
    // Last-resort id label so the chip is never blank when configured.
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
```

- [ ] **Step 3.4: Run test to verify it passes**

Run:

```bash
npx vitest run lib/orders/material-chip-data.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 3.5: Commit**

```bash
git add lib/orders/material-chip-data.ts lib/orders/material-chip-data.test.ts
git commit -m "feat(orders): add material-chip-data helper for row chip"
```

---

## Task 4: MaterialChip component

**Files:**
- Create: `components/features/orders/setup-panel/MaterialChip.tsx`

- [ ] **Step 4.1: Implement the component**

Create the file:

```tsx
'use client';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { MaterialChipState } from '@/lib/orders/material-chip-data';

const CHIP_BASE = 'inline-flex items-center gap-1 h-5 rounded-sm border px-1.5 text-[11px] leading-none whitespace-nowrap';

function truncate(label: string, max = 28): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

export function MaterialChip({ state }: { state: MaterialChipState }) {
  if (state.kind === 'hidden') return null;

  if (state.kind === 'not-configured') {
    return (
      <span className={cn(CHIP_BASE, 'border-border/60 bg-transparent text-muted-foreground/70')}>
        Not configured
      </span>
    );
  }

  const overrideSuffix = state.overrideCount > 0
    ? `+${state.overrideCount} override${state.overrideCount === 1 ? '' : 's'}`
    : null;

  if (state.kind === 'single') {
    const label = state.primaries[0];
    return (
      <TooltipProvider delayDuration={250}>
        <span className="inline-flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn(CHIP_BASE, 'border-border/70 bg-muted/30 text-foreground')}>
                {truncate(label)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="text-xs">
              {label}
            </TooltipContent>
          </Tooltip>
          {overrideSuffix && (
            <span className="text-[11px] leading-none text-muted-foreground">{overrideSuffix}</span>
          )}
        </span>
      </TooltipProvider>
    );
  }

  // multiple
  const visible = state.primaries.slice(0, 2);
  const extra = state.primaries.length - visible.length;
  const fullList = state.primaries.join(', ');
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5">
            {visible.map((label) => (
              <span key={label} className={cn(CHIP_BASE, 'border-border/70 bg-muted/30 text-foreground')}>
                {truncate(label, 18)}
              </span>
            ))}
            {extra > 0 && (
              <span className="text-[11px] leading-none text-muted-foreground">+{extra} more</span>
            )}
            {overrideSuffix && (
              <span className="text-[11px] leading-none text-muted-foreground">{overrideSuffix}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="text-xs">
          {fullList}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

- [ ] **Step 4.2: Verify it compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(setup-panel/MaterialChip|material-chip-data)" | head
```

Expected: empty output. Other unrelated `tsc` errors in the repo can be present per CLAUDE.md verification rule — only chip-related files must be clean.

- [ ] **Step 4.3: Commit**

```bash
git add components/features/orders/setup-panel/MaterialChip.tsx
git commit -m "feat(orders): add MaterialChip component"
```

---

## Task 5: OverviewSection component

**Files:**
- Create: `components/features/orders/setup-panel/OverviewSection.tsx`

- [ ] **Step 5.1: Implement the component**

Create the file:

```tsx
'use client';

import { computeLineStatus, type LineStatusKind } from '@/lib/orders/line-status';
import { formatQuantity } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

interface OverviewSectionProps {
  ordered: number;
  reserved: number;
  toBuild: number;
  hasCutlistSnapshot: boolean;
  primaryMaterialId: number | null;
  shortfallCount: number;
}

const STATUS_COLOR: Record<LineStatusKind, string> = {
  ready: 'text-foreground',
  'needs-material': 'text-amber-600 dark:text-amber-400',
  shortfall: 'text-destructive',
};

export function OverviewSection({
  ordered,
  reserved,
  toBuild,
  hasCutlistSnapshot,
  primaryMaterialId,
  shortfallCount,
}: OverviewSectionProps) {
  const status = computeLineStatus({ hasCutlistSnapshot, primaryMaterialId, shortfallCount });

  return (
    <section className="px-5 py-5 border-b border-border/60">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        Overview
      </h3>

      <div className="grid grid-cols-3 gap-4">
        <Metric label="Ordered" value={formatQuantity(ordered)} />
        <Metric label="Reserved" value={formatQuantity(reserved)} />
        <Metric label="To build" value={formatQuantity(toBuild)} emphasized />
      </div>

      <p className={cn('mt-4 text-sm', STATUS_COLOR[status.kind])}>
        {status.sentence}
      </p>
    </section>
  );
}

function Metric({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 tabular-nums', emphasized ? 'text-2xl font-semibold' : 'text-lg')}>
        {value}
      </p>
    </div>
  );
}
```

- [ ] **Step 5.2: Verify compile**

Run:

```bash
npx tsc --noEmit 2>&1 | grep "OverviewSection" | head
```

Expected: empty.

- [ ] **Step 5.3: Commit**

```bash
git add components/features/orders/setup-panel/OverviewSection.tsx
git commit -m "feat(orders): add OverviewSection for setup panel"
```

---

## Task 6: CutlistMaterialsSection component

**Files:**
- Create: `components/features/orders/setup-panel/CutlistMaterialsSection.tsx`

- [ ] **Step 6.1: Implement the component**

The section reads the existing `cutlist_material_snapshot` shape on the order detail and renders one row per board-type group. Editing opens the existing `CutlistMaterialDialog` unchanged.

Create the file:

```tsx
'use client';

import React from 'react';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CutlistMaterialDialog } from '@/components/features/shared/CutlistMaterialDialog';
import { formatCurrency } from '@/lib/format-utils';
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
}

const BOARD_TYPE_LABEL: Record<string, string> = {
  '16mm-single': '16mm Single',
  '32mm-both': '32mm Laminated',
  '32mm-backer': '32mm With Backer',
};

function boardTypeLabel(kind: string): string {
  return BOARD_TYPE_LABEL[kind] ?? kind;
}

function namesFromGroup(group: any): { primary: string | null; backer: string | null; edging: string | null } {
  // Field shapes per lib/orders/snapshot-types.ts:
  //   group has primary_material_name, backer_material_name, effective_backer_name
  //   parts have effective_board_name, effective_edging_name (NOT effective_backer_name)
  // Edging lives at the part level only (per-part overrides) — surface the first part's value.
  const firstPart = Array.isArray(group?.parts) ? group.parts[0] : null;
  return {
    primary: firstPart?.effective_board_name ?? group?.primary_material_name ?? null,
    backer: group?.effective_backer_name ?? group?.backer_material_name ?? null,
    edging: firstPart?.effective_edging_name ?? null,
  };
}

export function CutlistMaterialsSection({ detail, applying, onApply }: CutlistMaterialsSectionProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const groups: CutlistSnapshotGroup[] = Array.isArray(detail?.cutlist_material_snapshot)
    ? detail.cutlist_material_snapshot
    : [];
  const overrideCount = Array.isArray(detail?.cutlist_part_overrides) ? detail.cutlist_part_overrides.length : 0;
  const surcharge = Number(detail?.cutlist_surcharge_resolved ?? 0);

  if (groups.length === 0) {
    return (
      <section className="px-5 py-5 border-b border-border/60">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Cutlist materials
        </h3>
        <p className="text-sm text-muted-foreground">This product has no cutlist parts.</p>
      </section>
    );
  }

  return (
    <>
      <section className="px-5 py-5 border-b border-border/60">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cutlist materials
          </h3>
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setDialogOpen(true)}>
            <Pencil className="mr-1.5 h-3 w-3" />
            Edit materials
          </Button>
        </div>

        <div className="space-y-3">
          {groups.map((group: any, idx: number) => {
            const partsCount = Array.isArray(group.parts) ? group.parts.length : 0;
            const names = namesFromGroup(group);
            return (
              <div key={`${group.board_type ?? 'group'}-${idx}`} className="text-sm">
                <p className="text-xs font-medium text-muted-foreground">
                  {boardTypeLabel(group.board_type)} · {partsCount} part{partsCount === 1 ? '' : 's'}
                </p>
                <p className="mt-0.5 text-sm text-foreground">
                  {names.primary ?? 'Primary not set'}
                </p>
                {names.backer && (
                  <p className="text-xs text-muted-foreground">+ Backer: {names.backer}</p>
                )}
                {names.edging && (
                  <p className="text-xs text-muted-foreground">Edging: {names.edging}</p>
                )}
              </div>
            );
          })}
        </div>

        {(overrideCount > 0 || surcharge !== 0) && (
          <div className="mt-4 pt-3 border-t border-border/40 text-xs text-muted-foreground space-y-0.5">
            {overrideCount > 0 && (
              <p>{overrideCount} part override{overrideCount === 1 ? '' : 's'}</p>
            )}
            {surcharge !== 0 && (
              <p>
                {surcharge > 0 ? '+' : '-'}
                {formatCurrency(Math.abs(surcharge))} line surcharge
              </p>
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

- [ ] **Step 6.2: Verify compile**

Run:

```bash
npx tsc --noEmit 2>&1 | grep "CutlistMaterialsSection" | head
```

Expected: empty.

- [ ] **Step 6.3: Commit**

```bash
git add components/features/orders/setup-panel/CutlistMaterialsSection.tsx
git commit -m "feat(orders): add CutlistMaterialsSection for setup panel"
```

---

## Task 7: ComponentReadinessSection component

**Files:**
- Create: `components/features/orders/setup-panel/ComponentReadinessSection.tsx`

This section is a refactor of the inline BOM expand JSX from `ProductsTableRow.tsx` (lines 313–438). The data shape and `computeComponentMetrics` helper are identical.

- [ ] **Step 7.1: Implement the component**

Create the file:

```tsx
'use client';

import Link from 'next/link';
import { Replace } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/lib/format-utils';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';

interface ComponentReadinessSectionProps {
  detail: any;
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  onSwapBomEntry: (entry: BomSnapshotEntry) => void;
}

function ComponentDescription({ description }: { description: string | null | undefined }) {
  const text = description?.trim();
  if (!text) return null;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block truncate text-xs text-muted-foreground">{text}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-xs leading-relaxed" side="top" align="start">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ComponentReadinessSection({
  detail,
  bomComponents,
  computeComponentMetrics,
  showGlobalContext,
  onSwapBomEntry,
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

  if (!bomComponents || bomComponents.length === 0) {
    return (
      <section className="px-5 py-5 border-b border-border/60">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Component readiness
        </h3>
        <p className="text-sm text-muted-foreground">No component requirements.</p>
      </section>
    );
  }

  // Render as a compact list (hairline row separators, no per-row card/border boxes).
  // The panel itself is the only container — no card-on-card. A subtle background
  // tint on shortfall rows is the only treatment that's allowed to differ between rows.
  return (
    <section className="px-5 py-5 border-b border-border/60">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Component readiness
      </h3>

      <div className="divide-y divide-border/40">
        {bomComponents.map((component: any) => {
          const metrics = computeComponentMetrics(component, detail.product_id);
          const globalShortfall = Number(component.global_real_shortfall ?? 0);
          const snapshotEntry = findSnapshotEntry(component);
          const isShort = metrics.real > 0;

          return (
            <div
              key={component.component_id}
              className={cn(
                'px-1 py-2.5 text-sm',
                isShort && '-mx-1 px-2 bg-destructive/5'
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  {component.component_id ? (
                    <Link
                      href={`/inventory/components/${component.component_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline"
                    >
                      {component.internal_code || 'Unknown'}
                    </Link>
                  ) : (
                    <span className="font-medium">{component.internal_code || 'Unknown'}</span>
                  )}
                  <ComponentDescription description={component.description} />
                </div>
                {snapshotEntry && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 w-7 px-0"
                    onClick={() => onSwapBomEntry(snapshotEntry)}
                    title="Swap component"
                    data-row-action
                  >
                    <Replace className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs tabular-nums">
                <Metric label="Required" value={formatQuantity(metrics.required)} />
                <Metric label="Available" value={formatQuantity(metrics.available ?? metrics.inStock)} />
                <Metric
                  label="Shortfall"
                  value={formatQuantity(metrics.real)}
                  className={metrics.real > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}
                />
                <Metric label="In stock" value={formatQuantity(metrics.inStock)} />
                <Metric label="Reserved" value={formatQuantity(metrics.reservedThisOrder ?? 0)} />
                <Metric label="On order" value={formatQuantity(metrics.onOrder)} />
              </div>

              {showGlobalContext && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Global shortfall:{' '}
                  <span className={cn('tabular-nums', globalShortfall > 0 ? 'text-destructive font-medium' : '')}>
                    {formatQuantity(globalShortfall)}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 7.2: Verify compile**

Run:

```bash
npx tsc --noEmit 2>&1 | grep "ComponentReadinessSection" | head
```

Expected: empty.

- [ ] **Step 7.3: Commit**

```bash
git add components/features/orders/setup-panel/ComponentReadinessSection.tsx
git commit -m "feat(orders): add ComponentReadinessSection for setup panel"
```

---

## Task 8: NextActionsSection component

**Files:**
- Create: `components/features/orders/setup-panel/NextActionsSection.tsx`

**Scope note:** the **Reserve order components** action calls the existing order-scoped `reserveComponentsMutation` (POST `/api/orders/[orderId]/reserve-components`). It earmarks stock across the **entire order**, not the selected line. The copy must say so honestly. Do NOT add line-scoped reservation logic in Phase 1 — that would expand the phase boundary.

- [ ] **Step 8.1: Implement the component**

Create the file:

```tsx
'use client';

import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NextActionsSectionProps {
  reservePending: boolean;
  onReserveOrderComponents: () => void | Promise<void>;
  onGenerateCuttingPlan: () => void;
  onIssueStock: () => void;
  onCreateJobCards: () => void;
}

export function NextActionsSection({
  reservePending,
  onReserveOrderComponents,
  onGenerateCuttingPlan,
  onIssueStock,
  onCreateJobCards,
}: NextActionsSectionProps) {
  return (
    <section className="px-5 py-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Next actions
      </h3>

      <div className="space-y-1">
        <ActionRow
          title="Reserve order components"
          description="Earmark on-hand stock across the entire order so other orders can’t claim it."
          loading={reservePending}
          disabled={reservePending}
          onClick={onReserveOrderComponents}
        />
        <ActionRow
          title="Generate cutting plan"
          description="Open the Cutting Plan tab to nest sheet boards and edging."
          onClick={onGenerateCuttingPlan}
        />
        <ActionRow
          title="Issue stock"
          description="Pick components or boards from stock against this order."
          onClick={onIssueStock}
        />
        <ActionRow
          title="Create job cards"
          description="Issue work-pool jobs to staff."
          onClick={onCreateJobCards}
        />
      </div>
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

Run:

```bash
npx tsc --noEmit 2>&1 | grep "NextActionsSection" | head
```

Expected: empty.

- [ ] **Step 8.3: Commit**

```bash
git add components/features/orders/setup-panel/NextActionsSection.tsx
git commit -m "feat(orders): add NextActionsSection for setup panel"
```

---

## Task 9: OrderLineSetupPanel composer

**Files:**
- Create: `components/features/orders/OrderLineSetupPanel.tsx`

- [ ] **Step 9.1: Implement the panel composer**

Create the file:

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
  /** Order-scoped — calls the existing reserve-components API; reserves across the full order. */
  onReserveOrderComponents: () => void | Promise<void>;
  onGenerateCuttingPlan: () => void;
  onIssueStock: () => void;
  onCreateJobCards: () => void;
  /** When true, renders inside a Sheet overlay for narrow viewports. */
  asSheet?: boolean;
  open?: boolean;
}

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
  showGlobalContext,
  applying,
  reservePending,
  onClose,
  onApplyCutlistMaterial,
  onSwapBomEntry,
  onReserveOrderComponents,
  onGenerateCuttingPlan,
  onIssueStock,
  onCreateJobCards,
}: OrderLineSetupPanelProps) {
  const productName = detail?.product?.name ?? 'Order line';
  const qty = Number(detail?.quantity ?? 0);
  const shortfallCount = bomComponents.filter((component) => {
    const metrics = computeComponentMetrics(component, detail.product_id);
    return metrics.real > 0.0001;
  }).length;
  const hasCutlistSnapshot = Array.isArray(detail?.cutlist_material_snapshot) && detail.cutlist_material_snapshot.length > 0;

  return (
    <>
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border/60">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Order line setup</p>
          <h2 className="mt-0.5 text-base font-semibold truncate" title={productName}>{productName}</h2>
          <p className="text-xs text-muted-foreground tabular-nums">qty {qty}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 -mr-1"
          onClick={onClose}
          aria-label="Close setup panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <OverviewSection
        ordered={coverage.ordered}
        reserved={coverage.reserved}
        toBuild={coverage.remain}
        hasCutlistSnapshot={hasCutlistSnapshot}
        primaryMaterialId={detail?.cutlist_primary_material_id ?? null}
        shortfallCount={shortfallCount}
      />

      <CutlistMaterialsSection
        detail={detail}
        applying={applying}
        onApply={onApplyCutlistMaterial}
      />

      <ComponentReadinessSection
        detail={detail}
        bomComponents={bomComponents}
        computeComponentMetrics={computeComponentMetrics}
        showGlobalContext={showGlobalContext}
        onSwapBomEntry={onSwapBomEntry}
      />

      <NextActionsSection
        reservePending={reservePending}
        onReserveOrderComponents={onReserveOrderComponents}
        onGenerateCuttingPlan={onGenerateCuttingPlan}
        onIssueStock={onIssueStock}
        onCreateJobCards={onCreateJobCards}
      />
    </>
  );
}
```

- [ ] **Step 9.2: Verify compile**

Run:

```bash
npx tsc --noEmit 2>&1 | grep "OrderLineSetupPanel" | head
```

Expected: empty.

- [ ] **Step 9.3: Commit**

```bash
git add components/features/orders/OrderLineSetupPanel.tsx
git commit -m "feat(orders): add OrderLineSetupPanel composer"
```

---

## Task 10: Strip ProductsTableRow

**Files:**
- Modify: `components/features/orders/ProductsTableRow.tsx`

This task removes the inline BOM expand, the inline cutlist material button, the surcharge child rows, and the chevron toggle. It adds a row click handler, selection styling, and the MaterialChip slot.

- [ ] **Step 10.1: Replace the file contents**

Overwrite `components/features/orders/ProductsTableRow.tsx` with:

```tsx
'use client';

import React from 'react';
import { Edit, Trash, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency, formatQuantity } from '@/lib/format-utils';
import { MaterialChip } from '@/components/features/orders/setup-panel/MaterialChip';
import { resolveMaterialChip } from '@/lib/orders/material-chip-data';

interface ProductsTableRowProps {
  detail: any;
  coverage: { ordered: number; reserved: number; remain: number; factor: number };
  isEditing: boolean;
  editQuantity: string;
  editUnitPrice: string;
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  isSelected: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onQuantityChange: (value: string) => void;
  onUnitPriceChange: (value: string) => void;
  updatePending: boolean;
  deletePending: boolean;
}

export function ProductsTableRow({
  detail,
  coverage,
  isEditing,
  editQuantity,
  editUnitPrice,
  bomComponents,
  computeComponentMetrics,
  isSelected,
  onSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onQuantityChange,
  onUnitPriceChange,
  updatePending,
  deletePending,
}: ProductsTableRowProps) {
  const hasShortfall = bomComponents.some((comp) => {
    const metrics = computeComponentMetrics(comp, detail.product_id);
    return metrics.real > 0.0001;
  });

  // Chip helper reads names directly from the snapshot — no name map needed.
  const chipState = resolveMaterialChip({
    cutlistMaterialSnapshot: detail.cutlist_material_snapshot ?? null,
    cutlistPrimaryMaterialId: detail.cutlist_primary_material_id ?? null,
    cutlistPartOverrides: detail.cutlist_part_overrides ?? [],
  });

  // Row-click propagation guardrail: any click that lands inside an explicit
  // interactive control (buttons, links, inputs, contenteditable, anything we
  // tag with `data-row-action`) must NOT select the row. Belt-and-braces with
  // the `data-row-action` opt-in attribute on the action cells.
  const handleRowClick = (event: React.MouseEvent) => {
    if (isEditing) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const interactive = target.closest(
      'button, a, input, textarea, select, label, [contenteditable=true], [role="button"], [role="combobox"], [data-row-action]'
    );
    if (interactive) return;
    onSelect();
  };

  return (
    <TableRow
      onClick={handleRowClick}
      className={cn(
        'cursor-pointer transition-colors',
        'bg-muted/40 hover:bg-muted/60',
        hasShortfall && 'bg-destructive/5 hover:bg-destructive/10',
        isSelected && 'bg-primary/5 hover:bg-primary/5 shadow-[inset_2px_0_0_0_var(--color-primary)]'
      )}
    >
      <TableCell>
        <div className="min-w-0">
          <p className="font-medium">{detail.product?.name}</p>
          <p className="text-sm text-muted-foreground truncate max-w-md">
            {detail.product?.description || 'No description available'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <MaterialChip state={chipState} />
            {hasShortfall && (
              <Badge variant="destructive" className="h-4 text-[10px]">
                Shortfall
              </Badge>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {isEditing ? (
          <Input
            type="number"
            value={editQuantity}
            onChange={(e) => onQuantityChange(e.target.value)}
            className="w-24 text-right"
            min="0"
            step="0.01"
            data-row-action
          />
        ) : (
          formatQuantity(coverage.ordered)
        )}
      </TableCell>

      <TableCell className="text-right tabular-nums">{formatQuantity(coverage.reserved)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatQuantity(coverage.remain)}</TableCell>

      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {isEditing ? (
          <Input
            type="number"
            value={editUnitPrice}
            onChange={(e) => onUnitPriceChange(e.target.value)}
            className="w-28 text-right"
            min="0"
            step="0.01"
            data-row-action
          />
        ) : (
          formatCurrency(detail.unit_price || 0)
        )}
      </TableCell>

      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {isEditing
          ? formatCurrency(parseFloat(editQuantity || '0') * parseFloat(editUnitPrice || '0'))
          : formatCurrency((detail.quantity || 0) * (detail.unit_price || 0))}
      </TableCell>

      <TableCell className="text-right" data-row-action>
        {isEditing ? (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="ghost" onClick={onSaveEdit} disabled={updatePending}>
              {updatePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={updatePending}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="ghost" onClick={onStartEdit}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} disabled={deletePending}>
              {deletePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
```

Notes for the implementer:

- The previous file's `surchargeRows` rendering, the `cutlistSurcharge` row, the chevron expand, the inline BOM grid, the cutlist material popover button, and the imported `CutlistMaterialDialog` are all removed. The cutlist material editing UI now lives inside the panel's `CutlistMaterialsSection`. The surcharge information now lives inside that section's footer.
- `data-row-action` on action cells / inputs prevents the row click from firing when the operator interacts with edit inputs or buttons.
- `isSelected` is the new prop driving the left-edge accent. Implemented as a hairline `box-shadow` (not a `border-l-2`) per the design law against side-stripes.

- [ ] **Step 10.2: Verify compile**

Run:

```bash
npx tsc --noEmit 2>&1 | grep "ProductsTableRow" | head
```

Expected: empty (callers in `page.tsx` will fail until Task 11 — that's expected and addressed there).

- [ ] **Step 10.3: Commit**

```bash
git add components/features/orders/ProductsTableRow.tsx
git commit -m "refactor(orders): strip inline BOM/cutlist UI from ProductsTableRow"
```

---

## Task 11: Wire selection state in page.tsx

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`

This task changes the order detail page to:

1. Read / write a `?line=<order_detail_id>` URL param.
2. Pass new props to `ProductsTableRow` (drop the removed ones — including the `boardNameById` map; the chip now reads names directly from the snapshot).
3. Conditionally render `OrderLineSetupPanel` vs `OrderSidebar` in the right column.
4. Hook the existing `onProductClick` callsite to set selection instead of opening the legacy slide-out.
5. Drop the `line` URL param when leaving the Products tab so `tab` switches don't carry a stale line selection.

- [ ] **Step 11.1: Add URL-param helpers and selection state**

Inside `OrderDetailPage` (near the existing `activeTab` / `handleTabChange` block at lines 135–140), add:

```tsx
const selectedLineParam = searchParams?.get('line');
const selectedLineId = selectedLineParam ? Number(selectedLineParam) : null;

const handleSelectLine = useCallback((orderDetailId: number | null) => {
  const params = new URLSearchParams(searchParams?.toString() || '');
  if (orderDetailId == null) {
    params.delete('line');
  } else {
    params.set('line', String(orderDetailId));
  }
  router.replace(`?${params.toString()}`, { scroll: false });
}, [searchParams, router]);
```

Then update the existing `handleTabChange` (lines 136–140) to drop `line` when leaving Products:

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

- [ ] **Step 11.2: Update the `ProductsTableRow` call site**

Replace the current `<ProductsTableRow … />` call at lines 1301–1327 with:

```tsx
<ProductsTableRow
  key={detail.order_detail_id}
  detail={detail}
  coverage={coverage}
  isEditing={isEditing}
  editQuantity={editQuantity}
  editUnitPrice={editUnitPrice}
  bomComponents={productBom}
  computeComponentMetrics={computeComponentMetrics}
  isSelected={selectedLineId === detail.order_detail_id}
  onSelect={() => handleSelectLine(detail.order_detail_id)}
  onStartEdit={() => handleStartEditDetail(detail)}
  onSaveEdit={() => handleSaveDetail(detail.order_detail_id)}
  onCancelEdit={handleCancelDetailEdit}
  onDelete={() => handleDeleteDetail(detail.order_detail_id, detail.product?.name || 'this product')}
  onQuantityChange={setEditQuantity}
  onUnitPriceChange={setEditUnitPrice}
  updatePending={updateDetailMutation.isPending}
  deletePending={deleteDetailMutation.isPending}
/>
```

The removed-from-row callbacks (`onToggleExpand`, `onApplyCutlistMaterial`, `onSwapBomEntry`, `onProductClick`) move into the panel — see the next step. The `idx > 0 && (<spacer row>)` block above the `ProductsTableRow` stays as it is.

**Note on `slideOutProduct`:** the legacy state (`page.tsx:154`) and its consumer `OrderSlideOutPanel` remain compiled but are intentionally unreachable in Phase 1. Do NOT add a "View product" affordance now. The slide-out is retired in Phase 2 after confirming nothing else triggers it.

Also delete the surrounding `expandedRows` / `toggleRowExpansion` / `isExpanded` plumbing for product rows. Search for `expandedRows[expandKey]` and `toggleRowExpansion` and remove those references from this loop (keep any usages outside of the products table loop unchanged).

- [ ] **Step 11.3: Render the panel in the right column**

Find the existing right-column block that renders `<OrderSidebar … />` on the order detail page. (Search for `OrderSidebar` in the file.) Replace its single render with a conditional render:

```tsx
{(() => {
  const selectedDetail = order?.details?.find?.((d: any) => d.order_detail_id === selectedLineId) ?? null;
  if (selectedDetail) {
    const selectedCoverage = coverageByProduct.get(selectedDetail.product_id) ?? {
      ordered: Number(selectedDetail.quantity ?? 0),
      reserved: 0,
      remain: Number(selectedDetail.quantity ?? 0),
      factor: 1,
    };
    const selectedBom = (
      componentRequirements.find((pr: any) => pr.order_detail_id === selectedDetail.order_detail_id)
      ?? componentRequirements.find((pr: any) => pr.product_id === selectedDetail.product_id)
    )?.components ?? [];

    return (
      <OrderLineSetupPanel
        detail={selectedDetail}
        coverage={selectedCoverage}
        bomComponents={selectedBom}
        computeComponentMetrics={computeComponentMetrics}
        showGlobalContext={showGlobalContext}
        applying={updateDetailMutation.isPending}
        reservePending={reserveComponentsMutation.isPending}
        onClose={() => handleSelectLine(null)}
        onApplyCutlistMaterial={(value) => updateDetailMutation.mutateAsync({
          detailId: selectedDetail.order_detail_id,
          ...value,
        })}
        onSwapBomEntry={(entry) => setSwapTarget({ detail: selectedDetail, entry })}
        onReserveOrderComponents={() => reserveComponentsMutation.mutateAsync()}
        onGenerateCuttingPlan={() => handleTabChange('cutting-plan')}
        onIssueStock={() => handleTabChange('issue-stock')}
        onCreateJobCards={() => handleTabChange('job-cards')}
      />
    );
  }
  return <OrderSidebar orderId={orderId} onTabChange={handleTabChange} />;
})()}
```

Add the matching import at the top of the file (alongside `import { OrderSidebar } from '...'`):

```tsx
import { OrderLineSetupPanel } from '@/components/features/orders/OrderLineSetupPanel';
```

`reserveComponentsMutation` is already in scope at `page.tsx:828` (confirmed by preflight). It is **order-scoped** — calls `app/api/orders/[orderId]/reserve-components/route.ts` which reserves components across the entire order, not the selected line. The panel's "Reserve order components" copy in Task 8 reflects this scope; do not present the action as line-level.

- [ ] **Step 11.4: Verify compile**

Run:

```bash
npx tsc --noEmit 2>&1 | grep -E "(ProductsTableRow|OrderLineSetupPanel|page\.tsx)" | head -20
```

Expected: empty for the new components and call sites. Pre-existing unrelated errors in the repo can remain — only the files this plan touched should be clean.

- [ ] **Step 11.5: Lint**

Run:

```bash
npm run lint
```

Expected: no new errors in the files this task touched. Pre-existing lint warnings elsewhere are not this task's concern but should be reported in the PR description.

- [ ] **Step 11.6: Commit**

```bash
git add app/orders/\[orderId\]/page.tsx
git commit -m "feat(orders): wire OrderLineSetupPanel and selection URL state"
```

---

## Task 12: Keyboard navigation

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`

- [ ] **Step 12.1: Add the keyboard handler**

Inside `OrderDetailPage`, after the `handleSelectLine` callback (Task 11 step 1), add:

```tsx
React.useEffect(() => {
  if (selectedLineId == null) return;
  function onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    const details: any[] = order?.details ?? [];
    const index = details.findIndex((d: any) => d.order_detail_id === selectedLineId);
    if (event.key === 'Escape') {
      event.preventDefault();
      handleSelectLine(null);
    } else if (event.key === 'ArrowDown' && index >= 0 && index < details.length - 1) {
      event.preventDefault();
      handleSelectLine(details[index + 1].order_detail_id);
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      handleSelectLine(details[index - 1].order_detail_id);
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [selectedLineId, order, handleSelectLine]);
```

`React` must be imported at the top of the file (it already is in this file).

- [ ] **Step 12.2: Lint**

Run:

```bash
npm run lint
```

Expected: clean for touched lines.

- [ ] **Step 12.3: Commit**

```bash
git add app/orders/\[orderId\]/page.tsx
git commit -m "feat(orders): add keyboard navigation for setup panel"
```

---

## Task 13: Narrow-viewport sheet behavior

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`

The `OrderLineSetupPanel` already supports an `asSheet` mode. This task uses a media query to swap render modes at the page level rather than inside the panel.

- [ ] **Step 13.1: Add a narrow-viewport hook**

Inside `OrderDetailPage`, add (just under `selectedLineId`):

```tsx
const [isNarrow, setIsNarrow] = React.useState(false);
React.useEffect(() => {
  const mql = window.matchMedia('(max-width: 1023px)');
  const handler = (event: MediaQueryListEvent | MediaQueryList) => setIsNarrow('matches' in event ? event.matches : (event as MediaQueryList).matches);
  handler(mql);
  mql.addEventListener('change', handler as (event: MediaQueryListEvent) => void);
  return () => mql.removeEventListener('change', handler as (event: MediaQueryListEvent) => void);
}, []);
```

- [ ] **Step 13.2: Apply asSheet in the right-column conditional**

In the conditional from Task 11 step 4, change the panel render to:

```tsx
return (
  <OrderLineSetupPanel
    detail={selectedDetail}
    coverage={selectedCoverage}
    bomComponents={selectedBom}
    computeComponentMetrics={computeComponentMetrics}
    showGlobalContext={showGlobalContext}
    applying={updateDetailMutation.isPending}
    reservePending={reserveComponentsMutation.isPending}
    onClose={() => handleSelectLine(null)}
    onApplyCutlistMaterial={(value) => updateDetailMutation.mutateAsync({
      detailId: selectedDetail.order_detail_id,
      ...value,
    })}
    onSwapBomEntry={(entry) => setSwapTarget({ detail: selectedDetail, entry })}
    onReserveComponents={() => reserveComponentsMutation.mutateAsync()}
    onGenerateCuttingPlan={() => handleTabChange('cutting-plan')}
    onIssueStock={() => handleTabChange('issue-stock')}
    onCreateJobCards={() => handleTabChange('job-cards')}
    asSheet={isNarrow}
    open={isNarrow ? selectedLineId != null : undefined}
  />
);
```

Also: when `isNarrow` is true, the right column should not occupy layout space (the sheet floats over content). Adjust the right-column wrapper so it renders nothing in narrow mode unless a line is selected. The exact JSX depends on the existing layout — the implementer should locate the right-column wrapper (around the `OrderSidebar` block) and gate it behind `!isNarrow || selectedLineId != null`.

- [ ] **Step 13.3: Verify compile + lint**

```bash
npx tsc --noEmit 2>&1 | grep "page.tsx" | head
npm run lint
```

Expected: clean.

- [ ] **Step 13.4: Commit**

```bash
git add app/orders/\[orderId\]/page.tsx
git commit -m "feat(orders): swap panel to sheet on narrow viewports"
```

---

## Task 14: Browser smoke verification

**Files:** none (verification only)

- [ ] **Step 14.1: Start the preview server**

Use the preview MCP (`preview_start`) to start the Next.js dev server at the repo root. Wait for it to report "Ready" in the preview logs.

- [ ] **Step 14.2: Sign in with the test account**

Per CLAUDE.md verification rule and the test-account memory, sign in as `testai@qbutton.co.za` / `ClaudeTest2026!`. The preview MCP keeps an isolated profile, so sign in fresh each session.

- [ ] **Step 14.3: Open an order with multiple lines**

Pick an order under the QButton org with at least three product lines: ideally one with cutlist material configured, one not configured, one with shortfall. The piecework / panel test orders documented in MEMORY are reasonable candidates; verify with `preview_snapshot` that the page renders.

- [ ] **Step 14.4: Verify the row + panel interaction**

Walk through every acceptance criterion from the spec. Capture failures with `preview_console_logs` and `preview_screenshot` and fix at the source before proceeding.

- [ ] **Step 14.5: Verify URL persistence**

`preview_eval` to read `window.location.search`, reload the page, confirm the same line is selected.

- [ ] **Step 14.6: Verify narrow-viewport sheet behavior**

`preview_resize` to 768×1024, click a row, confirm the sheet slides over content. Resize back to 1280, confirm two-column behavior returns.

- [ ] **Step 14.7: Capture proof for the PR**

Take one full-page screenshot of the new layout in two-column mode and one of the sheet mode. Save them to `docs/screenshots/2026-05-08-order-products-setup-panel/` (create the folder).

- [ ] **Step 14.8: Stop the preview server**

`preview_stop`.

---

## Task 15: Final verification + push

**Files:** none

- [ ] **Step 15.1: Run lint and tsc**

```bash
npm run lint
npx tsc --noEmit
```

Expected: no new failures introduced by this branch. Pre-existing unrelated failures are reported as-is in the PR description.

- [ ] **Step 15.2: Run the new helper tests**

```bash
npx vitest run lib/orders/line-status.test.ts lib/orders/material-chip-data.test.ts
```

Expected: PASS, 11 tests total.

- [ ] **Step 15.3: Restore any test data modified during smoke**

If the browser smoke modified any live data (e.g. material selections on a real order), restore it to its original state per the [restore-test-data feedback memory](feedback_restore_test_data.md).

- [ ] **Step 15.4: Push the branch**

```bash
git push -u origin codex/local-order-products-setup-panel
```

- [ ] **Step 15.5: Open the PR**

Create a pull request from `codex/local-order-products-setup-panel` into `codex/integration`. PR description must include:

- Spec link: `docs/superpowers/specs/2026-05-08-order-products-setup-panel-design.md`
- Plan link: `docs/superpowers/plans/2026-05-08-order-products-setup-panel.md`
- Screenshots from Task 14 step 7
- Acceptance-criteria checklist (copy from the spec)
- Any pre-existing lint/tsc failures left untouched
- Reviewer note: this is Phase 1; cost preview and inline editing are explicitly deferred

---

## Self-review checklist

Run before declaring the plan ready for execution:

**1. Spec coverage** — every acceptance criterion in the spec maps to at least one task:

- Row click selects → Task 10 + 11
- Different row swaps panel → Task 11
- Close button / Esc deselects → Task 9 (close button) + Task 12 (Esc)
- `?line=` URL param survives reload → Task 11 + Task 14 step 5
- Selection styling on row → Task 10
- No chevron expand / no inline cutlist button / no surcharge child rows → Task 10
- Material chip states → Task 3 (helper) + Task 4 (component)
- Overview section content → Task 5
- Cutlist Materials section reuses dialog unchanged → Task 6 (dialog import is unchanged)
- Component Readiness section → Task 7
- Next Actions section → Task 8
- Narrow-viewport sheet → Task 13
- Stock Reservations / Component Reservations untouched → confirmed in Task 11 (we only modify the right-column conditional, not the left)
- No new queries / no schema / no RLS → confirmed across all tasks
- No CutlistMaterialDialog changes → confirmed in Task 6 (only imported)
- Edit-in-place / delete / swap / surcharge behavior preserved → Task 10 retains the existing edit/delete handlers; swap moves to the panel via `onSwapBomEntry`

**2. Placeholder scan** — search the plan for "TBD", "TODO", "fill in", "appropriate error handling", "similar to". None present.

**3. Type consistency** — `LineStatus`, `MaterialChipState`, `OrderLineSetupPanelProps` names match across the helper, component, and call-site tasks.

**4. Any spec requirement with no task?** No.

---

## Out-of-scope reminders

- Do not modify `CutlistMaterialDialog`.
- Do not introduce new queries or API routes.
- Do not surface cost numbers anywhere on the Products tab.
- Do not change snapshot semantics on `order_details`.
- Do not touch RLS, migrations, or schema.
- Do not delete `slideOutProduct` state or its consumers in this PR — it stays unused on row click; retire it in Phase 2 after confirming nothing depends on it.

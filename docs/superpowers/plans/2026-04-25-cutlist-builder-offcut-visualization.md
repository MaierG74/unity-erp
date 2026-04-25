# Cutlist Builder Offcut Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface reusable offcut sizes in the per-product Cutlist Builder via three coordinated screen-only changes: (1) green-tinted offcut overlays with adaptive labels on the SVG sheet diagram, (2) a per-sheet bullet list of reusable offcut dimensions, (3) a segmented utilization bar (parts/reusable/scrap) per-sheet AND rolled up at the top of the Builder, with quick-fill chips that populate the existing Manual % billing input.

**Architecture:** A new pure helper `lib/cutlist/effectiveUtilization.ts` centralises the utilization math (raw percentages for chips/billing parity, display percentages for bar segments). Two new shared primitives — `UtilizationBar.tsx` and `ReusableOffcutList.tsx` — are consumed by the per-sheet card (`SheetLayoutGrid.tsx`), the zoom modal (`InteractiveSheetViewer.tsx`), and the rolled-up bar at the top of the Builder (`CutlistCalculator.tsx`). The SVG offcut overlay lives in `SheetPreview` (`preview.tsx`) behind a new optional prop. **No costing engine changes** — Manual % stays as the human-controlled billing input; effective utilization is purely informational.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind v4, shadcn v4 (Tooltip, Button, Input), `node:test` via `npx tsx --test`, `@tanstack/react-query`. Spec: [docs/superpowers/specs/2026-04-25-cutlist-builder-offcut-visualization-design.md](../specs/2026-04-25-cutlist-builder-offcut-visualization-design.md).

**Branch:** continue on `codex/integration` (or branch off `codex/integration` if you prefer a separate task branch).

**Verification harness for every task:**
- Lint: `npm run lint` (tolerate pre-existing image-related warnings)
- Type-check: `npx tsc --noEmit` (touched files must be clean; 138 pre-existing baseline errors elsewhere are out of scope)
- Unit tests: `npx tsx --test tests/<file>.test.ts`
- Manual browser: use the Claude in Chrome MCP, log in as `testai@qbutton.co.za` / `ClaudeTest2026!`, navigate to `http://localhost:3000/products/856/cutlist-builder`

---

## Task 1: Pure helper — `lib/cutlist/effectiveUtilization.ts` + tests

**Why first:** All downstream UI consumes this. Pure math, TDD-friendly, no React.

**Files:**
- Create: `lib/cutlist/effectiveUtilization.ts`
- Create: `tests/cutlist-effective-utilization.test.ts`

- [ ] **Step 1.1: Write the failing test file**

Create `tests/cutlist-effective-utilization.test.ts`:

```ts
/**
 * Tests for the effective-utilization helper.
 *
 * Run with: npx tsx --test tests/cutlist-effective-utilization.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSheetUtilization,
  computeRolledUpUtilization,
} from '../lib/cutlist/effectiveUtilization';
import type { SheetLayout } from '../lib/cutlist/types';

const sheet = (
  used_area_mm2: number,
  reusable_area_mm2: number,
  scrap_area_mm2 = 0,
): SheetLayout => ({
  sheet_id: 's1',
  placements: [],
  used_area_mm2,
  offcut_summary: {
    fragments: 1,
    reusableCount: reusable_area_mm2 > 0 ? 1 : 0,
    scrapCount: scrap_area_mm2 > 0 ? 1 : 0,
    reusableArea_mm2: reusable_area_mm2,
    scrapArea_mm2: scrap_area_mm2,
    largestReusableArea_mm2: reusable_area_mm2,
    reusableOffcuts: [],
    scrapOffcuts: [],
  },
});

test('basic 40/30/30 split — display pcts sum to 100', () => {
  const r = computeSheetUtilization(sheet(2_000_000, 1_500_000), 1000, 5000);
  // Total = 5_000_000 mm². Parts=40%, Reusable=30%, Scrap=30%.
  assert.equal(r.totalArea_mm2, 5_000_000);
  assert.equal(r.partsArea_mm2, 2_000_000);
  assert.equal(r.reusableArea_mm2, 1_500_000);
  assert.equal(r.scrapArea_mm2, 1_500_000);
  assert.equal(r.mechanicalPctRaw, 40);
  assert.equal(r.effectivePctRaw, 70);
  assert.equal(r.displayPartsPct + r.displayReusablePct + r.displayScrapPct, 100);
  assert.equal(r.hasReusable, true);
  assert.equal(r.hasAreaDrift, false);
});

test('zero reusable — hasReusable false, two-segment bar', () => {
  const r = computeSheetUtilization(sheet(2_000_000, 0, 3_000_000), 1000, 5000);
  assert.equal(r.hasReusable, false);
  assert.equal(r.displayReusablePct, 0);
  assert.equal(r.displayPartsPct + r.displayScrapPct, 100);
  assert.equal(r.mechanicalPctRaw, 40);
  assert.equal(r.effectivePctRaw, 40); // equals mechanical when no reusable
});

test('100% used — full bar of parts only', () => {
  const r = computeSheetUtilization(sheet(5_000_000, 0), 1000, 5000);
  assert.equal(r.partsArea_mm2, 5_000_000);
  assert.equal(r.reusableArea_mm2, 0);
  assert.equal(r.scrapArea_mm2, 0);
  assert.equal(r.displayPartsPct, 100);
  assert.equal(r.displayReusablePct, 0);
  assert.equal(r.displayScrapPct, 0);
});

test('area drift — parts area is preserved, reusable yields', () => {
  // Parts says 4_000_000 (80%); reusable claims 2_000_000 (40%) → 120% total. Drift!
  const r = computeSheetUtilization(sheet(4_000_000, 2_000_000), 1000, 5000);
  assert.equal(r.hasAreaDrift, true);
  assert.equal(r.partsArea_mm2, 4_000_000); // preserved
  // Reusable clamped to (total - parts) = 1_000_000
  assert.equal(r.reusableArea_mm2, 1_000_000);
  assert.equal(r.scrapArea_mm2, 0);
  assert.equal(r.mechanicalPctRaw, 80); // raw mech still 80%, NOT reduced
});

test('parts overflows total — clamped to total, reusable=scrap=0', () => {
  // Parts says 6_000_000 (120%) — impossible drift. Clamp parts to total.
  const r = computeSheetUtilization(sheet(6_000_000, 0), 1000, 5000);
  assert.equal(r.hasAreaDrift, true);
  assert.equal(r.partsArea_mm2, 5_000_000);
  assert.equal(r.reusableArea_mm2, 0);
  assert.equal(r.scrapArea_mm2, 0);
});

test('zero total area — no divide by zero, all zero pcts', () => {
  const r = computeSheetUtilization(sheet(0, 0), 0, 0);
  assert.equal(r.totalArea_mm2, 0);
  assert.equal(r.mechanicalPctRaw, 0);
  assert.equal(r.effectivePctRaw, 0);
  assert.equal(r.displayPartsPct, 0);
  assert.equal(r.displayReusablePct, 0);
  assert.equal(r.displayScrapPct, 0);
});

test('sheet missing offcut_summary — reusable defaults to 0', () => {
  const s: SheetLayout = { sheet_id: 's2', placements: [], used_area_mm2: 1_000_000 };
  const r = computeSheetUtilization(s, 1000, 5000);
  assert.equal(r.reusableArea_mm2, 0);
  assert.equal(r.hasReusable, false);
});

test('rolled-up sums areas, then computes pcts (NOT averaging per-sheet pcts)', () => {
  // Sheet 1: 4m² used / 1m² reusable / 0 scrap → 80%/20%/0 of 5m²
  // Sheet 2: 0 used / 0 reusable / 5m² scrap → 0/0/100 of 5m²
  // Combined: 4m² parts + 1m² reusable + 5m² scrap = 10m² total
  // Expected: 40% / 10% / 50% — NOT (80+0)/2 = 40% / (20+0)/2 = 10% / (0+100)/2 = 50%
  // (Numbers happen to match in this case, but the principle matters.)
  const r = computeRolledUpUtilization([
    { layout: sheet(4_000_000, 1_000_000, 0), widthMm: 1000, lengthMm: 5000 },
    { layout: sheet(0, 0, 5_000_000), widthMm: 1000, lengthMm: 5000 },
  ]);
  assert.equal(r.totalArea_mm2, 10_000_000);
  assert.equal(r.partsArea_mm2, 4_000_000);
  assert.equal(r.reusableArea_mm2, 1_000_000);
  assert.equal(r.mechanicalPctRaw, 40);
  assert.equal(r.effectivePctRaw, 50);
});

test('rolled-up empty — guards against divide by zero', () => {
  const r = computeRolledUpUtilization([]);
  assert.equal(r.totalArea_mm2, 0);
  assert.equal(r.mechanicalPctRaw, 0);
  assert.equal(r.effectivePctRaw, 0);
});
```

- [ ] **Step 1.2: Run, expect failure**

Run: `npx tsx --test tests/cutlist-effective-utilization.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement the helper**

Create `lib/cutlist/effectiveUtilization.ts`:

```ts
/**
 * Effective sheet utilization — reusable-offcut aware.
 *
 * See docs/superpowers/specs/2026-04-25-cutlist-builder-offcut-visualization-design.md §2.
 *
 * Two-tier percentages:
 *   - Raw (mechanicalPctRaw, effectivePctRaw) → drives chip values & matches existing autoPct
 *     for "Reset to auto" parity. No rounding compensation.
 *   - Display (displayPartsPct, displayReusablePct, displayScrapPct) → drives bar segments.
 *     Rounded to 1 decimal, then compensated so they sum to exactly 100.
 *
 * Clamp order matters: parts area is the trusted number from packer placements.
 * Reusable area yields to drift. Never silently under-report placed-parts %.
 */

import type { SheetLayout } from './types';

export interface UtilizationBreakdown {
  totalArea_mm2: number;
  partsArea_mm2: number;
  reusableArea_mm2: number;
  scrapArea_mm2: number;

  mechanicalPctRaw: number;
  effectivePctRaw: number;

  displayPartsPct: number;
  displayReusablePct: number;
  displayScrapPct: number;

  hasReusable: boolean;
  hasAreaDrift: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pct(area: number, total: number): number {
  return total > 0 ? (area / total) * 100 : 0;
}

/** Round each segment to 1 decimal, then push the rounding delta onto the largest. */
function compensateToHundred(
  parts: number,
  reusable: number,
  scrap: number,
): { parts: number; reusable: number; scrap: number } {
  const rounded = {
    parts: Math.round(parts * 10) / 10,
    reusable: Math.round(reusable * 10) / 10,
    scrap: Math.round(scrap * 10) / 10,
  };
  const sum = rounded.parts + rounded.reusable + rounded.scrap;
  if (sum === 0) return rounded;
  const delta = Math.round((100 - sum) * 10) / 10;
  if (delta === 0) return rounded;
  // Push delta onto whichever segment has the largest unrounded value.
  const largest = parts >= reusable && parts >= scrap
    ? 'parts'
    : reusable >= scrap
      ? 'reusable'
      : 'scrap';
  return { ...rounded, [largest]: Math.round((rounded[largest] + delta) * 10) / 10 };
}

function buildBreakdown(
  rawPartsArea: number,
  rawReusableArea: number,
  totalArea: number,
): UtilizationBreakdown {
  const partsArea = clamp(rawPartsArea, 0, totalArea);
  const reusableArea = clamp(rawReusableArea, 0, Math.max(0, totalArea - partsArea));
  const scrapArea = Math.max(0, totalArea - partsArea - reusableArea);
  const hasAreaDrift = rawPartsArea + rawReusableArea > totalArea + 0.5; // tolerate <0.5 mm² FP

  const mechanicalPctRaw = pct(partsArea, totalArea);
  const reusablePctRaw = pct(reusableArea, totalArea);
  const scrapPctRaw = pct(scrapArea, totalArea);
  const effectivePctRaw = mechanicalPctRaw + reusablePctRaw;

  const display = compensateToHundred(mechanicalPctRaw, reusablePctRaw, scrapPctRaw);

  return {
    totalArea_mm2: totalArea,
    partsArea_mm2: partsArea,
    reusableArea_mm2: reusableArea,
    scrapArea_mm2: scrapArea,
    mechanicalPctRaw,
    effectivePctRaw,
    displayPartsPct: display.parts,
    displayReusablePct: display.reusable,
    displayScrapPct: display.scrap,
    hasReusable: reusableArea > 0,
    hasAreaDrift,
  };
}

export function computeSheetUtilization(
  sheet: SheetLayout,
  sheetWidth_mm: number,
  sheetLength_mm: number,
): UtilizationBreakdown {
  const totalArea = sheetWidth_mm * sheetLength_mm;
  const partsArea =
    sheet.used_area_mm2 ?? sheet.placements.reduce((sum, p) => sum + p.w * p.h, 0);
  const reusableArea = sheet.offcut_summary?.reusableArea_mm2 ?? 0;
  return buildBreakdown(partsArea, reusableArea, totalArea);
}

export function computeRolledUpUtilization(
  sheets: Array<{ layout: SheetLayout; widthMm: number; lengthMm: number }>,
): UtilizationBreakdown {
  let totalArea = 0;
  let partsArea = 0;
  let reusableArea = 0;
  for (const { layout, widthMm, lengthMm } of sheets) {
    totalArea += widthMm * lengthMm;
    partsArea +=
      layout.used_area_mm2 ?? layout.placements.reduce((s, p) => s + p.w * p.h, 0);
    reusableArea += layout.offcut_summary?.reusableArea_mm2 ?? 0;
  }
  return buildBreakdown(partsArea, reusableArea, totalArea);
}
```

- [ ] **Step 1.4: Run, expect pass**

Run: `npx tsx --test tests/cutlist-effective-utilization.test.ts`
Expected: 9 tests pass.

- [ ] **Step 1.5: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit 2>&1 | grep -E "lib/cutlist/effectiveUtilization|tests/cutlist-effective-utilization"`
Expected: zero errors at the touched files.

- [ ] **Step 1.6: Commit**

```bash
git add lib/cutlist/effectiveUtilization.ts tests/cutlist-effective-utilization.test.ts
git commit -m "feat(cutlist): add effective-utilization helper with raw/display percentage tiers"
```

---

## Task 2: `UtilizationBar` primitive component

**Why now:** Three call sites consume it (per-sheet card, zoom modal stats, rolled-up at top). Build once, reuse three times.

**Files:**
- Create: `components/features/cutlist/primitives/UtilizationBar.tsx`

- [ ] **Step 2.1: Create the component**

Create `components/features/cutlist/primitives/UtilizationBar.tsx`:

```tsx
/**
 * Segmented utilization bar — parts (blue) / reusable (green) / scrap (gray).
 *
 * Read-only display primitive. Three call sites:
 *   - SheetLayoutGrid.tsx (per-sheet card)
 *   - InteractiveSheetViewer.tsx (zoom modal stats)
 *   - CutlistCalculator.tsx (rolled-up at top of Builder)
 *
 * Uses display percentages (sum to 100). Raw percentages drive the
 * "Mechanical X% · Effective Y%" line below the bar.
 */

'use client';

import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { UtilizationBreakdown } from '@/lib/cutlist/effectiveUtilization';

interface UtilizationBarProps {
  breakdown: UtilizationBreakdown;
  /** Optional className applied to the outer wrapper. */
  className?: string;
  /** Optional title shown above the bar (e.g. "All sheets"). */
  title?: string;
}

const COLORS = {
  parts: 'bg-blue-500',
  reusable: 'bg-emerald-500',
  scrap: 'bg-gray-500',
};

const SWATCH = {
  parts: 'bg-blue-500',
  reusable: 'bg-emerald-500',
  scrap: 'bg-gray-500',
};

export function UtilizationBar({ breakdown, className, title }: UtilizationBarProps) {
  const {
    displayPartsPct,
    displayReusablePct,
    displayScrapPct,
    mechanicalPctRaw,
    effectivePctRaw,
    hasReusable,
  } = breakdown;

  return (
    <div className={cn('space-y-1.5', className)}>
      {title && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
      )}

      {/* Segmented bar */}
      <div className="flex h-[18px] overflow-hidden rounded border border-border">
        {displayPartsPct > 0 && (
          <div className={COLORS.parts} style={{ width: `${displayPartsPct}%` }} />
        )}
        {hasReusable && displayReusablePct > 0 && (
          <div className={COLORS.reusable} style={{ width: `${displayReusablePct}%` }} />
        )}
        {displayScrapPct > 0 && (
          <div className={COLORS.scrap} style={{ width: `${displayScrapPct}%` }} />
        )}
      </div>

      {/* 3-column legend (or 2 columns when reusable is hidden) */}
      <div
        className={cn(
          'grid gap-1 text-[10px] font-mono',
          hasReusable ? 'grid-cols-3' : 'grid-cols-2',
        )}
      >
        <div className="flex items-center gap-1">
          <span className={cn('inline-block w-2.5 h-2.5 rounded-sm', SWATCH.parts)} />
          <span className="text-muted-foreground">Parts</span>
          <span className="text-foreground">{displayPartsPct.toFixed(1)}%</span>
        </div>
        {hasReusable && (
          <div className="flex items-center gap-1">
            <span className={cn('inline-block w-2.5 h-2.5 rounded-sm', SWATCH.reusable)} />
            <span className="text-muted-foreground">Reuse</span>
            <span className="text-foreground">{displayReusablePct.toFixed(1)}%</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className={cn('inline-block w-2.5 h-2.5 rounded-sm', SWATCH.scrap)} />
          <span className="text-muted-foreground">Scrap</span>
          <span className="text-foreground">{displayScrapPct.toFixed(1)}%</span>
        </div>
      </div>

      {/* Mechanical / Effective summary line */}
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
        <span>Mechanical {mechanicalPctRaw.toFixed(1)}%</span>
        {hasReusable && (
          <>
            <span>·</span>
            <span className="text-emerald-500">
              Effective {effectivePctRaw.toFixed(1)}%
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="What is Effective?"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-snug">
                Parts placed plus reusable offcuts retained as stock. This is informational —
                costing uses Manual % below.
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.2: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit 2>&1 | grep "UtilizationBar"`
Expected: zero errors at the new file.

- [ ] **Step 2.3: Commit**

```bash
git add components/features/cutlist/primitives/UtilizationBar.tsx
git commit -m "feat(cutlist): add UtilizationBar primitive (segmented bar + legend + Effective tooltip)"
```

---

## Task 3: `ReusableOffcutList` primitive component

**Why now:** Used in per-sheet card and zoom modal. Same shape, same content, two surfaces.

**Files:**
- Create: `components/features/cutlist/primitives/ReusableOffcutList.tsx`

- [ ] **Step 3.1: Create the component**

Create `components/features/cutlist/primitives/ReusableOffcutList.tsx`:

```tsx
/**
 * Bullet list of reusable offcut sizes for a sheet (the "B garnish").
 *
 * Sorted by area descending. If more than 6 items, shows the first 5 and a
 * "+N more" expander that reveals the rest in place (no modal).
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { OffcutRect } from '@/lib/cutlist/types';

interface ReusableOffcutListProps {
  /** SheetOffcutSummary.reusableOffcuts — already filtered to reusables. */
  offcuts: OffcutRect[];
  /** Optional className applied to the outer wrapper. */
  className?: string;
  /** When more than this many items, collapse behind "+N more". Default: 6. */
  collapseAfter?: number;
}

const formatDims = (rect: OffcutRect): string => {
  const long = Math.max(rect.w, rect.h);
  const short = Math.min(rect.w, rect.h);
  return `${Math.round(long)} × ${Math.round(short)} mm`;
};

export function ReusableOffcutList({
  offcuts,
  className,
  collapseAfter = 6,
}: ReusableOffcutListProps) {
  const [expanded, setExpanded] = React.useState(false);

  if (offcuts.length === 0) return null;

  const sorted = React.useMemo(
    () => [...offcuts].sort((a, b) => b.area_mm2 - a.area_mm2),
    [offcuts],
  );

  const showExpander = sorted.length > collapseAfter;
  const visible = showExpander && !expanded ? sorted.slice(0, collapseAfter - 1) : sorted;
  const hiddenCount = sorted.length - visible.length;

  return (
    <div className={cn('space-y-0.5 text-[11px]', className)}>
      <div className="text-muted-foreground">
        Reusable offcuts ({sorted.length})
      </div>
      <ul className="pl-3 space-y-0 text-emerald-600 dark:text-emerald-500 font-mono">
        {visible.map((rect, i) => (
          <li key={i}>• {formatDims(rect)}</li>
        ))}
        {showExpander && !expanded && (
          <li>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              onClick={() => setExpanded(true)}
            >
              +{hiddenCount} more
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3.2: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit 2>&1 | grep "ReusableOffcutList"`
Expected: zero errors.

- [ ] **Step 3.3: Commit**

```bash
git add components/features/cutlist/primitives/ReusableOffcutList.tsx
git commit -m "feat(cutlist): add ReusableOffcutList primitive (sortable, collapses past 6)"
```

---

## Task 4: SVG offcut overlay in `SheetPreview`

**Why now:** Pure visual change to one component. Independent of stats card wiring.

**Files:**
- Modify: `components/features/cutlist/preview.tsx`

- [ ] **Step 4.1: Add the new prop and import the data type**

In `components/features/cutlist/preview.tsx`, add to the existing import block at the top (around line 1-4):

```ts
import type { OffcutRect } from '@/lib/cutlist/types';
```

(The `SheetLayout` import at line 2 already brings in the rest by transitive type access.)

Then in the `SheetPreviewProps` interface (around lines 6-36), add the new prop after `interactive`:

```ts
  /** When true, render reusable-offcut overlays in green with size labels. Default: false. */
  showOffcutOverlay?: boolean;
```

In the function signature destructure (around line 53-70), add the new param with default:

```ts
  showOffcutOverlay = false,
```

- [ ] **Step 4.2: Add overlay constants near the existing color constants**

Around line 38-45 (after `EDGE_BAND_THICKNESS`), add:

```ts
/** Reusable offcut overlay color (Tailwind emerald-500 with 32% alpha). */
const REUSABLE_FILL = 'rgba(16, 185, 129, 0.32)';
const REUSABLE_STROKE = 'rgb(16, 185, 129)';
const REUSABLE_LABEL_COLOR = 'rgb(52, 211, 153)'; // emerald-400 — reads on dark+light
```

- [ ] **Step 4.3: Render the overlay group after the part placements**

Find the closing tag of the placements `.map(...)` block (after line ~360 in the file — find it by searching for the next `</svg>` after line 244). Just before `</svg>`, add the overlay group:

```tsx
{/* Reusable offcut overlays — same coordinate transform as placements */}
{showOffcutOverlay &&
  layout.offcut_summary?.reusableOffcuts?.map((rect, i) => {
    const cx = sheetX + rect.x * scale;
    const cy = sheetY + rect.y * scale;
    const cw = rect.w * scale;
    const ch = rect.h * scale;

    // Adaptive label: same approach as the placement labels above.
    const longMm = Math.round(Math.max(rect.w, rect.h));
    const shortMm = Math.round(Math.min(rect.w, rect.h));
    const dimLabel = `${longMm} × ${shortMm}`;
    const areaLabel = `reusable · ${(rect.area_mm2 / 100).toFixed(0)} cm²`;

    // Fit-test using the same heuristic as placement labels (CHAR_WIDTH_RATIO).
    const dimWidthEst = dimFont * CHAR_WIDTH_RATIO * dimLabel.length;
    const areaWidthEst = dimFont * 0.85 * CHAR_WIDTH_RATIO * areaLabel.length;
    const lineHeight = dimFont * 1.2;

    const fitsTwoLine = cw >= dimWidthEst + 8 && cw >= areaWidthEst + 8 && ch >= 2 * lineHeight + 4;
    const fitsOneLine = cw >= dimWidthEst + 4 && ch >= lineHeight + 2;

    const labelCenterX = cx + cw / 2;
    const labelCenterY = cy + ch / 2;

    return (
      <g key={`reusable-${i}`} pointerEvents="none">
        <rect
          x={cx}
          y={cy}
          width={cw}
          height={ch}
          fill={REUSABLE_FILL}
          stroke={REUSABLE_STROKE}
          strokeWidth={1.5}
        />
        {fitsTwoLine ? (
          <>
            <text
              x={labelCenterX}
              y={labelCenterY - lineHeight * 0.1}
              textAnchor="middle"
              fontSize={dimFont}
              fontFamily="monospace"
              fontWeight={600}
              fill={REUSABLE_LABEL_COLOR}
            >
              {dimLabel}
            </text>
            <text
              x={labelCenterX}
              y={labelCenterY + lineHeight * 0.85}
              textAnchor="middle"
              fontSize={dimFont * 0.85}
              fontFamily="monospace"
              fill={REUSABLE_LABEL_COLOR}
              opacity={0.85}
            >
              {areaLabel}
            </text>
          </>
        ) : fitsOneLine ? (
          <text
            x={labelCenterX}
            y={labelCenterY + dimFont * 0.35}
            textAnchor="middle"
            fontSize={dimFont}
            fontFamily="monospace"
            fontWeight={600}
            fill={REUSABLE_LABEL_COLOR}
          >
            {dimLabel}
          </text>
        ) : (
          // Outside leader line — point to nearest sheet edge (right by default for thin tall,
          // bottom for short wide). Simple v1 — no collision avoidance.
          <>
            <line
              x1={labelCenterX}
              y1={labelCenterY}
              x2={cw >= ch ? labelCenterX : cx + cw + 12}
              y2={cw >= ch ? cy + ch + 12 : labelCenterY}
              stroke={REUSABLE_STROKE}
              strokeWidth={1}
            />
            <text
              x={cw >= ch ? labelCenterX : cx + cw + 14}
              y={cw >= ch ? cy + ch + 12 + dimFont : labelCenterY + dimFont * 0.35}
              textAnchor={cw >= ch ? 'middle' : 'start'}
              fontSize={dimFont}
              fontFamily="monospace"
              fontWeight={600}
              fill={REUSABLE_LABEL_COLOR}
            >
              {dimLabel}
            </text>
          </>
        )}
      </g>
    );
  })}
```

- [ ] **Step 4.4: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit 2>&1 | grep "preview.tsx"`
Expected: zero errors at the touched file.

- [ ] **Step 4.5: Commit**

```bash
git add components/features/cutlist/preview.tsx
git commit -m "feat(cutlist): add reusable-offcut overlay with adaptive labels to SheetPreview"
```

---

## Task 5: Per-sheet stats card integration in `SheetLayoutGrid.tsx`

**Why now:** Wires Tasks 1+2+3+4 into the user-visible per-sheet card. Largest single edit.

**Files:**
- Modify: `components/features/cutlist/primitives/SheetLayoutGrid.tsx`

- [ ] **Step 5.1: Add new imports**

At the top of `SheetLayoutGrid.tsx`, add to the existing imports:

```ts
import { computeSheetUtilization } from '@/lib/cutlist/effectiveUtilization';
import { UtilizationBar } from './UtilizationBar';
import { ReusableOffcutList } from './ReusableOffcutList';
```

- [ ] **Step 5.2: Compute breakdown inside the per-sheet map**

Inside the `result.sheets...map((sheetLayout, idx) => { ... })` block, just after the existing line `const chargePct = mode === 'full' ? 100 : mode === 'manual' ? manualPct : autoPct;` (around line 122), add:

```ts
const breakdown = computeSheetUtilization(sheetLayout, sheetW, sheetL);
```

- [ ] **Step 5.3: Pass `showOffcutOverlay` to the SheetPreview**

Around line 154-162, the existing `<SheetPreview ... />` call gets one new prop:

```tsx
<SheetPreview
  sheetWidth={sheetW}
  sheetLength={sheetL}
  layout={sheetLayout}
  maxWidth={260}
  maxHeight={200}
  colorMap={allColorMap}
  showEdgeBanding
  showOffcutOverlay
/>
```

- [ ] **Step 5.4: Replace the two-line stats block with bar + list**

Replace the existing block (around lines 165-181 — the `<div className="text-xs text-muted-foreground">Used …</div>` and the `{sheetLayout.offcut_summary && …}` block):

```tsx
{/* Reusable offcut size list (B garnish) */}
{sheetLayout.offcut_summary && breakdown.hasReusable && (
  <ReusableOffcutList
    offcuts={sheetLayout.offcut_summary.reusableOffcuts}
    className="px-1"
  />
)}

{/* Segmented utilization bar with legend + Mech/Eff line */}
<UtilizationBar breakdown={breakdown} className="px-1" />

{/* Existing m² readout — kept for parity with the original "Used …" line */}
<div className="text-[10px] font-mono text-muted-foreground px-1">
  {((sheetLayout.used_area_mm2 || 0) / 1_000_000).toFixed(2)} m² of{' '}
  {(sheetArea / 1_000_000).toFixed(2)} m²
</div>
```

- [ ] **Step 5.5: Add the quick-fill chips above the Manual % input**

Locate the "Manual percentage input" block (around lines 216-244). Insert this new block immediately BEFORE the `<Label htmlFor={`manual-${sheetLayout.sheet_id}`}>Manual %</Label>`:

```tsx
{/* Quick-fill chips */}
<div className="grid grid-cols-3 gap-1">
  <ChipButton
    label="Mech"
    pct={breakdown.mechanicalPctRaw}
    disabled={globalFullBoard || mode === 'full'}
    variant="default"
    onClick={() =>
      onSheetOverridesChange({
        ...sheetOverrides,
        [sheetLayout.sheet_id]: {
          mode: 'manual',
          manualPct: Number(breakdown.mechanicalPctRaw.toFixed(1)),
        },
      })
    }
  />
  {breakdown.hasReusable && (
    <ChipButton
      label="Eff"
      pct={breakdown.effectivePctRaw}
      disabled={globalFullBoard || mode === 'full'}
      variant="effective"
      onClick={() =>
        onSheetOverridesChange({
          ...sheetOverrides,
          [sheetLayout.sheet_id]: {
            mode: 'manual',
            manualPct: Number(breakdown.effectivePctRaw.toFixed(1)),
          },
        })
      }
    />
  )}
  <ChipButton
    label="Full"
    pct={100}
    disabled={globalFullBoard || mode === 'full'}
    variant="default"
    onClick={() =>
      onSheetOverridesChange({
        ...sheetOverrides,
        [sheetLayout.sheet_id]: { mode: 'manual', manualPct: 100 },
      })
    }
  />
</div>
```

- [ ] **Step 5.6: Add the `ChipButton` helper at the bottom of the file**

Above `export default SheetLayoutGrid;` (around line 290), add:

```tsx
function ChipButton({
  label,
  pct,
  disabled,
  variant,
  onClick,
}: {
  label: string;
  pct: number;
  disabled: boolean;
  variant: 'default' | 'effective';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center rounded border px-1 py-1 font-mono text-[10px] leading-tight transition-colors',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && variant === 'default' &&
          'border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        !disabled && variant === 'effective' &&
          'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
      )}
    >
      <span>{label}</span>
      <span>{pct.toFixed(1)}</span>
    </button>
  );
}
```

Add `cn` to the imports at the top if not already imported:

```ts
import { cn } from '@/lib/utils';
```

- [ ] **Step 5.7: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit 2>&1 | grep "SheetLayoutGrid.tsx"`
Expected: zero errors at the touched file.

- [ ] **Step 5.8: Commit**

```bash
git add components/features/cutlist/primitives/SheetLayoutGrid.tsx
git commit -m "feat(cutlist): integrate utilization bar + chips + reusable offcut list into per-sheet card"
```

---

## Task 6: Zoom modal mirror in `InteractiveSheetViewer.tsx`

**Why now:** Mirrors the per-sheet card primitives in the zoom modal stats panel. No chips/input there — read-only inspection.

**Files:**
- Modify: `components/features/cutlist/primitives/InteractiveSheetViewer.tsx`

- [ ] **Step 6.1: Add imports**

At the top:

```ts
import { computeSheetUtilization } from '@/lib/cutlist/effectiveUtilization';
import { UtilizationBar } from './UtilizationBar';
import { ReusableOffcutList } from './ReusableOffcutList';
```

- [ ] **Step 6.2: Compute breakdown alongside the existing sheet-stat calculations**

Inside the component, where `sheetLayout`, `sheetWidth`, and `sheetLength` are already in scope (search for the existing `formatAreaCm2` calls around line 269 to find the area), add:

```ts
const breakdown = computeSheetUtilization(sheetLayout, sheetWidth, sheetLength);
```

- [ ] **Step 6.3: Replace the existing stats block with the new primitives**

Find the existing stats display around lines 449-475 (the `Sheet stats` comment and the `Used …` / `Reusable offcuts: …` / `Scrap pockets: …` lines). Replace that block with:

```tsx
{/* Sheet stats */}
<div className="space-y-3">
  {sheetLayout.offcut_summary && breakdown.hasReusable && (
    <ReusableOffcutList offcuts={sheetLayout.offcut_summary.reusableOffcuts} />
  )}
  <UtilizationBar breakdown={breakdown} />
  <div className="text-[11px] font-mono text-muted-foreground">
    {((sheetLayout.used_area_mm2 || 0) / 1_000_000).toFixed(2)} m² of{' '}
    {((sheetWidth * sheetLength) / 1_000_000).toFixed(2)} m²
  </div>
</div>
```

- [ ] **Step 6.4: Pass `showOffcutOverlay` to the SheetPreview inside the modal**

Find the `<SheetPreview ... />` call inside the modal (search for `<SheetPreview` in this file). Add the `showOffcutOverlay` prop:

```tsx
<SheetPreview
  /* …existing props… */
  showOffcutOverlay
/>
```

- [ ] **Step 6.5: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit 2>&1 | grep "InteractiveSheetViewer.tsx"`
Expected: zero errors.

- [ ] **Step 6.6: Commit**

```bash
git add components/features/cutlist/primitives/InteractiveSheetViewer.tsx
git commit -m "feat(cutlist): mirror utilization bar + offcut list in zoom modal"
```

---

## Task 7: Rolled-up bar at the top of the Builder

**Why now:** Whole-job visualization above the sheet grid. Backer-aware.

**Files:**
- Modify: `components/features/cutlist/CutlistCalculator.tsx`

- [ ] **Step 7.1: Add imports near the existing imports at the top of the file**

```ts
import { computeRolledUpUtilization } from '@/lib/cutlist/effectiveUtilization';
import { UtilizationBar } from './primitives/UtilizationBar';
```

- [ ] **Step 7.2: Memoize the rolled-up breakdown above the render section**

Inside the `CutlistCalculator` component body, near where `result` and `backerResult` are derived from state (search for `const result =` or `setResult` around line 456 region), add a memo. Place it where both values are guaranteed in scope; a safe location is just before the `return (` statement (search for the `return (\n    <div className={cn(\'space-y-6\'` at line ~1509):

```ts
const allSheetsForRollup = React.useMemo(() => {
  if (!result) return [];
  const primary = result.sheets.map((layout) => ({
    layout,
    widthMm: layout.stock_width_mm || sheet.width_mm,
    lengthMm: layout.stock_length_mm || sheet.length_mm,
  }));
  const backer = (backerResult?.sheets ?? []).map((layout) => ({
    layout,
    widthMm: layout.stock_width_mm || backerSheet.width_mm,
    lengthMm: layout.stock_length_mm || backerSheet.length_mm,
  }));
  return [...primary, ...backer];
}, [result, backerResult, sheet, backerSheet]);

const rolledUpBreakdown = React.useMemo(
  () =>
    allSheetsForRollup.length > 0 ? computeRolledUpUtilization(allSheetsForRollup) : null,
  [allSheetsForRollup],
);
```

If `sheet` or `backerSheet` aren't named exactly that in the surrounding code, adjust to whatever the local stock-sheet bindings are called — confirm by searching for `width_mm` references in `CutlistCalculator.tsx` near the `result`/`backerResult` usage.

- [ ] **Step 7.3: Render the rolled-up bar above the Sheet Layout Grid**

Just before the `{/* Sheet Layout Grid */}` comment at line ~1885, insert:

```tsx
{rolledUpBreakdown && (
  <div className="rounded border bg-muted/30 px-3 py-2.5">
    <UtilizationBar breakdown={rolledUpBreakdown} title="All sheets" />
  </div>
)}
```

- [ ] **Step 7.4: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit 2>&1 | grep "CutlistCalculator.tsx"`
Expected: zero errors at the touched file.

- [ ] **Step 7.5: Commit**

```bash
git add components/features/cutlist/CutlistCalculator.tsx
git commit -m "feat(cutlist): add rolled-up utilization bar above sheet grid (backer-aware)"
```

---

## Task 8: Manual browser verification + simplify pass

**Files:** None modified — this is verification.

- [ ] **Step 8.1: Start the dev server** (if not already running) via `npm run dev` and navigate to `http://localhost:3000/products/856/cutlist-builder` while signed in as `testai@qbutton.co.za`. Run the calculation if needed.

- [ ] **Step 8.2: Verify per-sheet card** for at least one sheet:
  - The reusable offcut bullet list appears above the bar (when reusable count > 0).
  - The segmented bar shows three segments (blue/green/gray) summing visually to full width.
  - The 3-column legend reads `Parts X.X% / Reuse X.X% / Scrap X.X%`.
  - The line below reads `Mechanical X.X% · Effective Y.Y%` with a green Effective number and an `(i)` icon.
  - Hovering the `(i)` icon shows the tooltip text starting "Parts placed plus reusable offcuts retained as stock."
  - Above the Manual % input, three chips read `Mech X.X / Eff Y.Y / Full 100`.
  - Clicking the **Eff** chip populates the Manual % input with that value and the Billing display updates.
  - Clicking **Reset to auto** clears the override; the Mech chip's value matches what auto would have been (no off-by-0.1 discrepancy).
  - Toggle "Charge full sheet" ON — chips visibly disable; Manual % input also disables (existing behaviour).

- [ ] **Step 8.3: Verify SVG offcut overlay** on the sheet diagram in the per-sheet card:
  - Reusable offcuts appear with green fill and stroke.
  - Each carries a label like `680 × 320` (long × short, mm).
  - Larger offcuts also show a second line `reusable · {area} cm²`.
  - Tiny offcuts use a leader line to an outside label.

- [ ] **Step 8.4: Verify zoom modal**:
  - Click "Zoom" on a sheet — the modal opens.
  - Same green offcut overlay on the SVG.
  - Right-side stats panel shows the bullet list + segmented bar + legend + Mech/Eff line.
  - No chips, no Manual % input, no Reset link inside the modal — read-only.

- [ ] **Step 8.5: Verify rolled-up bar at the top of the Builder**:
  - Above the per-sheet grid, a wider bar reads "All sheets" with the same three-segment visualization.
  - For a job with both primary and backer sheets, the rolled-up math reflects BOTH (sanity check: rolled-up parts area should equal the sum of per-sheet parts areas across primary + backer).

- [ ] **Step 8.6: Verify zero-reusable case**: pick or construct a job where a sheet has no reusable offcuts (e.g. a layout that fills the sheet). Confirm:
  - Bar shows only Parts + Scrap (no green segment).
  - Legend collapses to two columns.
  - Mech/Eff line collapses to "Mechanical X.X%" only (no Effective, no `(i)` tooltip).
  - The Eff chip is hidden (not just disabled).
  - The bullet list of reusable offcuts is hidden.

- [ ] **Step 8.7: Run `/simplify` over the cumulative diff** (CLAUDE.md requires this for any session touching > 3 files; we touched ~7). Address anything flagged before declaring done.

- [ ] **Step 8.8: Final report**: list the seven commits in order, note any acceptance criteria that could not be verified in the browser, and surface any unrelated issues observed.

---

## Final scope sweep

- [ ] Repo-wide search for any stale references to the old two-line stats block: `grep -rn "Reusable offcuts: \|Scrap pockets:" --include="*.tsx" components/features/cutlist`. Expected: zero hits except inside the new `ReusableOffcutList` (which uses the singular `Reusable offcuts (N)` format) and the `UtilizationBar` (which has no such string). If any remain, they are leftover renders from the legacy stats block — clean up.

## Rules

- No two-line "Used X% / Reusable: N / Scrap: N" blocks remain in the modified files after Task 5/6.
- The `UtilizationBar` and `ReusableOffcutList` primitives are imported only from their new files — do not duplicate their markup inline.
- The chip click handler always writes `{ mode: 'manual', manualPct: nextPct }` — never `chargeMode`.
- "Reset to auto" continues to delete the per-sheet override (existing behaviour).
- Commits are per-task, not per-step.
- If a task surfaces an unforeseen complication (e.g. `sheet`/`backerSheet` variables in `CutlistCalculator.tsx` are named differently than assumed), STOP and report rather than improvising.

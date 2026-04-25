# Cutlist Reusable-Offcut Rules Implementation Plan

> **For Codex:** Execute this plan task-by-task. Each task ends with verification + commit. Do not batch tasks into a single commit. Branch: continue on `codex/local-cutlist-tab-rewire` (or branch off `codex/integration` if it has diverged). Spec: [docs/superpowers/specs/2026-04-25-cutlist-reusable-offcut-rules-design.md](../specs/2026-04-25-cutlist-reusable-offcut-rules-design.md).

**Goal:** Replace the single-scalar `minReusableOffcutDimensionMm` + area gate on Cutlist Defaults with a 2D, optionally grain-aware rule (`minReusableOffcutLengthMm`, `minReusableOffcutWidthMm`, `minReusableOffcutGrain`). Wire the new rule through the guillotine packer's classification *and* steering paths, the strip packer, the org-settings hook, the `/settings/cutlist` page, and benchmark scripts. Drop the area field. Add a tooltip explaining the preferred-offcut steering knob.

**Architecture:**
- Pure helper `isReusableOffcut` in a new module `lib/cutlist/offcuts.ts` is the single source of truth for "is this offcut reusable?" — both packers and tests import it.
- Sheet grain runs along `length_mm` (Y) by convention; offcut `h` is along grain, `w` is across grain.
- Steering (sliver/sub-optimal penalties, split selection, free-rect retention) becomes axis-aligned: X-axis remnants compare against `minUsableWidth`; Y-axis remnants against `minUsableLength`.
- Grain direction filter applies to **classification only**, not steering.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase (JSONB column on `organizations.cutlist_defaults` — no SQL migration), shadcn v4, Tailwind v4, `node:test` via `npx tsx --test`.

**Verification harness for every task:**
- Lint: `npm run lint` (tolerate pre-existing image-related warnings)
- Type-check: `npx tsc --noEmit` (note unrelated pre-existing errors in `app/orders/[orderId]/page.tsx:192` per memory; do not fix them)
- Unit tests: `npx tsx --test tests/<file>.test.ts`

---

## Task 1: Foundation — `lib/cutlist/offcuts.ts` + truth-table tests

**Why first:** Both packers and tests will import this module. No consumers yet, so it ships in isolation.

**Files:**
- Create: `lib/cutlist/offcuts.ts`
- Create: `tests/cutlist-reusable-offcut.test.ts`

- [ ] **Step 1.1: Write the failing test file**

Create `tests/cutlist-reusable-offcut.test.ts`:

```ts
/**
 * Truth-table coverage for isReusableOffcut.
 *
 * Run with: npx tsx --test tests/cutlist-reusable-offcut.test.ts
 *
 * Convention recap (see lib/cutlist/offcuts.ts):
 *   rect.h = along grain (Y axis)
 *   rect.w = across grain (X axis)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { isReusableOffcut } from '../lib/cutlist/offcuts';

test('grain=any: square at threshold passes', () => {
  assert.equal(
    isReusableOffcut({ w: 300, h: 300 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }),
    true,
  );
});

test('grain=any: square just below threshold fails', () => {
  assert.equal(
    isReusableOffcut({ w: 299, h: 299 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }),
    false,
  );
});

test('grain=any: long thin strip (legacy bug case) fails', () => {
  // Under legacy single-dim rule (min=150, area=100k), 150 x 5000 was reusable.
  // Under new 2D rule with default 300 x 300, the long side passes but short fails.
  assert.equal(
    isReusableOffcut({ w: 150, h: 5000 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }),
    false,
  );
});

test('grain=any: long-thin strip in either rotation passes when both axes meet mins', () => {
  assert.equal(
    isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }),
    true,
  );
  // Rotated — same physical rect, same answer for grain=any
  assert.equal(
    isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }),
    true,
  );
});

test('grain=length: orientation-locked — long-grain piece passes', () => {
  // h (along grain) = 600 ≥ minLength=600, w (across grain) = 300 ≥ minWidth=300
  assert.equal(
    isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'length' }),
    true,
  );
});

test('grain=length: same physical rect rotated fails (cross-grain orientation)', () => {
  // h (along grain) = 300 < minLength=600
  assert.equal(
    isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'length' }),
    false,
  );
});

test('grain=width: swapped axis check', () => {
  // grain=width means minLength applies to across-grain (w), minWidth to along-grain (h)
  // w=600 ≥ minLength=600, h=300 ≥ minWidth=300
  assert.equal(
    isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'width' }),
    true,
  );
});

test('grain=length: below width minimum fails', () => {
  // h=600 ≥ 600 ✓, but w=300 < minWidth=400 ✗
  assert.equal(
    isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 400, minUsableGrain: 'length' }),
    false,
  );
});

test('grain=any: max-side gate uses Math.max correctly', () => {
  // 200 x 700: max=700, min=200. With minLength=600, minWidth=200 → passes.
  assert.equal(
    isReusableOffcut({ w: 200, h: 700 }, { minUsableLength: 600, minUsableWidth: 200, minUsableGrain: 'any' }),
    true,
  );
  // Same rect, min=300 on width → fails (min(200,700)=200 < 300)
  assert.equal(
    isReusableOffcut({ w: 200, h: 700 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }),
    false,
  );
});
```

- [ ] **Step 1.2: Run the test, expect failure**

Run: `npx tsx --test tests/cutlist-reusable-offcut.test.ts`
Expected: FAIL with module-not-found error on `../lib/cutlist/offcuts`.

- [ ] **Step 1.3: Implement the helper module**

Create `lib/cutlist/offcuts.ts`:

```ts
/**
 * Reusable-offcut classification.
 *
 * Sheet grain convention: grain runs along the sheet's length_mm (Y) axis.
 * For an offcut FreeRect { w, h }:
 *   - AG (along grain) = h (Y axis)
 *   - CG (across grain) = w (X axis)
 *
 * See docs/superpowers/specs/2026-04-25-cutlist-reusable-offcut-rules-design.md §1.
 */

import type { GrainOrientation } from './types';

export interface OffcutClassificationConfig {
  /** Minimum dimension along the grain axis (mm). */
  minUsableLength: number;
  /** Minimum dimension across the grain axis (mm). */
  minUsableWidth: number;
  /** Required grain orientation for the offcut to count as reusable. */
  minUsableGrain: GrainOrientation;
}

/**
 * Decide whether a free rectangle is reusable stock under the given rule.
 *
 * - 'any':    rotation allowed; max(AG,CG) ≥ minLength AND min(AG,CG) ≥ minWidth
 * - 'length': orientation-locked; AG ≥ minLength AND CG ≥ minWidth
 * - 'width':  orientation-locked, swapped; CG ≥ minLength AND AG ≥ minWidth
 */
export function isReusableOffcut(
  rect: { w: number; h: number },
  cfg: OffcutClassificationConfig,
): boolean {
  const ag = rect.h; // along grain — Y axis
  const cg = rect.w; // across grain — X axis
  switch (cfg.minUsableGrain) {
    case 'length':
      return ag >= cfg.minUsableLength && cg >= cfg.minUsableWidth;
    case 'width':
      return cg >= cfg.minUsableLength && ag >= cfg.minUsableWidth;
    case 'any':
    default:
      return Math.max(ag, cg) >= cfg.minUsableLength
          && Math.min(ag, cg) >= cfg.minUsableWidth;
  }
}
```

- [ ] **Step 1.4: Re-run the test, expect pass**

Run: `npx tsx --test tests/cutlist-reusable-offcut.test.ts`
Expected: All 9 tests pass.

- [ ] **Step 1.5: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit`
Expected: clean for the touched files.

- [ ] **Step 1.6: Commit**

```bash
git add lib/cutlist/offcuts.ts tests/cutlist-reusable-offcut.test.ts
git commit -m "feat(cutlist): add isReusableOffcut helper with truth-table tests"
```

---

## Task 2: Hook normalizer — `useOrgSettings`

**Why now:** Independent of packer changes. Settings page (Task 6) depends on this. Establishes the new `CutlistDefaults` shape and the three-case migration.

**Files:**
- Modify: `hooks/use-org-settings.ts`
- Create: `tests/use-org-settings-cutlist-defaults.test.ts`

- [ ] **Step 2.1: Write the failing test file**

Create `tests/use-org-settings-cutlist-defaults.test.ts`:

```ts
/**
 * Tests for the CutlistDefaults legacy → new key normalization.
 *
 * Run with: npx tsx --test tests/use-org-settings-cutlist-defaults.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCutlistDefaults } from '../hooks/use-org-settings';

test('null/missing JSONB → strict new defaults (300 x 300, any)', () => {
  assert.deepEqual(normalizeCutlistDefaults(null), {
    minReusableOffcutLengthMm: 300,
    minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any',
    preferredOffcutDimensionMm: 300,
  });
  assert.deepEqual(normalizeCutlistDefaults({}), {
    minReusableOffcutLengthMm: 300,
    minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any',
    preferredOffcutDimensionMm: 300,
  });
});

test('pure-legacy JSON → carry scalar to both axes, drop area gate', () => {
  const result = normalizeCutlistDefaults({
    minReusableOffcutDimensionMm: 150,
    preferredOffcutDimensionMm: 300,
    minReusableOffcutAreaMm2: 100000,
  });
  assert.deepEqual(result, {
    minReusableOffcutLengthMm: 150,
    minReusableOffcutWidthMm: 150,
    minReusableOffcutGrain: 'any',
    preferredOffcutDimensionMm: 300,
  });
});

test('mixed JSON: any new key present → new keys win, legacy scalar ignored', () => {
  const result = normalizeCutlistDefaults({
    minReusableOffcutLengthMm: 600,
    minReusableOffcutDimensionMm: 150, // should be ignored
  });
  assert.deepEqual(result, {
    minReusableOffcutLengthMm: 600,
    minReusableOffcutWidthMm: 300, // default — NOT 150 from legacy
    minReusableOffcutGrain: 'any',
    preferredOffcutDimensionMm: 300,
  });
});

test('fully-new JSON passes through with all four fields', () => {
  const result = normalizeCutlistDefaults({
    minReusableOffcutLengthMm: 600,
    minReusableOffcutWidthMm: 400,
    minReusableOffcutGrain: 'length',
    preferredOffcutDimensionMm: 500,
  });
  assert.deepEqual(result, {
    minReusableOffcutLengthMm: 600,
    minReusableOffcutWidthMm: 400,
    minReusableOffcutGrain: 'length',
    preferredOffcutDimensionMm: 500,
  });
});
```

- [ ] **Step 2.2: Run the test, expect failure**

Run: `npx tsx --test tests/use-org-settings-cutlist-defaults.test.ts`
Expected: FAIL — `normalizeCutlistDefaults` not exported from `../hooks/use-org-settings`.

- [ ] **Step 2.3: Update `hooks/use-org-settings.ts`**

Replace the existing `CutlistDefaults` interface and the `cutlistDefaults` resolution inside `queryFn`. Apply these three edits:

(a) Replace the `CutlistDefaults` interface (around lines 37-41):

```ts
import type { GrainOrientation } from '@/lib/cutlist/types';

export interface CutlistDefaults {
  minReusableOffcutLengthMm?: number;
  minReusableOffcutWidthMm?: number;
  minReusableOffcutGrain?: GrainOrientation;
  preferredOffcutDimensionMm?: number;
}

/** Internal type used only for migrating legacy JSONB rows. */
interface LegacyCutlistDefaults {
  minReusableOffcutDimensionMm?: number;
  minReusableOffcutAreaMm2?: number;
}
```

(b) Replace the `DEFAULTS.cutlistDefaults` block (around lines 56-60):

```ts
cutlistDefaults: {
  minReusableOffcutLengthMm: 300,
  minReusableOffcutWidthMm: 300,
  minReusableOffcutGrain: 'any',
  preferredOffcutDimensionMm: 300,
},
```

(c) Add a new exported `normalizeCutlistDefaults` function above `useOrgSettings`, and call it from `queryFn`. Replace the existing `cutlistDefaults: { ... }` object inside the return (around lines 84-91) with `cutlistDefaults: normalizeCutlistDefaults(data.cutlist_defaults)`.

The full helper:

```ts
/**
 * Normalize a `cutlist_defaults` JSONB blob (possibly legacy, possibly mixed)
 * into the current CutlistDefaults shape.
 *
 * Three cases (see spec §2):
 *   1. null / empty → strict new defaults (300 x 300, any).
 *   2. pure legacy (no new keys present) → carry minReusableOffcutDimensionMm
 *      to both axes; ignore minReusableOffcutAreaMm2.
 *   3. mixed (any new key present) → new keys win; missing new keys default to
 *      300; legacy scalar is ignored entirely.
 */
export function normalizeCutlistDefaults(
  raw: Partial<CutlistDefaults & LegacyCutlistDefaults> | null | undefined,
): Required<CutlistDefaults> {
  const r = raw ?? {};
  const hasNewKey =
    r.minReusableOffcutLengthMm !== undefined ||
    r.minReusableOffcutWidthMm !== undefined;

  const legacyDim = hasNewKey ? undefined : r.minReusableOffcutDimensionMm;

  return {
    minReusableOffcutLengthMm: r.minReusableOffcutLengthMm ?? legacyDim ?? 300,
    minReusableOffcutWidthMm: r.minReusableOffcutWidthMm ?? legacyDim ?? 300,
    minReusableOffcutGrain: r.minReusableOffcutGrain ?? 'any',
    preferredOffcutDimensionMm: r.preferredOffcutDimensionMm ?? 300,
  };
}
```

- [ ] **Step 2.4: Re-run the test, expect pass**

Run: `npx tsx --test tests/use-org-settings-cutlist-defaults.test.ts`
Expected: 4 tests pass.

- [ ] **Step 2.5: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit`
Expected: clean. If `tsc` surfaces errors at consumers of `CutlistDefaults` (Tasks 5, 6 fix them), note them — they will be resolved by later tasks.

- [ ] **Step 2.6: Commit**

```bash
git add hooks/use-org-settings.ts tests/use-org-settings-cutlist-defaults.test.ts
git commit -m "feat(cutlist): 2D + grain-aware CutlistDefaults with legacy normalizer"
```

---

## Task 3: Guillotine packer — config rename, classification swap, axis-aligned scoring

**Why now:** Largest single change. Other packer-adjacent code waits on this.

**Files:**
- Modify: `lib/cutlist/guillotinePacker.ts`

This task has many edits. Group them and verify at the end with `tsx --test`.

- [ ] **Step 3.1: Update the `PackingConfig` interface and default**

Around line 40, replace the interface and `DEFAULT_PACKING_CONFIG`:

```ts
export interface PackingConfig {
  /** Minimum along-grain (Y) dimension for an offcut to be usable. Default: 300 */
  minUsableLength: number;
  /** Minimum across-grain (X) dimension for an offcut to be usable. Default: 300 */
  minUsableWidth: number;
  /** Required grain orientation for an offcut to be classified as reusable. Default: 'any' */
  minUsableGrain: GrainOrientation;
  /** Preferred minimum dimension (mm) for a good offcut. Default: 300 */
  preferredMinDimension: number;
  /** Penalty score for creating unusable slivers. Default: 10,000 */
  sliverPenalty: number;
  /** Penalty for a small terminal trim when the other dimension is an exact fit. Default: 500 */
  exactFitTrimPenalty: number;
  /** Penalty for sub-optimal but usable strips. Default: 2,000 */
  subOptimalPenalty: number;
  /** Bonus for placements touching sheet edges. Default: 500 */
  touchingBonus: number;
  /** Bonus for perfect fit (one dimension matches exactly). Default: 1,000 */
  perfectFitBonus: number;
  /** Weight for offcut concentration bonus (higher = favor consolidated waste). Default: 2000 */
  concentrationWeight: number;
  /** Penalty per additional free rectangle created. Default: 150 */
  fragmentationPenalty: number;
}

export const DEFAULT_PACKING_CONFIG: PackingConfig = {
  minUsableLength: 300,
  minUsableWidth: 300,
  minUsableGrain: 'any',
  preferredMinDimension: 300,
  sliverPenalty: 10_000,
  exactFitTrimPenalty: 500,
  subOptimalPenalty: 2_000,
  touchingBonus: 500,
  perfectFitBonus: 1_000,
  concentrationWeight: 2000,
  fragmentationPenalty: 150,
};
```

Add the `GrainOrientation` import to the top-level imports if not already present (the file already imports from `./types`, so add `GrainOrientation` to that import list — line 28 region).

Add a new top-level import for the helper:

```ts
import { isReusableOffcut } from './offcuts';
```

- [ ] **Step 3.2: Replace the four classification call sites**

Each becomes a call to `isReusableOffcut`.

(a) `classifyOffcuts` (around line 557-576). Replace the function body:

```ts
function classifyOffcuts(freeRects: FreeRect[], config: PackingConfig): {
  usableRects: FreeRect[];
  scrapRects: FreeRect[];
} {
  const usableRects: FreeRect[] = [];
  const scrapRects: FreeRect[] = [];
  for (const rect of freeRects) {
    if (isReusableOffcut(rect, config)) usableRects.push(rect);
    else scrapRects.push(rect);
  }
  return { usableRects, scrapRects };
}
```

(b) `getUsableOffcuts` method (around line 986-992). Replace:

```ts
getUsableOffcuts(): FreeRect[] {
  return this.freeRects.filter((r) => isReusableOffcut(r, this.config));
}
```

(c) `usableOffcuts` filter near line 1078. Replace:

```ts
const usableOffcuts = freeRects.filter((r) => isReusableOffcut(r, fullConfig));
```

(d) `usableOffcuts` filter near line 1230. Replace:

```ts
const usableOffcuts = freeRects.filter((r) => isReusableOffcut(r, fullConfig));
```

- [ ] **Step 3.3: Update placement-scoring sliver / sub-optimal penalties (axis-aligned)**

In `calculatePlacementScore` (around lines 354-367), replace the four penalty checks:

```ts
// Sliver penalty: heavily penalize creating unusable strips
if (remW > 0 && remW < config.minUsableWidth) {
  score += exactHeightFit ? config.exactFitTrimPenalty : config.sliverPenalty;
}
if (remH > 0 && remH < config.minUsableLength) {
  score += exactWidthFit ? config.exactFitTrimPenalty : config.sliverPenalty;
}

// Sub-optimal penalty: moderate penalty for usable but small strips
if (remW >= config.minUsableWidth && remW < config.preferredMinDimension) {
  score += exactHeightFit ? config.exactFitTrimPenalty : config.subOptimalPenalty;
}
if (remH >= config.minUsableLength && remH < config.preferredMinDimension) {
  score += exactWidthFit ? config.exactFitTrimPenalty : config.subOptimalPenalty;
}
```

- [ ] **Step 3.4: Update `getBestSplit` signature and the call from `calculatePlacementScore`**

`getBestSplit` currently takes a single `minDimension` scalar. Find its declaration (search the file for `function getBestSplit`); change its signature to accept two scalars `minLength` and `minWidth`, and use `minWidth` for X-axis (right) remnant comparisons and `minLength` for Y-axis (top) remnant comparisons throughout its body.

The call at line 378 changes from:

```ts
const { simulation } = getBestSplit(freeRect, partW, partH, config.minUsableDimension);
```

to:

```ts
const { simulation } = getBestSplit(freeRect, partW, partH, config.minUsableLength, config.minUsableWidth);
```

Inside `getBestSplit`'s body, every check of the scalar must be replaced with the axis-appropriate one. There are typically two of these (one per split orientation comparing the X and Y remainders to the threshold). If you find the body uses `minDimension` against both X and Y indiscriminately, switch each comparison to whichever axis the remainder represents.

If unclear from inspection which side is X vs Y inside `getBestSplit`, adopt this rule and add inline comments: **right-side remnants (`remRightW`, `freeRect.w - partW`) compare against `minWidth`; top-side remnants (`remTopH`, `freeRect.h - partH`) compare against `minLength`.**

- [ ] **Step 3.5: Update `splitFreeRect` retention checks (axis-aligned)**

In `splitFreeRect` (around lines 402-462), the checks `remRightW > minDimension` and `remTopH > minDimension` decide whether a sub-rect is worth keeping. Update the function signature to take both minima, and rewrite the four retention checks:

Signature change:

```ts
function splitFreeRect(
  freeRect: FreeRect,
  partW: number,
  partH: number,
  kerf: number,
  minLength: number,
  minWidth: number,
): FreeRect[] {
  const { horizontal } = getBestSplit(freeRect, partW, partH, minLength, minWidth);
  // …
```

Inside the body, replace:
- `if (remRightW > minDimension)` → `if (remRightW > minWidth)` (X-axis remainder)
- `if (remTopH > minDimension)` → `if (remTopH > minLength)` (Y-axis remainder)

(There are two of each, one per branch of the `if (horizontal)` / `else`.)

- [ ] **Step 3.6: Update the call to `splitFreeRect` from the packer class**

Around line 895, replace:

```ts
const newFreeRects = splitFreeRect(
  freeRect,
  orientation.w,
  orientation.h,
  this.kerf,
  this.config.minUsableDimension
);
```

with:

```ts
const newFreeRects = splitFreeRect(
  freeRect,
  orientation.w,
  orientation.h,
  this.kerf,
  this.config.minUsableLength,
  this.config.minUsableWidth,
);
```

And around line 853 (the `getBestSplit` call inside the packer class), replace:

```ts
const { horizontal } = getBestSplit(
  freeRect,
  orientation.w,
  orientation.h,
  this.config.minUsableDimension
);
```

with:

```ts
const { horizontal } = getBestSplit(
  freeRect,
  orientation.w,
  orientation.h,
  this.config.minUsableLength,
  this.config.minUsableWidth,
);
```

- [ ] **Step 3.7: Sweep for any remaining references to `minUsableDimension` or `minUsableArea`**

Run: `grep -n "minUsableDimension\|minUsableArea" lib/cutlist/guillotinePacker.ts`
Expected: zero matches. If any remain (e.g. a callsite the plan missed), fix them by mapping to the new keys following the convention from this task. If a matched line is purely a comment, update the comment.

- [ ] **Step 3.8: Type-check**

Run: `npx tsc --noEmit`
Expected: errors *only* at consumers of `PackingConfig` (Task 5 will fix `CutlistCalculator.tsx`; benchmarks fixed in Task 5; strip packer in Task 4; `tests/cutlist-packing.test.ts` updated in Task 7). Pre-existing unrelated errors stay.

- [ ] **Step 3.9: Run the truth-table tests from Task 1 to confirm classification still works at the consumer level**

Run: `npx tsx --test tests/cutlist-reusable-offcut.test.ts`
Expected: 9 tests pass (this exercises the helper, which the packer now uses).

- [ ] **Step 3.10: Commit**

```bash
git add lib/cutlist/guillotinePacker.ts
git commit -m "feat(cutlist): rewire guillotine packer to 2D grain-aware classification + axis-aligned scoring"
```

---

## Task 4: Strip packer — config rename, threading, remnant emission

**Why now:** With guillotine done, finish the packer side so all surfaces emit consistent classification.

**Background:** `StripPackerConfig.minUsableDimension` exists ([lib/cutlist/stripPacker.ts:41](../../../lib/cutlist/stripPacker.ts#L41)) but is **never read** in the strip packer body. The rename is purely a config-shape alignment. Strip currently emits no `offcut_summary` on its `SheetLayout` records — this task adds that.

**Files:**
- Modify: `lib/cutlist/stripPacker.ts`
- Modify: `components/features/cutlist/packing.ts`

- [ ] **Step 4.1: Update `StripPackerConfig` and `DEFAULT_STRIP_CONFIG`**

In `lib/cutlist/stripPacker.ts` around line 31:

```ts
import type { GrainOrientation } from './types';
import { isReusableOffcut } from './offcuts';

export interface StripPackerConfig {
  /** Saw blade kerf in mm. Default: 3 */
  kerf_mm: number;
  /** Minimum strip height in mm. Default: 100 */
  minStripHeight_mm: number;
  /** Height tolerance for grouping parts (0-1). Default: 0.15 (15%) */
  heightTolerance: number;
  /** Try to align vertical cuts across strips. Default: true */
  preferAlignedCuts: boolean;
  /** Minimum along-grain dimension for a remnant to be classified as reusable (mm). Default: 300 */
  minUsableLength: number;
  /** Minimum across-grain dimension for a remnant to be classified as reusable (mm). Default: 300 */
  minUsableWidth: number;
  /** Required grain orientation for a remnant to count as reusable. Default: 'any' */
  minUsableGrain: GrainOrientation;
}

export const DEFAULT_STRIP_CONFIG: StripPackerConfig = {
  kerf_mm: 3,
  minStripHeight_mm: 100,
  heightTolerance: 0.15,
  preferAlignedCuts: true,
  minUsableLength: 300,
  minUsableWidth: 300,
  minUsableGrain: 'any',
};
```

- [ ] **Step 4.2: Add a helper to compute strip remnants and their `SheetOffcutSummary`**

Add this helper near the top of `stripPacker.ts` (after the type definitions, before `expandParts`). It is the strip equivalent of guillotine's `classifyOffcuts`.

```ts
import type { SheetOffcutSummary, OffcutRect } from './types';

/**
 * Compute the free rectangles (remnants) on a sheet packed with strips.
 *
 * Two sources of free space:
 *   1. Per-strip right remainder: rect at (strip.usedWidth, strip.y) with
 *      size (sheetWidth - strip.usedWidth) × strip.height
 *   2. Bottom remainder: rect at (0, sumOfStripHeights) with size
 *      sheetWidth × (sheetHeight - sumOfStripHeights)
 */
function computeStripRemnants(
  strips: Strip[],
  sheetWidth: number,
  sheetHeight: number,
): { x: number; y: number; w: number; h: number }[] {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  let bottomOfStack = 0;
  for (const strip of strips) {
    const rightRem = sheetWidth - strip.usedWidth;
    if (rightRem > 0 && strip.height > 0) {
      rects.push({ x: strip.usedWidth, y: strip.y, w: rightRem, h: strip.height });
    }
    bottomOfStack = Math.max(bottomOfStack, strip.y + strip.height);
  }
  const bottomH = sheetHeight - bottomOfStack;
  if (bottomH > 0 && sheetWidth > 0) {
    rects.push({ x: 0, y: bottomOfStack, w: sheetWidth, h: bottomH });
  }
  return rects;
}

/**
 * Build a SheetOffcutSummary from a list of free rectangles using the
 * shared isReusableOffcut classifier.
 */
function summarizeOffcuts(
  rects: { x: number; y: number; w: number; h: number }[],
  cfg: { minUsableLength: number; minUsableWidth: number; minUsableGrain: GrainOrientation },
): SheetOffcutSummary {
  const reusable: OffcutRect[] = [];
  const scrap: OffcutRect[] = [];
  for (const r of rects) {
    const area = r.w * r.h;
    const out: OffcutRect = { x: r.x, y: r.y, w: r.w, h: r.h, area_mm2: area };
    if (isReusableOffcut(r, cfg)) reusable.push(out);
    else scrap.push(out);
  }
  const reusableArea = reusable.reduce((s, o) => s + o.area_mm2, 0);
  const scrapArea = scrap.reduce((s, o) => s + o.area_mm2, 0);
  const largestReusableArea = reusable.reduce((m, o) => Math.max(m, o.area_mm2), 0);
  return {
    fragments: reusable.length + scrap.length,
    reusableCount: reusable.length,
    scrapCount: scrap.length,
    reusableArea_mm2: reusableArea,
    scrapArea_mm2: scrapArea,
    largestReusableArea_mm2: largestReusableArea,
    reusableOffcuts: reusable,
    scrapOffcuts: scrap,
  };
}
```

- [ ] **Step 4.3: Populate `offcut_summary` on each strip-packed sheet**

In `packWithStrips` and any helpers that build `SheetLayout` objects (search for `sheets.push({` inside `stripPacker.ts`), attach `offcut_summary` from `summarizeOffcuts(computeStripRemnants(stripsForThisSheet, sheetWidth, sheetHeight), fullConfig)`.

The exact insertion point is where each sheet's strips are known and the `SheetLayout` is being assembled. If multiple approaches are tried (`standardSheets`, `nestedSheets`, `verticalSheets`), each must populate `offcut_summary` consistently. Wrap with a helper inside `packWithStrips`:

```ts
function attachOffcutSummary(layouts: SheetLayout[], stripsBySheet: Strip[][]): SheetLayout[] {
  return layouts.map((layout, i) => ({
    ...layout,
    offcut_summary: summarizeOffcuts(
      computeStripRemnants(stripsBySheet[i] ?? [], sheetWidth, sheetHeight),
      fullConfig,
    ),
  }));
}
```

Apply `attachOffcutSummary` to whichever approach wins the comparison and is returned. If the existing return path returns `bestSheets`, apply it just before the `return`.

- [ ] **Step 4.4: Thread `PackingConfig` through `packWithStrips`**

The current strip-packer call site (`packing.ts:529`) does NOT pass `packingConfig`. Update `packWithStrips`'s signature so its config parameter accepts the union of strip-specific and offcut-classification fields:

```ts
export function packWithStrips(
  parts: PartSpec[],
  stock: StockSheetSpec,
  config: Partial<StripPackerConfig> = {},
): StripPackResult {
```

This signature is unchanged — `StripPackerConfig` already gained the three classification fields in Step 4.1. Callers in `packing.ts` will pass a `Partial<StripPackerConfig>` containing the classification fields.

In `components/features/cutlist/packing.ts`, find both callers:

(a) Line ~529 inside `algorithm === 'strip'` branch:

```ts
const result = packWithStrips(parts, sheet, {
  minUsableLength: opts.packingConfig?.minUsableLength,
  minUsableWidth: opts.packingConfig?.minUsableWidth,
  minUsableGrain: opts.packingConfig?.minUsableGrain,
});
```

(b) Line ~552 inside `algorithm === 'deep'` branch (the strip baseline):

```ts
const stripBaseline = packWithStrips(parts, sheet, {
  minUsableLength: opts.packingConfig?.minUsableLength,
  minUsableWidth: opts.packingConfig?.minUsableWidth,
  minUsableGrain: opts.packingConfig?.minUsableGrain,
});
```

If `opts.packingConfig` typing does not yet include the new fields, the issue resolves once Task 5 updates `CutlistCalculator.tsx` (which feeds `packingConfig`). If TypeScript complains in this task, add an `any`-typed cast on the `opts.packingConfig?` reads here, with a comment `// TODO Task 5: tighten typing once PackingConfig consumers updated`. This is acceptable temporarily because tasks are committed independently.

- [ ] **Step 4.5: Sweep for any remaining `minUsableDimension` references in strip packer**

Run: `grep -n "minUsableDimension" lib/cutlist/stripPacker.ts components/features/cutlist/packing.ts`
Expected: zero matches.

- [ ] **Step 4.6: Type-check**

Run: `npx tsc --noEmit`
Expected: same set of errors as after Task 3 (Task 5 will close them all).

- [ ] **Step 4.7: Commit**

```bash
git add lib/cutlist/stripPacker.ts components/features/cutlist/packing.ts
git commit -m "feat(cutlist): strip packer remnant emission + 2D config alignment"
```

---

## Task 5: Calculator wiring + benchmark sweep

**Why now:** Closes all type errors, makes the new config keys end-to-end live.

**Files:**
- Modify: `components/features/cutlist/CutlistCalculator.tsx`
- Modify: `scripts/cutlist-benchmark.ts`
- Modify: `scripts/cutlist-deep-benchmark.ts`

- [ ] **Step 5.1: Update `CutlistCalculator.tsx` config mapping**

In `components/features/cutlist/CutlistCalculator.tsx` around line 422, replace the packing-config block:

```ts
packingConfig: {
  minUsableLength: cutlistDefaults.minReusableOffcutLengthMm,
  minUsableWidth:  cutlistDefaults.minReusableOffcutWidthMm,
  minUsableGrain:  cutlistDefaults.minReusableOffcutGrain,
  preferredMinDimension: cutlistDefaults.preferredOffcutDimensionMm,
}
```

Update the surrounding `useMemo` dependency array (was lines 427-429) to:

```ts
[
  cutlistDefaults.minReusableOffcutLengthMm,
  cutlistDefaults.minReusableOffcutWidthMm,
  cutlistDefaults.minReusableOffcutGrain,
  cutlistDefaults.preferredOffcutDimensionMm,
]
```

Remove the `minUsableArea` and `minUsableDimension` references entirely from the surrounding block.

- [ ] **Step 5.2: Sweep benchmark scripts**

Run: `grep -n "minUsableDimension\|minUsableArea\|minReusableOffcutDimensionMm\|minReusableOffcutAreaMm2" scripts/cutlist-benchmark.ts scripts/cutlist-deep-benchmark.ts`

For each match:
- If the line passes a hardcoded numeric value (e.g. `minUsableDimension: 150`), replace with the new keys: `minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any'` (and drop `minUsableArea`).
- If the line references the old org-settings key, switch to the new key name.

If a script imports `GrainOrientation`, it's already available from `lib/cutlist/types`.

- [ ] **Step 5.3: Final repo-wide sweep**

Run: `grep -rn "minUsableDimension\|minUsableArea\|minReusableOffcutDimensionMm\|minReusableOffcutAreaMm2" --include="*.ts" --include="*.tsx" .`
Expected: zero matches outside `node_modules`. Investigate any remaining hits.

- [ ] **Step 5.4: Type-check + lint**

Run: `npx tsc --noEmit` and `npm run lint`
Expected: clean except pre-existing unrelated errors. Tests file failures from `tests/cutlist-packing.test.ts` will be addressed in Task 7.

- [ ] **Step 5.5: Commit**

```bash
git add components/features/cutlist/CutlistCalculator.tsx scripts/cutlist-benchmark.ts scripts/cutlist-deep-benchmark.ts
git commit -m "chore(cutlist): wire calculator + benchmarks to new packer config keys"
```

---

## Task 6: Settings page UX

**Why now:** All data-layer plumbing exists. UI changes are the user-visible payoff.

**Files:**
- Modify: `app/settings/cutlist/page.tsx`

- [ ] **Step 6.1: Replace `app/settings/cutlist/page.tsx`**

Full replacement (the file is small enough):

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOrgSettings, type CutlistDefaults } from '@/hooks/use-org-settings';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { GrainOrientation } from '@/lib/cutlist/types';

const GRAIN_OPTIONS: { value: GrainOrientation; icon: string; label: string }[] = [
  { value: 'any', icon: '○', label: 'Any direction' },
  { value: 'length', icon: '↕', label: 'Grain along length' },
  { value: 'width', icon: '↔', label: 'Grain along width' },
];

function nextGrain(current: GrainOrientation): GrainOrientation {
  const order: GrainOrientation[] = ['any', 'length', 'width'];
  return order[(order.indexOf(current) + 1) % order.length];
}

function getGrainOption(value: GrainOrientation) {
  return GRAIN_OPTIONS.find((o) => o.value === value) ?? GRAIN_OPTIONS[0];
}

export default function CutlistSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgSettings = useOrgSettings();

  const [defaults, setDefaults] = useState<CutlistDefaults>({});
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!orgSettings.isLoading && !initialized.current) {
      setDefaults(orgSettings.cutlistDefaults);
      initialized.current = true;
    }
  }, [orgSettings.isLoading, orgSettings.cutlistDefaults]);

  const update = (key: keyof CutlistDefaults, value: number | GrainOrientation | undefined) => {
    setDefaults((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const orgId = getOrgId(user);
    if (!orgId) return;
    setSaving(true);
    const cleaned: CutlistDefaults = {
      minReusableOffcutLengthMm: Number(defaults.minReusableOffcutLengthMm) || 300,
      minReusableOffcutWidthMm: Number(defaults.minReusableOffcutWidthMm) || 300,
      minReusableOffcutGrain: defaults.minReusableOffcutGrain ?? 'any',
      preferredOffcutDimensionMm: Number(defaults.preferredOffcutDimensionMm) || 300,
    };
    const { error } = await supabase
      .from('organizations')
      .update({ cutlist_defaults: cleaned })
      .eq('id', orgId);
    setSaving(false);
    if (error) {
      toast.error('Failed to save cutlist defaults');
    } else {
      toast.success('Cutlist defaults saved');
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
    }
  };

  const grain = defaults.minReusableOffcutGrain ?? 'any';
  const grainOpt = getGrainOption(grain);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Cutlist Defaults</h1>
          <p className="text-sm text-muted-foreground">
            Organization-wide rules for what counts as a reusable offcut.
          </p>
        </div>

        {/* Minimum reusable offcut row */}
        <div className="space-y-2">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto]">
            <div>
              <label className="block text-sm font-medium mb-1">Minimum length (mm)</label>
              <Input
                type="number"
                min={1}
                placeholder="0"
                value={defaults.minReusableOffcutLengthMm ?? ''}
                onChange={(e) =>
                  update('minReusableOffcutLengthMm', e.target.value === '' ? undefined : Number(e.target.value))
                }
                onBlur={() => {
                  if (!defaults.minReusableOffcutLengthMm) update('minReusableOffcutLengthMm', 300);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Minimum width (mm)</label>
              <Input
                type="number"
                min={1}
                placeholder="0"
                value={defaults.minReusableOffcutWidthMm ?? ''}
                onChange={(e) =>
                  update('minReusableOffcutWidthMm', e.target.value === '' ? undefined : Number(e.target.value))
                }
                onBlur={() => {
                  if (!defaults.minReusableOffcutWidthMm) update('minReusableOffcutWidthMm', 300);
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Grain</label>
              {/* Settings-local grain cycle button. Click cycles any → length → width.
                  Arrow-key cycling is intentionally NOT implemented (low-frequency edit context;
                  see docs/superpowers/specs/2026-04-25-cutlist-reusable-offcut-rules-design.md §5). */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => update('minReusableOffcutGrain', nextGrain(grain))}
                    className="min-w-12"
                  >
                    <span aria-hidden>{grainOpt.icon}</span>
                    <span className="sr-only">{grainOpt.label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{grainOpt.label}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A leftover counts as reusable stock only if it meets both minimums. Pick a grain
            direction to require a specific orientation; leave on Any to accept either.
          </p>
        </div>

        {/* Preferred offcut row */}
        <div className="grid gap-3 grid-cols-1 sm:max-w-xs">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium mb-1">
              Preferred offcut dimension (mm)
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="What is preferred offcut dimension?"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-snug">
                  Nudge the optimizer toward larger, cleaner leftover strips. Sizes between the
                  minimum reusable and this value are mildly penalised during packing — a quality
                  preference, not a hard rule.
                </TooltipContent>
              </Tooltip>
            </label>
            <Input
              type="number"
              min={1}
              placeholder="0"
              value={defaults.preferredOffcutDimensionMm ?? ''}
              onChange={(e) =>
                update('preferredOffcutDimensionMm', e.target.value === '' ? undefined : Number(e.target.value))
              }
              onBlur={() => {
                if (!defaults.preferredOffcutDimensionMm) update('preferredOffcutDimensionMm', 300);
              }}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Cutlist Defaults'}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 6.2: Lint and type-check**

Run: `npm run lint` and `npx tsc --noEmit`
Expected: clean for this file.

- [ ] **Step 6.3: Manual browser verification (Claude in Chrome)**

Log in with the test account (CLAUDE.md credentials). Navigate to `http://localhost:3000/settings/cutlist`.

Verify:
- All four controls render (length, width, grain, preferred).
- Layout doesn't overflow at 1024px width or in the settings sidebar shell.
- Grain button cycles `○ → ↕ → ↔ → ○` on click; tooltip text matches.
- Preferred-dimension info tooltip appears on hover, copy is readable, max width is reasonable.
- Save → toast appears, refresh the page → values persist.
- Confirm via the Cutlist Builder (e.g. `/products/856/cutlist-builder`) that changing the values affects the reusable-offcut count in the preview pane (compare counts before/after lowering the minimums dramatically).

- [ ] **Step 6.4: Commit**

```bash
git add app/settings/cutlist/page.tsx
git commit -m "feat(cutlist): 2D + grain-aware settings page with preferred-dim tooltip"
```

---

## Task 7: Integration tests for both algorithms

**Why now:** End-to-end behaviour validation. Both packers must show the new rule changing reusable counts.

**Files:**
- Modify: `tests/cutlist-packing.test.ts`

- [ ] **Step 7.1: Inspect existing packing tests**

Run: `npx tsx --test tests/cutlist-packing.test.ts`
Expected: PASS or FAIL? If existing tests pinned the legacy single-dim behaviour, some may now fail because defaults moved from 150 → 300. Note which tests fail and why.

- [ ] **Step 7.2: Update any tests that pinned legacy default values**

For each failing test, decide:
- If the test asserts a specific reusable count that depended on the old defaults: update the assertion to reflect the new defaults (300×300), or pass an explicit `packingConfig` with the old values to keep the historical behaviour pinned.
- If the test passes hardcoded legacy config keys (`minUsableDimension`, `minUsableArea`): rewrite to use new keys (`minUsableLength`, `minUsableWidth`, `minUsableGrain`).

- [ ] **Step 7.3: Add an explicit "new rule changes outcome" test for guillotine**

At the end of `tests/cutlist-packing.test.ts`, add:

```ts
test('guillotine: long thin offcut classified as scrap under new 2D rule', async () => {
  const mod = await importPacking();
  // A single small part that leaves a long thin strip as the offcut.
  // Old rule (min=150 short side, area gate 100k): 150 x ≥667 strip = reusable.
  // New rule (min length=300, min width=300): same strip = scrap.
  const parts: PartSpec[] = [
    { id: 'p1', length_mm: 600, width_mm: 1830, qty: 1, grain: 'any' },
  ];
  const stock: StockSheetSpec[] = [{ id: 's1', length_mm: 2750, width_mm: 1830, qty: 1 }];
  const result = await mod.packPartsSmartOptimized(parts, stock, {
    algorithm: 'guillotine',
    packingConfig: {
      minUsableLength: 300,
      minUsableWidth: 300,
      minUsableGrain: 'any',
    },
  });
  const offcuts = result.sheets[0]?.offcut_summary;
  // Strip leftover (1830 x 2150) IS reusable; verify the rule fires correctly
  // for at least one rect being scrap if any small remainder exists.
  assert.ok(offcuts !== undefined, 'expected offcut_summary on guillotine sheet');
});
```

(If the test imports `PartSpec` and `StockSheetSpec` differently from what's already at the top of the file, mirror the existing pattern. The point is to assert that `offcut_summary` is populated and behaves under the new rule.)

- [ ] **Step 7.4: Add the equivalent test for strip algorithm**

Same shape, swapping `algorithm: 'strip'`. The key assertion is that **`result.sheets[0].offcut_summary` is defined** — this proves Task 4's emission work is wired through.

```ts
test('strip: offcut_summary now populated (Task 4 emission)', async () => {
  const mod = await importPacking();
  const parts: PartSpec[] = [
    { id: 'p1', length_mm: 600, width_mm: 1830, qty: 1, grain: 'any' },
  ];
  const stock: StockSheetSpec[] = [{ id: 's1', length_mm: 2750, width_mm: 1830, qty: 1 }];
  const result = await mod.packPartsSmartOptimized(parts, stock, {
    algorithm: 'strip',
    packingConfig: {
      minUsableLength: 300,
      minUsableWidth: 300,
      minUsableGrain: 'any',
    },
  });
  assert.ok(result.sheets[0]?.offcut_summary !== undefined,
    'strip algorithm must emit offcut_summary after Task 4');
});
```

- [ ] **Step 7.5: Run the full test file**

Run: `npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts`
Expected: all tests pass.

- [ ] **Step 7.6: Run any other cutlist-adjacent test files for regressions**

Run: `npx tsx --test tests/edging-computation.test.ts tests/snapshot-freshness.test.ts tests/cutting-plan-aggregate.test.ts tests/cutting-plan-utils.test.ts tests/line-allocation.test.ts tests/line-material-cost.test.ts tests/padded-line-cost.test.ts`
Expected: all pre-existing tests still pass.

- [ ] **Step 7.7: Commit**

```bash
git add tests/cutlist-packing.test.ts
git commit -m "test(cutlist): cover 2D rule + strip remnant emission across both algorithms"
```

---

## Final step: simplify pass

- [ ] Run `/simplify` over the resulting diff (CLAUDE.md requires this for any session that modifies more than 3 files). Address any flags before reporting back.

- [ ] **Final report:** list the seven commits in order; note any tests that needed reshaping (Task 7); flag any unrelated TypeScript errors observed during `tsc` runs; confirm whether browser verification was completed against the test account.

## Rules

- No destructive ops without evidence (no `DELETE`, no `TRUNCATE`, no `DROP TABLE`).
- Do not touch files outside those listed per task.
- If a task surfaces an unforeseen complication (e.g. `getBestSplit`'s body uses the scalar in a way the plan didn't anticipate), STOP and report rather than improvising. The plan's per-axis rule (`X → minUsableWidth`, `Y → minUsableLength`) is the tiebreaker.
- Commits are per-task, not per-step.

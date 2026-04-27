# Cutlist Optimizer: Prefer Complete Layouts Implementation Plan

> **For Codex:** Execute this plan task-by-task. Each task ends with verification + commit. Do not batch tasks into a single commit. Branch off `codex/integration` (see Task 0). Spec context: discovered via the leg/top/modesty screenshot case where the guillotine and Deep optimizers chose a partial 2-piece layout because the leftover offcut was attractive, even though a complete 4-piece layout fit on the same sheet.

**Goal:** Make the cutlist optimizer rank "all parts placed" above offcut quality, so guillotine and Deep (SA) modes never choose a partial layout when a complete layout exists. Today the scoring functions in `lib/cutlist/guillotinePacker.ts` and `lib/cutlist/saOptimizer.ts` ignore `result.unplaced` entirely, and the Deep-mode strip-fallback safety net in `components/features/cutlist/packing.ts` only fires on sheet count, not on completeness.

**Architecture:**
- Introduce one shared helper `countUnplacedPieces(result)` in `lib/cutlist/guillotinePacker.ts` that sums the per-entry `count` field — `unplaced.length` is wrong because unplaced parts are grouped by `partId`.
- Add a dominant `-unplacedCount × <large>` term at the top of both score functions (`calculateResultScore` in guillotinePacker.ts, `calculateResultScoreV2` in saOptimizer.ts). The penalty must be larger than any combination of sheet/offcut terms so completeness always wins.
- Tighten the post-SA strip-fallback in packing.ts: fall back to strip when strip places strictly more pieces than SA, regardless of sheet count. Preserve the existing "fewer sheets" rule as a secondary trigger.
- Keep offcut-quality ranking among layouts with the *same* unplaced count.

**Tech Stack:** TypeScript, Next.js App Router, `node:test` via `npx tsx --test`. No DB, no UI work, no React changes.

**Verification harness for every task:**
- Lint: `npm run lint` (tolerate pre-existing image-related warnings)
- Type-check: `npx tsc --noEmit` (note unrelated pre-existing errors elsewhere — do not fix)
- Targeted unit tests: `npx tsx --test tests/<file>.test.ts`
- Full cutlist test suite at the end: `npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-result-scoring.test.ts`

---

## Task 0: Branch setup

**Files:** none (git only).

- [ ] **Step 0.1: Confirm clean working tree**

```bash
git status --short
```

Expected: empty output. If anything is dirty, stop and surface to the user — do not proceed.

- [ ] **Step 0.2: Refresh `codex/integration`**

```bash
git fetch origin
git checkout codex/integration
git pull --ff-only origin codex/integration
```

- [ ] **Step 0.3: Create the task branch**

```bash
git checkout -b codex/local-cutlist-complete-placement-scoring
```

No commit yet.

---

## Task 1: Add `countUnplacedPieces` helper + direct test

**Why first:** Both score functions and the strip-fallback need this. Ship it in isolation with its own test.

**Files:**
- Modify: `lib/cutlist/guillotinePacker.ts` (add export near `calculateResultScore`)
- Create: `tests/cutlist-result-scoring.test.ts`

- [ ] **Step 1.1: Write the failing test file**

Create `tests/cutlist-result-scoring.test.ts`:

```ts
/**
 * Direct unit tests for cutlist scoring helpers.
 *
 * Run with: npx tsx --test tests/cutlist-result-scoring.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const importGuillotine = async () => {
  const mod = await import('../lib/cutlist/guillotinePacker.js');
  return mod;
};

test('countUnplacedPieces returns 0 when unplaced is undefined', async () => {
  const { countUnplacedPieces } = await importGuillotine();
  assert.equal(countUnplacedPieces({ unplaced: undefined } as any), 0);
});

test('countUnplacedPieces returns 0 when unplaced is an empty array', async () => {
  const { countUnplacedPieces } = await importGuillotine();
  assert.equal(countUnplacedPieces({ unplaced: [] } as any), 0);
});

test('countUnplacedPieces sums the count field across grouped entries', async () => {
  const { countUnplacedPieces } = await importGuillotine();
  const result = {
    unplaced: [
      { part: { id: 'leg' }, count: 2, reason: 'insufficient_sheet_capacity' },
      { part: { id: 'modesty' }, count: 1, reason: 'insufficient_sheet_capacity' },
    ],
  };
  // 3 missing pieces total — NOT 2 (array length)
  assert.equal(countUnplacedPieces(result as any), 3);
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

```bash
npx tsx --test tests/cutlist-result-scoring.test.ts
```

Expected: FAIL — `countUnplacedPieces is not a function` or similar import error.

- [ ] **Step 1.3: Implement and export the helper**

In `lib/cutlist/guillotinePacker.ts`, immediately above the existing `calculateResultScore` function (currently at line 1322), add:

```ts
/**
 * Total number of unplaced pieces across all unplaced entries.
 *
 * Unplaced entries are grouped by part id — each entry carries a `count`,
 * so two missing legs from the same part collapse into one entry with
 * count=2. Use this helper instead of `result.unplaced?.length`.
 */
export function countUnplacedPieces(
  result: Pick<GuillotinePackResult, 'unplaced'>
): number {
  if (!result.unplaced || result.unplaced.length === 0) return 0;
  let total = 0;
  for (const entry of result.unplaced) {
    total += entry.count;
  }
  return total;
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

```bash
npx tsx --test tests/cutlist-result-scoring.test.ts
```

Expected: PASS, 3/3 tests.

- [ ] **Step 1.5: Commit**

```bash
git add lib/cutlist/guillotinePacker.ts tests/cutlist-result-scoring.test.ts
git commit -m "feat(cutlist): add countUnplacedPieces helper for layout completeness checks"
```

---

## Task 2: Make `calculateResultScore` rank complete layouts above partial layouts

**Files:**
- Modify: `lib/cutlist/guillotinePacker.ts` (function `calculateResultScore`, currently at line 1322)
- Modify: `tests/cutlist-result-scoring.test.ts` (append new tests)

- [ ] **Step 2.1: Append the failing scoring tests**

Append to `tests/cutlist-result-scoring.test.ts`:

```ts
test('calculateResultScore: complete layout beats partial with better offcut', async () => {
  const { calculateResultScore } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  // Partial layout — 2 unplaced pieces, but a huge contiguous offcut
  const partial = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: [{ part: { id: 'leg' }, count: 2, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  // Complete layout — 0 unplaced, but a fragmented offcut
  const complete = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.10 * sheetArea,
    offcutConcentration: 0.3,
    fragmentCount: 6,
  } as any;

  assert.ok(
    calculateResultScore(complete, sheetArea) > calculateResultScore(partial, sheetArea),
    'Complete layout must outrank partial layout regardless of offcut quality',
  );
});

test('calculateResultScore: among complete layouts, larger offcut still wins', async () => {
  const { calculateResultScore } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  const big = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const small = { ...big, largestOffcutArea: 0.10 * sheetArea, offcutConcentration: 0.3, fragmentCount: 6 };

  assert.ok(
    calculateResultScore(big, sheetArea) > calculateResultScore(small, sheetArea),
    'Among complete layouts, larger contiguous offcut must still win',
  );
});

test('calculateResultScore: fewer unplaced beats more unplaced even with worse offcut', async () => {
  const { calculateResultScore } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  const oneMissing = {
    sheets: [{ placements: [] }],
    stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: [{ part: { id: 'a' }, count: 1, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0.10 * sheetArea,
    offcutConcentration: 0.3,
    fragmentCount: 6,
  } as any;

  const threeMissing = {
    ...oneMissing,
    unplaced: [{ part: { id: 'a' }, count: 3, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  };

  assert.ok(
    calculateResultScore(oneMissing, sheetArea) > calculateResultScore(threeMissing, sheetArea),
    'A layout missing 1 piece must outrank a layout missing 3 pieces',
  );
});
```

- [ ] **Step 2.2: Run the new tests to verify they fail**

```bash
npx tsx --test tests/cutlist-result-scoring.test.ts
```

Expected: 3 of the new tests FAIL (the 3 helper tests still pass). Failure messages should mention scoring inversion.

- [ ] **Step 2.3: Patch `calculateResultScore`**

In `lib/cutlist/guillotinePacker.ts`, replace the entire body of `calculateResultScore` (currently at line 1322) with:

```ts
export function calculateResultScore(result: GuillotinePackResult, sheetArea: number): number {
  const totalSheetArea = result.sheets.length * sheetArea;
  const usedArea = result.stats.used_area_mm2;

  // Calculate utilization percentage (0-100)
  const utilizationPct = totalSheetArea > 0 ? (usedArea / totalSheetArea) * 100 : 0;

  // Calculate offcut quality score (normalized 0-100)
  // Larger single offcut relative to sheet area is better
  const offcutQualityPct = (result.largestOffcutArea / sheetArea) * 100;

  // Offcut concentration: 1.0 = all waste in one piece (ideal), 0 = fragmented
  const concentrationBonus = result.offcutConcentration * 100;

  // Fewer fragmented offcuts is better (penalty for fragmentation)
  const fragmentationPenalty = result.fragmentCount * 5;

  // Completeness gate — a layout that leaves parts unplaced must rank below
  // any layout with fewer unplaced pieces, regardless of offcut quality or
  // sheet count. The penalty (1,000,000 per piece) is chosen to dominate
  // the sheet term (10,000 per sheet) by two orders of magnitude.
  const unplacedCount = countUnplacedPieces(result);
  const completenessPenalty = unplacedCount * 1_000_000;

  return (
    -completenessPenalty + // Tier 1: completeness (mandatory)
    -result.sheets.length * 10_000 + // Tier 2: fewer sheets
    utilizationPct + // Tier 3: higher utilization
    offcutQualityPct + // Tier 4: larger offcuts
    concentrationBonus - // Tier 5: consolidated waste
    fragmentationPenalty // Tier 6: fragmentation penalty
  );
}
```

Also update the JSDoc block immediately above the function (lines 1312–1321) to read:

```ts
/**
 * Calculate a score for a packing result.
 * Higher score = better result.
 *
 * Scoring hierarchy (in order of importance):
 * 1. Completeness — every unplaced piece is a 1,000,000 penalty (dominates everything)
 * 2. Fewer sheets — 10,000 penalty per sheet
 * 3. Higher utilization
 * 4. Quality of offcuts (larger, fewer offcuts are better)
 * 5. Offcut concentration (prefer waste in one contiguous piece)
 * 6. Fragmentation penalty
 */
```

- [ ] **Step 2.4: Run all scoring tests to verify they pass**

```bash
npx tsx --test tests/cutlist-result-scoring.test.ts
```

Expected: PASS, 6/6 tests.

- [ ] **Step 2.5: Run the existing cutlist suite to confirm no regression**

```bash
npx tsx --test tests/cutlist-packing.test.ts
```

Expected: PASS for every existing test.

- [ ] **Step 2.6: Commit**

```bash
git add lib/cutlist/guillotinePacker.ts tests/cutlist-result-scoring.test.ts
git commit -m "fix(cutlist): rank complete guillotine layouts above partials with better offcuts"
```

---

## Task 3: Apply the same completeness gate to SA scoring (`calculateResultScoreV2`)

**Why:** The Deep optimizer's main scorer lives in `saOptimizer.ts` and also ignores `unplaced`. Without this, SA can drift back to a partial layout during search even when seeded from a complete baseline.

**Files:**
- Modify: `lib/cutlist/saOptimizer.ts` (function `calculateResultScoreV2`, currently at line 84)
- Modify: `tests/cutlist-result-scoring.test.ts` (append new tests)

- [ ] **Step 3.1: Append the failing SA-scoring tests**

Append to `tests/cutlist-result-scoring.test.ts`:

```ts
const importSAOptimizer = async () => {
  const mod = await import('../lib/cutlist/saOptimizer.js');
  return mod;
};

test('calculateResultScoreV2: complete layout beats partial with better offcut', async () => {
  const { calculateResultScoreV2 } = await importSAOptimizer();
  const sheetArea = 2730 * 1830;

  const partial = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: [{ part: { id: 'leg' }, count: 2, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const complete = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.10 * sheetArea,
    offcutConcentration: 0.3,
    fragmentCount: 6,
  } as any;

  assert.ok(
    calculateResultScoreV2(complete, sheetArea) > calculateResultScoreV2(partial, sheetArea),
    'V2: complete layout must outrank partial layout regardless of offcut quality',
  );
});

test('calculateResultScoreV2: among complete layouts, larger offcut still wins (V2 weighting preserved)', async () => {
  const { calculateResultScoreV2 } = await importSAOptimizer();
  const sheetArea = 2730 * 1830;

  const big = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const small = { ...big, largestOffcutArea: 0.10 * sheetArea, offcutConcentration: 0.3, fragmentCount: 6 };

  assert.ok(
    calculateResultScoreV2(big, sheetArea) > calculateResultScoreV2(small, sheetArea),
    'V2: among complete layouts, larger offcut must still win — V2 offcut weighting preserved',
  );
});
```

- [ ] **Step 3.2: Run the new tests to verify they fail**

```bash
npx tsx --test tests/cutlist-result-scoring.test.ts
```

Expected: the two new V2 tests FAIL. Existing tests still pass.

- [ ] **Step 3.3: Patch `calculateResultScoreV2`**

In `lib/cutlist/saOptimizer.ts`, locate the existing import block at the top of the file. Add `countUnplacedPieces` to the import from `./guillotinePacker`. If the existing import looks like `import type { GuillotinePackResult, ExpandedPartInstance } from './guillotinePacker';`, change it to two imports:

```ts
import type { GuillotinePackResult, ExpandedPartInstance } from './guillotinePacker';
import { countUnplacedPieces } from './guillotinePacker';
```

(If the existing import is already a value import, just append `countUnplacedPieces` to the named import list.)

Then replace the `return` statement of `calculateResultScoreV2` (currently at lines 124–131) with:

```ts
  // Completeness gate — dominates the V2 sheet term (-100,000 per sheet) by
  // two orders of magnitude, so any complete layout beats any partial one
  // regardless of offcut quality, concentration, or compactness.
  const unplacedCount = countUnplacedPieces(result);
  const completenessPenalty = unplacedCount * 10_000_000;

  return (
    -completenessPenalty +                // Tier 0: completeness (mandatory)
    -result.sheets.length * 100_000 +     // Tier 1: fewer sheets
    offcutQualityPct * 500 +              // Tier 2: largest offcut (heavy weight)
    concentration * 300 +                 // Tier 3: consolidated waste
    -compactnessPenalty * 50 +            // Tier 4: compactness
    utilizationPct * 1 -                  // Tier 5: efficiency (weak)
    fragments * 20                        // Tier 6: fragmentation penalty
  );
```

Also update the JSDoc above `calculateResultScoreV2` (lines 71–83) to add a Tier 0 line:

```ts
 * Score hierarchy:
 *   Tier 0: Completeness (-10,000,000 per unplaced piece) — dominates everything
 *   Tier 1: Sheet count (-100,000 per sheet) — unambiguous
 *   Tier 2: Offcut quality (×500) — user's #1 priority among complete layouts
 *   Tier 3: Waste concentration (×300) — consolidated waste
 *   Tier 4: Compactness (×50) — prefer parts packed in corner, not spread out
 *   Tier 5: Utilization (×1) — implied by sheet count
 *   Tier 6: Fragmentation penalty (×20) — fewer fragments better
```

- [ ] **Step 3.4: Run scoring tests to verify they pass**

```bash
npx tsx --test tests/cutlist-result-scoring.test.ts
```

Expected: PASS, 8/8 tests.

- [ ] **Step 3.5: Run the existing cutlist suite to confirm no regression**

```bash
npx tsx --test tests/cutlist-packing.test.ts
```

Expected: PASS for every existing test.

- [ ] **Step 3.6: Commit**

```bash
git add lib/cutlist/saOptimizer.ts tests/cutlist-result-scoring.test.ts
git commit -m "fix(cutlist): add completeness gate to SA V2 scorer so Deep mode never picks partial layouts"
```

---

## Task 4: Tighten Deep-mode strip fallback to compare on completeness, not just sheet count

**Why:** Even with the scorers fixed, defence-in-depth — the orchestrator's existing safety net at [components/features/cutlist/packing.ts:643–653](../../components/features/cutlist/packing.ts) only fires on sheet count. If SA somehow returns a partial result with the same sheet count as a complete strip baseline, SA still wins. Make completeness the dominant trigger.

**Files:**
- Modify: `components/features/cutlist/packing.ts` (lines around 643–659 — the post-SA fallback block)
- Modify: `tests/cutlist-packing.test.ts` (append a regression test)

- [ ] **Step 4.1: Append the failing fallback test**

Append at the end of `tests/cutlist-packing.test.ts`:

```ts
test('Deep mode falls back to strip when SA leaves parts unplaced and strip places them all', async () => {
  // Screenshot case: 1 Top + 1 Modesty + 2 Legs on one 2730 × 1830 sheet, kerf 3.
  // The full set fits — strip packs all 4 pieces. Even if SA returns a 2-piece
  // partial layout with a larger offcut, the orchestrator must reject it.
  const { packPartsSmartOptimized } = await importPacking();

  const stock: StockSheetSpec = {
    id: 'sheet',
    length_mm: 2730,
    width_mm: 1830,
    qty: 1,
    kerf_mm: 3,
  };

  const parts: PartSpec[] = [
    { id: 'top',     length_mm: 1200, width_mm: 750, qty: 1, grain: 'length' },
    { id: 'modesty', length_mm: 1118, width_mm: 350, qty: 1, grain: 'length' },
    { id: 'leg',     length_mm: 700,  width_mm: 700, qty: 2, grain: 'length' },
  ];

  const result = await packPartsSmartOptimized(parts, [stock], {
    algorithm: 'deep',
    timeBudgetMs: 250,
  }) as LayoutResult & { algorithm: string; strategyUsed: string };

  assert.equal(result.algorithm, 'deep', 'Should run the deep optimizer path');
  assert.equal(result.unplaced, undefined, 'Deep mode must place every part when a complete layout exists');
  assert.equal(result.sheets.length, 1, 'All 4 pieces fit on one 2730 × 1830 sheet');
  assert.equal(
    result.sheets[0].placements.length,
    4,
    'All 4 pieces (top + modesty + 2 legs) must be placed on the single sheet',
  );
});

test('Guillotine mode places all 4 pieces for the leg/top/modesty case instead of choosing a 2-piece partial', async () => {
  const { packPartsSmartOptimized } = await importPacking();

  const stock: StockSheetSpec = {
    id: 'sheet',
    length_mm: 2730,
    width_mm: 1830,
    qty: 1,
    kerf_mm: 3,
  };

  const parts: PartSpec[] = [
    { id: 'top',     length_mm: 1200, width_mm: 750, qty: 1, grain: 'length' },
    { id: 'modesty', length_mm: 1118, width_mm: 350, qty: 1, grain: 'length' },
    { id: 'leg',     length_mm: 700,  width_mm: 700, qty: 2, grain: 'length' },
  ];

  const result = await packPartsSmartOptimized(parts, [stock], {
    algorithm: 'guillotine',
  }) as LayoutResult & { algorithm: string; strategyUsed: string };

  assert.equal(result.algorithm, 'guillotine', 'Should run the guillotine path');
  assert.equal(result.unplaced, undefined, 'Guillotine must not leave parts unplaced when a complete layout exists');
  assert.equal(result.sheets.length, 1, 'All 4 pieces fit on one 2730 × 1830 sheet');
  assert.equal(
    result.sheets[0].placements.length,
    4,
    'All 4 pieces (top + modesty + 2 legs) must be placed on the single sheet',
  );
});
```

- [ ] **Step 4.2: Run the new tests to verify they fail (or pass via Tasks 2 & 3 alone)**

```bash
npx tsx --test tests/cutlist-packing.test.ts
```

Both new tests should currently PASS thanks to Tasks 2 and 3, BUT the orchestrator-level guard is still missing. We add it as a belt-and-braces safety net so any future regression in either scorer can't reintroduce the bug. Proceed regardless.

- [ ] **Step 4.3: Patch the strip-fallback block in `packing.ts`**

In `components/features/cutlist/packing.ts`, locate the block currently at lines 643–659 that begins with the comment `// Post-run safety net:`. Replace the entire block (from the comment through the closing `}` of the deep branch's final `return`) with:

```ts
    // Post-run safety net: prefer the strip baseline when it is strictly
    // more complete than SA's output, OR when both layouts place every
    // part but strip uses fewer sheets. SA is allowed to win on offcut
    // quality only among layouts with the same unplaced count + sheet
    // count, since scoreLayoutResult below has no offcut terms.
    const stripUnplaced = countUnplacedLayoutPieces(stripBaseline);
    const saUnplaced = countUnplacedLayoutPieces(saLayout);

    const stripIsMoreComplete = stripUnplaced < saUnplaced;
    const stripUsesFewerSheets =
      stripUnplaced === saUnplaced &&
      stripBaseline.sheets.length < saLayout.sheets.length;

    if (stripIsMoreComplete || stripUsesFewerSheets) {
      return {
        ...stripBaseline,
        strategyUsed: `strip-fallback (SA tried ${saLayout.strategyUsed})`,
        algorithm: 'deep',
      };
    }

    return {
      ...saLayout,
      strategyUsed: saLayout.strategyUsed,
      algorithm: 'deep',
    };
  }
```

Then, immediately above the existing `function scoreLayoutResult(...)` declaration (currently at line 702), add:

```ts
/**
 * Total unplaced pieces in a LayoutResult — same semantics as
 * countUnplacedPieces in guillotinePacker.ts but typed for LayoutResult.
 * Sums the per-entry `count`; `unplaced.length` is wrong because entries
 * are grouped by part id.
 */
function countUnplacedLayoutPieces(result: LayoutResult): number {
  if (!result.unplaced || result.unplaced.length === 0) return 0;
  let total = 0;
  for (const entry of result.unplaced) {
    total += entry.count;
  }
  return total;
}
```

- [ ] **Step 4.4: Run the full cutlist suite**

```bash
npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-result-scoring.test.ts
```

Expected: PASS for every test. The two new screenshot-case tests pass. Existing tests (including `'deep SA mode keeps the 600mm rip-column layout when the guillotine baseline is already optimal'` at line 701 of `cutlist-packing.test.ts`) still pass.

- [ ] **Step 4.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors introduced by this task. Pre-existing unrelated errors are fine — note them but do not fix.

- [ ] **Step 4.6: Commit**

```bash
git add components/features/cutlist/packing.ts tests/cutlist-packing.test.ts
git commit -m "fix(cutlist): Deep-mode strip fallback now triggers on completeness, not just sheet count"
```

---

## Task 5: Update canonical doc — `docs/features/cutlist-calculator.md`

**Files:**
- Modify: `docs/features/cutlist-calculator.md`

- [ ] **Step 5.1: Bump the "Last Updated" header**

In `docs/features/cutlist-calculator.md`, change line 5 from:

```markdown
> **Last Updated**: 2026-04-25
```

to:

```markdown
> **Last Updated**: 2026-04-26
```

- [ ] **Step 5.2: Add the completeness gate bullet to the guillotine section**

In the same file, find the **Alternative algorithm: `guillotine`** section (around line 211). Append a new bullet to the end of the bullet list, immediately before the **Deep algorithm: `simulated annealing`** heading:

```markdown
- **Completeness gate**: Layouts that leave parts unplaced are ranked below any layout with fewer unplaced pieces, regardless of sheet count or offcut quality. Offcut metrics only break ties among layouts with the same unplaced count. This prevents the optimizer from choosing a partial 2-piece layout with a beautiful offcut when a complete 4-piece layout fits on the same sheet.
```

- [ ] **Step 5.3: Update the SA scoring breakdown**

In the **Scoring (V2)** sub-list under **Deep algorithm: `simulated annealing`** (around line 233), prepend a new top-priority bullet at the start of the score-breakdown list:

```markdown
  - `-unplacedCount × 10,000,000` (completeness — dominates everything; never trade a placed part for a better offcut)
```

So the list now reads:

```markdown
- **Scoring (V2)**: Heavily weighted toward offcut quality, but completeness comes first:
  - `-unplacedCount × 10,000,000` (completeness — dominates everything; never trade a placed part for a better offcut)
  - `-sheets × 100,000` (fewer sheets)
  - `+offcutQuality × 500` (largest offcut as % of sheet — user's #1 priority among complete layouts)
  - `+concentration × 300` (consolidated waste)
  - `-compactness × 50` (bounding box penalty — prefer parts packed in corner)
  - `+utilization × 1` (efficiency, weak signal)
  - `-fragments × 20` (fewer fragments better)
```

- [ ] **Step 5.4: Update the strip-fallback description**

In the same **Deep algorithm** section, find the bullet that begins **"Strip fallback safety net"** (around line 240) and replace it with:

```markdown
- **Strip fallback safety net**: After SA completes, the orchestrator runs the strip packer and falls back to it when (a) strip places strictly more pieces than SA, or (b) both layouts place every part but strip uses fewer sheets. SA is allowed to win on offcut quality only among layouts with the same unplaced count and sheet count. This guarantees Deep never returns a partial layout when strip found a complete one, and never regresses below the Fast algorithm on simple jobs.
```

- [ ] **Step 5.5: Append a footer entry**

At the bottom of the file, after the existing `*Updated: 2026-03-06 ...*` line, append:

```markdown
*Updated: 2026-04-26 - Optimizer ranking now treats complete placement as mandatory; offcut quality only ranks among layouts with the same unplaced count*
```

- [ ] **Step 5.6: Commit**

```bash
git add docs/features/cutlist-calculator.md
git commit -m "docs(cutlist): document completeness gate in optimizer ranking"
```

---

## Task 6: Final verification

**Files:** none (read-only checks).

- [ ] **Step 6.1: Lint**

```bash
npm run lint
```

Expected: clean, or only pre-existing image-related warnings. No new warnings introduced by this branch.

- [ ] **Step 6.2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors introduced by this branch. Note any pre-existing unrelated errors but do not fix them.

- [ ] **Step 6.3: Targeted test run**

```bash
npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-result-scoring.test.ts
```

Expected: PASS for every test, including:
- The 8 scoring tests in `cutlist-result-scoring.test.ts`
- The 2 new screenshot-case tests at the end of `cutlist-packing.test.ts`
- The existing `'deep SA mode keeps the 600mm rip-column layout when the guillotine baseline is already optimal'` test at `cutlist-packing.test.ts:701`
- All other pre-existing cutlist packing tests

- [ ] **Step 6.4: Confirm commit list**

```bash
git log --oneline codex/integration..HEAD
```

Expected exactly 5 commits (in order):
1. `feat(cutlist): add countUnplacedPieces helper for layout completeness checks`
2. `fix(cutlist): rank complete guillotine layouts above partials with better offcuts`
3. `fix(cutlist): add completeness gate to SA V2 scorer so Deep mode never picks partial layouts`
4. `fix(cutlist): Deep-mode strip fallback now triggers on completeness, not just sheet count`
5. `docs(cutlist): document completeness gate in optimizer ranking`

If commit count is wrong, stop and surface to the user — do not amend or rebase without confirmation.

- [ ] **Step 6.5: Push and report**

```bash
git push -u origin codex/local-cutlist-complete-placement-scoring
```

Then report back to the user:
- Branch name and final commit SHA
- Confirmation that all targeted tests pass
- Note that the leg/top/modesty 4-piece case now packs onto 1 sheet in both Guillotine and Deep modes
- Any pre-existing tsc/lint findings that are not related to this change

---

## Acceptance Criteria

- The leg/top/modesty 4-piece case (1× 1200×750 Top + 1× 1118×350 Modesty + 2× 700×700 Legs on a 2730×1830 sheet, kerf 3) places all 4 pieces on one sheet for both Guillotine and Deep algorithms.
- `calculateResultScore` and `calculateResultScoreV2` rank any complete layout above any partial layout, regardless of offcut quality.
- Among layouts with the same unplaced count, larger contiguous offcut and fewer sheets still win — V2 offcut weighting is preserved.
- The Deep-mode strip fallback fires when strip is strictly more complete than SA, even when sheet counts match.
- All existing cutlist packing tests pass unchanged.
- `docs/features/cutlist-calculator.md` documents the completeness gate in both the guillotine and Deep sections.

---

## Out of Scope

- The "Part exceeds stock sheet dimensions" UI message wording. The scoring fix is the real cause of the screenshot bug; the message can be revisited in a follow-up if it still misleads after this lands.
- Any changes to the strip packer (it already handles partial cases correctly).
- Any changes to the legacy `packPartsIntoSheets` greedy best-fit packer (not used by `/cutlist`).
- Updates to `docs/README.md` or `docs/overview/todo-index.md` (per CLAUDE.md, do not touch shared index docs on every task).

# Cutlist Optimizer: Lexicographic Completeness Comparison Implementation Plan

> **For Codex (fresh session):** Execute this plan task-by-task. Each task ends with verification + commit. Do not batch tasks into a single commit. This plan is self-contained — no prior context required.

---

## Context (read first)

**The codebase.** This repo is `unity-erp`, a Next.js 15 / React 19 / TypeScript Supabase ERP. The relevant subsystem is the **Cutlist Optimizer** at `/cutlist`, which packs woodworking parts into stock sheets to minimize waste. Three packing algorithms exist:

- **Strip** (`lib/cutlist/stripPacker.ts`) — fast, cut-minimizing, default.
- **Guillotine** (`lib/cutlist/guillotinePacker.ts`) — multi-pass heuristic optimizing for large reusable offcuts.
- **Deep / SA** (`lib/cutlist/saOptimizer.ts`) — simulated annealing seeded from the guillotine baseline.

The orchestrator that selects the algorithm and runs the post-SA strip-fallback safety net is in `components/features/cutlist/packing.ts`.

**What just landed (background).** A previous change made the optimizers prefer complete layouts (every part placed) over partial layouts (some parts unplaced). It did this by adding a large negative completeness penalty into the scalar score functions:

- `calculateResultScore` in `lib/cutlist/guillotinePacker.ts` adds `-unplacedCount × 1,000,000` to the score, on top of `-sheets × 10,000` and bounded positive terms (utilization, offcut quality, concentration, fragmentation penalty).
- `calculateResultScoreV2` in `lib/cutlist/saOptimizer.ts` adds `-unplacedCount × 10,000,000`, on top of `-sheets × 100,000` and similar bounded positive terms.
- A helper `countUnplacedPieces(result)` already exists in `lib/cutlist/guillotinePacker.ts` (exported). It sums the per-entry `count` field — `result.unplaced?.length` is wrong because unplaced parts are grouped by `partId`.

**The bug this plan fixes.** The penalty constants are not strictly dominant. Once the sheet term grows large enough, a partial layout with few sheets can outscore a complete layout with many sheets. Concretely:

- Guillotine: `1,000,000` penalty vs `−10,000`/sheet. At 200 sheets the sheet term reaches `−2,000,000`, which exceeds the penalty. A 1-sheet 1-piece-unplaced layout (score ≈ `−1,010,000`) beats a 200-sheet complete layout (score ≈ `−2,000,000`). Wrong.
- V2: same 100× ratio, same threshold (≥100 sheets).

Real jobs that need >100 sheets are rare, but the documented invariant is "complete always beats partial". Shipping with a known counterexample is sloppy.

**The fix.** Replace scalar `if (score > bestScore)` comparisons with **lexicographic comparison**: complete layouts always beat partial layouts regardless of scalar score; among layouts with the same unplaced count, the existing scalar score breaks the tie. The completeness penalty constants stay in place as belt-and-braces (cheap defensive depth), but the load-bearing guarantee comes from the lexicographic comparator.

---

## Goal

Add a single `compareResults(a, b, sheetArea, scoreFn?)` helper in `lib/cutlist/guillotinePacker.ts`, and use it at the three sites that currently pick "best result" via scalar score comparison:

1. `updateBest` closure inside `packPartsGuillotine` (`lib/cutlist/guillotinePacker.ts` around line 1406)
2. The `if (score > bestScore)` branch inside `packPartsGuillotineDeep` (same file, around line 1554)
3. The "track global best" branch inside `runSimulatedAnnealing` (`lib/cutlist/saOptimizer.ts` around line 424)

Leave the SA metropolis acceptance criterion (line 416–418 of `saOptimizer.ts`) alone. It uses score *deltas* with `exp(delta / temperature)` — the existing penalty constants underflow to 0 for partial→worse-partial transitions, which is the correct rejection behaviour. (Confirmed via review.)

## Architecture

- `compareResults` lives next to `calculateResultScore` in `lib/cutlist/guillotinePacker.ts`. It accepts an optional `scoreFn` so callers can pass `calculateResultScoreV2` from SA.
- Returns positive if `a` is better than `b`, negative if worse, zero if equal — matches `Array.prototype.sort` convention.
- Three call sites become one-liners: `if (compareResults(candidate, current, sheetArea) > 0) current = candidate;`
- The existing scalar penalty constants (`× 1,000,000`, `× 10,000,000`) **stay** in the scoring functions. They're now redundant for the dominance guarantee but provide defensive depth.

## Tech Stack

TypeScript, Next.js App Router, `node:test` via `npx tsx --test`. No DB, no UI, no React changes.

## Verification harness for every task

- Lint: `npm run lint` (tolerate pre-existing image-related warnings)
- Type-check: `npx tsc --noEmit` (note unrelated pre-existing errors elsewhere — do not fix)
- Targeted tests: `npx tsx --test tests/<file>.test.ts`
- Full cutlist suite at the end: `npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-result-scoring.test.ts`

---

## Task 0: Branch setup

**Files:** none (git only).

This work continues on the existing task branch `codex/local-cutlist-complete-placement-scoring`. The previous completeness fix already landed there; this plan adds follow-up commits before merging back to `codex/integration`.

- [ ] **Step 0.1: Confirm clean working tree**

```bash
git status --short
```

Expected: empty output. If anything is dirty, stop and surface to the user.

- [ ] **Step 0.2: Switch to the task branch and pull**

```bash
git checkout codex/local-cutlist-complete-placement-scoring
git pull --ff-only origin codex/local-cutlist-complete-placement-scoring
```

- [ ] **Step 0.3: Confirm the previous work is present**

```bash
git log --oneline -10
```

Expected: the most recent commits include (in some order):
- `docs(plans): add 2026-04-26 cutlist complete-layout-ranking plan`
- `docs(cutlist): document completeness gate in optimizer ranking`
- `fix(cutlist): Deep-mode strip fallback now triggers on completeness, not just sheet count`
- `fix(cutlist): add completeness gate to SA V2 scorer so Deep mode never picks partial layouts`
- `fix(cutlist): rank complete guillotine layouts above partials with better offcuts`
- `feat(cutlist): add countUnplacedPieces helper for layout completeness checks`

If those commits are missing, stop and surface to the user.

- [ ] **Step 0.4: Sanity-check that `countUnplacedPieces` already exists**

```bash
grep -n "export function countUnplacedPieces" lib/cutlist/guillotinePacker.ts
```

Expected: one match. If zero matches, stop — this plan assumes the previous work has landed.

---

## Task 1: Add `compareResults` helper + direct tests

**Why first:** Three call sites will use this. Ship it in isolation with its own tests so a regression is easy to bisect.

**Files:**
- Modify: `lib/cutlist/guillotinePacker.ts` (add export below `calculateResultScore`)
- Modify: `tests/cutlist-result-scoring.test.ts` (append new tests at the end)

- [ ] **Step 1.1: Read the existing scoring file to locate the insertion point**

```bash
grep -n "export function calculateResultScore\|^}" lib/cutlist/guillotinePacker.ts | head -20
```

Expected: a line `export function calculateResultScore(result: GuillotinePackResult, sheetArea: number): number {` followed (some lines later) by its closing `}`. Insert the new helper immediately after that closing `}`.

- [ ] **Step 1.2: Append the failing tests**

Append to `tests/cutlist-result-scoring.test.ts`:

```ts
test('compareResults: complete layout beats partial regardless of sheet count', async () => {
  const { compareResults } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  // Complete but uses 200 sheets — scalar score would be ~-2,000,000
  const completeMany = {
    sheets: Array.from({ length: 200 }, () => ({ placements: [] })),
    stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0,
    offcutConcentration: 0,
    fragmentCount: 0,
  } as any;

  // Partial (1 piece unplaced) but only 1 sheet — scalar score would be ~-1,010,000
  const partialOne = {
    sheets: [{ placements: [] }],
    stats: { used_area_mm2: 0, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: [{ part: { id: 'a' }, count: 1, reason: 'insufficient_sheet_capacity' }],
    largestOffcutArea: 0,
    offcutConcentration: 0,
    fragmentCount: 0,
  } as any;

  // Without lexicographic comparison, scalar score would let partialOne win.
  // compareResults must return > 0 for completeMany.
  assert.ok(
    compareResults(completeMany, partialOne, sheetArea) > 0,
    'compareResults must rank a 200-sheet complete layout above a 1-sheet partial layout',
  );
  assert.ok(
    compareResults(partialOne, completeMany, sheetArea) < 0,
    'Symmetric: partial loses to complete regardless of operand order',
  );
});

test('compareResults: among layouts with same unplaced count, scalar score breaks the tie', async () => {
  const { compareResults } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  // Both complete, both 1 sheet — bigger offcut wins via scalar tiebreak
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
    compareResults(big, small, sheetArea) > 0,
    'Among complete layouts, larger offcut wins via the scalar tiebreaker',
  );
});

test('compareResults: returns 0 for layouts that are objectively equal', async () => {
  const { compareResults } = await importGuillotine();
  const sheetArea = 2730 * 1830;

  const a = {
    sheets: [{ placements: [] }],
    stats: { used_area_mm2: 100, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 1000,
    offcutConcentration: 0.5,
    fragmentCount: 2,
  } as any;
  const b = { ...a };

  assert.equal(compareResults(a, b, sheetArea), 0, 'Identical layouts compare equal');
});

test('compareResults: accepts an alternate scoreFn for SA V2 weighting', async () => {
  const { compareResults } = await importGuillotine();
  const { calculateResultScoreV2 } = await importSAOptimizer();
  const sheetArea = 2730 * 1830;

  const completeBigOffcut = {
    sheets: [{ placements: [{ x: 0, y: 0, w: 600, h: 1200 }] }],
    stats: { used_area_mm2: 600 * 1200, waste_area_mm2: 0, cuts: 0, cut_length_mm: 0, edgebanding_length_mm: 0 },
    unplaced: undefined,
    largestOffcutArea: 0.85 * sheetArea,
    offcutConcentration: 1,
    fragmentCount: 1,
  } as any;

  const completeSmallOffcut = {
    ...completeBigOffcut,
    largestOffcutArea: 0.10 * sheetArea,
    offcutConcentration: 0.3,
    fragmentCount: 6,
  };

  // V2 weights offcut quality at ×500, so the gap between big and small should
  // be MUCH larger under V2 than under the default scorer. Either way, big wins.
  assert.ok(
    compareResults(completeBigOffcut, completeSmallOffcut, sheetArea, calculateResultScoreV2) > 0,
    'V2 scorer also picks the bigger-offcut layout when completeness ties',
  );
});
```

- [ ] **Step 1.3: Run the new tests to verify they fail**

```bash
npx tsx --test tests/cutlist-result-scoring.test.ts
```

Expected: the 4 new tests FAIL with `compareResults is not a function` or import error. Pre-existing tests still pass.

- [ ] **Step 1.4: Implement the helper**

In `lib/cutlist/guillotinePacker.ts`, immediately after the closing `}` of `calculateResultScore`, append:

```ts
/**
 * Lexicographic comparison of two packing results.
 *
 * Completeness comes first: a layout with fewer unplaced pieces always
 * outranks a layout with more unplaced pieces, regardless of any scalar
 * score difference. Among layouts with the same unplaced count, the
 * scalar score breaks the tie.
 *
 * This guarantees the "complete always beats partial" invariant for
 * arbitrarily large sheet counts — the scalar penalty in
 * calculateResultScore alone is not strictly dominant once the sheet
 * term grows past the penalty constant.
 *
 * Return value follows Array.prototype.sort convention:
 *   > 0  → `a` is better than `b`
 *   < 0  → `a` is worse than `b`
 *   = 0  → `a` and `b` are equally ranked
 *
 * @param scoreFn  Defaults to calculateResultScore. SA passes calculateResultScoreV2.
 */
export function compareResults(
  a: GuillotinePackResult,
  b: GuillotinePackResult,
  sheetArea: number,
  scoreFn: (result: GuillotinePackResult, sheetArea: number) => number = calculateResultScore,
): number {
  const aUnplaced = countUnplacedPieces(a);
  const bUnplaced = countUnplacedPieces(b);
  if (aUnplaced !== bUnplaced) {
    // Fewer unplaced is better → return positive when a has fewer
    return bUnplaced - aUnplaced;
  }
  return scoreFn(a, sheetArea) - scoreFn(b, sheetArea);
}
```

- [ ] **Step 1.5: Run the tests to verify they pass**

```bash
npx tsx --test tests/cutlist-result-scoring.test.ts
```

Expected: PASS, all tests in the file (the previous 8 plus the 4 new ones).

- [ ] **Step 1.6: Commit**

```bash
git add lib/cutlist/guillotinePacker.ts tests/cutlist-result-scoring.test.ts
git commit -m "feat(cutlist): add compareResults lexicographic comparator for layout ranking"
```

---

## Task 2: Use `compareResults` in `packPartsGuillotine`

**Why:** This is the function that runs the multi-pass heuristic and picks the best layout across ~25 strategy variations. Currently it uses scalar score comparison via an `updateBest` closure.

**Files:**
- Modify: `lib/cutlist/guillotinePacker.ts` (function `packPartsGuillotine`, around line 1384)

- [ ] **Step 2.1: Locate the current implementation**

```bash
grep -n "let bestResult\|let bestScore\|const updateBest\|bestScore =\|bestResult =" lib/cutlist/guillotinePacker.ts | head -20
```

Note the line numbers — you'll need them to find the surrounding context.

- [ ] **Step 2.2: Replace the `updateBest` closure**

In `packPartsGuillotine` (around line 1384), find this block:

```ts
  let bestResult: GuillotinePackResult | null = null;
  let bestScore = -Infinity;

  const updateBest = (result: GuillotinePackResult) => {
    const score = calculateResultScore(result, sheetArea);
    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }
  };
```

Replace it with:

```ts
  let bestResult: GuillotinePackResult | null = null;

  const updateBest = (result: GuillotinePackResult) => {
    if (!bestResult || compareResults(result, bestResult, sheetArea) > 0) {
      bestResult = result;
    }
  };
```

The `bestScore` tracker is no longer needed — `compareResults` recomputes the scalar score internally only when unplaced counts tie, and the result is not used elsewhere in this function.

- [ ] **Step 2.3: Run the full cutlist test suite**

```bash
npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-result-scoring.test.ts
```

Expected: PASS for every test (44 from before + 4 added in Task 1 = 48). The leg/top/modesty integration tests must still pass.

- [ ] **Step 2.4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors introduced. Pre-existing unrelated errors are fine.

- [ ] **Step 2.5: Commit**

```bash
git add lib/cutlist/guillotinePacker.ts
git commit -m "fix(cutlist): use lexicographic compareResults in packPartsGuillotine multi-pass loop"
```

---

## Task 3: Use `compareResults` in `packPartsGuillotineDeep`

**Why:** The Deep / SA orchestration path also runs a time-budgeted heuristic loop and currently picks the best via scalar comparison.

**Files:**
- Modify: `lib/cutlist/guillotinePacker.ts` (function `packPartsGuillotineDeep`, around line 1493)

- [ ] **Step 3.1: Locate the seed and the loop comparison**

```bash
grep -n "packPartsGuillotineDeep\|let bestResult = packPartsGuillotine\|score > bestScore" lib/cutlist/guillotinePacker.ts
```

Expected: hits at the function signature, the seed line (around 1505), and the loop comparison (around 1554).

- [ ] **Step 3.2: Replace the seed score tracker**

In `packPartsGuillotineDeep` (around line 1493), find:

```ts
  // Initial result using standard heuristics (baseline)
  let bestResult = packPartsGuillotine(parts, stock, config);
  let bestScore = calculateResultScore(bestResult, sheetArea);
```

Replace with:

```ts
  // Initial result using standard heuristics (baseline)
  let bestResult = packPartsGuillotine(parts, stock, config);
```

(`bestScore` is no longer needed; the loop will use `compareResults`.)

- [ ] **Step 3.3: Replace the loop comparison**

Inside the same function, find:

```ts
    // Pack this variation
    const strategyName = `deep-${baseStrategy}-${seed}`;
    const result = packWithExpandedParts(shuffled, sheet, strategyName, parts, config);
    const score = calculateResultScore(result, sheetArea);

    // Keep if better
    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }
```

Replace with:

```ts
    // Pack this variation
    const strategyName = `deep-${baseStrategy}-${seed}`;
    const result = packWithExpandedParts(shuffled, sheet, strategyName, parts, config);

    // Keep if better — lexicographic so completeness always dominates
    if (compareResults(result, bestResult, sheetArea) > 0) {
      bestResult = result;
    }
```

- [ ] **Step 3.4: Run the full cutlist test suite**

```bash
npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-result-scoring.test.ts
```

Expected: PASS for every test.

- [ ] **Step 3.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3.6: Commit**

```bash
git add lib/cutlist/guillotinePacker.ts
git commit -m "fix(cutlist): use lexicographic compareResults in packPartsGuillotineDeep loop"
```

---

## Task 4: Use `compareResults` in `runSimulatedAnnealing` global-best tracker

**Why:** SA has a "track global best" branch that records the best layout seen across all iterations. It currently uses scalar score comparison. The metropolis acceptance criterion (which decides whether to accept a worse candidate via `exp(delta / temperature)`) **stays unchanged** — that is delta-based and already safely rejects worse partials via floating-point underflow.

**Files:**
- Modify: `lib/cutlist/saOptimizer.ts` (function `runSimulatedAnnealing`, around line 343 + line 424)

- [ ] **Step 4.1: Locate the import block and add `compareResults`**

```bash
grep -n "from './guillotinePacker'\|from \"./guillotinePacker\"" lib/cutlist/saOptimizer.ts
```

Find the existing value import that already pulls `countUnplacedPieces` (added in the previous fix):

```ts
import { countUnplacedPieces } from './guillotinePacker';
```

Append `compareResults` to that import:

```ts
import { compareResults, countUnplacedPieces } from './guillotinePacker';
```

If the import is on a different shape (e.g., already imports both as a value list), add `compareResults` to the named list. Do not duplicate import lines.

- [ ] **Step 4.2: Replace the global-best comparison inside the iteration loop**

In `runSimulatedAnnealing` (around line 405–432), find:

```ts
    if (accept) {
      currentScore = candidateScore;

      // Track global best
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestResult = candidateResult;
        improvementCount++;
        itersSinceImprovement = 0;
      } else {
        itersSinceImprovement++;
      }
    } else {
      // Reject: undo the move
      undo();
      itersSinceImprovement++;
    }
```

Replace the inner `if (candidateScore > bestScore)` block with a `compareResults` check, while keeping `currentScore` and `bestScore` for use by the metropolis criterion and progress reporting:

```ts
    if (accept) {
      currentScore = candidateScore;

      // Track global best — lexicographic so a complete candidate always
      // beats a partial best, and a partial candidate never replaces a
      // complete best, regardless of scalar score difference.
      if (compareResults(candidateResult, bestResult, sheetArea, calculateResultScoreV2) > 0) {
        bestScore = candidateScore;
        bestResult = candidateResult;
        improvementCount++;
        itersSinceImprovement = 0;
      } else {
        itersSinceImprovement++;
      }
    } else {
      // Reject: undo the move
      undo();
      itersSinceImprovement++;
    }
```

The metropolis acceptance step (lines 416–418) remains unchanged:

```ts
    const delta = candidateScore - currentScore;
    const accept =
      delta > 0 || Math.random() < Math.exp(delta / temperature);
```

This is intentional. Reviewers have confirmed `exp(very_negative)` underflows to 0, which safely rejects worse partials.

- [ ] **Step 4.3: Run the full cutlist test suite**

```bash
npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-result-scoring.test.ts
```

Expected: PASS for every test, including the existing `'deep SA mode keeps the 600mm rip-column layout when the guillotine baseline is already optimal'` test in `tests/cutlist-packing.test.ts` and the screenshot-case Deep test.

- [ ] **Step 4.4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors. The `compareResults` import resolves cleanly because it's a public export of `guillotinePacker.ts`.

- [ ] **Step 4.5: Commit**

```bash
git add lib/cutlist/saOptimizer.ts
git commit -m "fix(cutlist): use lexicographic compareResults for SA global-best tracker"
```

---

## Task 5: Update canonical doc — `docs/features/cutlist-calculator.md`

**Files:**
- Modify: `docs/features/cutlist-calculator.md`

The previous fix added bullets describing a scalar penalty constant. Those bullets are now slightly inaccurate — the dominance guarantee comes from lexicographic comparison, not the constant. Tighten the wording.

- [ ] **Step 5.1: Bump the "Last Updated" header**

Open `docs/features/cutlist-calculator.md`. The header at the top has a `> **Last Updated**: 2026-04-26` line. Leave the date as `2026-04-26` (today). If the date is different, change it to `2026-04-26`.

- [ ] **Step 5.2: Replace the guillotine completeness bullet**

In the **Alternative algorithm: `guillotine`** section, find the bullet that begins **"Completeness gate"** (was added in the previous fix). Replace its text with:

```markdown
- **Completeness ranking**: Layouts that leave parts unplaced are ranked below any layout with fewer unplaced pieces via lexicographic comparison — completeness is checked first, scalar offcut/utilization scores only break ties among layouts with the same unplaced count. This holds for arbitrarily large jobs; sheet count cannot drown out completeness.
```

- [ ] **Step 5.3: Replace the V2 scoring breakdown lead bullet**

In the **Deep algorithm: `simulated annealing`** section, find the **Scoring (V2)** sub-list. The first bullet currently reads `-unplacedCount × 10,000,000 (completeness — dominates everything ...)`. Replace just that first bullet with:

```markdown
  - **Lexicographic completeness gate** — comparison checks unplaced count before any scalar score; a complete layout always beats a partial layout regardless of sheet count or offcut quality. The scalar `-unplacedCount × 10,000,000` term remains in the score function as defensive depth, but the load-bearing guarantee is the comparator.
```

The other bullets in that sub-list (`-sheets × 100,000`, `+offcutQuality × 500`, etc.) stay unchanged.

- [ ] **Step 5.4: Replace the strip-fallback bullet (no functional change, just clarify)**

In the same Deep section, find the bullet that begins **"Strip fallback safety net"**. Update its wording so it references the comparator approach explicitly:

```markdown
- **Strip fallback safety net**: After SA completes, the orchestrator runs the strip packer and falls back to it when (a) strip places strictly more pieces than SA, or (b) both layouts place every part but strip uses fewer sheets. Equivalent to the lexicographic comparator used inside the optimizers — completeness comes first, sheet count second.
```

- [ ] **Step 5.5: Append a footer entry**

At the bottom of the file, append a new line below the most recent `*Updated: ...*` line:

```markdown
*Updated: 2026-04-26 - Optimizer ranking now uses lexicographic completeness comparison; scalar penalty constants remain as defensive depth*
```

- [ ] **Step 5.6: Commit**

```bash
git add docs/features/cutlist-calculator.md
git commit -m "docs(cutlist): document lexicographic completeness comparison in optimizer ranking"
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

Expected: no new errors. Pre-existing unrelated errors (Next route types, edge function types, manufacturing types) are out of scope and should not be touched.

- [ ] **Step 6.3: Targeted test run**

```bash
npx tsx --test tests/cutlist-packing.test.ts tests/cutlist-result-scoring.test.ts
```

Expected: PASS for every test, including:
- The 4 new `compareResults` tests in `tests/cutlist-result-scoring.test.ts`
- All previous scoring tests (8 from the previous fix)
- The two screenshot-case integration tests in `tests/cutlist-packing.test.ts`
- All other pre-existing cutlist packing tests

- [ ] **Step 6.4: Confirm new commits on top of the previous work**

```bash
git log --oneline codex/integration..HEAD
```

Expected: at least 5 new commits added by this plan, on top of the 6 from the previous plan, in this order (newest first):
1. `docs(cutlist): document lexicographic completeness comparison in optimizer ranking`
2. `fix(cutlist): use lexicographic compareResults for SA global-best tracker`
3. `fix(cutlist): use lexicographic compareResults in packPartsGuillotineDeep loop`
4. `fix(cutlist): use lexicographic compareResults in packPartsGuillotine multi-pass loop`
5. `feat(cutlist): add compareResults lexicographic comparator for layout ranking`

Followed (older) by the 6 commits from the previous plan.

- [ ] **Step 6.5: Push and report**

```bash
git push origin codex/local-cutlist-complete-placement-scoring
```

Then report back to the user:
- Final commit SHA
- Confirmation that all targeted tests pass (give the count)
- A one-line summary of behaviour: "200-sheet complete layouts now strictly outrank 1-sheet partial layouts in both Guillotine and SA paths."
- Any pre-existing tsc/lint findings that are not related to this change

---

## Acceptance Criteria

- `compareResults(a, b, sheetArea, scoreFn?)` returns `> 0` when `a` has fewer unplaced pieces than `b`, regardless of any scalar score difference, including the explicit 200-sheet-complete vs 1-sheet-partial case.
- Among layouts with the same unplaced count, `compareResults` falls back to scalar score comparison.
- `packPartsGuillotine`, `packPartsGuillotineDeep`, and the SA global-best tracker all use `compareResults`. None of them use raw `score > bestScore` comparisons against the scalar score functions.
- The SA metropolis acceptance step (`delta > 0 || exp(delta / temperature) > random`) is **unchanged**.
- All existing cutlist tests pass unchanged.
- `docs/features/cutlist-calculator.md` describes the comparator-based guarantee instead of relying on the scalar penalty constant alone.

---

## Out of Scope

- Removing the scalar `× 1,000,000` and `× 10,000,000` penalty constants from `calculateResultScore` and `calculateResultScoreV2`. They stay as defensive depth — cheap, harmless, and protect against future regressions if someone reintroduces a scalar comparator.
- The strip packer (`lib/cutlist/stripPacker.ts`). Untouched. Strip already produces complete layouts when one exists.
- The legacy `packPartsIntoSheets` greedy best-fit packer. Not used by `/cutlist`.
- UI text changes. The "Part exceeds stock sheet dimensions" message is a separate follow-up if it still misleads operators.
- Updates to `docs/README.md` or `docs/overview/todo-index.md` — per repo conventions, do not update shared index docs on every task.

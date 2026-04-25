# Cutlist Reusable-Offcut Rules

## Purpose / Big Picture

Replace the org-level Cutlist Defaults with a 2D, optionally grain-aware "minimum reusable offcut" rule. After this lands, an admin opens `/settings/cutlist`, configures a minimum length and minimum width (e.g. 600 × 300 mm) and an optional grain orientation (any / long / cross), and the Cutlist Builder's reusable-offcut count in the preview pane reflects that rule for both packing algorithms. Today the same setting is a single short-side scalar — a 150 × 5000 mm strip incorrectly counts as reusable stock — and the legacy area gate (100 000 mm²) silently overlaps the dimension rule, producing confusing classifications. We also add a tooltip to the existing Preferred Offcut Dimension field so users understand it is a steering knob (penalises usable-but-awkward leftovers during packing) rather than a hard rule.


## Progress

- [ ] P1. Create `lib/cutlist/offcuts.ts` with the `isReusableOffcut` helper plus truth-table unit tests
- [ ] P2. Update `hooks/use-org-settings.ts` to the new `CutlistDefaults` shape, add an exported `normalizeCutlistDefaults` legacy-aware reader, and unit-test the three migration paths
- [ ] P3. Rewire `lib/cutlist/guillotinePacker.ts`: rename `PackingConfig` keys; replace four classification call sites with `isReusableOffcut`; make placement scoring, `getBestSplit`, `splitFreeRect`, and free-rect retention axis-aligned
- [ ] P4. Update `lib/cutlist/stripPacker.ts`: rename `StripPackerConfig` keys; emit `offcut_summary` per sheet via shared classifier
- [ ] P5. Thread `packingConfig` through both `packWithStrips` call sites in `components/features/cutlist/packing.ts`
- [ ] P6. Update `components/features/cutlist/CutlistCalculator.tsx` org-settings → packer-config mapping (and the `useMemo` deps), then sweep `scripts/cutlist-benchmark.ts` and `scripts/cutlist-deep-benchmark.ts` for legacy keys
- [ ] P7. Replace `app/settings/cutlist/page.tsx` with the 4-control UI: minimum length, minimum width, grain cycle button (`○ / ↕ / ↔`), preferred offcut dimension with info tooltip
- [ ] P8. Update `tests/cutlist-packing.test.ts` for the new defaults and add cases that prove `offcut_summary` is populated under both `'guillotine'` and `'strip'` algorithms
- [ ] P9. Repo-wide sweep — `grep -rn "minUsableDimension\|minUsableArea\|minReusableOffcutDimensionMm\|minReusableOffcutAreaMm2" --include="*.ts" --include="*.tsx" .` returns zero hits outside `node_modules`
- [ ] P10. Run the full validation pass and confirm Acceptance criteria below


## Surprises & Discoveries




## Decision Log




## Outcomes & Retrospective




## Context and Orientation

**The product:** Unity ERP, a Next.js (App Router) furniture-manufacturing ERP. Postgres lives in Supabase. Tests are `node:test` driven via `npx tsx --test`. Branch for this work: `codex/local-cutlist-tab-rewire` (continue on it, or branch fresh off `codex/integration` if it has diverged).

**The Cutlist module:** Computes how to cut furniture parts out of melamine sheets ("stock"). Two packing algorithms exist behind a feature flag (`packing.ts:PackingAlgorithm`):

- **`guillotine`** — full guillotine packer with placement scoring, free-rectangle splitting, sliver/sub-optimal/concentration penalties. Lives in `lib/cutlist/guillotinePacker.ts`. Already emits per-sheet `offcut_summary` (`SheetOffcutSummary` shape from `lib/cutlist/types.ts`) classifying remnants as reusable-stock vs. scrap.
- **`strip`** — simpler strip packer that groups parts into horizontal bands; the production default per `packing.ts:510`. Lives in `lib/cutlist/stripPacker.ts`. Currently emits **no** `offcut_summary` — its `SheetLayout` records leave that field undefined.

**The settings under change:** `organizations.cutlist_defaults` is a JSONB column. Today it carries three keys:

- `minReusableOffcutDimensionMm` (default 150) — packer rule today: `Math.min(w, h) ≥ value` (i.e. short-side floor).
- `preferredOffcutDimensionMm` (default 300) — soft penalty inside the guillotine packer's scoring function. Strips between min and preferred get a moderate placement penalty, nudging the optimizer to leave bigger cleaner strips.
- `minReusableOffcutAreaMm2` (default 100 000) — independent area floor: `w × h ≥ value`. Combines AND-wise with the dimension rule.

**Sheet grain convention** (verified via the prior spec-review pass against `getValidOrientations` and `getBestSplit`): grain runs along the sheet's `length_mm` (Y) axis. The `GrainOrientation` enum (`'any' | 'length' | 'width'`) on parts already encodes "grain along part length" / "grain along part width" / "either". For a free rectangle `{ w, h }` produced by the packer, `h` is along grain (AG) and `w` is across grain (CG).

**Legacy single-dim bug we are fixing:** A 150 × 5000 mm strip passes `min(w,h) ≥ 150` and area = 750 000 ≥ 100 000, so it is currently reported as reusable stock. In practice nobody reuses a 150 mm strip; the long-side check is missing. The fix is to express the rule as a 2D minimum (length × width) and optionally restrict by grain orientation.

**No SQL migration required.** `cutlist_defaults` is JSONB. The hook normalizer in P2 handles legacy rows server-side without touching the database.

**Verification harness** (re-run between tasks as you choose; required at the end):

- Lint: `npm run lint` — tolerate pre-existing image-related warnings.
- Type-check: `npx tsc --noEmit` — pre-existing unrelated errors live in `app/orders/[orderId]/page.tsx:192`. Do not fix them; ignore.
- Unit tests: `npx tsx --test tests/<file>.test.ts`.

**Multi-tenancy:** `cutlist_defaults` is org-scoped. RLS on `organizations` is already in place. Do not alter RLS in this work.


## Plan of Work

### Module ordering

1. **`lib/cutlist/offcuts.ts` (new)** — The `isReusableOffcut` helper is the single source of truth for "is this rect reusable stock?" Both packers and the test suite import it. Standalone module so neither packer pulls in the other. Tests in `tests/cutlist-reusable-offcut.test.ts`.

2. **`hooks/use-org-settings.ts`** — Update the `CutlistDefaults` interface (drop `minReusableOffcutDimensionMm`, `minReusableOffcutAreaMm2`; add `minReusableOffcutLengthMm`, `minReusableOffcutWidthMm`, `minReusableOffcutGrain`). Export a new `normalizeCutlistDefaults(raw)` function that turns any of (null, pure-legacy JSONB, mixed JSONB, fully-new JSONB) into the canonical shape. Tests in `tests/use-org-settings-cutlist-defaults.test.ts`.

3. **`lib/cutlist/guillotinePacker.ts`** — Rename `PackingConfig` keys: `minUsableDimension` → `minUsableLength` + `minUsableWidth` + `minUsableGrain` (drop `minUsableArea`). Default to 300 / 300 / `'any'`. Replace four reusability checks (`classifyOffcuts`, `getUsableOffcuts`, two `usableOffcuts` filters at lines ~1078 and ~1230) with `isReusableOffcut(rect, config)`. The scoring/split/retention paths use the legacy scalar in five additional places — make each axis-aligned (X-axis remnants compare against `minUsableWidth`; Y-axis remnants against `minUsableLength`). `getBestSplit` and `splitFreeRect` signatures change to accept both minima.

4. **`lib/cutlist/stripPacker.ts`** — Same config-key rename to keep the two packers' configs symmetric. The existing `StripPackerConfig.minUsableDimension` is **declared but never read** in the file body — the rename is purely a config-shape alignment for the strip packer's internals. The substantive change is **emission**: build a `SheetOffcutSummary` for each strip-packed sheet and attach it to `SheetLayout.offcut_summary`. Two new file-local helpers — `computeStripRemnants(strips, sheetWidth, sheetHeight)` and `summarizeOffcuts(rects, cfg)` — handle the math. Strip remnants come from two sources: the right-side empty space inside each strip (`sheetWidth - usedWidth` × `strip.height`), and the bottom of the sheet below the last strip. **Integration point is already exposed:** all three packing approaches (`stackStripsOnSheets`, `packNested`, `packVerticalFirst`) return `Strip[][]` per sheet, and the conversion loop in `packWithStrips` (around lines 1021-1035) already iterates with each sheet's `Strip[]` in hand as `sheetStrips`. No refactor of any helper signature is needed — extend the existing `sheetLayouts.push({ … })` call to add `offcut_summary: summarizeOffcuts(computeStripRemnants(sheetStrips, sheetWidth, sheetHeight), fullConfig)`.

5. **`components/features/cutlist/packing.ts`** — Two call sites today invoke `packWithStrips(parts, sheet)` without forwarding `opts.packingConfig`: the `algorithm === 'strip'` branch (~line 529) and the `algorithm === 'deep'` strip baseline (~line 552). Forward the three new classification fields in both. Once `PackingConfig` (P3) carries them, `Partial<PackingConfig>` typing flows through `ExtendedPackOptions.packingConfig` cleanly and the strip config (`Partial<StripPackerConfig>` after P4) accepts them via structural typing — no `any` casts needed.

6. **`components/features/cutlist/CutlistCalculator.tsx`** — Single call site (~line 422) maps `cutlistDefaults` from the hook to a `packingConfig` literal. Replace the three legacy keys with the three new ones; update the surrounding `useMemo` dependency array (~lines 427-429) to track the new fields.

7. **`scripts/cutlist-benchmark.ts` and `scripts/cutlist-deep-benchmark.ts`** — Sweep for hardcoded references to the legacy keys (`minUsableDimension`, `minUsableArea`). Rewrite to the new shape: `{ minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }`. These scripts run benchmarks; failing them means broken benchmark output, not broken production behaviour.

8. **`app/settings/cutlist/page.tsx`** — Full file replacement. The new layout: a 3-column grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto]`) for the three minimum-related controls (length, width, grain cycle button), then a separate single-column row for the preferred offcut dimension with an `(i)` info tooltip. The grain cycle button is **settings-local** — do not import any helpers from `components/features/cutlist/primitives/CompactPartsTable.tsx`. The button cycles `any → length → width → any` on click; tooltip shows the current label. Arrow-key cycling is intentionally omitted (low-frequency edit context). Preferred-dim tooltip uses `<TooltipContent className="max-w-xs text-xs leading-snug">` because the shared `TooltipContent` has no default max-width and verbose copy renders comically wide otherwise. Numeric inputs follow the project convention: `value={x ?? ''}` with `placeholder="0"` and an `onBlur` handler that reverts empty fields to the default.

9. **`tests/cutlist-packing.test.ts`** — Existing tests may break because the default classification rule changed (was 150 short-side + 100k area; becomes 300 × 300, no area gate). For each failing test: either pass an explicit `packingConfig` matching the historical scalar to keep the test's assertion stable, or update the assertion to match the new defaults. Then add two new cases — one each for `algorithm: 'guillotine'` and `algorithm: 'strip'` — that assert `result.sheets[0]?.offcut_summary !== undefined`. The strip case is the regression test for P4's emission work; without it the change can silently regress.


## Concrete Steps

1. Verify your shell starts in `/Users/gregorymaier/developer/unity-erp` and the branch is `codex/local-cutlist-tab-rewire` (or a fresh branch off `codex/integration`). Run `git status` and confirm a clean working tree before starting; if there are uncommitted unrelated edits, stash them.

2. **(P1) Create `lib/cutlist/offcuts.ts`** with this exact body:

   ```ts
   /**
    * Reusable-offcut classification.
    *
    * Sheet grain convention: grain runs along the sheet's length_mm (Y) axis.
    * For an offcut FreeRect { w, h }:
    *   - AG (along grain) = h (Y axis)
    *   - CG (across grain) = w (X axis)
    */

   import type { GrainOrientation } from './types';

   export interface OffcutClassificationConfig {
     minUsableLength: number;
     minUsableWidth: number;
     minUsableGrain: GrainOrientation;
   }

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

   Then create `tests/cutlist-reusable-offcut.test.ts`:

   ```ts
   import test from 'node:test';
   import assert from 'node:assert/strict';
   import { isReusableOffcut } from '../lib/cutlist/offcuts';

   test('grain=any: square at threshold passes', () => {
     assert.equal(isReusableOffcut({ w: 300, h: 300 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }), true);
   });
   test('grain=any: square just below threshold fails', () => {
     assert.equal(isReusableOffcut({ w: 299, h: 299 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }), false);
   });
   test('grain=any: long thin strip (legacy bug case) fails', () => {
     assert.equal(isReusableOffcut({ w: 150, h: 5000 }, { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' }), false);
   });
   test('grain=any: 600x300 in either orientation passes', () => {
     assert.equal(isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }), true);
     assert.equal(isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }), true);
   });
   test('grain=length: long-grain piece passes', () => {
     assert.equal(isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'length' }), true);
   });
   test('grain=length: same rect rotated fails (cross-grain orientation)', () => {
     assert.equal(isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'length' }), false);
   });
   test('grain=width: swapped axis check', () => {
     assert.equal(isReusableOffcut({ w: 600, h: 300 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'width' }), true);
   });
   test('grain=length: below width minimum fails', () => {
     assert.equal(isReusableOffcut({ w: 300, h: 600 }, { minUsableLength: 600, minUsableWidth: 400, minUsableGrain: 'length' }), false);
   });
   test('grain=any: max-side gate uses Math.max correctly', () => {
     assert.equal(isReusableOffcut({ w: 200, h: 700 }, { minUsableLength: 600, minUsableWidth: 200, minUsableGrain: 'any' }), true);
     assert.equal(isReusableOffcut({ w: 200, h: 700 }, { minUsableLength: 600, minUsableWidth: 300, minUsableGrain: 'any' }), false);
   });
   ```

   Run `npx tsx --test tests/cutlist-reusable-offcut.test.ts`. Expected: `# pass 9`. Commit:

   ```
   git add lib/cutlist/offcuts.ts tests/cutlist-reusable-offcut.test.ts
   git commit -m "feat(cutlist): add isReusableOffcut helper with truth-table tests"
   ```

3. **(P2) Update `hooks/use-org-settings.ts`.** Add a top-of-file import: `import type { GrainOrientation } from '@/lib/cutlist/types';`. Replace the existing `CutlistDefaults` interface (around lines 37-41) with:

   ```ts
   export interface CutlistDefaults {
     minReusableOffcutLengthMm?: number;
     minReusableOffcutWidthMm?: number;
     minReusableOffcutGrain?: GrainOrientation;
     preferredOffcutDimensionMm?: number;
   }

   interface LegacyCutlistDefaults {
     minReusableOffcutDimensionMm?: number;
     minReusableOffcutAreaMm2?: number;
   }
   ```

   Replace the `DEFAULTS.cutlistDefaults` object (around lines 56-60) with:

   ```ts
   cutlistDefaults: {
     minReusableOffcutLengthMm: 300,
     minReusableOffcutWidthMm: 300,
     minReusableOffcutGrain: 'any',
     preferredOffcutDimensionMm: 300,
   },
   ```

   Add this exported function above `useOrgSettings`:

   ```ts
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

   Replace the existing inline `cutlistDefaults: { … }` literal inside `queryFn`'s return (around lines 84-91) with `cutlistDefaults: normalizeCutlistDefaults(data.cutlist_defaults as Partial<CutlistDefaults & LegacyCutlistDefaults> | null)`.

   Create `tests/use-org-settings-cutlist-defaults.test.ts`:

   ```ts
   import test from 'node:test';
   import assert from 'node:assert/strict';
   import { normalizeCutlistDefaults } from '../hooks/use-org-settings';

   test('null/missing → strict new defaults', () => {
     assert.deepEqual(normalizeCutlistDefaults(null), {
       minReusableOffcutLengthMm: 300, minReusableOffcutWidthMm: 300,
       minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
     });
     assert.deepEqual(normalizeCutlistDefaults({}), {
       minReusableOffcutLengthMm: 300, minReusableOffcutWidthMm: 300,
       minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
     });
   });
   test('pure-legacy → carry scalar to both axes, drop area', () => {
     assert.deepEqual(normalizeCutlistDefaults({
       minReusableOffcutDimensionMm: 150,
       preferredOffcutDimensionMm: 300,
       minReusableOffcutAreaMm2: 100000,
     }), {
       minReusableOffcutLengthMm: 150, minReusableOffcutWidthMm: 150,
       minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
     });
   });
   test('mixed: any new key wins, legacy scalar ignored', () => {
     assert.deepEqual(normalizeCutlistDefaults({
       minReusableOffcutLengthMm: 600,
       minReusableOffcutDimensionMm: 150,
     }), {
       minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 300,
       minReusableOffcutGrain: 'any', preferredOffcutDimensionMm: 300,
     });
   });
   test('fully-new passes through', () => {
     assert.deepEqual(normalizeCutlistDefaults({
       minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 400,
       minReusableOffcutGrain: 'length', preferredOffcutDimensionMm: 500,
     }), {
       minReusableOffcutLengthMm: 600, minReusableOffcutWidthMm: 400,
       minReusableOffcutGrain: 'length', preferredOffcutDimensionMm: 500,
     });
   });
   ```

   Run `npx tsx --test tests/use-org-settings-cutlist-defaults.test.ts`. Expected: `# pass 4`. `npx tsc --noEmit` will surface errors at consumers of `CutlistDefaults` (CutlistCalculator, settings page) — those are addressed in P6 and P7; ignore for now. Commit:

   ```
   git add hooks/use-org-settings.ts tests/use-org-settings-cutlist-defaults.test.ts
   git commit -m "feat(cutlist): 2D + grain-aware CutlistDefaults with legacy normalizer"
   ```

4. **(P3) Rewire `lib/cutlist/guillotinePacker.ts`.** Add to the imports near the top: `import { isReusableOffcut } from './offcuts';` and ensure `GrainOrientation` is in the import from `./types`.

   Replace the `PackingConfig` interface (around lines 40-61) with:

   ```ts
   export interface PackingConfig {
     minUsableLength: number;
     minUsableWidth: number;
     minUsableGrain: GrainOrientation;
     preferredMinDimension: number;
     sliverPenalty: number;
     exactFitTrimPenalty: number;
     subOptimalPenalty: number;
     touchingBonus: number;
     perfectFitBonus: number;
     concentrationWeight: number;
     fragmentationPenalty: number;
   }
   ```

   Replace `DEFAULT_PACKING_CONFIG` with:

   ```ts
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

   Replace `classifyOffcuts` (around line 557):

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

   Replace `getUsableOffcuts` method (around line 986):

   ```ts
   getUsableOffcuts(): FreeRect[] {
     return this.freeRects.filter((r) => isReusableOffcut(r, this.config));
   }
   ```

   Replace the `usableOffcuts` filter near line 1078 and the second one near line 1230 with:

   ```ts
   const usableOffcuts = freeRects.filter((r) => isReusableOffcut(r, fullConfig));
   ```

   Inside `calculatePlacementScore` (around lines 354-367), replace the four penalty checks with axis-aligned forms:

   ```ts
   if (remW > 0 && remW < config.minUsableWidth)  score += exactHeightFit ? config.exactFitTrimPenalty : config.sliverPenalty;
   if (remH > 0 && remH < config.minUsableLength) score += exactWidthFit  ? config.exactFitTrimPenalty : config.sliverPenalty;
   if (remW >= config.minUsableWidth  && remW < config.preferredMinDimension) score += exactHeightFit ? config.exactFitTrimPenalty : config.subOptimalPenalty;
   if (remH >= config.minUsableLength && remH < config.preferredMinDimension) score += exactWidthFit  ? config.exactFitTrimPenalty : config.subOptimalPenalty;
   ```

   Change `getBestSplit`'s signature from `(freeRect, partW, partH, minDimension)` to `(freeRect, partW, partH, minLength, minWidth)`. Inside its body, every comparison of `minDimension` against an X-axis remainder (the `freeRect.w - partW` value, i.e. right-side leftover) uses `minWidth`; every comparison against a Y-axis remainder (the `freeRect.h - partH` value, i.e. top-side leftover) uses `minLength`. Add inline comments at each comparison: `// X (across grain) → minWidth` and `// Y (along grain) → minLength`.

   Update the call to `getBestSplit` in `calculatePlacementScore` (line 378):

   ```ts
   const { simulation } = getBestSplit(freeRect, partW, partH, config.minUsableLength, config.minUsableWidth);
   ```

   Change `splitFreeRect`'s signature similarly to take `minLength, minWidth`. Inside its body the four `> minDimension` retention checks become: `remRightW > minWidth` (X) and `remTopH > minLength` (Y).

   Update the two calls inside the packer class (around lines 853 and 895):

   ```ts
   // line ~853
   const { horizontal } = getBestSplit(freeRect, orientation.w, orientation.h, this.config.minUsableLength, this.config.minUsableWidth);
   // line ~895
   const newFreeRects = splitFreeRect(freeRect, orientation.w, orientation.h, this.kerf, this.config.minUsableLength, this.config.minUsableWidth);
   ```

   Run `grep -n "minUsableDimension\|minUsableArea" lib/cutlist/guillotinePacker.ts`. Expected: zero matches. If any remain, apply the same axis-aligned mapping rule. Run `npx tsc --noEmit` — errors should only appear at non-P3 consumers (`CutlistCalculator.tsx`, `stripPacker.ts`, `packing.ts`, `tests/cutlist-packing.test.ts`); ignore. Commit:

   ```
   git add lib/cutlist/guillotinePacker.ts
   git commit -m "feat(cutlist): rewire guillotine packer to 2D grain-aware classification + axis-aligned scoring"
   ```

5. **(P4) Update `lib/cutlist/stripPacker.ts`.** Add to imports:

   ```ts
   import type { GrainOrientation, SheetOffcutSummary, OffcutRect } from './types';
   import { isReusableOffcut } from './offcuts';
   ```

   Replace `StripPackerConfig` (around lines 31-42) and `DEFAULT_STRIP_CONFIG` (around lines 44-50):

   ```ts
   export interface StripPackerConfig {
     kerf_mm: number;
     minStripHeight_mm: number;
     heightTolerance: number;
     preferAlignedCuts: boolean;
     minUsableLength: number;
     minUsableWidth: number;
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

   Add these helpers near the other top-of-file helpers (after type defs, before `expandParts`):

   ```ts
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

   function summarizeOffcuts(
     rects: { x: number; y: number; w: number; h: number }[],
     cfg: { minUsableLength: number; minUsableWidth: number; minUsableGrain: GrainOrientation },
   ): SheetOffcutSummary {
     const reusable: OffcutRect[] = [];
     const scrap: OffcutRect[] = [];
     for (const r of rects) {
       const out: OffcutRect = { x: r.x, y: r.y, w: r.w, h: r.h, area_mm2: r.w * r.h };
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

   Then plumb `offcut_summary` into the per-sheet `SheetLayout` records. The integration point is the existing conversion loop in `packWithStrips` around lines 1021-1035, which already iterates with `sheetStrips` (`Strip[]`) in scope. Edit the existing `sheetLayouts.push({ … })` call to add a fourth field:

   ```ts
   sheetLayouts.push({
     sheet_id: `${stock.id}:${i + 1}`,
     placements,
     used_area_mm2: usedArea,
     offcut_summary: summarizeOffcuts(
       computeStripRemnants(sheetStrips, sheetWidth, sheetHeight),
       fullConfig,
     ),
   });
   ```

   No helper signature changes are required — `stackStripsOnSheets`, `packNested`, and `packVerticalFirst` already return `Strip[][]` per sheet, and `packWithStrips` already exposes `stripsBySheet: sheets` on its result.

   Run `grep -n "minUsableDimension" lib/cutlist/stripPacker.ts`. Expected: zero. Run `npx tsc --noEmit` — same set of expected errors as after P3; ignore. Commit:

   ```
   git add lib/cutlist/stripPacker.ts
   git commit -m "feat(cutlist): strip packer 2D config + per-sheet offcut_summary emission"
   ```

6. **(P5) Update `components/features/cutlist/packing.ts`.** Find the strip-algorithm branch around line 529 and replace `packWithStrips(parts, sheet)` with:

   ```ts
   const result = packWithStrips(parts, sheet, {
     minUsableLength: opts.packingConfig?.minUsableLength,
     minUsableWidth: opts.packingConfig?.minUsableWidth,
     minUsableGrain: opts.packingConfig?.minUsableGrain,
   });
   ```

   Find the `algorithm === 'deep'` strip baseline around line 552 and apply the same change to `const stripBaseline = packWithStrips(parts, sheet);`. Run `grep -n "packWithStrips(" components/features/cutlist/packing.ts`. Expected: every call site forwards the three classification fields. `npx tsc --noEmit` should now compile cleanly for `packing.ts`. Commit:

   ```
   git add components/features/cutlist/packing.ts
   git commit -m "feat(cutlist): forward packingConfig to packWithStrips call sites"
   ```

7. **(P6) Update `components/features/cutlist/CutlistCalculator.tsx`.** Find the `packingConfig: { … }` block around line 422; replace with:

   ```ts
   packingConfig: {
     minUsableLength: cutlistDefaults.minReusableOffcutLengthMm,
     minUsableWidth:  cutlistDefaults.minReusableOffcutWidthMm,
     minUsableGrain:  cutlistDefaults.minReusableOffcutGrain,
     preferredMinDimension: cutlistDefaults.preferredOffcutDimensionMm,
   }
   ```

   Update the surrounding `useMemo` dependency array (lines 427-429 region) to:

   ```ts
   [
     cutlistDefaults.minReusableOffcutLengthMm,
     cutlistDefaults.minReusableOffcutWidthMm,
     cutlistDefaults.minReusableOffcutGrain,
     cutlistDefaults.preferredOffcutDimensionMm,
   ]
   ```

   Sweep both benchmark scripts: `grep -n "minUsableDimension\|minUsableArea\|minReusableOffcutDimensionMm\|minReusableOffcutAreaMm2" scripts/cutlist-benchmark.ts scripts/cutlist-deep-benchmark.ts`. For each match, rewrite to the new keys (drop area entirely; map dimension to `minUsableLength` and `minUsableWidth`; add `minUsableGrain: 'any'` if the script constructs a config object). Run a repo-wide sweep:

   ```
   grep -rn "minUsableDimension\|minUsableArea\|minReusableOffcutDimensionMm\|minReusableOffcutAreaMm2" --include="*.ts" --include="*.tsx" .
   ```

   Expected: zero matches outside `node_modules`. Investigate any remaining hit. Run `npx tsc --noEmit` and `npm run lint` — expected clean except pre-existing unrelated errors and `tests/cutlist-packing.test.ts` failures (addressed in P8). Commit:

   ```
   git add components/features/cutlist/CutlistCalculator.tsx scripts/cutlist-benchmark.ts scripts/cutlist-deep-benchmark.ts
   git commit -m "chore(cutlist): wire calculator + benchmarks to new packer config keys"
   ```

8. **(P7) Replace `app/settings/cutlist/page.tsx`** with this exact contents:

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

           <div className="space-y-2">
             <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto]">
               <div>
                 <label className="block text-sm font-medium mb-1">Minimum length (mm)</label>
                 <Input
                   type="number"
                   min={1}
                   placeholder="0"
                   value={defaults.minReusableOffcutLengthMm ?? ''}
                   onChange={(e) => update('minReusableOffcutLengthMm', e.target.value === '' ? undefined : Number(e.target.value))}
                   onBlur={() => { if (!defaults.minReusableOffcutLengthMm) update('minReusableOffcutLengthMm', 300); }}
                 />
               </div>
               <div>
                 <label className="block text-sm font-medium mb-1">Minimum width (mm)</label>
                 <Input
                   type="number"
                   min={1}
                   placeholder="0"
                   value={defaults.minReusableOffcutWidthMm ?? ''}
                   onChange={(e) => update('minReusableOffcutWidthMm', e.target.value === '' ? undefined : Number(e.target.value))}
                   onBlur={() => { if (!defaults.minReusableOffcutWidthMm) update('minReusableOffcutWidthMm', 300); }}
                 />
               </div>
               <div>
                 <label className="block text-sm font-medium mb-1">Grain</label>
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <Button type="button" variant="outline" size="sm" onClick={() => update('minReusableOffcutGrain', nextGrain(grain))} className="min-w-12">
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

           <div className="grid gap-3 grid-cols-1 sm:max-w-xs">
             <div>
               <label className="flex items-center gap-1.5 text-sm font-medium mb-1">
                 Preferred offcut dimension (mm)
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What is preferred offcut dimension?">
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
                 onChange={(e) => update('preferredOffcutDimensionMm', e.target.value === '' ? undefined : Number(e.target.value))}
                 onBlur={() => { if (!defaults.preferredOffcutDimensionMm) update('preferredOffcutDimensionMm', 300); }}
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

   Run `npm run lint` and `npx tsc --noEmit` — expected clean for this file. Commit:

   ```
   git add app/settings/cutlist/page.tsx
   git commit -m "feat(cutlist): 2D + grain-aware settings page with preferred-dim tooltip"
   ```

9. **(P8) Update `tests/cutlist-packing.test.ts`.** First, run it as-is: `npx tsx --test tests/cutlist-packing.test.ts`. Note any failures — they are likely from tests that pinned the legacy 150 mm short-side rule. For each failing test, decide:

   - If the test's purpose is to verify a specific historical behaviour: pass an explicit `packingConfig` matching the historical scalar (e.g. `{ minUsableLength: 150, minUsableWidth: 150, minUsableGrain: 'any' }`) and adjust the assertion to reflect that no area gate exists anymore.
   - If the test's purpose is general algorithm correctness: update assertions to match the new defaults (300 × 300, no area gate).

   Append two new cases at the end of the file:

   ```ts
   test('guillotine: offcut_summary populated with new 2D rule', async () => {
     const mod = await importPacking();
     const parts: PartSpec[] = [
       { id: 'p1', length_mm: 600, width_mm: 1830, qty: 1, grain: 'any' },
     ];
     const stock: StockSheetSpec[] = [{ id: 's1', length_mm: 2750, width_mm: 1830, qty: 1 }];
     const result = await mod.packPartsSmartOptimized(parts, stock, {
       algorithm: 'guillotine',
       packingConfig: { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' },
     });
     assert.ok(result.sheets[0]?.offcut_summary !== undefined,
       'guillotine algorithm must emit offcut_summary');
   });

   test('strip: offcut_summary populated (P4 emission regression)', async () => {
     const mod = await importPacking();
     const parts: PartSpec[] = [
       { id: 'p1', length_mm: 600, width_mm: 1830, qty: 1, grain: 'any' },
     ];
     const stock: StockSheetSpec[] = [{ id: 's1', length_mm: 2750, width_mm: 1830, qty: 1 }];
     const result = await mod.packPartsSmartOptimized(parts, stock, {
       algorithm: 'strip',
       packingConfig: { minUsableLength: 300, minUsableWidth: 300, minUsableGrain: 'any' },
     });
     assert.ok(result.sheets[0]?.offcut_summary !== undefined,
       'strip algorithm must emit offcut_summary after P4');
   });
   ```

   Run again: `npx tsx --test tests/cutlist-packing.test.ts`. All cases pass. Run the cutlist-adjacent suite for regressions:

   ```
   npx tsx --test tests/edging-computation.test.ts tests/snapshot-freshness.test.ts tests/cutting-plan-aggregate.test.ts tests/cutting-plan-utils.test.ts tests/line-allocation.test.ts tests/line-material-cost.test.ts tests/padded-line-cost.test.ts
   ```

   Expected: all pre-existing tests pass. Commit:

   ```
   git add tests/cutlist-packing.test.ts
   git commit -m "test(cutlist): cover 2D rule + strip remnant emission across both algorithms"
   ```

10. **(P9 + P10) Final validation.** Run all four:

    ```
    grep -rn "minUsableDimension\|minUsableArea\|minReusableOffcutDimensionMm\|minReusableOffcutAreaMm2" --include="*.ts" --include="*.tsx" .
    npm run lint
    npx tsc --noEmit
    npx tsx --test tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts tests/cutlist-packing.test.ts
    ```

    Expected outputs: zero grep hits outside `node_modules`; lint clean save the pre-existing image warnings; `tsc` clean save the documented pre-existing `app/orders/[orderId]/page.tsx:192` error; all three test files pass.


## Validation and Acceptance

The following observable behaviours must all hold after the work lands. Capture command transcripts as proof in **Artifacts and Notes**.

1. **Settings page renders the new shape.** Start the dev server (`npm run dev`), navigate to `http://localhost:3000/settings/cutlist` while signed in as the test account `testai@qbutton.co.za`. The page shows three input controls in a row (Minimum length, Minimum width, Grain cycle button rendering `○` initially), then a separate row for Preferred offcut dimension with an `(i)` icon next to its label. No "Minimum reusable area" control appears.

2. **Grain cycle behaviour.** Clicking the grain button cycles its label and visible icon `○ → ↕ → ↔ → ○` on successive clicks. Hovering the button shows a tooltip whose text matches the current state ("Any direction", "Grain along length", "Grain along width" respectively).

3. **Preferred-dimension tooltip.** Hovering the `(i)` icon next to "Preferred offcut dimension (mm)" surfaces a tooltip whose text starts "Nudge the optimizer toward larger, cleaner leftover strips" and is constrained to ~20rem wide (no comically wide single-line rendering).

4. **Save round-trip.** Set Minimum length to `600`, Minimum width to `400`, click Grain through to `↕`, set Preferred to `400`, click Save. Toast appears: "Cutlist defaults saved". Reload the page; the four values are still 600 / 400 / ↕ / 400.

5. **Builder respects the rule.** Open `http://localhost:3000/products/856/cutlist-builder`. The reusable-offcut count rendered in the preview pane (shown as part of `offcut_summary`) reflects the new 600 × 400 long-grain rule — strips that previously qualified under 150 mm short-side now do not.

6. **Both algorithms emit `offcut_summary`.** Test transcript proves this:

   ```
   $ npx tsx --test tests/cutlist-packing.test.ts
   …
   ok N - guillotine: offcut_summary populated with new 2D rule
   ok N+1 - strip: offcut_summary populated (P4 emission regression)
   …
   # pass <total>
   # fail 0
   ```

7. **Truth-table classification correctness.** Test transcript:

   ```
   $ npx tsx --test tests/cutlist-reusable-offcut.test.ts
   …
   # pass 9
   # fail 0
   ```

8. **Legacy migration correctness.** Test transcript:

   ```
   $ npx tsx --test tests/use-org-settings-cutlist-defaults.test.ts
   …
   # pass 4
   # fail 0
   ```

9. **No legacy keys remain in the codebase.** `grep -rn "minUsableDimension\|minUsableArea\|minReusableOffcutDimensionMm\|minReusableOffcutAreaMm2" --include="*.ts" --include="*.tsx" .` produces zero lines outside `node_modules`.

10. **Lint and type-check clean.** `npm run lint` produces no errors (image-related warnings tolerated). `npx tsc --noEmit` produces no errors except the pre-existing unrelated error at `app/orders/[orderId]/page.tsx:192` (Customer query typing).


## Idempotence and Recovery

Each progress item P1-P10 corresponds to its own commit. To roll back a single step, `git revert <commit>` it; the remaining work survives. To roll back the whole branch, `git reset --hard <pre-P1-sha>`.

The runtime data layer is JSONB on `organizations.cutlist_defaults`. No SQL migration is performed. The normalizer in P2 is read-side: legacy rows continue to load; on first save through the new UI, the row is overwritten with the new key shape. There is no destructive write; the legacy keys are not stripped server-side, only ignored on read.

Re-running the full plan after partial completion: each step inspects the current source before editing. The grep sweep at P9 is the canonical "are we done?" check — if it returns matches, P3 / P4 / P5 / P6 left work undone and you re-apply the relevant edits.


## Artifacts and Notes




## Interfaces and Dependencies

### New module — `lib/cutlist/offcuts.ts`

Exports:

```ts
export interface OffcutClassificationConfig {
  minUsableLength: number;
  minUsableWidth: number;
  minUsableGrain: GrainOrientation;
}

export function isReusableOffcut(
  rect: { w: number; h: number },
  cfg: OffcutClassificationConfig,
): boolean;
```

### Updated — `hooks/use-org-settings.ts`

Exports:

```ts
export interface CutlistDefaults {
  minReusableOffcutLengthMm?: number;
  minReusableOffcutWidthMm?: number;
  minReusableOffcutGrain?: GrainOrientation;
  preferredOffcutDimensionMm?: number;
}

export function normalizeCutlistDefaults(
  raw: Partial<CutlistDefaults & LegacyCutlistDefaults> | null | undefined,
): Required<CutlistDefaults>;
```

Removed keys from `CutlistDefaults`: `minReusableOffcutDimensionMm`, `minReusableOffcutAreaMm2`. Both still tolerated on read via `LegacyCutlistDefaults` and `normalizeCutlistDefaults`.

### Updated — `lib/cutlist/guillotinePacker.ts`

`PackingConfig` field rename:

| Removed | Added |
|---|---|
| `minUsableDimension: number` | `minUsableLength: number` (default 300) |
| `minUsableArea: number` | `minUsableWidth: number` (default 300) |
| | `minUsableGrain: GrainOrientation` (default `'any'`) |

Unchanged: `preferredMinDimension`, all penalty/bonus weights.

Internal function signature changes (not exported):

```ts
function getBestSplit(
  freeRect: FreeRect, partW: number, partH: number,
  minLength: number, minWidth: number,
): { simulation: …; horizontal: boolean };

function splitFreeRect(
  freeRect: FreeRect, partW: number, partH: number, kerf: number,
  minLength: number, minWidth: number,
): FreeRect[];
```

### Updated — `lib/cutlist/stripPacker.ts`

`StripPackerConfig` field rename, same shape as guillotine:

| Removed | Added |
|---|---|
| `minUsableDimension: number` | `minUsableLength: number` (default 300) |
| | `minUsableWidth: number` (default 300) |
| | `minUsableGrain: GrainOrientation` (default `'any'`) |

New file-local helpers (not exported): `computeStripRemnants(strips, sheetWidth, sheetHeight)`, `summarizeOffcuts(rects, cfg)`. The `packWithStrips` exported signature is unchanged structurally — its `config` parameter is `Partial<StripPackerConfig>`, which now carries the new fields.

Per-sheet `SheetLayout.offcut_summary` is populated for every sheet returned (previously undefined for strip output).

### Database

No SQL migration. JSONB column `organizations.cutlist_defaults` is updated through normal UPDATE writes from the settings page. RLS unchanged.

### Library versions

No package additions or upgrades. All edits use existing dependencies: `react`, `next`, `@supabase/supabase-js`, `@tanstack/react-query`, `sonner`, shadcn primitives (`Input`, `Button`, `Tooltip`), `lucide-react` (`Info`).

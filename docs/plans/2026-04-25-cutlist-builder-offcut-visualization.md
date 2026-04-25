# Cutlist Builder — Reusable Offcut Visualization

## Purpose / Big Picture

Surface reusable offcut sizes in the per-product Cutlist Builder so estimators can see what stock a layout produces and feed informed numbers into the existing Manual % billing input. Three coordinated screen-only changes: green-tinted offcut overlays with size labels on each sheet's SVG diagram, a per-sheet bullet list of offcut dimensions, and a segmented utilization bar (parts / reusable / scrap) per sheet AND rolled up across the whole job. Quick-fill chips above Manual % one-click populate the input from the bar's raw percentages. After this lands, an estimator looking at any product's `/products/<id>/cutlist-builder` page can read the breakdown at a glance, see exactly which leftovers are stock, and choose a billing % between mechanical and effective utilization without doing the arithmetic in their head.


## Progress

- [ ] P1. Create the pure helper module `lib/cutlist/effectiveUtilization.ts` exporting `UtilizationBreakdown`, `computeSheetUtilization`, `computeRolledUpUtilization`
- [ ] P2. Add unit tests in `tests/cutlist-effective-utilization.test.ts` covering the nine truth-table cases listed in **Validation and Acceptance**
- [ ] P3. Add the shared `components/features/cutlist/primitives/UtilizationBar.tsx` primitive (segmented bar + 3-column legend + Mechanical/Effective line + Effective tooltip)
- [ ] P4. Add the shared `components/features/cutlist/primitives/ReusableOffcutList.tsx` primitive (sortable bullet list, collapses past six items)
- [ ] P5. Extend `components/features/cutlist/preview.tsx` `SheetPreview` with a new optional `showOffcutOverlay?: boolean` prop and the green-rect overlay + adaptive labels behind it
- [ ] P6. Integrate the bar + offcut list + quick-fill chips into the per-sheet card in `components/features/cutlist/primitives/SheetLayoutGrid.tsx`; pass `showOffcutOverlay` to its `SheetPreview` call
- [ ] P7. Mirror the bar + offcut list (no chips, no input) into the zoom modal stats panel in `components/features/cutlist/primitives/InteractiveSheetViewer.tsx`; pass `showOffcutOverlay` to its `SheetPreview` call
- [ ] P8. Add the rolled-up "All sheets" bar above the sheet grid in `components/features/cutlist/CutlistCalculator.tsx`, computed via `computeRolledUpUtilization` over primary + backer sheets together
- [ ] P9. Browser verification end-to-end against `/products/856/cutlist-builder` covering every Acceptance criterion below
- [ ] P10. Final validation pass — lint, type-check at touched files, repo-wide stale-string sweep, `/simplify` over the cumulative diff


## Surprises & Discoveries




## Decision Log




## Outcomes & Retrospective




## Context and Orientation

**The product:** Unity ERP, a Next.js (App Router) furniture-manufacturing ERP backed by Supabase. This work is on `codex/integration` (or fresh task branch off it).

**The Cutlist Builder:** Per-product page at `/products/<id>/cutlist-builder` that runs a packing algorithm against a list of parts and a stock sheet, then renders one card per produced sheet. The top-level component is `CutlistCalculator.tsx`. It owns two `result` objects when products use lamination-with-backer: `result` (primary sheets) and `backerResult` (backer sheets). Each is rendered through its own `<SheetLayoutGrid>` instance. The grid renders a card per sheet with: the SVG diagram via `<SheetPreview>`, sheet stats, a "Charge full sheet" toggle, a "Manual %" input, and a "Reset to auto" link.

**Today's per-sheet stats** display two lines: `Used 45.5% (2.27 m² of 5.00 m²)` and a two-line block `Reusable offcuts: 3 (26770 cm²)` / `Scrap pockets: 0 (0.0 cm²)`. The `offcut_summary` carries the rich data (`reusableOffcuts: OffcutRect[]` with x/y/w/h/area each), but only the count and total area surface.

**Existing billing model** (preserved unchanged):
- `autoPct = ((sheet.used_area_mm2 || 0) / sheetArea) * 100` — mechanical utilization, raw.
- Per-sheet override shape `{ mode: 'auto' | 'manual' | 'full', manualPct: number }` keyed by `sheet.sheet_id` in a `sheetOverrides` map.
- `mode = globalFullBoard ? 'full' : (override?.mode ?? 'auto')` — global Charge-full toggle wins.
- "Reset to auto" deletes the per-sheet override entry; `autoPct` then displays.
- `chargePct = mode === 'full' ? 100 : mode === 'manual' ? manualPct : autoPct` — drives the "Billing X.X%" readout and downstream costing.

**Sheet grain convention** (confirmed in prior work): grain runs along the sheet's `length_mm` (Y) axis. For an `OffcutRect { x, y, w, h }`, `h` is along grain and `w` is across grain. Offcut size labels read as `{long} × {short}` mm where long = `Math.max(w, h)`.

**SheetPreview internals you must respect:** `preview.tsx` computes a `scale` factor and `sheetX`/`sheetY` padding offsets in its body (search for `const padding =`). Placements render at `sheetX + pl.x * scale` (search for that exact pattern). Reusable-offcut rects MUST use the identical transform — raw rect coordinates would render off-position. Adaptive label sizing already exists for placement labels using `CHAR_WIDTH_RATIO = 0.6` and `MIN_LABEL_FONT = 5` — reuse the same constants and approach for offcut labels.

**Test runner:** `node:test` driven via `npx tsx --test tests/<file>.test.ts`. Tests use `assert/strict`. No React component test infrastructure exists in this repo — verification of UI components is via lint, type-check, and Claude-in-Chrome browser walkthrough.

**Scope is screen-only.** The order-level multi-product PDF cutting plan is a separate future workstream; do not touch any PDF rendering code.

**No costing engine changes.** `chargePct` flows through to costing today; that path is untouched. Effective utilization is informational. The chips populate the existing Manual % input via the existing override-write code path; nothing downstream from `chargePct` changes shape.

**Verification harness:**
- Lint: `npm run lint` — tolerate the 37 pre-existing image-related warnings.
- Type-check: `npx tsc --noEmit` — the touched files must be clean. ~138 pre-existing baseline errors elsewhere in the repo (lib/assistant/, components/quotes/, app/todos/, etc.) are out of scope. Filter your tsc output by touched-file paths to confirm no new errors.
- Unit tests: `npx tsx --test tests/cutlist-effective-utilization.test.ts`.
- Manual: log in as `testai@qbutton.co.za` / `ClaudeTest2026!` at `http://localhost:3000`. The dev server may already be running — check before starting another.

**Multi-tenancy:** No data-layer changes. The existing per-sheet override map is local React state that flows through to the costing snapshot via the existing path.


## Plan of Work

### Module ordering and rationale

1. **`lib/cutlist/effectiveUtilization.ts` (new)** — Pure math, zero dependencies on React or the packer. Test-first. Single source of truth for the percentage tiers (raw vs. display) so all three call sites can never disagree.

2. **`tests/cutlist-effective-utilization.test.ts` (new)** — Truth-table coverage of the helper. Every edge case the spec calls out has an assertion: 40/30/30 split, zero reusable, 100% used, area drift, parts overflow, zero total, missing offcut_summary, rolled-up area-summing (NOT pct-averaging), empty rolled-up.

3. **`components/features/cutlist/primitives/UtilizationBar.tsx` (new)** — Segmented bar + 3-column legend (collapses to 2 when no reusable area) + "Mechanical X% · Effective Y%" line below with an Info tooltip on Effective. Read-only display primitive. Uses display percentages for segments and raw percentages for the labels. Optional `title` prop for the rolled-up "All sheets" caption.

4. **`components/features/cutlist/primitives/ReusableOffcutList.tsx` (new)** — Bullet list of offcut sizes formatted `{long} × {short} mm`, sorted by area descending, collapsing past 6 with a `+N more` in-place expander.

5. **`components/features/cutlist/preview.tsx` (modify)** — Add a single new optional prop `showOffcutOverlay?: boolean` (default `false`). When true, render a new SVG group iterating `layout.offcut_summary?.reusableOffcuts`, each rect drawn at the same coordinate transform as placements. Each rect carries an adaptive label using the same `CHAR_WIDTH_RATIO` and font-fit pattern as the existing placement labels (search the file for `CHAR_WIDTH_RATIO` to find the canonical heuristic). Three label modes by descending preference: two-line inside (dimensions + `reusable · {area} cm²`), one-line inside (dimensions only), outside leader-line (1px green line to nearest sheet edge with the dimensions label at the endpoint). Leader-line collision avoidance is explicitly deferred to a future polish pass — the B size list provides the canonical fallback.

6. **`components/features/cutlist/primitives/SheetLayoutGrid.tsx` (modify)** — Inside the per-sheet card render block, compute `breakdown = computeSheetUtilization(sheetLayout, sheetW, sheetL)` once. Pass `showOffcutOverlay` to the existing `<SheetPreview>` call. Replace the existing two-line stats block (the `Used 45.5%` line and the `Reusable offcuts: N / Scrap pockets: N` block) with: `<ReusableOffcutList>` (only when `breakdown.hasReusable`), then `<UtilizationBar>`, then a small monospace m² readout for parity. Insert three quick-fill chips immediately above the existing `Manual %` input. Each chip is a `<button>` showing `{label}\n{pct.toFixed(1)}` in a 3-column grid with `gap-1`. On click, write the per-sheet override `{ mode: 'manual', manualPct: <raw value from breakdown> }` via the existing `onSheetOverridesChange` setter. Disable each chip when either `globalFullBoard` is true OR the per-sheet `mode === 'full'` (matching the existing Manual % input's disabled rule). Hide the Eff chip entirely when `breakdown.hasReusable` is false.

7. **`components/features/cutlist/primitives/InteractiveSheetViewer.tsx` (modify)** — Compute `breakdown` the same way. Pass `showOffcutOverlay` to its `<SheetPreview>` call. Replace the existing `Used …` / `Reusable offcuts: …` / `Scrap pockets: …` block in the stats panel with `<ReusableOffcutList>` (when `hasReusable`) plus `<UtilizationBar>` plus a small m² readout. **No chips, no Manual % input, no Reset link** in the modal — read-only inspection.

8. **`components/features/cutlist/CutlistCalculator.tsx` (modify)** — Memoize a `rolledUpBreakdown` from `computeRolledUpUtilization` over the union of `result.sheets` and `backerResult?.sheets`, paired with each sheet's own dimensions (use `layout.stock_width_mm || sheet.width_mm` and the equivalent backer fallback to handle multi-material sheets). Render a single `<UtilizationBar title="All sheets">` inside a small bordered container immediately above the first `<SheetLayoutGrid>` call.

### Two implementation choices left to Codex

These were flagged in the writing-plans pass as having reasonable alternatives:

- **Chip rendering** — extract a `ChipButton` helper or inline three `<Button>` calls. Either is fine; the contract is what matters (raw value, override write, disabled rule, Eff hidden when no reusable).
- **Leader-line orientation rule** — when an offcut is too small for an inside label, the spec says "leader to nearest sheet edge." A trivial v1 picks "below" for wide-short rects and "right" for tall-thin rects. A smarter rule (e.g. always pick the edge with the most adjacent free space) is fine if obvious; otherwise ship the trivial heuristic and add `[deferred: collision avoidance]` to Surprises.


## Concrete Steps

1. Confirm working directory is `/Users/gregorymaier/developer/unity-erp` and branch is `codex/integration` (or a fresh task branch off it). `git status` should be clean. If there are uncommitted edits unrelated to this plan, stash them with a clear name before starting (`git stash push -u -m "pre-offcut-viz-<date>"`).

2. **(P1+P2)** Implement the helper and its tests together (TDD on the helper is the cheapest correctness gate). Test file goes at `tests/cutlist-effective-utilization.test.ts`. Helper at `lib/cutlist/effectiveUtilization.ts`. The exported types and signatures are pinned in **Interfaces and Dependencies**. The 9 truth-table cases the tests must cover are listed in **Validation and Acceptance**. Run `npx tsx --test tests/cutlist-effective-utilization.test.ts` and confirm `# pass 9 / # fail 0`. Commit:

   ```
   git add lib/cutlist/effectiveUtilization.ts tests/cutlist-effective-utilization.test.ts
   git commit -m "feat(cutlist): add effective-utilization helper with raw/display percentage tiers"
   ```

3. **(P3)** Implement `components/features/cutlist/primitives/UtilizationBar.tsx`. Props pinned in **Interfaces and Dependencies**. Render rules: bar with three colored segments using `displayPartsPct`, `displayReusablePct`, `displayScrapPct` widths; legend in a 3-column grid (or 2-column when `hasReusable === false`); below the legend a monospace line `Mechanical X.X%`, then `· Effective Y.Y%` (in green) when `hasReusable`, with an Info icon `(i)` triggering the tooltip whose copy is pinned below. Tooltip uses the existing shadcn `Tooltip` primitive set with `<TooltipContent className="max-w-xs text-xs leading-snug">` (the existing `TooltipContent` has no default max-width — without this class the verbose copy renders comically wide). Run `npx tsc --noEmit 2>&1 | grep UtilizationBar` and confirm zero errors at the new file. Commit standalone.

4. **(P4)** Implement `components/features/cutlist/primitives/ReusableOffcutList.tsx`. Props pinned below. Sort `offcuts` by `area_mm2` descending. Format each line `• {Math.round(long)} × {Math.round(short)} mm` where `long = Math.max(w, h)`. When `offcuts.length > collapseAfter` (default 6), show the first `collapseAfter - 1` items and a `+{N} more` button that toggles to show all in place — no modal. Render nothing when `offcuts.length === 0`. Commit standalone.

5. **(P5)** Modify `components/features/cutlist/preview.tsx`:
   - Add the new optional prop `showOffcutOverlay?: boolean` to `SheetPreviewProps` (default `false`).
   - Add three module-level color constants near the existing `EDGE_BAND_COLOR` definition: `REUSABLE_FILL = 'rgba(16, 185, 129, 0.32)'`, `REUSABLE_STROKE = 'rgb(16, 185, 129)'`, `REUSABLE_LABEL_COLOR = 'rgb(52, 211, 153)'` (emerald-400 — chosen to read on both dark and light backdrops).
   - When `showOffcutOverlay && layout.offcut_summary?.reusableOffcuts` is non-empty, render a new SVG group inside the `<svg>` after the placements `.map(...)`. Each `OffcutRect` becomes one `<g pointerEvents="none">` containing a `<rect>` (with the fill, stroke, stroke-width 1.5) plus a label rendered per the three-mode decision tree described in **Plan of Work** §5. The rect coordinate transform is `cx = sheetX + rect.x * scale`, `cy = sheetY + rect.y * scale`, `cw = rect.w * scale`, `ch = rect.h * scale` — identical to the placement render.
   - The label fit-test compares `cw` and `ch` (post-scale pixel dimensions) against `dimFont * CHAR_WIDTH_RATIO * label.length` (pixel width estimate). Two-line label requires `cw ≥ dimWidthEst + 8` AND the area-line width estimate also fits AND `ch ≥ 2 * lineHeight + 4`. One-line requires `cw ≥ dimWidthEst + 4` AND `ch ≥ lineHeight + 2`. Otherwise outside leader.
   - Format: dimensions label `{long} × {short}` (rounded mm). Optional second line `reusable · {Math.round(area_mm2 / 100)} cm²` only on the two-line branch. Both monospace, dimensions weight 600.
   - Run `npx tsc --noEmit 2>&1 | grep "preview.tsx"` — zero errors. Commit standalone.

6. **(P6)** Modify `components/features/cutlist/primitives/SheetLayoutGrid.tsx` per the contract in **Plan of Work** §6. Key invariants:
   - The chip click handler MUST write `{ mode: 'manual', manualPct: <value> }` via the existing `onSheetOverridesChange` setter. The field name is `mode`, not `chargeMode`. Match the shape used by the existing Manual % input handler in this same file — search for `[sheetLayout.sheet_id]: { mode: 'manual', manualPct: nextPct }` to find the canonical pattern.
   - Chips disabled rule must match the Manual % input's existing disabled rule (`globalFullBoard || mode === 'full'`).
   - The Eff chip is hidden (not just disabled) when `breakdown.hasReusable === false`.
   - Pass `showOffcutOverlay` to the existing `<SheetPreview>` call (no other prop changes).
   - Existing "Charge full sheet" toggle, Manual % input, "Billing X.X%" readout, and "Reset to auto" link stay in place with unchanged behaviour. "Reset to auto" continues to delete the override entry from the map (do not change it to "set Manual % to autoPct").
   - Run lint and `npx tsc --noEmit 2>&1 | grep "SheetLayoutGrid.tsx"` — zero new errors. Commit standalone.

7. **(P7)** Modify `components/features/cutlist/primitives/InteractiveSheetViewer.tsx` per **Plan of Work** §7. The key constraint: the modal stats panel is read-only — no chips, no Manual % input, no Reset link. The modal also gets `showOffcutOverlay` on its `<SheetPreview>`. Commit standalone.

8. **(P8)** Modify `components/features/cutlist/CutlistCalculator.tsx`:
   - Add a `useMemo` building `allSheetsForRollup` from `result.sheets` (mapped to include each sheet's stock dimensions, falling back to the primary stock-sheet dimensions when `layout.stock_width_mm` / `layout.stock_length_mm` are missing) plus `backerResult?.sheets` (same treatment, falling back to backer stock-sheet dimensions).
   - Add another `useMemo` calling `computeRolledUpUtilization(allSheetsForRollup)` when the array is non-empty.
   - Render a single `<UtilizationBar title="All sheets">` inside a small bordered container (`rounded border bg-muted/30 px-3 py-2.5`) immediately above the existing `<SheetLayoutGrid result={result} ...>` call. Search the file for the existing `{/* Sheet Layout Grid */}` comment to find the insertion point.
   - If the surrounding stock-sheet variable names differ from `sheet` / `backerSheet`, adapt — these are the names visible in the call-site context (search for `stockSheet={sheet}` and `stockSheet={backerSheet}` to confirm).
   - Run lint and tsc on the touched file — zero new errors. Commit standalone.

9. **(P9)** Browser walkthrough — see **Validation and Acceptance** for the exact criteria. Capture screenshots or text descriptions for the **Artifacts and Notes** section as evidence.

10. **(P10)** Final validation:
    - Repo-wide stale-string sweep: `grep -rn "Reusable offcuts: \|Scrap pockets:" --include="*.tsx" components/features/cutlist`. Expected: only hits inside the new `ReusableOffcutList` (which uses singular `Reusable offcuts (N)` format) — no remaining old two-line block strings. Investigate any other hits.
    - `npm run lint` — 0 errors, 37 pre-existing image warnings tolerated.
    - `npx tsc --noEmit` — touched files clean (filter output for `lib/cutlist/effectiveUtilization|UtilizationBar|ReusableOffcutList|preview\.tsx|SheetLayoutGrid|InteractiveSheetViewer|CutlistCalculator|tests/cutlist-effective-utilization`); the ~138 unrelated baseline errors are out of scope.
    - `npx tsx --test tests/cutlist-effective-utilization.test.ts tests/cutlist-packing.test.ts tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts` — all pass; the prior suites confirm no regression in the upstream packer/normalizer work.
    - Run `/simplify` over the cumulative diff and address anything flagged before the final commit.


## Validation and Acceptance

The following observable behaviours must all hold after the work lands. Capture transcripts and short text descriptions in **Artifacts and Notes**.

1. **Helper test transcript** —

   ```
   $ npx tsx --test tests/cutlist-effective-utilization.test.ts
   ...
   # pass 9
   # fail 0
   ```

   The 9 cases must cover: (a) 40/30/30 split with display pcts summing to exactly 100; (b) zero reusable → `hasReusable === false`, `effectivePctRaw === mechanicalPctRaw`; (c) 100% used → `displayPartsPct === 100`, others 0; (d) area drift where `partsArea + reusableArea > totalArea` → parts area preserved, reusable clamped to `total − parts`, `hasAreaDrift === true`, `mechanicalPctRaw` unchanged from raw; (e) parts overflow `total` → parts clamped to total, reusable and scrap both 0; (f) zero total area → no divide-by-zero, all zero pcts; (g) sheet missing `offcut_summary` → reusable defaults to 0; (h) rolled-up sums areas first, then computes pcts (NOT averages of per-sheet pcts) — verify with the worked example in **Interfaces and Dependencies** below; (i) empty rolled-up array — guards against divide-by-zero.

2. **Per-sheet card visualization** — Sign in to `http://localhost:3000` as the test account, open `/products/856/cutlist-builder`, run a calculation. For at least one sheet card:
   - The reusable offcut bullet list appears above the bar when reusable count > 0 (heading `Reusable offcuts (N)`, then bullets `• {long} × {short} mm`, sorted by area descending).
   - The segmented bar shows three coloured segments (blue / emerald / gray) and a 3-column legend below reading `Parts X.X% / Reuse Y.Y% / Scrap Z.Z%`.
   - Below the legend a monospace line reads `Mechanical X.X% · Effective Y.Y%` (Effective in green) with an Info `(i)` icon at the end.
   - Hovering the `(i)` icon surfaces a tooltip whose text begins "Parts placed plus reusable offcuts retained as stock" and is constrained in width (no comically wide single-line rendering).
   - A 3-column row of chips reads `Mech X.X` / `Eff Y.Y` / `Full 100` immediately above the Manual % input.
   - Clicking the **Eff** chip writes that value to the Manual % input and the "Billing X.X%" readout updates accordingly.
   - Clicking **Reset to auto** clears the override; reading the Mech chip's number and clicking it produces the SAME numeric value the input now displays (no off-by-0.1 discrepancy — proves chips use raw percentages, not rounded display).

3. **Charge-full toggle interaction** — Toggle the per-sheet "Charge full sheet" switch ON. All three chips visibly disable AND the Manual % input disables (existing behaviour preserved). Toggle OFF — chips and input re-enable.

4. **Global Charge-full interaction** — Toggle the global "Charge full sheet for every used board" switch (above the page selector) ON. All chips across all per-sheet cards disable. Toggle OFF — chips re-enable.

5. **SVG offcut overlay on the per-sheet diagram** — Visible green-fill rectangles over reusable areas of each sheet. Each carries a label like `680 × 320`. Larger offcuts also show `reusable · {N} cm²` underneath. Tiny offcuts (smaller than the inside-label fit threshold) use a leader line with a label outside the rect. Coordinates align exactly — labels sit visually within or pointing to their rects.

6. **Zoom modal mirror** — Click "Zoom" on a sheet. The modal opens. The same green offcut overlay renders on the larger SVG. The right-side stats panel shows the reusable-offcut bullet list, the segmented bar with legend, and the Mechanical/Effective line. There are NO chips, NO Manual % input, and NO Reset link in the modal.

7. **Rolled-up "All sheets" bar** — Above the per-sheet grid, a wider bordered container holds a single `UtilizationBar` titled "All sheets". Its math reflects all primary AND backer sheets (sanity check on a with-backer product: the rolled-up parts area equals the sum of per-sheet parts areas across both grids).

8. **Zero-reusable case** — Find or construct a sheet with no reusable offcuts (e.g., a layout that fully fills the sheet). Confirm:
   - The bar shows only Parts + Scrap (no green segment).
   - The legend collapses to two columns.
   - The "Mechanical X.X%" line is shown alone — no `· Effective`, no `(i)`.
   - The Eff chip is HIDDEN entirely (not just disabled).
   - The reusable-offcut bullet list is hidden.

9. **Lint and type-check transcripts**:

   ```
   $ npm run lint
   ...
   ✖ 37 problems (0 errors, 37 warnings)

   $ npx tsc --noEmit 2>&1 | grep -E "lib/cutlist/effectiveUtilization|UtilizationBar|ReusableOffcutList|preview\.tsx|SheetLayoutGrid|InteractiveSheetViewer|CutlistCalculator|tests/cutlist-effective-utilization"
   (no output)
   ```

   The grep producing no output proves all touched files type-check clean. The repo-wide tsc baseline noise outside touched files is acceptable.

10. **Repo-wide stale-string sweep**:

    ```
    $ grep -rn "Reusable offcuts: \|Scrap pockets:" --include="*.tsx" components/features/cutlist
    (only hits inside ReusableOffcutList.tsx with the singular "Reusable offcuts (N)" form)
    ```

    No old two-line `Reusable offcuts: N (...) / Scrap pockets: N (...)` blocks remain in any modified file.


## Idempotence and Recovery

Each Progress item P1-P10 corresponds to its own commit. To roll back a single step, `git revert <commit>` for that commit; the others survive. To roll back the whole branch, `git reset --hard <pre-P1-sha>`.

No data-layer changes. No SQL migrations. No JSONB shape changes. The existing `sheetOverrides` map and the per-sheet override shape `{ mode, manualPct }` are unchanged. The existing `chargePct` flow into costing is unchanged.

Re-running the plan after partial completion: each step inspects the current source before editing. The grep sweep at P10 is the canonical "are we done?" check — if it returns matches outside `ReusableOffcutList.tsx`, P6 or P7 left work undone. The unit tests at P2 are the canonical "is the math right?" check.

If the SVG overlay's adaptive label heuristic produces visibly bad results in the browser (overflow, missing labels), iterate on the threshold constants in `preview.tsx` rather than redesigning. Worst case: drop the area-line entirely and ship dimensions-only labels. Document any such retreat in **Decision Log**.


## Artifacts and Notes




## Interfaces and Dependencies

### New module — `lib/cutlist/effectiveUtilization.ts`

Exports:

```ts
import type { SheetLayout } from './types';

export interface UtilizationBreakdown {
  totalArea_mm2: number;
  partsArea_mm2: number;       // clamped to [0, totalArea]
  reusableArea_mm2: number;    // clamped to [0, totalArea − partsArea]
  scrapArea_mm2: number;

  // Raw — drive chip values + "Reset to auto" parity. No rounding compensation.
  mechanicalPctRaw: number;
  effectivePctRaw: number;

  // Display — drive bar segments. Sum to exactly 100 via rounding compensation
  // (round each to 1 decimal, push delta onto whichever segment has the largest
  // unrounded value).
  displayPartsPct: number;
  displayReusablePct: number;
  displayScrapPct: number;

  hasReusable: boolean;        // reusableArea_mm2 > 0
  hasAreaDrift: boolean;       // raw (parts + reusable) exceeded totalArea before clamping
}

export function computeSheetUtilization(
  sheet: SheetLayout,
  sheetWidth_mm: number,
  sheetLength_mm: number,
): UtilizationBreakdown;

export function computeRolledUpUtilization(
  sheets: Array<{ layout: SheetLayout; widthMm: number; lengthMm: number }>,
): UtilizationBreakdown;
```

Implementation invariants:

- **Parts area is trusted; reusable yields to drift.** Clamp parts to `[0, total]` first, then clamp reusable to `[0, total − parts]`. Never silently reduce the parts percentage to make room for reusable.
- **`partsArea_mm2 = sheet.used_area_mm2 ?? sum of placement w*h`** — fall back to summing placements only when `used_area_mm2` is missing (defensive).
- **`reusableArea_mm2 = sheet.offcut_summary?.reusableArea_mm2 ?? 0`**.
- **Rolled-up sums areas first, THEN computes percentages.** Worked example: sheet1 = 4 m² parts / 1 m² reusable / 5 m² total; sheet2 = 0 / 0 / 5 m² total. Combined = 4 m² parts / 1 m² reusable / 10 m² total → 40% / 10% / 50%. Do NOT average per-sheet percentages.
- **`hasAreaDrift`** is set when raw (parts + reusable) > total + 0.5 mm² (tolerate sub-mm² floating-point fuzz).

### New component — `components/features/cutlist/primitives/UtilizationBar.tsx`

Props:

```ts
interface UtilizationBarProps {
  breakdown: UtilizationBreakdown;
  className?: string;
  title?: string;  // shown above the bar in small uppercase muted text
}
```

Render contract:
- Bar height ~18px, three colored segments using display percentages as widths.
- Colors: parts blue, reusable emerald, scrap gray (specific Tailwind utility classes are Codex's call as long as they're visually distinct in both themes).
- Legend grid below: 3 columns when `hasReusable`, 2 columns otherwise. Each column: color swatch + `Parts|Reuse|Scrap` label + raw display percentage.
- Below the legend: monospace `Mechanical X.X%`. When `hasReusable`, append `· Effective Y.Y%` in green plus an Info icon `(i)` button. The Info button uses shadcn `Tooltip` with `<TooltipContent className="max-w-xs text-xs leading-snug">`.

### New component — `components/features/cutlist/primitives/ReusableOffcutList.tsx`

Props:

```ts
import type { OffcutRect } from '@/lib/cutlist/types';

interface ReusableOffcutListProps {
  offcuts: OffcutRect[];
  className?: string;
  collapseAfter?: number;  // default 6
}
```

Render contract:
- Header `Reusable offcuts (N)` in muted text where N = `offcuts.length`.
- Sorted by `area_mm2` descending.
- Each item: `• {Math.round(long)} × {Math.round(short)} mm` where `long = Math.max(w, h)`.
- When `offcuts.length > collapseAfter`, show first `collapseAfter - 1` items plus a `+{remaining} more` button that toggles to show all in place.
- Returns `null` when `offcuts.length === 0`.

### Modified — `components/features/cutlist/preview.tsx`

`SheetPreviewProps` gains one optional prop:

```ts
showOffcutOverlay?: boolean;  // default false
```

New module-level constants (place near the existing `EDGE_BAND_COLOR`):

```ts
const REUSABLE_FILL = 'rgba(16, 185, 129, 0.32)';
const REUSABLE_STROKE = 'rgb(16, 185, 129)';
const REUSABLE_LABEL_COLOR = 'rgb(52, 211, 153)';  // emerald-400
```

Render contract for the overlay group (only when `showOffcutOverlay && layout.offcut_summary?.reusableOffcuts.length > 0`):
- Coordinate transform IDENTICAL to placement render: `cx = sheetX + rect.x * scale`, `cy = sheetY + rect.y * scale`, `cw = rect.w * scale`, `ch = rect.h * scale`.
- Each rect: filled `REUSABLE_FILL`, stroked `REUSABLE_STROKE` weight 1.5.
- Adaptive label using existing `CHAR_WIDTH_RATIO` and `MIN_LABEL_FONT` constants. Three modes by descending preference:
  - **Two-line inside**: dimensions + `reusable · {area_cm²}` line beneath, both centered, monospace, dimensions weight 600 in `REUSABLE_LABEL_COLOR`. Requires `cw ≥ dimWidthEst + 8 && cw ≥ areaWidthEst + 8 && ch ≥ 2 * lineHeight + 4`.
  - **One-line inside**: dimensions only, centered. Requires `cw ≥ dimWidthEst + 4 && ch ≥ lineHeight + 2`.
  - **Outside leader**: 1px green line from rect center to a point ~12px outside the nearest sheet edge; label at the leader endpoint anchored away from the sheet. Trivial v1 orientation rule (e.g. `cw >= ch ? "below" : "right"`) is acceptable; collision avoidance is deferred.
- Group has `pointerEvents="none"` so it doesn't break click/hover on placements.

### Modified — `components/features/cutlist/primitives/SheetLayoutGrid.tsx`

Inside the per-sheet card render, before any new markup, compute:

```ts
const breakdown = computeSheetUtilization(sheetLayout, sheetW, sheetL);
```

Replace the existing two-line stats block (the `Used 45.5%` line and the `Reusable offcuts: N / Scrap pockets: N` block — both rendered when `sheetLayout.offcut_summary` is present) with:

1. `<ReusableOffcutList offcuts={sheetLayout.offcut_summary.reusableOffcuts} />` (only when `breakdown.hasReusable`).
2. `<UtilizationBar breakdown={breakdown} />`.
3. A small `<div>` with monospace muted text showing `{(used_area_mm2/1_000_000).toFixed(2)} m² of {(sheetArea/1_000_000).toFixed(2)} m²` for parity with the original.

Add `showOffcutOverlay` to the existing `<SheetPreview>` call.

Insert three quick-fill chips immediately above the existing `Manual %` input — 3-column grid `gap-1`, each chip a `<button>` with `{label}` on the top line and `{rawPct.toFixed(1)}` on the bottom line in monospace. Click handler writes `{ mode: 'manual', manualPct: <raw value> }` via `onSheetOverridesChange`. Disable rule: `globalFullBoard || mode === 'full'`. Eff chip hidden when `!breakdown.hasReusable`.

The existing "Charge full sheet" switch, Manual % input, "Billing X.X%" readout, and "Reset to auto" link stay unchanged. "Reset to auto" continues to delete the per-sheet override entry — do NOT change it to write a value.

### Modified — `components/features/cutlist/primitives/InteractiveSheetViewer.tsx`

Compute `breakdown` the same way. Pass `showOffcutOverlay` to its `<SheetPreview>` call. Replace the existing `Used …` / `Reusable offcuts: …` / `Scrap pockets: …` block with `<ReusableOffcutList>` (when `hasReusable`) plus `<UtilizationBar>` plus the small m² readout. **Read-only** — no chips, no Manual % input, no Reset link.

### Modified — `components/features/cutlist/CutlistCalculator.tsx`

Two memos near the bottom of the component body, before the `return (`:

```ts
const allSheetsForRollup = React.useMemo(() => {
  if (!result) return [];
  const primary = result.sheets.map(layout => ({
    layout,
    widthMm: layout.stock_width_mm || sheet.width_mm,
    lengthMm: layout.stock_length_mm || sheet.length_mm,
  }));
  const backer = (backerResult?.sheets ?? []).map(layout => ({
    layout,
    widthMm: layout.stock_width_mm || backerSheet.width_mm,
    lengthMm: layout.stock_length_mm || backerSheet.length_mm,
  }));
  return [...primary, ...backer];
}, [result, backerResult, sheet, backerSheet]);

const rolledUpBreakdown = React.useMemo(
  () => allSheetsForRollup.length > 0 ? computeRolledUpUtilization(allSheetsForRollup) : null,
  [allSheetsForRollup],
);
```

Render `<UtilizationBar breakdown={rolledUpBreakdown} title="All sheets" />` inside `<div className="rounded border bg-muted/30 px-3 py-2.5">` immediately above the existing primary `<SheetLayoutGrid result={result} ...>` call (search for the `{/* Sheet Layout Grid */}` comment to find the insertion point).

If `sheet` / `backerSheet` are named differently in the surrounding code, adapt — these are the names visible in the existing `<SheetLayoutGrid stockSheet={sheet} ...>` and `<SheetLayoutGrid result={backerResult} stockSheet={backerSheet} ...>` calls.

### Tooltip copy — exact

> Parts placed plus reusable offcuts retained as stock. This is informational — costing uses Manual % below.

### Chip labels — exact

`Mech` / `Eff` / `Full`

### Override shape — already exists, MUST be matched

```ts
{ mode: 'auto' | 'manual' | 'full', manualPct: number }
```

Field name is `mode`, NOT `chargeMode`. Confirm by searching `SheetLayoutGrid.tsx` for the existing `[sheetLayout.sheet_id]: { mode: 'manual', manualPct: nextPct }` write pattern.

### Database / library versions

No package additions or upgrades. No SQL migrations. No RLS or schema changes. All edits use existing dependencies (`react`, `lucide-react`'s `Info` icon, the existing shadcn `Tooltip` and `Button` and `Input` primitives, the existing `cn` utility from `@/lib/utils`).

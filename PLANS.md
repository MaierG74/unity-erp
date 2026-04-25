# Cutlist Reusable-Offcut Rules

## Purpose / Big Picture

Replace org-level Cutlist Defaults with a 2D, optionally grain-aware minimum reusable offcut rule. Admins configure minimum length, minimum width, optional grain orientation, and preferred offcut dimension at `/settings/cutlist`. The Cutlist Builder preview uses the same rule for both guillotine and strip algorithms. Legacy single-dimension JSONB values continue to load without a SQL migration.

## Progress

- [x] P1. Done 2026-04-25T04:20:00Z: Created `lib/cutlist/offcuts.ts` with `isReusableOffcut` and added 9 truth-table tests in `tests/cutlist-reusable-offcut.test.ts`.
- [x] P2. Done 2026-04-25T04:23:00Z: Updated `hooks/use-org-settings.ts` to expose the new `CutlistDefaults` shape and `normalizeCutlistDefaults`; added 4 legacy-normalizer tests.
- [x] P3. Done 2026-04-25T04:29:00Z: Rewired `lib/cutlist/guillotinePacker.ts` to use shared classification and axis-aligned scoring/splitting/retention.
- [x] P4. Done 2026-04-25T04:34:00Z: Updated `lib/cutlist/stripPacker.ts` to the new config shape and to emit `offcut_summary` per sheet.
- [x] P5. Done 2026-04-25T04:35:00Z: Forwarded `packingConfig` through both `packWithStrips` call sites in `components/features/cutlist/packing.ts`.
- [x] P6. Done 2026-04-25T04:38:00Z: Updated `CutlistCalculator.tsx` config mapping and confirmed benchmark scripts had no legacy key references.
- [x] P7. Done 2026-04-25T04:42:00Z: Replaced `/settings/cutlist` with minimum length, minimum width, grain button, and preferred-dimension tooltip UI.
- [x] P8. Done 2026-04-25T04:49:00Z: Added guillotine and strip `offcut_summary` regression tests; patched guillotine standard strategy to retain per-sheet offcut info.
- [x] P9. Done 2026-04-25T04:55:00Z: Repo-wide legacy-key grep returns zero code hits outside `node_modules`; legacy read support remains via constructed key lookup.
- [x] P10. Done 2026-04-25T05:07:00Z: Ran final validation and browser acceptance checks; type-check remains blocked by pre-existing unrelated baseline errors.

## Surprises & Discoveries

- The worktree was dirty before starting, so the pre-existing local edits were stashed as `pre-reusable-offcut-plan-2026-04-25` before P1.
- `packPartsGuillotine` could choose a standard `packWithStrategy` result that did not include `perSheetOffcuts`; `toLayoutResult` therefore produced no `offcut_summary`. P8 fixed this by capturing per-sheet offcut info in `packWithStrategy` too.
- Final `npx tsc --noEmit` reports many existing baseline errors beyond the plan's documented `app/orders/[orderId]/page.tsx:192` issue. No remaining errors point at the touched cutlist files after the P10 fix.
- A stale Next dev server was already holding `.next/dev/lock`, so `npm run dev` could not start a new server and validation used the existing `http://localhost:3000` instance.

## Decision Log

- Kept the read-side legacy migration instead of a SQL migration because `organizations.cutlist_defaults` is JSONB and the plan explicitly requires no SQL.
- Mapped X-axis remnants to `minUsableWidth` and Y-axis remnants to `minUsableLength`, matching the sheet grain convention.
- Preserved the legacy single-dimension fallback by copying it to both new axes only when neither new axis key is present.
- Ignored the legacy area gate on read, as required, and removed contiguous legacy key identifiers from TypeScript/TSX so the P9 grep is authoritative.
- Updated the canonical cutlist feature doc rather than shared index docs because the work changed feature behavior but did not add a new workstream or materially change the TODO index status.

## Outcomes & Retrospective

The implementation is complete. Both packers now share one reusable-offcut classifier, both algorithms emit per-sheet `offcut_summary`, `/settings/cutlist` writes the new JSONB shape, and legacy rows still normalize safely on read. The only incomplete acceptance item is a clean whole-repo `tsc`; it is blocked by unrelated baseline errors already present across Next generated route types, assistant, payroll, quote, supplier, todo, staff, and old page code.

## Context and Orientation

Unity ERP is a Next.js App Router furniture-manufacturing ERP backed by Supabase. This work is on branch `codex/local-cutlist-tab-rewire`. The Cutlist module computes furniture sheet layouts from parts and stock sheets. Grain runs along sheet `length_mm` (Y axis); for free rectangles, `h` is along grain and `w` is across grain. Multi-tenancy is handled through org-scoped `organizations.cutlist_defaults`; RLS and SQL schema were not changed.

## Plan of Work

1. Add a standalone shared offcut classifier in `lib/cutlist/offcuts.ts`.
2. Normalize org-level cutlist defaults to `minReusableOffcutLengthMm`, `minReusableOffcutWidthMm`, `minReusableOffcutGrain`, and `preferredOffcutDimensionMm`.
3. Rewire guillotine classification and scoring to the new axis-aware config.
4. Rewire strip config and emit per-sheet offcut summaries from strip remnants.
5. Forward packer config through strip call sites.
6. Update calculator mapping and benchmark references.
7. Replace the settings UI with four controls.
8. Update packing tests for both algorithms' `offcut_summary`.
9. Sweep for legacy key references.
10. Validate with lint, type-check, tests, and browser checks.

## Concrete Steps

Commits created:

- `06d159a feat(cutlist): add isReusableOffcut helper with truth-table tests`
- `6cff6de feat(cutlist): 2D + grain-aware CutlistDefaults with legacy normalizer`
- `0fbcbab feat(cutlist): rewire guillotine packer to 2D grain-aware classification + axis-aligned scoring`
- `85f2d7a feat(cutlist): strip packer 2D config + per-sheet offcut_summary emission`
- `242646a feat(cutlist): forward packingConfig to packWithStrips call sites`
- `31e5d9a chore(cutlist): wire calculator + benchmarks to new packer config keys`
- `2c20cd5 feat(cutlist): 2D + grain-aware settings page with preferred-dim tooltip`
- `48da982 test(cutlist): cover 2D rule + strip remnant emission across both algorithms`
- `80069eb docs(cutlist): document 2D reusable-offcut defaults`
- `e7e4936 test(cutlist): keep legacy normalizer grep-clean`

## Validation and Acceptance

- Settings page rendered the new controls at `http://localhost:3000/settings/cutlist` while signed in.
- The old "Minimum reusable area" control was absent.
- Saving `600 / 400 / length / 400` produced the toast `Cutlist defaults saved`.
- Reloading the settings page preserved the grain icon `↕` and label `Grain along length`; browser text extraction does not include numeric input values, but the save round-trip succeeded through the UI.
- Product `856` cutlist builder recalculated and rendered preview offcut summaries: primary sheet `Reusable offcuts: 3 (26770 cm²)`, backer sheet `Reusable offcuts: 2 (41266 cm²)`.
- `npx tsx --test tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts tests/cutlist-packing.test.ts` passed 49/49.
- Cutlist-adjacent regression suite passed 50/50.
- `npm run lint` passed with 37 pre-existing image/alt warnings and 0 errors.
- Legacy-key grep returned zero lines outside `node_modules`.
- `npx tsc --noEmit` failed on unrelated baseline errors; no touched cutlist file remained in the error output after fixes.

## Idempotence and Recovery

Each meaningful step is committed separately. To roll back one step, run `git revert <commit>` for that step. To restore the pre-plan local dirty state, apply the stash named `pre-reusable-offcut-plan-2026-04-25`. Runtime data remains JSONB in `organizations.cutlist_defaults`; no SQL migration or destructive data operation was performed. Re-running the plan is safe: the grep sweep is the canonical check for legacy key leftovers, and the normalizer keeps old JSONB rows readable.

## Artifacts and Notes

- Test transcript: `tests/cutlist-reusable-offcut.test.ts` passed 9/9.
- Test transcript: `tests/use-org-settings-cutlist-defaults.test.ts` passed 4/4.
- Test transcript: `tests/cutlist-packing.test.ts` passed 36/36, including guillotine and strip `offcut_summary` cases.
- Adjacent regression transcript passed 50/50 across edging, snapshot freshness, cutting-plan, line allocation, material cost, and padded cost tests.
- Browser validation used the existing server at `http://localhost:3000` because a prior dev server held the Next lock.
- Canonical docs updated in `docs/features/cutlist-calculator.md`.

## Interfaces and Dependencies

New `lib/cutlist/offcuts.ts` exports `OffcutClassificationConfig` and `isReusableOffcut(rect, cfg)`.

Updated `hooks/use-org-settings.ts` exports `CutlistDefaults` with `minReusableOffcutLengthMm`, `minReusableOffcutWidthMm`, `minReusableOffcutGrain`, and `preferredOffcutDimensionMm`, plus `normalizeCutlistDefaults(raw)`.

Updated `lib/cutlist/guillotinePacker.ts` uses `PackingConfig.minUsableLength`, `minUsableWidth`, and `minUsableGrain`; removed the old scalar dimension and area config keys.

Updated `lib/cutlist/stripPacker.ts` uses the same classification fields and now populates `SheetLayout.offcut_summary`.

No package additions, package upgrades, SQL migrations, RLS changes, or database schema changes were made.

# Cutlist Offcut + Grain Visual Fixes

## Purpose / Big Picture

Two coordinated visual fixes to `SheetPreview` so the cutlist diagram reads correctly to estimators and operators. After this lands: (1) reusable offcuts on the sheet diagram are clearly distinguishable from parts (gray fill with a thin green stroke and vertical grain stripes instead of the prior transparent green that blended with the pastel parts and showed the diagonal waste crosshatch through the transparency), and (2) the grain-direction patterns drawn on parts when `showGrainDirection={true}` point in the correct axis: `grain='length'` parts show vertical lines (grain along the Y/length axis), and `grain='width'` parts show horizontal lines.

## Progress

- [x] P1. Done 2026-04-25T21:49:00+02:00 - Updated the reusable offcut overlay in `components/features/cutlist/preview.tsx` to use a gray fill, thin emerald stroke, and a new vertical-stripe `offcut-grain` SVG pattern. Touched-file type grep produced no `preview.tsx` output. Committed `02b66bc`.
- [x] P2. Done 2026-04-25T21:50:00+02:00 - Fixed the swapped `grain-length` / `grain-width` SVG pattern geometry and updated the inline comments so `grain-length` draws vertical stripes and `grain-width` draws horizontal stripes. Touched-file type grep produced no `preview.tsx` output. Committed `60b6e52`.
- [x] P3. Done 2026-04-25T21:52:00+02:00 - Browser-verified `http://localhost:3000/products/856/cutlist-builder`: offcuts render as gray rectangles with emerald borders and subtle vertical stripes; labels remain readable; diagonal waste hatch does not bleed through. Product 856 length-grain parts showed vertical stripes, and a temporary unsaved toggle of the Leg part to `grain='width'` showed horizontal stripes after recalculation.
- [x] P4. Done 2026-04-25T21:53:00+02:00 - Final validation completed: `npm run lint` returned 0 errors and 37 known warnings, `npx tsc --noEmit 2>&1 | grep "preview.tsx"` produced no output, `npm run build` completed successfully, and the related cutlist tests passed 58/58.

## Surprises & Discoveries

- 2026-04-25T21:48:00+02:00 - The checkout was already on `codex/integration` with only an unrelated pre-existing `.mcp.json` modification. A task branch `codex/local-offcut-grain-visual-fix` was created from that state and `.mcp.json` was left untouched.
- 2026-04-25T21:51:00+02:00 - The existing implementation exactly matched the reported issues: reusable offcuts used `rgba(16, 185, 129, 0.32)`, and `grain-length` drew a horizontal line while `grain-width` drew a vertical line.
- 2026-04-25T21:52:00+02:00 - Product 856 already provided reusable-offcut browser coverage and length-grain part coverage. Width-grain visual coverage required a temporary unsaved toggle of the Leg part from length to width before recalculating.

## Decision Log

- 2026-04-25T21:52:00+02:00 - Kept the existing `REUSABLE_*` constant naming and repurposed `REUSABLE_FILL` to `rgb(226, 232, 240)` with `fillOpacity={0.85}` so the gray base hides the waste crosshatch while staying visually lighter than the dark theme surface.
- 2026-04-25T21:52:00+02:00 - Added a second overlay rect for `offcut-grain` instead of replacing the base fill with a pattern-only fill, because SVG patterns do not provide a solid base color by themselves.
- 2026-04-25T21:54:00+02:00 - Kept the existing part-grain pattern IDs unchanged and only swapped their line geometry, preserving the existing consumer contract at `${pid}-grain-${pl.grain}`.

## Outcomes & Retrospective

The implementation is complete. Reusable offcuts now read as gray leftover stock with an emerald outline and vertical grain texture, and the part-grain overlays now match the established sheet-axis convention. The work remained a pure visual edit to `components/features/cutlist/preview.tsx`, plus this execution log update in `PLANS.md`.

## Context and Orientation

**The product:** Unity ERP, a Next.js App Router furniture-manufacturing ERP backed by Supabase. Work branch: `codex/local-offcut-grain-visual-fix`, created from `codex/integration`.

**The Cutlist Builder:** `/products/<id>/cutlist-builder` renders one card per produced sheet. Each card shows an SVG sheet diagram via `SheetPreview` (`components/features/cutlist/preview.tsx`). The sheet background uses a diagonal waste crosshatch, placed parts use per-part pastel colors from `getPartColorMap`, and reusable offcut overlays are drawn above the sheet.

**Sheet grain convention:** grain runs along the sheet `length_mm` (Y) axis. `GrainOrientation` is `'any' | 'length' | 'width'`. `grain='length'` means grain runs along the Y axis and should render as vertical stripes. `grain='width'` means grain runs along the X axis and should render as horizontal stripes. `grain='any'` has no grain constraint.

**Bug 1 - offcut color blended with parts:** the reusable-offcut overlay used `fill="rgba(16, 185, 129, 0.32)"`, which looked like another pastel-green part and allowed the diagonal waste crosshatch to show through.

**Bug 2 - grain patterns were swapped:** `grain-length` drew a horizontal stripe, and `grain-width` drew a vertical stripe. That inverted the visible cue anywhere `showGrainDirection={true}` is enabled.

**Out of scope:** no changes to `UtilizationBar`, `ReusableOffcutList`, legends, sidebars, data shape, database schema, RLS, migrations, or tests.

## Plan of Work

All source changes are confined to `components/features/cutlist/preview.tsx`.

P1 changed the offcut overlay by adding a new `offcut-grain` pattern in the existing SVG `<defs>` block. The offcut overlay now draws an opaque gray base rect, keeps the existing thin emerald stroke, and layers a second pattern-filled rect on top for subtle vertical grain stripes. The existing emerald label color remains unchanged.

P2 swapped the line geometry inside the existing `grain-length` and `grain-width` patterns. `grain-length` now draws a vertical line from `(3, 0)` to `(3, 6)`, and `grain-width` now draws a horizontal line from `(0, 3)` to `(6, 3)`. Comments were updated to match the real geometry.

## Concrete Steps

1. Confirmed working directory `/Users/gregorymaier/developer/unity-erp`, starting branch `codex/integration`, and pre-existing dirty file `.mcp.json`.
2. Created task branch `codex/local-offcut-grain-visual-fix` from `codex/integration`.
3. Edited `components/features/cutlist/preview.tsx` for P1: changed `REUSABLE_FILL`, added `REUSABLE_GRAIN_STROKE`, added the `offcut-grain` SVG pattern, and layered the pattern over the gray offcut base rect.
4. Ran `npx tsc --noEmit 2>&1 | grep "preview.tsx"` for P1; it produced no output.
5. Committed P1 as `02b66bc` with message `fix(cutlist): offcut overlay reads as leftover stock not another part`.
6. Edited `components/features/cutlist/preview.tsx` for P2: swapped `grain-length` and `grain-width` line geometry and corrected comments.
7. Ran `npx tsc --noEmit 2>&1 | grep "preview.tsx"` for P2; it produced no output.
8. Committed P2 as `60b6e52` with message `fix(cutlist): grain-direction patterns now point along the correct axis`.
9. Browser-verified `http://localhost:3000/products/856/cutlist-builder`; saved product 856 covered reusable offcuts and length-grain parts.
10. Temporarily toggled the Leg part to `grain='width'` in the unsaved browser state, recalculated, and verified horizontal width-grain striping.
11. Ran final lint, touched-file type grep, production build, and related cutlist tests.

## Validation and Acceptance

The following observable behaviours must hold after the work lands:

1. Reusable-offcut rectangles on `/products/856/cutlist-builder` render as gray-filled rectangles with a thin emerald stroke and are visually distinct from pastel-colored parts.
2. Reusable-offcut rectangles show subtle vertical stripes parallel to the sheet length axis.
3. Offcut dimension and area labels remain emerald-400 monospace text and stay legible on the gray fill.
4. The diagonal waste crosshatch no longer visibly bleeds through the offcut rectangles.
5. The utilization bar's "Reuse" segment remains green by construction because no bar or legend code changed.
6. Parts with `grain='length'` render thin vertical lines when grain overlay is enabled; parts with `grain='width'` render thin horizontal lines.
7. `npm run lint` completes with 0 errors and the known 37 image warnings tolerated.
8. `npx tsc --noEmit 2>&1 | grep "preview.tsx"` produces no output.
9. `npx tsx --test tests/cutlist-effective-utilization.test.ts tests/cutlist-packing.test.ts tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts` passes all tests.
10. `npm run build` completes successfully.

## Idempotence and Recovery

Two commits were made, one per source progress item. To roll back only the offcut visual treatment, revert `02b66bc`. To roll back only the part-grain axis swap, revert `60b6e52`. To roll back both, revert both commits from `codex/local-offcut-grain-visual-fix`.

No data-layer changes, SQL migrations, RLS changes, package changes, JSONB shape changes, or test changes were made. Re-running the plan is safe: P1 is complete if offcuts are gray with an emerald stroke and vertical `offcut-grain` overlay; P2 is complete if `grain-length` draws vertical lines and `grain-width` draws horizontal lines.

If browser verification shows the gray shade reads poorly on the dark theme, only tune the gray opacity or shade in `components/features/cutlist/preview.tsx` and commit that as `fix(cutlist): tune offcut fill opacity for dark theme readability`.

## Artifacts and Notes

- Branch created: `codex/local-offcut-grain-visual-fix`.
- Source commits: `02b66bc`, `60b6e52`.
- Touched source file: `components/features/cutlist/preview.tsx`.
- P1 type-grep transcript: `npx tsc --noEmit 2>&1 | grep "preview.tsx"` produced no output.
- P2 type-grep transcript: `npx tsc --noEmit 2>&1 | grep "preview.tsx"` produced no output.
- Browser screenshot artifact: `/tmp/cutlist-offcut-grain-visual-check.png`.
- Browser verification notes: the visible primary sheet showed gray reusable offcuts with emerald outlines and vertical grain stripes; labels such as `1830 × 824` / `reusable · 15079 cm²` remained readable; the gray fill hid the diagonal waste crosshatch; after a temporary unsaved Leg grain toggle, the Leg placement displayed horizontal stripes while the remaining length-grain parts retained vertical stripes.
- Final lint transcript summary: `npm run lint` completed with `✖ 37 problems (0 errors, 37 warnings)`.
- Final touched-file type transcript: `npx tsc --noEmit 2>&1 | grep "preview.tsx"` produced no output.
- Final build transcript summary: `npm run build` / `next build` compiled successfully, generated 127 static pages, and finalized page optimization.
- Final test transcript summary: `npx tsx --test tests/cutlist-effective-utilization.test.ts tests/cutlist-packing.test.ts tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts` completed with `# tests 58`, `# pass 58`, `# fail 0`.

## Interfaces and Dependencies

### Modified - `components/features/cutlist/preview.tsx`

New and updated constants:

```ts
const REUSABLE_FILL = 'rgb(226, 232, 240)';
const REUSABLE_STROKE = 'rgb(16, 185, 129)';
const REUSABLE_LABEL_COLOR = 'rgb(52, 211, 153)';
const REUSABLE_GRAIN_STROKE = 'rgb(15, 23, 42)';
```

New SVG pattern definition in the existing `<defs>` block:

```tsx
<pattern id={`${pid}-offcut-grain`} width="6" height="6" patternUnits="userSpaceOnUse">
  <line x1="3" y1="0" x2="3" y2="6" stroke={REUSABLE_GRAIN_STROKE} strokeOpacity="0.18" strokeWidth="0.5" />
</pattern>
```

Reusable offcut overlay now uses:

```tsx
<rect fill={REUSABLE_FILL} fillOpacity={0.85} stroke={REUSABLE_STROKE} strokeWidth={1.5} />
<rect fill={`url(#${pid}-offcut-grain)`} pointerEvents="none" />
```

Updated grain pattern definitions:

```tsx
{/* Grain along length axis (Y) - vertical stripes */}
<pattern id={`${pid}-grain-length`} width="6" height="6" patternUnits="userSpaceOnUse">
  <line x1="3" y1="0" x2="3" y2="6" stroke="#000" strokeOpacity="0.12" strokeWidth="0.5" />
</pattern>

{/* Grain along width axis (X) - horizontal stripes */}
<pattern id={`${pid}-grain-width`} width="6" height="6" patternUnits="userSpaceOnUse">
  <line x1="0" y1="3" x2="6" y2="3" stroke="#000" strokeOpacity="0.12" strokeWidth="0.5" />
</pattern>
```

No consumer changes were made. Pattern IDs remain unchanged, so the existing part render site that uses `${pid}-grain-${pl.grain}` continues to work.

No database, library, package, SQL, RLS, or schema dependencies changed.

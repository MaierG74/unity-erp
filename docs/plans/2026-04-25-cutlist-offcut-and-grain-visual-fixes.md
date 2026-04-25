# Cutlist Offcut + Grain Visual Fixes

## Purpose / Big Picture

Two coordinated visual fixes to `SheetPreview` so the cutlist diagram reads correctly to estimators and operators. After this lands: (1) reusable offcuts on the sheet diagram are clearly distinguishable from parts (gray fill with a thin green stroke and vertical grain stripes — instead of today's transparent green that blends with the pastel parts and accidentally shows the diagonal waste crosshatch through the transparency), and (2) the grain-direction patterns drawn on parts when `showGrainDirection={true}` actually point in the correct axis — `grain='length'` parts show vertical lines (grain along the Y/length axis), `grain='width'` parts show horizontal lines. Today the patterns are swapped, so any time grain overlay is enabled the visual cue points the wrong way.


## Progress

- [ ] P1. Update the reusable offcut overlay in `components/features/cutlist/preview.tsx` to use a gray fill + thin green stroke + vertical-stripe pattern indicating grain along the long axis. Add the new SVG pattern definition alongside the existing `grain-length` / `grain-width` / `waste` patterns.
- [ ] P2. Fix the swapped grain patterns in the same file: `grain-length` must draw lines parallel to the Y/length axis (vertical), `grain-width` must draw lines parallel to the X/width axis (horizontal). Update the inline comments so they no longer contradict themselves.
- [ ] P3. Browser verification at `http://localhost:3000/products/856/cutlist-builder` — confirm offcuts read as gray-with-vertical-stripes bordered green; confirm parts with `grain='length'` (toggle `showGrainDirection` if needed) show vertical lines; confirm `grain='width'` shows horizontal.
- [ ] P4. Final validation — `npm run lint` clean (37 pre-existing image warnings tolerated), `npx tsc --noEmit` shows no new errors at the touched file, all existing tests pass.


## Surprises & Discoveries




## Decision Log




## Outcomes & Retrospective




## Context and Orientation

**The product:** Unity ERP, a Next.js (App Router) furniture-manufacturing ERP. Branch: `codex/integration` (or fresh task branch off it).

**The Cutlist Builder** at `/products/<id>/cutlist-builder` renders one card per produced sheet. Each card shows an SVG sheet diagram via `SheetPreview` (`components/features/cutlist/preview.tsx`). Three layers stack on the sheet background: the sheet itself (with a diagonal "waste" crosshatch pattern showing through to indicate uncut sheet area), placed parts (filled with per-part pastel colors from `getPartColorMap`), and — added recently — reusable offcut overlays.

**Sheet grain convention** (already pinned in prior work): grain runs along the sheet's `length_mm` (Y) axis — the long dimension. The `GrainOrientation` enum is `'any' | 'length' | 'width'`. When a part has `grain='length'`, its grain runs along the Y axis (vertical in the rendered SVG). When `grain='width'`, grain runs along the X axis (horizontal). When `'any'`, no grain constraint.

**The two bugs being fixed:**

**Bug 1 — offcut color blends with parts.** Today's reusable-offcut overlay (added in the prior visualization work) uses `fill="rgba(16, 185, 129, 0.32)"` — a 32% opaque emerald. With pastel parts in adjacent cells (Top blue, Leg yellow, Modesty green), the green tint reads as "another part of the same family" rather than "leftover stock". The 32% transparency also lets the diagonal waste crosshatch bleed through, producing accidental diagonal stripes that look grain-ish but aren't tied to any actual grain direction.

**Bug 2 — grain patterns swapped.** The existing SVG `<pattern>` definitions for grain direction draw the wrong axis:

```
{/* Grain direction: horizontal lines (grain along length / x-axis) */}
<pattern id="...grain-length"> ... line at y=3 (horizontal) ... </pattern>

{/* Grain direction: vertical lines (grain along width / y-axis) */}
<pattern id="...grain-width"> ... line at x=3 (vertical) ... </pattern>
```

The `grain-length` pattern draws *horizontal* lines; the `grain-width` pattern draws *vertical*. Per the convention above, this is inverted: `grain='length'` should draw lines parallel to the length axis (vertical), and `grain='width'` parallel to the width axis (horizontal). The inline comments themselves contradict each other ("horizontal lines" + "x-axis" do not both align with "length"). Anywhere `showGrainDirection={true}` is set on `SheetPreview`, parts with grain orientations render the visual cue in the wrong axis.

**Where these patterns are consumed:** `SheetPreview` defines all three patterns (`grain-length`, `grain-width`, `waste`) inside `<defs>` (around lines 133-194). The grain patterns are applied as `fill="url(#...)"` to parts that have a grain orientation (around line 300, gated on `showGrainDirection && pl.grain && pl.grain !== 'any'`). The offcut overlay (around line 488) uses a flat `REUSABLE_FILL` and currently has no grain pattern at all.

**Out of scope:** any change to the bar/legend/sidebar primitives (`UtilizationBar`, `ReusableOffcutList`). Those use color tokens that remain unchanged. The bar's "Reuse" segment stays green — only the SVG diagram treatment changes. The grain patterns on parts are also not consumed in the bar/legend, only on the SVG.

**Verification harness:**
- Lint: `npm run lint` — tolerate the 37 pre-existing image-related warnings.
- Type-check: `npx tsc --noEmit` — touched file (`preview.tsx`) must be clean. Pre-existing baseline errors elsewhere (~138, in `lib/assistant/`, `components/quotes/`, `app/todos/` etc.) are out of scope.
- Tests: `npx tsx --test tests/cutlist-effective-utilization.test.ts tests/cutlist-packing.test.ts tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts` — all pass; this work is purely visual and shouldn't affect any test.
- Manual: log in as `testai@qbutton.co.za` / `ClaudeTest2026!` at `http://localhost:3000`. Dev server may already be running.


## Plan of Work

### Single file: `components/features/cutlist/preview.tsx`

Both fixes land here. Two logical changes, applied in either order; for clarity below they're described as P1 then P2.

**P1 — Offcut visual treatment.**

In the `<defs>` block alongside the existing `grain-length`, `grain-width`, and `waste` patterns, add one new pattern named `offcut-grain` that draws thin vertical lines (parallel to the Y axis, i.e. parallel to the sheet's grain). Same dimensions and stroke style as the existing grain patterns (6 × 6 user-space units, single line, low-opacity dark stroke) so it reads as a familiar grain texture without dominating.

Update the existing offcut overlay rect (search for `REUSABLE_FILL` to find the call site, around line 488). Three changes:

1. **Fill** changes from the existing flat `REUSABLE_FILL` (transparent emerald) to a layered treatment: a base gray fill (suggestion: slate-200 at ~55% opacity, dark enough to read on the dark theme background, opaque enough to hide the diagonal waste crosshatch that currently bleeds through) plus the new `offcut-grain` pattern overlaid on top via a second `<rect>` element (or a single rect with the pattern as fill — whichever is cleaner in SVG terms; the visual goal is gray base with subtle vertical stripes).
2. **Stroke** stays as the existing `REUSABLE_STROKE` (emerald 1.5px) — this is the only place we keep the green, and it ties the diagram visually to the bar legend's "Reuse" green so an estimator scanning between the diagram and the legend sees the link.
3. **Label colors** stay as `REUSABLE_LABEL_COLOR` (emerald-400). The label is monospace text on top of the gray fill, which has plenty of contrast.

The existing constants `REUSABLE_FILL`, `REUSABLE_STROKE`, `REUSABLE_LABEL_COLOR` live near the top of the file. Either repurpose `REUSABLE_FILL` to the new gray value (and add a new constant for the stripe pattern), or rename it (`OFFCUT_FILL`) and add adjacent constants — Codex's call based on what reads cleanest in the file's existing conventions.

**P2 — Grain pattern swap.**

In the same `<defs>` block, swap the line geometry of `grain-length` and `grain-width` (or rename the pattern IDs and update the consumer at the part-render site — but flipping the line geometry is the smaller change and matches the IDs that the rest of the codebase references via `${pid}-grain-${pl.grain}`).

After the fix:
- `grain-length` draws a vertical line (e.g., from `(3, 0)` to `(3, 6)` inside a 6×6 pattern tile) — visually parallel to the Y/length axis.
- `grain-width` draws a horizontal line (e.g., from `(0, 3)` to `(6, 3)`) — visually parallel to the X/width axis.
- Comments above each pattern updated to read truthfully: e.g. `Grain along length axis (Y) — vertical stripes` and `Grain along width axis (X) — horizontal stripes`.

No change required at the consumer site (line ~300) — the pattern IDs stay the same, only what they draw changes.


## Concrete Steps

1. Confirm working directory `/Users/gregorymaier/developer/unity-erp` and clean tree on `codex/integration` (or fresh task branch). `git status` should be clean. If anything unrelated is dirty, stash with a clear name first.

2. **(P1)** Edit `components/features/cutlist/preview.tsx`. Add the new `offcut-grain` SVG pattern in the `<defs>` block. Update the offcut overlay rect to use the new gray-fill + green-stroke + vertical-stripe treatment described in **Plan of Work** above. Constants are Codex's call; suggested names and contracts are pinned in **Interfaces and Dependencies**. Run `npx tsc --noEmit 2>&1 | grep "preview.tsx"` — zero errors. Commit:

   ```
   git add components/features/cutlist/preview.tsx
   git commit -m "fix(cutlist): offcut overlay reads as leftover stock not another part"
   ```

3. **(P2)** Edit the same file: swap the line geometry inside the `grain-length` and `grain-width` `<pattern>` definitions so `grain-length` draws vertical lines and `grain-width` draws horizontal. Update the inline comments above each pattern so they accurately describe the new geometry. Run `npx tsc --noEmit 2>&1 | grep "preview.tsx"` — zero errors. Commit:

   ```
   git add components/features/cutlist/preview.tsx
   git commit -m "fix(cutlist): grain-direction patterns now point along the correct axis"
   ```

4. **(P3)** Browser verification at `http://localhost:3000/products/856/cutlist-builder` (sign in as the test account if needed):
   - Open the Cutlist Builder. The reusable-offcut rectangles on each sheet diagram now render as **gray** rectangles with a **thin emerald border** and **subtle vertical stripes** indicating the grain direction. They are visually distinct from the pastel-colored parts (Top blue, Leg yellow, Modesty green).
   - The dimension and area labels inside the offcut rectangles remain readable (emerald-400 monospace).
   - If a sheet has parts with explicit grain orientation AND `showGrainDirection={true}` somewhere in the consumer chain, those parts now render their grain stripes in the correct axis (vertical for `grain='length'`, horizontal for `grain='width'`).

5. **(P4)** Final validation:
   - `npm run lint` — 0 errors, 37 pre-existing warnings tolerated.
   - `npx tsc --noEmit 2>&1 | grep "preview.tsx"` — no output (touched file clean).
   - `npx tsx --test tests/cutlist-effective-utilization.test.ts tests/cutlist-packing.test.ts tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts` — all pass.
   - Capture screenshots or short text descriptions of the before/after diagram in **Artifacts and Notes**.


## Validation and Acceptance

The following observable behaviours must all hold after the work lands. Capture transcripts and short text descriptions in **Artifacts and Notes**.

1. **Offcut color reads as "leftover stock", not as a part.** On `/products/856/cutlist-builder`, the reusable-offcut rectangles on the sheet diagram render as gray-filled rectangles bordered with a thin emerald stroke. They are visually distinct from the pastel-colored parts (Top blue, Leg yellow, Modesty green) — an estimator scanning the diagram should not mistake an offcut for a part.

2. **Offcut grain stripes run along the long axis.** Inside each reusable-offcut rectangle there is a subtle vertical stripe pattern (lines parallel to the sheet's length axis / the long 2730 mm side). The stripes are visible but not visually overwhelming — they communicate grain direction without competing with the dimension label.

3. **Offcut dimension and area labels remain legible.** The `{long} × {short}` dimension label and the `reusable · {N} cm²` area label inside each offcut rectangle render in emerald-400 monospace, with sufficient contrast against the gray fill to be easily read.

4. **No diagonal stripes on offcuts.** The diagonal waste crosshatch pattern that lives on the sheet background no longer bleeds through into the offcut rectangles — confirms the new fill is opaque enough.

5. **Bar legend remains tied to diagram.** The `UtilizationBar`'s "Reuse" segment continues to render in green; the green-bordered offcut rectangles on the diagram visually link back to that legend entry. (Sanity check: nothing in the bar/legend rendering changed; this should be true by construction.)

6. **Grain pattern on parts points the right way.** For a sheet that has at least one part with `grain='length'` and `showGrainDirection={true}` enabled at the consumer level, that part renders thin **vertical** lines as its fill pattern (parallel to the Y/length axis). For a part with `grain='width'`, the fill pattern shows thin **horizontal** lines. Before this fix, the lines pointed in the opposite axis from the grain.

7. **Lint and type-check transcripts:**

   ```
   $ npm run lint
   ...
   ✖ 37 problems (0 errors, 37 warnings)

   $ npx tsc --noEmit 2>&1 | grep "preview.tsx"
   (no output)
   ```

8. **Tests still green:**

   ```
   $ npx tsx --test tests/cutlist-effective-utilization.test.ts tests/cutlist-packing.test.ts tests/cutlist-reusable-offcut.test.ts tests/use-org-settings-cutlist-defaults.test.ts
   ...
   # pass <total>
   # fail 0
   ```

   Visual changes shouldn't affect any test, but a regression run is cheap insurance.


## Idempotence and Recovery

Two commits, one per Progress item (P1 + P2 = two separate commits). To roll back a single fix, `git revert <commit>` for that one; the other survives. To roll back both, revert both commits or `git reset --hard <pre-P1-sha>`.

No data-layer changes. No SQL migrations. No JSONB shape changes. No test changes. Pure visual edits to one file.

Re-running the plan after partial completion: each step inspects the current source before editing. If the offcut overlay already shows gray + green stroke + vertical stripes, P1 is done. If `grain-length` draws vertical lines, P2 is done.

If the gray shade for the offcut fill turns out to read poorly on the dark theme during browser verification (too light or too dark), tune the opacity / shade and re-commit the adjustment as a follow-up commit named `fix(cutlist): tune offcut fill opacity for dark theme readability`. Do NOT redesign — the gray-fill + green-stroke + vertical-stripes approach is fixed; only the exact shade is adjustable.


## Artifacts and Notes




## Interfaces and Dependencies

### Modified — `components/features/cutlist/preview.tsx`

**New SVG pattern definition** in the existing `<defs>` block, alongside `grain-length`, `grain-width`, `waste`:

```
id="${pid}-offcut-grain"
6 × 6 userSpaceOnUse pattern tile
Single vertical <line> at x=3, y1=0, y2=6
stroke: dark-on-light or light-on-dark depending on what reads on the gray fill
strokeOpacity: ~0.18 (similar to existing grain patterns at 0.12, slightly bumped for visibility against gray)
strokeWidth: 0.5
```

**Offcut overlay rect** (replace existing fill/stroke at the call site found by searching for `REUSABLE_FILL`):

- Fill: gray base — suggested `rgb(226, 232, 240)` (Tailwind slate-200) at opacity ~0.55. Goal: opaque enough to hide the underlying diagonal waste crosshatch from bleeding through; light enough to remain visually distinct from a darker scrap region. Codex may tune the shade/opacity during browser verification.
- Pattern overlay: a second rect (or single rect using the pattern as fill — whichever is cleaner) using `fill="url(#${pid}-offcut-grain)"` to add the vertical stripes on top of the gray base.
- Stroke: existing `REUSABLE_STROKE` (`rgb(16, 185, 129)`, emerald) at strokeWidth `1.5`. Unchanged.
- Labels: existing `REUSABLE_LABEL_COLOR` (`rgb(52, 211, 153)`, emerald-400). Unchanged.

The existing module-level constants (`REUSABLE_FILL`, `REUSABLE_STROKE`, `REUSABLE_LABEL_COLOR`) can be repurposed or renamed to match the new treatment — Codex's call. If renaming, the new names should be obvious (e.g. `OFFCUT_FILL`, `OFFCUT_STRIPE_STROKE`).

**Grain pattern definitions** (swap inside `<defs>`):

```
{/* Grain along length axis (Y) — vertical stripes */}
<pattern id="${pid}-grain-length" width="6" height="6" patternUnits="userSpaceOnUse">
  <line x1="3" y1="0" x2="3" y2="6" stroke="#000" strokeOpacity="0.12" strokeWidth="0.5" />
</pattern>

{/* Grain along width axis (X) — horizontal stripes */}
<pattern id="${pid}-grain-width" width="6" height="6" patternUnits="userSpaceOnUse">
  <line x1="0" y1="3" x2="6" y2="3" stroke="#000" strokeOpacity="0.12" strokeWidth="0.5" />
</pattern>
```

(The line coordinates above are the literal swap of the existing definitions — preserve the `stroke="#000"`, `strokeOpacity="0.12"`, `strokeWidth="0.5"` values from the originals so the visual weight stays consistent. Comments updated to match.)

**No consumer changes.** The pattern ID lookup at the part render site (around line 300, search for `${pid}-grain-${pl.grain}`) is unchanged because pattern IDs are unchanged. Only the geometry inside each pattern flips.

### Database / library versions

No package additions or upgrades. No SQL migrations. No RLS or schema changes. No test changes. Pure visual edits.

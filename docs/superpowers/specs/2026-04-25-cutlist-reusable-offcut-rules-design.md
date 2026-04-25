# Cutlist Reusable-Offcut Rules Design

**Date**: 2026-04-25
**Status**: Draft
**Scope**: Replace the single-scalar "minimum reusable dimension" on the Cutlist Defaults settings page with a 2D, optionally grain-aware rule. Drop the redundant "minimum reusable area" field. Add an info tooltip to "preferred offcut dimension" and clarify its role in the optimizer.

## Problem

The org-level Cutlist Defaults at `/settings/cutlist` currently expose three knobs:

| Field | Default | Meaning |
|---|---|---|
| `minReusableOffcutDimensionMm` | 150 | Hard cutoff. Packer rule: `Math.min(w, h) ≥ 150`. |
| `preferredOffcutDimensionMm` | 300 | Soft penalty. Strips between min and preferred get a moderate placement penalty. |
| `minReusableOffcutAreaMm2` | 100 000 | Independent area floor. Packer rule: `w × h ≥ 100 000`. |

Two problems with this shape:

1. **The single-scalar minimum only checks the short side.** A `150 × 5000` mm strip passes (`min = 150 ≥ 150`, area = 750 000) and is reported as reusable stock, even though it is rarely usable in practice. Users intuitively reason about offcuts as `length × width`, not as a single threshold.
2. **The area field is a confusing overlap.** Once `minLength × minWidth` defines an implied minimum area (e.g. `300 × 300 = 90 000 mm²`), a separate `minReusableOffcutAreaMm2` field either does nothing (if smaller) or contradicts the dimension rule (if larger).

Industry convention (CutLogic 2D, OptiCut, FastCUT) consistently uses a 2D "min length AND min width" pair. The 300 × 300 mm "worth keeping" rule of thumb is widely cited in the woodworking community.

A secondary observation: melamine sheets have a grain direction, and a long-grain offcut serves different downstream parts than a cross-grain one. A shop that primarily cuts long-grain parts may want to classify cross-grain leftovers as scrap regardless of size. No reviewed competitor surfaces this, but the existing `GrainOrientation` UI on parts (`'any' | 'length' | 'width'`, rendered as ○ / ↕ / ↔) makes the interaction cheap to add.

## Goals

1. Replace `minReusableOffcutDimensionMm` (single scalar) with `minReusableOffcutLengthMm` + `minReusableOffcutWidthMm` (2D), and add an optional `minReusableOffcutGrain` filter.
2. Drop `minReusableOffcutAreaMm2` everywhere it is read or persisted (data layer, hook, settings page, packer).
3. Keep `preferredOffcutDimensionMm` as a 1D scalar steering knob; expose it with an info tooltip explaining what it does.
4. The classification rule for "is this offcut reusable?" lives in one place (the packer's `classifyOffcuts` and its sibling filters). All call sites read from it; no duplicated thresholds.
5. Existing org records with the old shape continue to render correctly until rewritten; no data backfill required.

## Out of Scope

- **Per-material overrides.** The setting stays org-level for now. A future iteration may let a material (e.g. veneered ply) override the org default; this spec does not design that.
- **Sheet-level grain axis configuration.** All sheets are assumed to carry their grain along the `length_mm` (Y) axis, matching the existing convention in `GrainOrientation` ('length' = along Y). Verifying and pinning this convention into a comment is part of implementation, but introducing a per-sheet override is not in scope.
- **Making `preferredOffcutDimensionMm` 2D or grain-aware.** It is a steering knob, not a classification rule, and 1D is sufficient.
- **Migrating already-saved JSONB values.** A read-side normalizer in `useOrgSettings` maps the old shape forward; the row is rewritten on next save.
- **Rewriting the packer's penalty/scoring logic.** Sliver, sub-optimal, and consolidation penalties stay as-is. Only the *reusability classification* changes.

---

## Design

### 1. Sheet grain convention (assumed throughout)

`StockSheetSpec` ([lib/cutlist/types.ts:164](../../../lib/cutlist/types.ts#L164)) carries `length_mm` (Y) and `width_mm` (X). The `GrainOrientation` enum on parts treats `'length'` as "grain runs along the part's length dim" — and the packer aligns parts onto sheets such that `length_mm` axes line up. By convention, **the sheet's grain runs along its `length_mm` (Y) axis.**

For an offcut `FreeRect { x, y, w, h }` produced by the packer:
- **AG (along grain)** = `h` (the Y-axis dimension)
- **CG (across grain)** = `w` (the X-axis dimension)

Implementation will add a single inline comment at the classification site to anchor this convention, so a future reader does not have to reverse-engineer it.

### 2. Data model

`CutlistDefaults` in [hooks/use-org-settings.ts](../../../hooks/use-org-settings.ts) changes shape:

```ts
export type GrainOrientation = 'any' | 'length' | 'width'; // imported from lib/cutlist/types

export interface CutlistDefaults {
  minReusableOffcutLengthMm?: number;   // along-grain min, default 300
  minReusableOffcutWidthMm?: number;    // across-grain min, default 300
  minReusableOffcutGrain?: GrainOrientation; // default 'any'
  preferredOffcutDimensionMm?: number;  // unchanged, default 300
}
```

Removed keys: `minReusableOffcutDimensionMm`, `minReusableOffcutAreaMm2`.

`organizations.cutlist_defaults` is a JSONB column; no SQL migration is required. `useOrgSettings` normalizes reads:

```ts
const raw = (data.cutlist_defaults as Partial<CutlistDefaults & LegacyShape>) ?? {};
const legacyDim = raw.minReusableOffcutDimensionMm; // may be present on old rows
return {
  minReusableOffcutLengthMm: raw.minReusableOffcutLengthMm ?? legacyDim ?? 300,
  minReusableOffcutWidthMm: raw.minReusableOffcutWidthMm ?? legacyDim ?? 300,
  minReusableOffcutGrain: raw.minReusableOffcutGrain ?? 'any',
  preferredOffcutDimensionMm: raw.preferredOffcutDimensionMm ?? 300,
  // raw.minReusableOffcutAreaMm2 ignored
};
```

Why seed both new mins from the legacy `minReusableOffcutDimensionMm`: the legacy value gated only the short side, alongside the area gate we are dropping. Carrying it forward into both length and width preserves the legacy short-side floor for both axes. Be aware of one direction-of-change: dropping the area gate makes legacy rows **more permissive** (a 200 × 200 = 40 000 mm² rect was scrap under `area ≥ 100 000`, becomes reusable under `min ≥ 150` on both sides). Operators who want a stricter rule explicitly visit the settings page and pick the new defaults (300 × 300). This is acceptable: the area gate was the source of the confusion this spec is removing, and orgs that care about classification will configure the page intentionally.

### 3. Packer config + classification rule

`PackerConfig` in [lib/cutlist/guillotinePacker.ts](../../../lib/cutlist/guillotinePacker.ts) changes match the data model:

```ts
interface PackerConfig {
  // …
  minUsableLength: number;   // was minUsableDimension
  minUsableWidth: number;    // (new — same default)
  minUsableGrain: GrainOrientation; // (new)
  preferredMinDimension: number; // unchanged
  // minUsableArea: removed
}
```

A single pure helper centralises the rule:

```ts
function isReusableOffcut(
  rect: { w: number; h: number },
  cfg: Pick<PackerConfig, 'minUsableLength' | 'minUsableWidth' | 'minUsableGrain'>,
): boolean {
  const ag = rect.h; // along grain (Y axis, convention)
  const cg = rect.w; // across grain (X axis)
  switch (cfg.minUsableGrain) {
    case 'length':
      return ag >= cfg.minUsableLength && cg >= cfg.minUsableWidth;
    case 'width':
      return cg >= cfg.minUsableLength && ag >= cfg.minUsableWidth;
    case 'any':
    default:
      return Math.max(ag, cg) >= cfg.minUsableLength && Math.min(ag, cg) >= cfg.minUsableWidth;
  }
}
```

All current reusability checks in `guillotinePacker.ts` become calls to this helper:
- `classifyOffcuts` (~line 565)
- `getUsableOffcuts` method (~line 989)
- The two `usableOffcuts` filters (~lines 1078, 1230)

The single call site that hands org settings into the packer config is in [CutlistCalculator.tsx:422](../../../components/features/cutlist/CutlistCalculator.tsx#L422). It currently maps:

```ts
minUsableDimension: cutlistDefaults.minReusableOffcutDimensionMm,
preferredMinDimension: cutlistDefaults.preferredOffcutDimensionMm,
minUsableArea: cutlistDefaults.minReusableOffcutAreaMm2,
```

Becomes:

```ts
minUsableLength: cutlistDefaults.minReusableOffcutLengthMm,
minUsableWidth:  cutlistDefaults.minReusableOffcutWidthMm,
minUsableGrain:  cutlistDefaults.minReusableOffcutGrain,
preferredMinDimension: cutlistDefaults.preferredOffcutDimensionMm,
```

The dependency array on the surrounding `useMemo` updates accordingly.

### 4. Sliver penalty

The sliver penalty inside `getBestSplit` (`remW < config.minUsableDimension`, `remH < config.minUsableDimension`) is the closest analogue of "this dimension is too small to keep" and gates the optimizer's placement scoring per axis. It becomes:

```ts
if (remW > 0 && remW < config.minUsableWidth)  score += SLIVER_PENALTY;
if (remH > 0 && remH < config.minUsableLength) score += SLIVER_PENALTY;
```

Rationale for asymmetric mapping: `remW` is the across-grain (X) leftover; `remH` is the along-grain (Y) leftover. Penalising each against its own axis-specific minimum keeps the steering aligned with the new 2D classification. The grain-direction filter is *not* applied to the sliver penalty — it only affects classification of "did we keep it as stock?"

### 5. Settings page UX

`/settings/cutlist` ([app/settings/cutlist/page.tsx](../../../app/settings/cutlist/page.tsx)) renders four controls in a single section:

```
Minimum reusable offcut
  [ Min length 300 ] mm    [ Min width 300 ] mm    [ Grain ○ ]

Preferred offcut dimension
  [ 300 ] mm   (i)
```

Layout: the three minimum-reusable controls sit on one row (3-column grid on `md+`, stacked on mobile). Preferred sits on its own row.

**Grain picker:** click-to-cycle button mirroring [CompactPartsTable.tsx:103-117](../../../components/features/cutlist/primitives/CompactPartsTable.tsx#L103). Same icons (`○ / ↕ / ↔`), same enum, same tooltip strings:
- `any` — Any grain direction
- `length` — Grain along Length
- `width` — Grain along Width

**Preferred-dimension info tooltip** copy:

> Nudge the optimizer toward larger, cleaner leftover strips. Strips between the minimum reusable size and this value are treated as 'usable but awkward' and mildly penalised during packing. This is a quality preference, not a hard rule.

**Section help text** on the minimum row:

> A leftover counts as reusable stock only if it meets both minimums. Pick a grain direction to require a specific grain orientation; leave on Any to accept either.

### 6. Forward compatibility

- `useOrgSettings` ignores unknown keys — old rows continue to load.
- `handleSave` in the settings page writes only the new keys. The legacy `minReusableOffcutDimensionMm` and `minReusableOffcutAreaMm2` are not written; on first save, the row is effectively migrated by overwrite.
- No background migration script. Orgs that never visit the page keep their old JSONB; the read-side normalizer makes the rule still resolvable.

---

## Testing

### Unit (new file: `tests/cutlist-reusable-offcut.test.ts`)

Truth-table coverage of `isReusableOffcut`:

| Case | grain | rect (w × h) | min L × W | Expected |
|---|---|---|---|---|
| Square at threshold | any | 300 × 300 | 300 × 300 | true |
| Square below | any | 299 × 299 | 300 × 300 | false |
| Long thin (legacy bug case) | any | 150 × 5000 | 300 × 300 | false |
| Long thin oriented for grain | length | 300 × 600 | 600 × 300 | true |
| Same rect rotated, grain=length | length | 600 × 300 | 600 × 300 | false |
| Same rect, grain=any | any | 600 × 300 | 600 × 300 | true |
| Grain=width swap behaviour | width | 600 × 300 | 600 × 300 | true |
| Below width min | length | 300 × 600 | 600 × 400 | false |

### Existing test surface

- Extend [tests/cutlist-packing.test.ts](../../../tests/cutlist-packing.test.ts) with one end-to-end case where the new rule changes the reusable count vs. the legacy rule (e.g. a layout that historically reported 1 reusable offcut and now reports 0).
- `useOrgSettings` normalizer: a small inline test for the legacy-key fallback path.

### Manual

- Settings page: open `/settings/cutlist`, confirm the new three-field layout renders, the grain picker cycles, the tooltip appears on the (i) icon. Save, refresh, confirm values persist.
- Cutlist Builder: load `/products/856/cutlist-builder`, observe reusable-offcut stats with default (300 × 300, any). Compare against the same product before the change to confirm the count and area shift in the expected direction.
- Multi-tenant: switch orgs, confirm the value is org-scoped.

---

## Open Questions

None blocking. Convention-pinning of "grain runs along sheet `length_mm`" will be confirmed during implementation by reading `getValidOrientations` and `getBestSplit`; if the convention turns out to be inverted from the assumption above, the AG/CG mapping in `isReusableOffcut` flips but the spec shape stands.

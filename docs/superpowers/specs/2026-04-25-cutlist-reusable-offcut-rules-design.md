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

`organizations.cutlist_defaults` is a JSONB column; no SQL migration is required. `useOrgSettings` normalizes reads using a precedence rule that avoids accidental hybrids on partially-migrated rows:

```ts
const raw = (data.cutlist_defaults as Partial<CutlistDefaults & LegacyShape>) ?? {};
const hasNewKey = raw.minReusableOffcutLengthMm !== undefined
  || raw.minReusableOffcutWidthMm !== undefined;
const legacyDim = raw.minReusableOffcutDimensionMm; // may be present on old rows

// If any new key exists, missing new keys default to 300 — never fall back to the legacy scalar.
// Only fall back to legacyDim when neither new key is present (pure-legacy row).
const lengthFallback = hasNewKey ? 300 : (legacyDim ?? 300);
const widthFallback  = hasNewKey ? 300 : (legacyDim ?? 300);

return {
  minReusableOffcutLengthMm: raw.minReusableOffcutLengthMm ?? lengthFallback,
  minReusableOffcutWidthMm: raw.minReusableOffcutWidthMm ?? widthFallback,
  minReusableOffcutGrain: raw.minReusableOffcutGrain ?? 'any',
  preferredOffcutDimensionMm: raw.preferredOffcutDimensionMm ?? 300,
  // raw.minReusableOffcutAreaMm2 ignored
};
```

**Three legacy cases, three behaviours:**

| Source row state | New `minLength × minWidth` | Direction of change vs. today |
|---|---|---|
| `null` / missing JSONB (implicit defaults today: 150 + area 100 000) | 300 × 300 (new defaults) | **Stricter.** Today's implicit default classified e.g. 200 × 200 as scrap (area gate) and 150 × 5000 as reusable; new default classifies the 5000-strip as scrap (long-side gate) and the 200 × 200 as scrap (below 300). |
| Pure-legacy JSON `{ minReusableOffcutDimensionMm: 150, minReusableOffcutAreaMm2: 100 000 }` | 150 × 150 (legacy scalar carried forward to both axes) | **More permissive.** Area gate is dropped: a 200 × 200 = 40 000 mm² rect was scrap under `area ≥ 100 000`, becomes reusable under `min ≥ 150` on both sides. |
| Mixed JSON (any new key present) | New keys win; missing new keys → 300 | Behaves as "operator partially configured the new shape." Legacy scalar is ignored entirely once any new key is set. |

This is acceptable: the area gate is the source of the confusion this spec is removing, and orgs that care will configure the page intentionally. Rollout note for QA: do not assume "no change for rows with default settings" — implicit-default orgs will see stricter classification of long thin strips, which is the bug we are fixing.

### 3. Packer config + classification rule

The classification helper lives in a new module so both packers and the test suite can import it without reaching into packer-private internals:

**New file: `lib/cutlist/offcuts.ts`**

```ts
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
  const ag = rect.h; // along grain — Y axis, by sheet-grain convention (§1)
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

Both `PackerConfig` (in [lib/cutlist/guillotinePacker.ts](../../../lib/cutlist/guillotinePacker.ts)) and `StripPackerConfig` (in [lib/cutlist/stripPacker.ts](../../../lib/cutlist/stripPacker.ts)) change shape:

```ts
// Removed: minUsableDimension, minUsableArea
// Added:
minUsableLength: number;
minUsableWidth: number;
minUsableGrain: GrainOrientation;
// Unchanged: preferredMinDimension (guillotine only)
```

**Guillotine packer call sites that now consume `isReusableOffcut`:**

Reusability classification (the "is this offcut counted as stock?" rule):
- `classifyOffcuts` (~line 565)
- `getUsableOffcuts` method (~line 989)
- The two `usableOffcuts` filters (~lines 1078, 1230)

The placement-scoring and split paths use scalar dimensions today — they are addressed in §4 with axis-aligned mapping; they do **not** call `isReusableOffcut`. Classification (§3) and steering (§4) are deliberately separate concerns.

**Strip packer scope:**

`packing.ts` defaults to `algorithm: 'strip'` ([packing.ts:510](../../../components/features/cutlist/packing.ts#L510)) and `packWithStrips(parts, sheet)` is currently called *without* the org `packingConfig` ([packing.ts:529](../../../components/features/cutlist/packing.ts#L529)); the deep-mode baseline at [packing.ts:552](../../../components/features/cutlist/packing.ts#L552) follows the same path. If we don't update strip too, an admin who changes `/settings/cutlist` will see no effect under the default algorithm.

Implementation must:
1. Thread the full `packingConfig` through `packWithStrips` (signature change).
2. Apply `isReusableOffcut` to strip-packer remnants. If strip currently emits no remnant classification, add it: emit `reusableOffcuts` and `reusableArea_mm2` on the strip result with the same shape guillotine uses, so downstream stats render consistently regardless of algorithm.
3. Rename `StripPackerConfig.minUsableDimension` → `minUsableLength` / `minUsableWidth` to match guillotine. The strip algorithm's *internal* sliver heuristics (if any) become axis-aligned per §4; if no internal heuristics consume the scalar today, the rename is purely a config-shape alignment.

**The single call site that hands org settings into packer config** is [CutlistCalculator.tsx:422](../../../components/features/cutlist/CutlistCalculator.tsx#L422):

```ts
// Before
minUsableDimension: cutlistDefaults.minReusableOffcutDimensionMm,
preferredMinDimension: cutlistDefaults.preferredOffcutDimensionMm,
minUsableArea: cutlistDefaults.minReusableOffcutAreaMm2,

// After
minUsableLength: cutlistDefaults.minReusableOffcutLengthMm,
minUsableWidth:  cutlistDefaults.minReusableOffcutWidthMm,
minUsableGrain:  cutlistDefaults.minReusableOffcutGrain,
preferredMinDimension: cutlistDefaults.preferredOffcutDimensionMm,
```

The surrounding `useMemo` dependency array updates accordingly. Implementation must also sweep the benchmark scripts ([scripts/cutlist-benchmark.ts](../../../scripts/cutlist-benchmark.ts), [scripts/cutlist-deep-benchmark.ts](../../../scripts/cutlist-deep-benchmark.ts)) for hardcoded legacy keys — silent failures here are easy to miss.

### 4. Placement scoring, split decision, and free-rect retention

The legacy scalar `minUsableDimension` flows into more than just the sliver penalty. Implementing only the classification rule from §3 while leaving the scoring/split paths on a single scalar would produce inconsistent layouts (offcuts classified 2D, but the optimizer still steered by a 1D rule). All scalar consumers become axis-aligned, with the rule that **X-axis remnants compare against `minUsableWidth` and Y-axis remnants compare against `minUsableLength`** — matching the AG/CG convention from §1.

**Scoring sliver / sub-optimal penalties** ([guillotinePacker.ts](../../../lib/cutlist/guillotinePacker.ts) ~lines 354-365 inside `calculatePlacementScore`):

```ts
// Sliver penalty
if (remW > 0 && remW < config.minUsableWidth)  score += SLIVER_PENALTY;
if (remH > 0 && remH < config.minUsableLength) score += SLIVER_PENALTY;

// Sub-optimal (between min and preferred) penalty — preferred stays 1D and applies to either axis
if (remW >= config.minUsableWidth  && remW < config.preferredMinDimension) score += SUB_OPT_PENALTY;
if (remH >= config.minUsableLength && remH < config.preferredMinDimension) score += SUB_OPT_PENALTY;
```

**Split decision** ([guillotinePacker.ts:378](../../../lib/cutlist/guillotinePacker.ts#L378)) — `getBestSplit(freeRect, partW, partH, config.minUsableDimension)` currently takes a single scalar. Signature change:

```ts
function getBestSplit(
  freeRect: FreeRect,
  partW: number,
  partH: number,
  minUsableLength: number,
  minUsableWidth: number,
): SplitResult { /* X remnant compared to width, Y remnant compared to length */ }
```

**Free-rect retention** during actual splits ([guillotinePacker.ts:853, 895](../../../lib/cutlist/guillotinePacker.ts#L853)) — these decide whether a freshly-cut sub-rect is worth keeping in the free-list. Same axis-aligned mapping: X-rect retention vs. `minUsableWidth`, Y-rect vs. `minUsableLength`.

**Why grain direction does NOT apply to scoring/split/retention:** the steering decisions are about whether the optimizer should treat a remnant as a useful-strip-to-leave-behind, which is purely a size question. The grain filter from §3 governs **classification** ("does this remnant count as stock when we report reusable offcuts?"), not steering. Keeping these separate concerns prevents grain-direction changes on the settings page from silently shifting layout decisions.

**Alternative considered (rejected):** define a single `scoringMinDimension = min(minUsableLength, minUsableWidth)` and keep all scoring/split scalar. Rejected because it loses the per-axis information the user explicitly configured — a long thin remnant would score as if both axes were equally constrained.

### 5. Settings page UX

`/settings/cutlist` ([app/settings/cutlist/page.tsx](../../../app/settings/cutlist/page.tsx)) renders four controls in a single section:

```
Minimum reusable offcut
  [ Min length 300 ] mm    [ Min width 300 ] mm    [ Grain ○ ]

Preferred offcut dimension
  [ 300 ] mm   (i)
```

**Layout grid** (verified at 768px, 1024px, and full-width settings shell):

```tsx
<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto]">
  {/* Min length, Min width, Grain picker */}
</div>
```

`auto` on the grain column lets the icon-button hug its content; `minmax(10rem,1fr)` keeps the two number inputs from collapsing under their labels at narrow widths. Stacked single-column on phone widths is fine — settings are not a hot path on mobile.

**Numeric inputs:** follow the project's numeric-input convention — `value={x ?? ''}` with `placeholder="0"`, and an `onBlur` handler that resets empty fields back to the default. (See MEMORY.md "Numeric Input UX Pattern".)

**Grain picker:** click-to-cycle button using the same `GrainOrientation` enum and icon set (`○ / ↕ / ↔`) as [CompactPartsTable.tsx:102-118](../../../components/features/cutlist/primitives/CompactPartsTable.tsx#L102), but **implemented locally to the settings page** — do not import the table-row's private helpers (`handleGrainKeyDown`, `nextGrainOrientation`, focus state). The settings-local control:

- Click cycles `any → length → width → any`.
- Tooltip shows the current label (see below).
- Arrow-key cycling is **out of scope** for the settings control; it's a low-frequency edit context where keyboard navigation isn't a priority. (Document this asymmetry in a code comment.)

**Tooltip labels** (adapted from `GRAIN_OPTIONS` for a settings context — the table's `"Any direction (solid color)"` references the icon, which is unnecessary here):

| value | tooltip |
|---|---|
| `any` | Any direction |
| `length` | Grain along length |
| `width` | Grain along width |

**Preferred-dimension info tooltip:**

```tsx
<TooltipContent className="max-w-xs text-xs leading-snug">
  Nudge the optimizer toward larger, cleaner leftover strips.
  Sizes between the minimum reusable and this value are mildly penalised
  during packing — a quality preference, not a hard rule.
</TooltipContent>
```

`max-w-xs` is critical: the shared `TooltipContent` ([components/ui/tooltip.tsx:22](../../../components/ui/tooltip.tsx#L22)) has no default max width, and the verbose copy would render as a single comically-wide line.

**Section help text** on the minimum row (small muted `<p>` below the grid):

> A leftover counts as reusable stock only if it meets both minimums. Pick a grain direction to require a specific orientation; leave on Any to accept either.

### 6. Forward compatibility

- `useOrgSettings` ignores unknown keys — old rows continue to load.
- `handleSave` in the settings page writes only the new keys. The legacy `minReusableOffcutDimensionMm` and `minReusableOffcutAreaMm2` are not written; on first save, the row is effectively migrated by overwrite.
- No background migration script. Orgs that never visit the page keep their old JSONB; the read-side normalizer makes the rule still resolvable.

---

## Testing

### Unit (new file: `tests/cutlist-reusable-offcut.test.ts`)

Imports `isReusableOffcut` from `lib/cutlist/offcuts.ts` (per §3 — exported helper, not a packer-private function). Truth-table coverage of `isReusableOffcut`:

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

- Extend [tests/cutlist-packing.test.ts](../../../tests/cutlist-packing.test.ts) with end-to-end cases under both algorithms (`'guillotine'` and `'strip'`) where the new rule changes the reusable count vs. the legacy rule (e.g. a layout that historically reported 1 reusable offcut and now reports 0). Required because §3 brings strip into scope.
- `useOrgSettings` normalizer: inline tests for all three migration paths from §2 — null/missing JSON (→ stricter 300×300), pure-legacy JSON (→ 150×150 from scalar carry), mixed JSON (→ new keys win, legacy ignored).

### Manual

- Settings page: open `/settings/cutlist`, confirm the new three-field layout renders, the grain picker cycles, the tooltip appears on the (i) icon. Save, refresh, confirm values persist.
- Cutlist Builder: load `/products/856/cutlist-builder`, observe reusable-offcut stats with default (300 × 300, any). Compare against the same product before the change to confirm the count and area shift in the expected direction.
- Multi-tenant: switch orgs, confirm the value is org-scoped.

---

## Open Questions

None blocking. Sheet grain convention (`length_mm` = Y = along grain) was independently verified during spec review by tracing `getValidOrientations` and the placement code in both `guillotinePacker.ts` and `stripPacker.ts`; the AG/CG mapping in `isReusableOffcut` is correct as written.

## Spec revision history

- **2026-04-25 r1** — initial draft.
- **2026-04-25 r2** — Codex review pass incorporated:
  - §2 split into three legacy cases (null-default vs. pure-legacy vs. mixed); precedence rule tightened so partially-migrated rows no longer hybridise.
  - §3 helper relocated to `lib/cutlist/offcuts.ts`; strip packer brought into scope (rename, threading `packingConfig` through `packWithStrips`, optional remnant emission); benchmark scripts called out.
  - §4 expanded to cover all scalar consumers — placement scoring, `getBestSplit` signature, free-rect retention — with axis-aligned mapping rule; alternative scalar approach considered and rejected with rationale.
  - §5 grain picker scoped as settings-local; tooltip labels and copy aligned with reality; explicit layout grid-template and tooltip max-width specified; numeric input convention referenced.
  - Test surface expanded to cover both algorithms and all three migration paths.

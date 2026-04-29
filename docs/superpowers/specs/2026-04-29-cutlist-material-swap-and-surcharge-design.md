# Cutlist Material Swap & Surcharge

> **LOCAL DESKTOP ONLY.** Codex Cloud must not pick up this work — Cloud branches off `main`, this branch lives off `codex/integration` and depends on the post-POL-71 state. Greg runs Codex on the local desktop; Claude reviews and merges.

**Date:** 2026-04-29
**Status:** Draft pending GPT-5.5 Pro plan-review pass (workflow trial in effect — see `docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md`).
**Parent:** Linear POL-83 *Cutlist Material Swap & Surcharge* (to be created when this spec is signed off).
**Related specs:**
- [`docs/plans/2026-04-28-product-swap-and-surcharge.md`](../plans/2026-04-28-product-swap-and-surcharge.md) — POL-71 BOM swap + surcharge (foundation; this spec extends the same model to cutlist materials and edging).
- [`2026-03-29-bom-substitution-design.md`](./2026-03-29-bom-substitution-design.md) — order-side BOM substitution v2.
- [`2026-04-01-edging-computation-design.md`](./2026-04-01-edging-computation-design.md) — current edging computation; this spec moves the edging primary into per-line decision-making while keeping the existing computation for fallback.
- [`2026-04-20-order-cutlist-costing-design.md`](./2026-04-20-order-cutlist-costing-design.md) — padded vs nested cost basis; this spec leaves §3 of that design intact.

## Purpose

Today, customer-facing colour decisions on cutlist products (panel colour, melamine type, edging colour) are not surfaced as line-level choices on quotes or orders. They live in `product_cutlist_groups.primary_material_id` / `backer_material_id` (often NULL on modern products) and in the order-level `orders.material_assignments` JSONB driven by the `MaterialAssignmentGrid` on the cutting plan tab. This means:

- Salespeople cannot quote two-tone configurations (carcass black + doors white) at quote stage; they have to convert to an order first and use the workshop-side grid.
- There is no mechanism to attach a commercial surcharge to a colour choice — even though premium boards routinely carry 7–15% upcharges.
- Two-tone preference is captured per part role on `orders.material_assignments` only, with no concept of a "primary" colour for the line and no edging-vs-board pairing memory.

POL-71 introduced per-BOM-row swap + surcharge with a downstream-state probe and exception model. **This spec applies the same shape to cutlist materials and edging**, adapted to the per-line "primary + overrides" mental model Greg validated in the 2026-04-29 brainstorm. The system must let users:

1. Pick a primary cutlist material per quote/order line (drives all parts by default).
2. Optionally override individual parts to other materials (two-tone, multi-tone).
3. Pick a primary edging that auto-fills from a learned `(board, thickness)` → edging association; override per part as needed.
4. Attach a per-line surcharge expressed as a fixed amount or a percentage, with an admin-set hint per board.
5. Continue to swap after PO sent / cutting plan finalized / job card issued, with the same warning + exception flow POL-71 already implements.

## Decision Summary

These were resolved with Greg in the 2026-04-29 brainstorm and the filesystem-grounded preflight probe. Codex must not re-litigate.

- **Per-line surcharge.** One number per quote/order line, expressed as fixed R or % of unit price. NOT per-BOM-row (POL-71's model is unchanged for hardware swaps).
- **Primary + per-part overrides UX (Approach A).** Single primary picker drives all parts; collapsed disclosure exposes per-part exceptions. Two-tone is just "add an override." Approach C (visual parts-thumbnail picker) is filed as future polish in [POL-82](https://linear.app/polygon-dev/issue/POL-82).
- **Quote-side and order-side both ship.** POL-71's quote-side carried `bom_snapshot` only, NOT `cutlist_snapshot`. This spec extends `quote_items` with cutlist data so two-tone configurations can be quoted without converting to an order first.
- **Edging in scope, with auto-pair learning.** A new `board_edging_pairs` table is keyed on `(org_id, board_component_id, thickness_mm)`. First-time pairing applies silently. Subsequent pairing on the same board+thickness shows an inline confirmation: **Update default** (upserts the pair) or **Just this line** (leaves the pair untouched, line stores its own decision).
- **Lamination-aware edging lookup.** Same physical 16mm board needs different edging when laminated to 32mm. Pair table is keyed on thickness, not just board id. `32mm-backer` groups present a single 32mm exposed edge (the backer is internal to the assembly), so they issue ONE 32mm lookup, not a split front/back lookup. Verified 2026-04-29 against `product_cutlist_groups` data: `32mm-backer` parts carry `lamination_type='with-backer'` as a single logical part, not two parts.
- **Surcharge tier hint per board.** `components.surcharge_percentage` is a nullable admin column. When set, the dialog auto-fills the surcharge field as a suggestion; user input always wins.
- **Surcharge total integration.** Cutlist surcharge resolves at app-layer save time into the **existing** `surcharge_total` column (introduced by POL-71). The POL-71 trigger that rolls `surcharge_total` into `orders.total_amount` and `quotes.subtotal` is unchanged. **No new trigger work.**
- **MaterialAssignmentGrid stays, behaviour switches.** Phase F flips the grid's writes from `orders.material_assignments` to per-line `cutlist_part_overrides`. The grid keeps its workshop-side role for mid-production fine-tuning. `orders.material_assignments` is preserved as the rollback target and read-fallback for orders not yet re-saved through the new UX; a separate cleanup ticket later removes it.
- **Downstream exception extension.** Reuse POL-71's `bom_swap_exceptions` table. CHECK constraint widens to include `cutlist_material_swapped_after_downstream_event`. Same probe, same activity log, same UI banner pattern.
- **Cutlist snapshot per-part shape.** `CutlistSnapshotPart` gains `effective_board_id`, `effective_board_name`, `effective_thickness_mm`, `effective_edging_id`, `effective_edging_name`, `is_overridden`. Self-describing — consumers don't reapply primary+overrides at read time.
- **Backfill scope.** A1 backfills `orders.material_assignments` per-line entries into `order_details.cutlist_primary_material_id` + `cutlist_part_overrides`. Stop-and-ask if the backfill produces high override-count percentages (>30% of parts being overrides on >5% of orders signals a misclassified primary).
- **Surcharge × quantity rule.** Both fixed and percentage surcharges scale with quantity. `qty=3, kind=fixed, value=200` → R600. `qty=3, kind=percentage, value=15, unit_price=2000` → 15% × 2000 × 3 = R900. Stored resolved value goes into `surcharge_total` per POL-71 semantics.

## Filesystem-grounded Preflight Findings (2026-04-29)

These shaped the design. Captured here because GPT Pro can read committed files in the GitHub repo but not local terminal output.

| Finding | Source | Implication |
|---|---|---|
| `quote_items` already has `bom_snapshot`, `surcharge_total`, `product_id` from POL-71. No `cutlist_snapshot`. | `information_schema.columns` query 2026-04-29 | Quote-side cutlist columns are net-new; no migration to a partially-set-up table. |
| `order_details` has `bom_snapshot`, `cutlist_snapshot`, `surcharge_total`. | Same query | Order-side reuses existing `cutlist_snapshot`; only the JSONB shape changes. |
| Two views read `order_details`: `jobs_in_factory` and `factory_floor_status`. Both reference `surcharge_total` only — neither reads `cutlist_snapshot`. | `information_schema.views` query 2026-04-29 | Adding cutlist columns to `order_details` will not drift these views. (POL-71 caught view drift on order-totals; safe here.) |
| No existing edging-association or board-pair table in `public` schema. | `information_schema.tables` ILIKE search 2026-04-29 | Greenfield for `board_edging_pairs`. |
| `components` table has no surcharge-related column. | `information_schema.columns` query | Greenfield for `surcharge_percentage`. |
| All target tables (`quote_items`, `order_details`, `orders`, `components`, `product_cutlist_groups`, `organization_members`) have RLS enabled with 4 policies each. | `pg_tables` + `pg_policies` join 2026-04-29 | New tables follow the same `is_org_member(org_id)` pattern. |
| `lib/orders/snapshot-utils.ts:deriveCutlistSwapEffectsFromBomSnapshot` already bridges BOM swaps on `is_cutlist_item=true` rows to cutlist `materialOverrides` / `removedMaterialIds`. | `grep` 2026-04-29 | The bridge exists but almost never fires — only 6 of 400 BOM rows are `is_cutlist_item=true`, and 3 of those are stranded (NULL `component_id`, legacy product 37). The new line-level UX is the right entry point; the existing bridge stays for backwards compatibility. |
| Most `product_cutlist_groups.primary_material_id` are NULL. | `product_cutlist_groups` query 2026-04-29 | "Default = product's costing material" doesn't apply to most products. The line's primary is a fresh decision at quote/order time. |
| `lib/orders/material-assignment-types.ts:buildPartRoles` already filters `quantity > 0`. | Code read 2026-04-29 | Removed-material handling from POL-71's spec (line-quantity-zero rule for cutlist parts) is already respected. |

## Architecture

### Three-layer model

```
Layer 1 — Operational cutlist            Layer 2 — Auto-pair memory       Layer 3 — Commercial surcharge
─────────────────────────────────        ────────────────────────────     ──────────────────────────────────
Per-line primary + per-part overrides    board_edging_pairs               Optional R amount or % on the line
  → drives cutting plan / costing          → suggests edging on board       → drives quote total / invoice
  → always accurate                        → user-confirmed on conflict     → independent of cost delta
  → no NULL = "not chosen yet" path        → never overrides line decision   → admin hint via components.surcharge_percentage
```

Layer 1 is operational truth (what the cutting plan reads). Layer 2 is a suggestion engine that helps the user make Layer 1 decisions faster. Layer 3 is the commercial price impact, independent of Layer 1's cost implications.

### How this composes with POL-71

POL-71 already added `surcharge_total` to `quote_items` and `order_details`, and an order-totals trigger that rolls it into the line/order/quote totals. This spec **adds to** that single column rather than introducing parallel surcharge plumbing:

```
surcharge_total =
    sum(BOM-snapshot per-row surcharge_amount × line_quantity)   ← POL-71
  + resolveCutlistSurcharge(line)                                ← THIS SPEC
```

Both sums are computed application-side at save time and written into `surcharge_total` in the same UPDATE. The trigger sees one rolled-up number and behaves identically.

## Data Model Changes

### 1. `quote_items` extensions

```sql
ALTER TABLE quote_items
  ADD COLUMN cutlist_snapshot JSONB NULL,
  ADD COLUMN cutlist_primary_material_id INTEGER NULL,
  ADD COLUMN cutlist_primary_edging_id INTEGER NULL,
  ADD COLUMN cutlist_part_overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN cutlist_surcharge_kind TEXT NOT NULL DEFAULT 'fixed'
    CHECK (cutlist_surcharge_kind IN ('fixed','percentage')),
  ADD COLUMN cutlist_surcharge_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN cutlist_surcharge_label TEXT NULL;
```

**Tenant-safety FKs.** POL-71 already added `UNIQUE (product_id, org_id)` on `products` and a composite FK from `quote_items` to that pair. We extend the same pattern to the new material+edging columns:

```sql
-- Prerequisite: composite UNIQUE on components(component_id, org_id).
-- component_id is already globally unique; the composite UNIQUE is the prerequisite for the FK below.
ALTER TABLE components
  ADD CONSTRAINT components_id_org_unique UNIQUE (component_id, org_id);

ALTER TABLE quote_items
  ADD CONSTRAINT quote_items_cutlist_primary_material_org_fk
    FOREIGN KEY (cutlist_primary_material_id, org_id)
    REFERENCES components (component_id, org_id),
  ADD CONSTRAINT quote_items_cutlist_primary_edging_org_fk
    FOREIGN KEY (cutlist_primary_edging_id, org_id)
    REFERENCES components (component_id, org_id);
```

If `components` already has a conflicting UNIQUE (e.g. just on `component_id`), STOP and confirm before adding.

### 2. `order_details` extensions

```sql
ALTER TABLE order_details
  ADD COLUMN cutlist_primary_material_id INTEGER NULL,
  ADD COLUMN cutlist_primary_edging_id INTEGER NULL,
  ADD COLUMN cutlist_part_overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN cutlist_surcharge_kind TEXT NOT NULL DEFAULT 'fixed'
    CHECK (cutlist_surcharge_kind IN ('fixed','percentage')),
  ADD COLUMN cutlist_surcharge_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN cutlist_surcharge_label TEXT NULL,
  ADD CONSTRAINT order_details_cutlist_primary_material_org_fk
    FOREIGN KEY (cutlist_primary_material_id, org_id)
    REFERENCES components (component_id, org_id),
  ADD CONSTRAINT order_details_cutlist_primary_edging_org_fk
    FOREIGN KEY (cutlist_primary_edging_id, org_id)
    REFERENCES components (component_id, org_id);
```

`cutlist_snapshot` already exists; only the JSONB *shape* changes (see §5).

### 3. `components.surcharge_percentage`

```sql
ALTER TABLE components
  ADD COLUMN surcharge_percentage NUMERIC(5,2) NULL
    CHECK (surcharge_percentage IS NULL OR surcharge_percentage BETWEEN -100 AND 1000);
```

Nullable. No backfill required. Admin populates per board over time.

### 4. New `board_edging_pairs` table

```sql
CREATE TABLE board_edging_pairs (
  pair_id BIGSERIAL PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations,
  board_component_id INTEGER NOT NULL,
  thickness_mm INTEGER NOT NULL CHECK (thickness_mm > 0),
  edging_component_id INTEGER NOT NULL,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT board_edging_pairs_board_org_fk
    FOREIGN KEY (board_component_id, org_id) REFERENCES components (component_id, org_id),
  CONSTRAINT board_edging_pairs_edging_org_fk
    FOREIGN KEY (edging_component_id, org_id) REFERENCES components (component_id, org_id),
  CONSTRAINT board_edging_pairs_unique
    UNIQUE (org_id, board_component_id, thickness_mm)
);

CREATE INDEX idx_board_edging_pairs_lookup
  ON board_edging_pairs (org_id, board_component_id, thickness_mm);

ALTER TABLE board_edging_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY board_edging_pairs_org_select ON board_edging_pairs
  FOR SELECT USING (is_org_member(org_id));
CREATE POLICY board_edging_pairs_org_insert ON board_edging_pairs
  FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY board_edging_pairs_org_update ON board_edging_pairs
  FOR UPDATE USING (is_org_member(org_id));
CREATE POLICY board_edging_pairs_org_delete ON board_edging_pairs
  FOR DELETE USING (is_org_member(org_id));
```

Lookup pattern in app code:

```ts
async function lookupBoardEdgingPair(
  orgId: string,
  boardComponentId: number,
  thicknessMm: number,
): Promise<{ edging_component_id: number; edging_component_name: string } | null>;
```

Auto-learn write happens via an `upsertBoardEdgingPair` helper called from the line save path. Two distinct call paths:
- **First time** for a given `(org, board, thickness)`: INSERT. No prompt.
- **Subsequent time** with a different `edging_component_id`: app code MUST surface the confirmation UI BEFORE calling the upsert. The DB layer is dumb — it just upserts when told to.

### 5. Extended `cutlist_snapshot` JSONB shape

`CutlistSnapshotGroup` is unchanged. `CutlistSnapshotPart` adds:

```ts
type CutlistSnapshotPart = {
  // existing fields:
  id: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  material_label?: string;

  // NEW (this spec):
  effective_board_id: number | null;          // line primary or per-part override
  effective_board_name: string | null;
  effective_thickness_mm: number;             // 16, 32, etc. — derived from board_type/lamination
  effective_edging_id: number | null;         // resolved from override OR pair OR primary edging
  effective_edging_name: string | null;
  is_overridden: boolean;                     // true if differs from line primary
};
```

`effective_thickness_mm` is derived from the part's `board_type` (not `lamination_type`, which is a separate per-part attribute carrying values like `'with-backer'`):
- `'16mm'` → 16
- `'32mm-both'` → 32
- `'32mm-backer'` → 32 (the visible edge thickness — the backer is internal to the laminated assembly and never exposed to edging)

Unknown `board_type` values must STOP and ask Greg before assuming a thickness.

### 6. `cutlist_part_overrides` JSONB shape

```ts
type CutlistPartOverride = {
  part_role: {
    board_type: string;
    part_name: string;
    length_mm: number;
    width_mm: number;
  };
  board_component_id: number | null;    // null = inherit line primary
  edging_component_id: number | null;   // null = inherit pair lookup OR line primary edging
};
```

Sparse array — only parts that differ from the primary appear. Empty array `[]` = "all parts inherit the line primary."

The fingerprint matches `lib/orders/material-assignment-types.ts:roleFingerprint` minus `order_detail_id` (since the override is already line-scoped). Phase F's grid translation uses this fingerprint mapping directly.

### 7. Surcharge resolution

```ts
function resolveCutlistSurcharge(line: {
  cutlist_surcharge_kind: 'fixed' | 'percentage';
  cutlist_surcharge_value: number;
  unit_price: number;
  quantity: number;
}): number {
  const { cutlist_surcharge_kind, cutlist_surcharge_value, unit_price, quantity } = line;
  const v = Number(cutlist_surcharge_value || 0);
  const q = Number(quantity || 0);
  if (cutlist_surcharge_kind === 'percentage') {
    return Math.round(unit_price * q * v) / 100; // round to 2dp
  }
  return Math.round(v * q * 100) / 100;
}
```

Total `surcharge_total` written to the row is `bomSnapshotSurchargeTotal(snapshot, qty) + resolveCutlistSurcharge(line)`.

Existing helper `lib/orders/snapshot-utils.ts:calculateBomSnapshotLineSurchargeTotal` already returns the BOM-side number. New helper `lib/orders/cutlist-surcharge.ts:resolveCutlistSurcharge` is added; the line save path composes both.

## UI Changes

### Shared `CutlistMaterialDialog`

Built once in `components/features/shared/CutlistMaterialDialog.tsx` (sibling of POL-71's `SwapComponentDialog`). Used by both quote and order line editors. Inputs:

```
┌─ Cutlist material ──────────────────────────────────────┐
│ Primary material  [Iceberg White                  ▾]    │
│                   Surcharge tier: 7%  (suggested)       │
│                                                          │
│ Edging            [Alpine White (paired)         ▾]     │
│                                                  [unlink]│
│                                                          │
│ Surcharge         [ 7 ] [ %▾ ]   Label [ ____ ]         │
│                   = R 245.00 on this line                │
│                                                          │
│ ▾ Customise per part   [3 board overrides]              │
│   Part name             Board                Edging     │
│   Carcass Sides        [Iceberg White ▾]   [Alpine ▾]   │
│   Carcass Back         [Iceberg White ▾]   [Alpine ▾]   │
│   Doors                [Cherry Veneer ▾]   [Cherry ▾]   │
│   Drawer Fronts        [Cherry Veneer ▾]   [Cherry ▾]   │
│   Modesty              [Iceberg White ▾]   [Alpine ▾]   │
│                                                          │
│ ⚠ Components ordered/scheduled — swap will create a     │
│   production exception. Continue?                       │
│                                                          │
│ [Cancel]                                       [Apply]   │
└──────────────────────────────────────────────────────────┘
```

Key behaviours:
- The board picker uses category-restricted lookups via `/api/components/by-category/[categoryId]` (existing) — restricted to board-melamine categories.
- The edging picker uses the same endpoint, restricted to edging categories.
- When the primary board changes: look up `board_edging_pairs(org, board, thickness)`. If found, auto-fill edging. If not, edging picker stays at its previous value (or empty if first time).
- When primary surcharge value is edited manually, subsequent primary changes must NOT overwrite. Track `surchargeTouched` state.
- Override row layout collapses dimensions into the part-name cell with a hover tooltip: `Carcass Sides   (818×585mm)`.
- Auto-pair confirmation prompt: see §UI Auto-pair confirmation flow below.

### UI Auto-pair confirmation flow

When the user is about to apply (clicked Apply, validation passed) and one or more `(board, thickness, edging)` triples are present that do NOT match the existing pair table:

1. Group new pairings by `(board, thickness)`.
2. If ALL are first-time: silently upsert the pairs. No prompt.
3. If ANY are conflicts (existing pair has a different edging): show a single confirmation dialog listing each conflict:

```
┌─ Update edging defaults? ─────────────────────────────┐
│                                                       │
│ Last time you paired:                                 │
│   • Iceberg White (16mm) → Alpine White               │
│                                                       │
│ This line uses:                                       │
│   • Iceberg White (16mm) → Glacier Tape               │
│                                                       │
│ Update the default for next time, or keep this line   │
│ only?                                                 │
│                                                       │
│ [ Keep this line only ]   [ Update default ]          │
└───────────────────────────────────────────────────────┘
```

4. **Update default** → upsert `board_edging_pairs` for each conflict; line save proceeds.
5. **Keep this line only** → don't touch the pair table; line save proceeds with the new edging stored in `cutlist_primary_edging_id` or the per-part override (whichever applies).

The line is **always** the source of truth for what gets manufactured. The pair table is a suggestion engine.

### Order-line render

Each order line shows its existing summary. Below the line, `surcharge_total > 0` produces a child row matching POL-71's pattern. With cutlist surcharge specifically, the child row label uses `cutlist_surcharge_label || effectiveOverrideSummary(snapshot)` where `effectiveOverrideSummary` generates a string like `"Cherry Veneer Doors + Drawer Fronts (+15%)"`.

### Quote-line render

Identical visual model on the quote Line Items tab. Quote PDF renders parent + child rows.

### Quote PDF generation

A new helper `lib/quotes/render-cutlist-summary.ts:summariseLineCutlistDelta(snapshot, surchargeKind, surchargeValue)` returns:

```ts
type CutlistDeltaSummary = {
  childLines: Array<{ description: string; amount: number }>;
};
```

Logic:
- If snapshot has no overrides AND `cutlist_surcharge_value === 0` → no child lines.
- Otherwise, group overrides by `effective_board_id`. For each non-default group, emit one child line: `"<Board name> <pluralised part roles> (+<surcharge>)"`. Cap at 3 child lines; remainder rolls up into "+ other variations" with the residual surcharge.
- The amount on the surcharge child line is the resolved cutlist surcharge for that line (single child line gets the full amount; multi-line cases distribute proportionally — by default share the surcharge across the FIRST child line only and tag others with `(included above)` to avoid double-counting).

Quote total continues to come from `quotes.subtotal` recomputed via the POL-71 `update_quote_totals()` trigger — no change.

### Settings: Board↔Edging pairs admin

New settings page `app/settings/board-edging-pairs/page.tsx`:
- Lists all pairs in the org grouped by board, with thickness column.
- Edit pair: change the edging.
- Delete pair: removes the suggestion (lines using that board+thickness will revert to manual edging selection on next save).
- Phase E feature; not blocking on B/C/D.

### MaterialAssignmentGrid coexistence (Phase F)

- The grid stays on the cutting plan tab, with a reworded header: *"Workshop adjustments — these mirror the line-level cutlist material decisions."*
- Reads: union of (line primaries + line overrides + legacy `material_assignments` for orders not yet re-saved).
- Writes: redirect to the line's `cutlist_primary_material_id` / `cutlist_part_overrides` based on the fingerprint's `order_detail_id`. Edging defaults / overrides translate the same way.
- `orders.material_assignments` is preserved as the rollback target. A separate cleanup ticket later removes it after a confidence period.

## Snapshot Consumers — full audit

Mirroring POL-71's audit, applied to `cutlist_snapshot` group-level material reads. Consumers must shift to per-part `effective_*` fields with a COALESCE fallback so old snapshots without `effective_*` continue working.

### TypeScript / application readers

| Reader | File | Current behaviour | Phase A1 action |
|---|---|---|---|
| Cutlist snapshot builder | [`lib/orders/build-cutlist-snapshot.ts`](../../lib/orders/build-cutlist-snapshot.ts) | Sets group-level `primary_material_id` + `backer_material_id` from product, applies `materialOverrides` map | **Update** to populate per-part `effective_*` fields from line primary + overrides + pair lookup. Replace `materialOverrides`/`removedMaterialIds` parameters with `(linePrimary, lineEdging, partOverrides, pairLookup)`. |
| Quote cutlist snapshot builder | `lib/quotes/build-cutlist-snapshot.ts` (new) | N/A | **Create** with the same shape. |
| Cutting plan candidate builder | [`lib/piecework/cuttingPlanWorkPool.ts`](../../lib/piecework/cuttingPlanWorkPool.ts) | Reads group `primary_material_id` | **Update** to read per-part `effective_board_id`. Filter `quantity > 0` already in place. |
| Material role builder | [`lib/orders/material-assignment-types.ts:buildPartRoles`](../../lib/orders/material-assignment-types.ts) | Reads group + parts; matches assignment by fingerprint | **Update** to prefer per-part `effective_board_id` from snapshot before falling back to `material_assignments` lookup. |
| Edging computation | [`lib/orders/edging-computation.ts`](../../lib/orders/edging-computation.ts) | Reads `material_assignments.edging_defaults/overrides` | **Update** to prefer per-part `effective_edging_id` from snapshot. Falls back to `material_assignments` for orders not yet re-saved. |
| Cutlist row builder | [`lib/cutlist/groupsToCutlistRows.ts`](../../lib/cutlist/groupsToCutlistRows.ts) | Group-level material | **Update** to per-part `effective_board_id`. |
| Cutting plan API | [`app/api/orders/[orderId]/cutting-plan/route.ts`](../../app/api/orders/[orderId]/cutting-plan/route.ts) | Reads `cutlist_snapshot` | **Update** to per-part fields. |
| Cutting plan aggregate | [`app/api/orders/[orderId]/cutting-plan/aggregate/route.ts`](../../app/api/orders/[orderId]/cutting-plan/aggregate/route.ts) | Same | **Update**. |
| Material regroup | [`lib/orders/material-regroup.ts`](../../lib/orders/material-regroup.ts) | Group-level | **Update**. |
| Cutting plan viewer | [`components/features/orders/CuttingPlanViewer.tsx`](../../components/features/orders/CuttingPlanViewer.tsx) | Display only | **Update** to show effective per-part materials. |
| from-quote conversion | [`app/api/orders/from-quote/route.ts`](../../app/api/orders/from-quote/route.ts) | Calls `deriveCutlistSwapEffectsFromBomSnapshot` and `buildCutlistSnapshot(materialOverrides, removedMaterialIds)` | **Update** to clone `cutlist_primary_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, and surcharge fields from quote_item to order_detail; rebuild snapshot using the new builder signature. |
| add-products endpoint | [`app/api/orders/[orderId]/add-products/route.ts`](../../app/api/orders/[orderId]/add-products/route.ts) | Builds cutlist snapshot from product defaults | **Update** to seed line primary from `product_cutlist_groups.primary_material_id` (when set) or NULL. Apply pair lookup for default edging if primary is set. |
| Tests | [`tests/edging-computation.test.ts`](../../tests/edging-computation.test.ts), [`tests/cutting-plan-aggregate.test.ts`](../../tests/cutting-plan-aggregate.test.ts), [`lib/piecework/__tests__/cuttingPlanWorkPool.test.ts`](../../lib/piecework/__tests__/cuttingPlanWorkPool.test.ts), [`lib/piecework/__tests__/cuttingPlanWorkPool.integration.test.ts`](../../lib/piecework/__tests__/cuttingPlanWorkPool.integration.test.ts), [`lib/piecework/__tests__/productCosting.test.ts`](../../lib/piecework/__tests__/productCosting.test.ts), [`lib/orders/cutting-plan-aggregate.test.ts`](../../lib/orders/cutting-plan-aggregate.test.ts), [`lib/cutlist/productCutlistLoader.ts`](../../lib/cutlist/productCutlistLoader.ts) tests | Old shape fixtures | **Update** fixtures + add: no overrides; single board override; full two-tone (carcass+door split); `32mm-backer` resolves to 32mm thickness; NULL line primary; per-part edging override. |

### SQL/RPC readers

**Confirmed 2026-04-29 — no SQL/RPC reader of `cutlist_snapshot` exists.**

Two probes:
- `grep -rn "cutlist_snapshot" supabase/migrations/ db/migrations/ migrations/` returned 0 results.
- `pg_proc` filter for any `public` schema function whose body references `cutlist_snapshot` returned 0 rows.

A1-CS1 is therefore a documented no-op. If implementation discovers an RPC added between spec sign-off and execution, STOP and add it to the AC. Do not silently leave it un-audited.

### Out-of-band readers

If implementation finds any reader of `cutlist_snapshot` not listed above, STOP and add to A1 AC.

## Lifecycle & Lock Behaviour

Identical to POL-71. The system never blocks a swap.

| Stage | Cutlist swap allowed? | Warning shown? | Exception logged? |
|---|---|---|---|
| Quote draft / sent | Yes | No | No |
| Order placed, no PO yet | Yes | No | No |
| PO drafted | Yes | No | No |
| PO sent to supplier | Yes | Yes | Yes |
| Cutting plan finalized | Yes | Yes | Yes |
| Job card issued | Yes | Yes | Yes |
| Order dispatched | Yes | Yes | Yes |

## Downstream-state Probe (Phase D)

Order-side only. Reuses POL-71's probe in `lib/orders/downstream-swap-exceptions.ts`. New entry point:

```ts
async function probeForCutlistSwap(
  orderDetailId: number,
  beforeSnapshot: CutlistSnapshotGroup[] | null,
  afterSnapshot: CutlistSnapshotGroup[] | null,
): Promise<DownstreamEvidence>;
```

Same four sources (supplier orders, work pool rows from cutting plan, issued job cards, order dispatched). If any returns positive AND the cutlist primary or any per-part override changed, write a `bom_swap_exceptions` row with `exception_type = 'cutlist_material_swapped_after_downstream_event'`.

CHECK constraint extension (Phase D migration):

```sql
ALTER TABLE bom_swap_exceptions
  DROP CONSTRAINT bom_swap_exceptions_exception_type_check;

ALTER TABLE bom_swap_exceptions
  ADD CONSTRAINT bom_swap_exceptions_exception_type_check
    CHECK (exception_type IN (
      'bom_swapped_after_downstream_event',
      'cutlist_material_swapped_after_downstream_event'
    ));
```

The activity log payload shape for cutlist exceptions captures the before/after `cutlist_primary_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, and surcharge fields. Same `created` / `swap_applied` / `acknowledged` / `resolution_selected` / `resolved` / `auto_resolved` event types.

## Phasing

Six Linear sub-issues under POL-83 (parent to be created when this spec is signed off). Codex picks them up in order; Claude reviews each before the next begins.

| Phase | Linear scope | Migration? | Greg sign-off? |
|---|---|---|---|
| **A1** | Schema migrations + extended snapshot shape + builders + ALL consumer updates (TS + SQL/RPC audit) + backfill | Yes (multiple) | Yes (RLS + tenant FKs + backfill) |
| **B** | Order-line `CutlistMaterialDialog` + per-part override UI + auto-pair learn/confirm + surcharge resolution wiring | No | No |
| **C** | Quote-line wiring + quote PDF rendering + quote→order conversion clones cutlist data | No | No |
| **D** | Downstream-exception integration + warning banner + activity log payload extension | Yes (CHECK widen) | Yes (RLS recheck) |
| **E** | Settings → Board↔Edging pairs admin + `components.surcharge_percentage` admin | No | No |
| **F** | MaterialAssignmentGrid behaviour switch (writes redirect to per-line `cutlist_part_overrides`) | No (data-only fallback for legacy orders) | No |

Phases B/C/D/E/F may proceed in parallel after A1 lands, but D depends on B (the swap mutation hooks the probe), and F depends on B/C being live so the per-line UX is the canonical input before the grid flips.

## Acceptance Criteria

### Phase A1 — Schema + snapshot shape + consumers + backfill

**Migration discipline (each step is a separate AC line):**
- A1-D1 Migration files created at `supabase/migrations/<timestamp>_<name>.sql`. Multiple files acceptable; each named distinctly.
- A1-D2 Each migration applied via `mcp__supabase__apply_migration`.
- A1-D3 `mcp__supabase__list_migrations` reconciles against the local migration directory; output captured in PR.
- A1-D4 [`docs/operations/migration-status.md`](../operations/migration-status.md) updated in the same PR.

**Schema:**
- A1-S1 `quote_items` gains `cutlist_snapshot`, `cutlist_primary_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, `cutlist_surcharge_kind`, `cutlist_surcharge_value`, `cutlist_surcharge_label`.
- A1-S2 `order_details` gains the same columns (excluding `cutlist_snapshot`, which already exists).
- A1-S3 `components.surcharge_percentage` added (nullable, range-checked).
- A1-S4 `UNIQUE (component_id, org_id)` added to `components`. STOP and ask if this conflicts with existing constraints.
- A1-S5 Composite FKs `quote_items_cutlist_primary_material_org_fk`, `quote_items_cutlist_primary_edging_org_fk`, `order_details_cutlist_primary_material_org_fk`, `order_details_cutlist_primary_edging_org_fk` added.
- A1-S6 `board_edging_pairs` table + indexes + 4 RLS policies per spec DDL.
- A1-S7 `board_edging_pairs_unique` constraint enforced.

**Snapshot shape and builders:**
- A1-B1 `CutlistSnapshotPart` TypeScript type extended with `effective_board_id`, `effective_board_name`, `effective_thickness_mm`, `effective_edging_id`, `effective_edging_name`, `is_overridden`.
- A1-B2 `lib/orders/build-cutlist-snapshot.ts` populates all new fields from line primary + overrides + pair lookup. Default state (no overrides, no primary set) populates `effective_*` from group's `primary_material_id` (when present) or NULL.
- A1-B3 `lib/quotes/build-cutlist-snapshot.ts` (new file) builds the same shape for `quote_items`.
- A1-B4 `lib/orders/cutlist-surcharge.ts:resolveCutlistSurcharge` helper added.

**Snapshot consumer updates (TS):**
- A1-CT1 `lib/piecework/cuttingPlanWorkPool.ts` reads per-part `effective_board_id`. Test added.
- A1-CT2 `lib/orders/material-assignment-types.ts:buildPartRoles` prefers per-part effective fields. Test added.
- A1-CT3 `lib/orders/edging-computation.ts` prefers per-part `effective_edging_id`. Test added.
- A1-CT4 `lib/cutlist/groupsToCutlistRows.ts` reads per-part. Test added.
- A1-CT5 Cutting plan API + aggregate route updates. Test added (or browser smoke noted).
- A1-CT6 `lib/orders/material-regroup.ts` reads per-part. Test added.
- A1-CT7 `app/api/orders/from-quote/route.ts` clones cutlist data on conversion. Browser smoke covers this in C.
- A1-CT8 `app/api/orders/[orderId]/add-products/route.ts` seeds line primary from product. Browser smoke covers this.
- A1-CT9 If any other TS reader is discovered, it's added to AC and updated.

**Snapshot consumer updates (SQL/RPC):**
- A1-CS1 Re-confirm via `grep` and `pg_proc` query that no SQL/RPC reader of `cutlist_snapshot` exists. Document in PR. STOP and add ACs if any reader has been introduced between spec sign-off and execution.

**Backfill:**
- A1-BF1 Migration backfills `orders.material_assignments` per-line entries → `order_details.cutlist_primary_material_id` (most-common board for the line by part-quantity-weighted count; ties broken by ascending `component_id` for determinism) + `cutlist_part_overrides` (everything else) + `cutlist_primary_edging_id` (the matching pair from `board_edging_pairs` if one exists, else the most-common edging from `edging_defaults` for that line; same tie-breaker rule) + edging overrides.
- A1-BF2 Backfill is re-runnable. Captured in PR diff.
- A1-BF3 STOP and ask if backfill produces >5% of orders with >30% override-count percentage (signals misclassified primary).
- A1-BF4 Quote items have nothing to backfill (no quote-side material data exists today). Document.

**Verification:**
- A1-V1 Unit tests cover: no overrides; single board override; full two-tone (carcass+door split); `32mm-backer` group resolving to 32mm thickness; product with NULL group primary; surcharge fixed × qty; surcharge percentage × qty; pair lookup hit/miss.
- A1-V2 SQL parity tests if any RPC was superseded.
- A1-V3 `npm run lint` clean.
- A1-V4 `npx tsc --noEmit` clean (or pre-existing failures explicitly enumerated).
- A1-V5 `mcp__supabase__get_advisors --type security` returns no new issues.
- A1-V6 Backfill parity check: query that compares pre-/post-backfill effective material per part role for a sample of 10 orders; zero diffs expected.

### Phase B — Order-line `CutlistMaterialDialog`

- B1 New `CutlistMaterialDialog` component in `components/features/shared/`.
- B2 Primary picker uses category-restricted `/api/components/by-category/[categoryId]` endpoint.
- B3 Edging picker auto-fills from `board_edging_pairs` lookup on primary change.
- B4 Per-part override disclosure expands by default if line has overrides; collapsed otherwise. Override count badge.
- B5 Surcharge field accepts numeric input, kind toggle (`Fixed R / %`), label autofills from primary board name. Tier hint from `components.surcharge_percentage` populates field on first open if untouched.
- B6 Apply persists `cutlist_primary_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, `cutlist_surcharge_kind`, `cutlist_surcharge_value`, `cutlist_surcharge_label`, `surcharge_total` in the same UPDATE; cutlist snapshot rebuilt; order-totals trigger from POL-71 fires.
- B7 Auto-pair confirmation prompt fires only on conflicting pair (existing pair, different edging). First-time pairing silent.
- B8 Order-line render shows child row for cutlist surcharge (parallel to POL-71's BOM-row child rendering).
- B9 Order PDF renders child row.
- B10 **Isolated browser smoke:** new order with Panel Leg Desk Test (product 856), open dialog, set primary Iceberg White, set 7% surcharge, override Doors to Cherry Veneer with 15% override, save, reload. Confirm `cutlist_snapshot` per-part effective fields populated, `surcharge_total` resolved, child rows rendered.
- B11 Lint + tsc clean.

### Phase C — Quote-line UI + PDF + conversion

- C1 `AddQuoteItemDialog` Product tab renders the `CutlistMaterialDialog` card below existing line fields when the chosen product has a `product_cutlist_groups` row.
- C2 Quote-line edit dialog uses the same component.
- C3 Quote PDF renders parent + cutlist child line(s) via `lib/quotes/render-cutlist-summary.ts:summariseLineCutlistDelta`.
- C4 Multi-board cap: max 3 child lines, residual rolls into "+ other variations."
- C5 Quote total auto-recalculates via POL-71's `update_quote_totals()` trigger (no change required).
- C6 Quote→order conversion (`app/api/orders/from-quote/route.ts`) clones `cutlist_primary_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, `cutlist_surcharge_kind`, `cutlist_surcharge_value`, `cutlist_surcharge_label` from quote_item to order_detail; rebuilds `cutlist_snapshot` using the new builder.
- C7 **Isolated browser smoke:** new quote with Panel Leg Desk, set primary + override doors to cherry, set 15% surcharge, regenerate PDF, view PDF; confirm child line "Cherry Veneer Doors + Drawer Fronts (+15%)" with correct amount.
- C8 **Conversion smoke:** convert that quote to an order; confirm primary, overrides, edging, surcharge cloned; cutting plan tab renders correctly.
- C9 Lint + tsc clean.

### Phase D — Downstream exception write path

- D1 Migration widens `bom_swap_exceptions_exception_type_check` to include `cutlist_material_swapped_after_downstream_event`.
- D2 Order-side cutlist swap mutation calls `probeForCutlistSwap()` and, if positive, calls `upsert_bom_swap_exception()` (existing RPC from POL-71) with the new `exception_type`.
- D3 Activity log entry shape extended to capture before/after cutlist primary/overrides/surcharge.
- D4 First swap creates the exception with `status='open'`; follow-ups append `swap_applied` activity without duplicating the exception (matches POL-71 unique-index behaviour).
- D5 Order detail page shows the warning banner when downstream activity is detected on a cutlist swap.
- D6 Production exceptions queue (existing UI) renders the new exception type with a clear visual distinction.
- D7 **Isolated browser smoke:** create order, generate cutting plan, change cutlist primary, confirm exception with `downstream_evidence.work_pool_rows[]` populated and `exception_type='cutlist_material_swapped_after_downstream_event'`. Resolve with `accept_swap_no_action`; status moves to `resolved`.
- D8 Lint + tsc clean.
- D9 `mcp__supabase__get_advisors --type security` clean (RLS recheck after CHECK constraint widen).

### Phase E — Settings: Board↔Edging pairs admin

- E1 New page `app/settings/board-edging-pairs/page.tsx` lists pairs grouped by board, with thickness column.
- E2 Edit pair changes the edging.
- E3 Delete pair removes the row; lines using that board+thickness will revert to manual edging selection on next save (existing behaviour for unknown pairs).
- E4 `components.surcharge_percentage` admin: existing component edit page gains a percentage field. Range validation client-side mirrors DB CHECK.
- E5 Settings nav link added.
- E6 **Isolated browser smoke:** edit a pair, save, confirm RLS scope (other org's pairs invisible).
- E7 Lint + tsc clean.

### Phase F — MaterialAssignmentGrid behaviour switch

- F1 Grid reads union of (line primaries + line overrides + legacy `material_assignments` for orders not yet re-saved through the new UX).
- F2 Grid writes redirect to `cutlist_primary_material_id` / `cutlist_part_overrides` based on the fingerprint's `order_detail_id`.
- F3 Edging defaults / overrides translate the same way.
- F4 Grid header reworded to "Workshop adjustments — these mirror the line-level cutlist material decisions."
- F5 `orders.material_assignments` writes are NOT removed (still present as fallback). Reading it for legacy orders is preserved.
- F6 **Isolated browser smoke:** legacy order (one with `material_assignments` populated and `cutlist_primary_material_id` NULL) — open grid, edit a part, confirm write goes to per-line columns, refresh, round-trip survives.
- F7 Lint + tsc clean.

## Verification Commands

```bash
# All phases
npm run lint
npx tsc --noEmit

# Phase A1
npm run schema
mcp__supabase__list_migrations
mcp__supabase__get_advisors --type security
npx vitest run lib/orders/build-cutlist-snapshot lib/orders/edging-computation lib/orders/cutlist-surcharge lib/piecework/cuttingPlanWorkPool

# Backfill parity (sample)
mcp__supabase__execute_sql "
WITH sample AS (
  SELECT order_id FROM orders ORDER BY created_at DESC LIMIT 10
)
SELECT order_id,
       (SELECT COUNT(*) FROM order_details od WHERE od.order_id = s.order_id AND od.cutlist_primary_material_id IS NOT NULL) AS lines_with_primary,
       (SELECT COUNT(*) FROM order_details od WHERE od.order_id = s.order_id AND jsonb_array_length(od.cutlist_part_overrides) > 0) AS lines_with_overrides
FROM sample s
"

# Phase B / C / D / E / F — see B10 / C7 / D7 / E6 / F6 above for browser smokes.
```

## Decision Points (Codex must STOP and ask Greg)

- **`components.UNIQUE (component_id, org_id)` conflict.** If `components` already has a UNIQUE that conflicts with the new constraint, STOP.
- **Out-of-band `cutlist_snapshot` consumer.** Any reader (TS or SQL) not in this spec → STOP and add to A1 AC.
- **Backfill drift.** If A1 backfill produces >5% of orders with >30% override-count percentage, STOP and surface examples.
- **Unknown `board_type` value.** Any value in `product_cutlist_groups.board_type` not in `{'16mm', '32mm-both', '32mm-backer'}` → STOP, confirm thickness mapping.
- **PDF render edge case.** Line with more board variations than the 3-line cap → STOP, confirm cap behaviour with Greg.
- **Composite FK on `components` blocks an in-flight migration.** If `components` already has triggers or constraints that block adding the composite UNIQUE, STOP.
- **Auto-pair confirmation prompt UX.** If implementation finds the prompt fires too often during normal use (>50% of saves on the dev env), STOP and revisit.
- **`MaterialAssignmentGrid` write redirection breaks an existing flow.** If F's switch breaks the cutting plan generation for legacy orders, STOP and reconcile.

## Rollback / Release Notes

### Phase A1 (migration-bearing)
- Migrations reversible: drop new columns, drop new tables, restore prior types/builders from migration history.
- The COALESCE fallback in consumer updates means existing snapshots without per-part `effective_*` continue to work.
- If forward migration fails on a row, abort in transaction and roll back; do not skip rows.
- Backfill is data-only and re-runnable. Rolling back the schema also rolls back the backfill.

### Phase B / C
- Standard PR revert.

### Phase D (migration-bearing)
- CHECK constraint widen is reversible by dropping the new constraint and re-adding the original. Existing exception rows of the new type would block rollback; document this in the rollback runbook.

### Phase E / F
- Standard PR revert. Phase F's behaviour switch is reversible by reverting the grid component; legacy `orders.material_assignments` is preserved.

## Documentation Requirements

- Update [`docs/superpowers/specs/2026-04-01-edging-computation-design.md`](./2026-04-01-edging-computation-design.md) with a "v2 — extended for line-level edging primary + auto-pair learning" header and back-link.
- Update [`docs/features/cutlist-calculator.md`](../features/cutlist-calculator.md) with the per-line primary + overrides model.
- Update [`docs/operations/migration-status.md`](../operations/migration-status.md) in each migration-bearing PR (A1 and D).
- Add a short "Cutlist material picker" section to the order detail and quote detail user docs.
- Phase E updates settings docs to include the Board↔Edging pairs admin page.

## Out of Scope

- Visual parts-thumbnail picker (POL-82, deferred polish on top of this work).
- Bulk-apply across order lines.
- Customer self-service material picker.
- Real-time 3D preview in the dialog.
- Configurator → cutlist direct write (separate workstream per `2026-04-20-order-cutlist-costing-design.md`).
- Currency or tax handling on the surcharge.
- Migrating `orders.material_assignments` writes off altogether (Phase F preserves it as fallback; full removal is a future cleanup ticket).
- Per-part surcharge (per Greg 2026-04-29: surcharge stays per-line).
- Auto-recalculating the nested cutting plan when materials change — existing "stale plan" pattern handles this; operator re-runs Generate.

## Open Questions

None. All resolved 2026-04-29 in brainstorm with Greg.

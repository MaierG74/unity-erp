# Cutlist Material Swap & Surcharge

> **LOCAL DESKTOP ONLY.** Codex Cloud must not pick up this work — Cloud branches off `main`, this branch lives off `codex/integration` and depends on the post-POL-71 state. Greg runs Codex on the local desktop; Claude reviews and merges.

**Date:** 2026-04-29
**Status:** v5, **signed off** by GPT-5.5 Pro round-4 review (2026-04-29). Ready for Linear filing (POL-83 + sub-issues) and Codex Desktop pickup.

Review history:
- Round 1 (2026-04-29): 3 BLOCKERs / 8 MAJORs / 2 MINORs — all integrated → v2.
- Round 2 (2026-04-29): 3 BLOCKERs / 6 MAJORs / 1 MINOR — all integrated → v3.
- Round 3 (2026-04-29): 1 BLOCKER / 1 MAJOR / 1 MINOR; "no broader architecture issues remain" — all integrated → v4.
- Round 4 (2026-04-29): 0 BLOCKERs / 0 MAJORs / 2 MINORs; explicit "Ship the spec" recommendation — both integrated → v5.

Workflow trial in effect — see `docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md`. Trial exit criteria evaluation captured in the same doc.
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
- **Surcharge total integration (Phase A2 trigger).** `surcharge_total` is **DB-derived** by a BEFORE INSERT/UPDATE trigger introduced in Phase A2. The trigger recomputes `cutlist_surcharge_resolved` and `surcharge_total` from row state on every relevant column change (incl. quantity, unit_price, bom_snapshot, cutlist_surcharge_kind/value, AND any direct write to surcharge_total / cutlist_surcharge_resolved themselves). Application code's `resolveCutlistSurcharge` helper is **preview-only** — it computes the same number app-side for live UI display, but the DB trigger is authoritative on commit. POL-71's order-totals trigger (AFTER) sums the post-recompute `surcharge_total` into `orders.total_amount` and `quotes.subtotal`. Trigger ordering: BEFORE recompute fires first, then row write, then AFTER totals fires.
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
| `order_details` has `bom_snapshot`, `cutlist_snapshot`, `surcharge_total`. | Same query | Order-side `cutlist_snapshot` column is **renamed to `cutlist_material_snapshot`** in A1 to match the new quote-side column name and avoid the TS-property collision documented in §1. JSONB shape also extended (per-part effective fields). The rename is safe because zero SQL/RPC readers exist (verified independently). |
| Two views read `order_details`: `jobs_in_factory` and `factory_floor_status`. Both reference `surcharge_total` only — neither reads `cutlist_snapshot` (or any other column being renamed/added in this spec). | `information_schema.views` query 2026-04-29 | Adding cutlist columns to `order_details` will not drift these views. The `cutlist_snapshot → cutlist_material_snapshot` rename is also safe at the view layer (no view references the column). (POL-71 caught view drift on order-totals; safe here.) |
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

#### NULL primary state — the "unassigned" lifecycle stage

`cutlist_primary_material_id` is **nullable**. NULL means "the user hasn't picked a colour for this line yet." It is a valid state at:

- Quote draft (salesperson has typed the product into the quote but not yet picked a colour)
- Order line just-added from the existing add-products flow on a product whose cutlist groups have NULL `primary_material_id` (today's most-common case)

NULL is **invalid** at:

- Cutting plan generation. The cutting plan UI (Generate button) MUST validate that every order line whose product has a cutlist group has a non-null `cutlist_primary_material_id` (and `cutlist_primary_backer_material_id` when the product has a `-backer` group). Validation failure surfaces as an inline banner on the cutting plan tab listing offending lines, NOT a hard error. Operator clicks through to fix.
- Quote→order conversion. If the source quote_item has a NULL primary AND its product has cutlist groups, the conversion either (a) seeds the order_detail's primary from `product_cutlist_groups.primary_material_id` if the product has one, or (b) carries NULL through (and the cutting plan validator catches it later). Decision: option (b) — preserves the user's intent that nothing was picked.

Application/UI consequences:
- The `CutlistMaterialDialog` always renders for products with cutlist groups, even if the line's primary is NULL. Dialog title in NULL state: *"Pick a cutlist material"* with no surcharge field highlighted (surcharge is only meaningful relative to a chosen primary).
- Saving the dialog with primary still NULL is allowed (matches today's "soft" workflow). The line remains in the unassigned state.
- The MaterialAssignmentGrid's existing per-part assignment UX is the second user-facing path that sets primaries — it remains operational, with Phase F's behaviour switch routing those writes to the new columns.

### How this composes with POL-71

POL-71 added `surcharge_total` to `quote_items` and `order_details` and an AFTER-trigger that rolls it into the order/quote totals. POL-71 wrote `surcharge_total` from application code on every save path. **This spec replaces that pattern** for both BOM and cutlist surcharges with a DB-side BEFORE INSERT/UPDATE trigger introduced in Phase A2:

```
                 (DB-side, Phase A2)                           (DB-side, POL-71)
                 ────────────────────                          ──────────────────
NEW row state ──▶ BEFORE trigger recomputes        ──▶ AFTER trigger sums
  qty, unit_price,        cutlist_surcharge_resolved =          surcharge_total over
  bom_snapshot,           f(kind, value, qty, unit_price)       lines into
  cutlist_surcharge_*     surcharge_total =                     orders.total_amount
                            BOM_sum × qty                       quotes.subtotal
                          + cutlist_surcharge_resolved
```

Both sums are now computed by the DB. Application code MAY write any value to `surcharge_total` or `cutlist_surcharge_resolved` — the BEFORE trigger overwrites it pre-commit. App-side helpers (`resolveCutlistSurcharge` in `lib/orders/cutlist-surcharge.ts`) exist only for **live UI preview** and must mirror the DB function exactly (parity tests required, see A1-V1).

Why a trigger instead of app-side recomputation: POL-71's app-side pattern silently drifts when a generic PATCH route changes `quantity` alone without recomputing `surcharge_total`. The trigger eliminates the entire class of drift bugs at the cost of one BEFORE trigger per affected table.

## Data Model Changes

### 1. `quote_items` extensions

> **Naming caution.** `quote_items` does NOT receive a column named `cutlist_snapshot`. The TypeScript `QuoteItem.cutlist_snapshot` property is already in use ([`lib/db/quotes.ts:35`](../../lib/db/quotes.ts), [`app/api/quotes/[id]/route.ts:99`](../../app/api/quotes/[id]/route.ts)) — it maps to `quote_item_cutlists(*)` (a side table for quote cutlist *layout* — `layout_json`, `billing_overrides`, `line_refs`). Adding a column with the same name would shadow the existing property under Supabase's `select('*')` mapping. The new column is `cutlist_material_snapshot`. Throughout this spec, `cutlist_material_snapshot` is the new JSONB on `quote_items` AND on `order_details`. (The order-side already has a column literally called `cutlist_snapshot` from before POL-71; we rename that too in this spec to keep both sides symmetric — see §2 for the order-side rename migration.)

```sql
ALTER TABLE quote_items
  ADD COLUMN cutlist_material_snapshot JSONB NULL,
  ADD COLUMN cutlist_primary_material_id INTEGER NULL,
  ADD COLUMN cutlist_primary_backer_material_id INTEGER NULL,
  ADD COLUMN cutlist_primary_edging_id INTEGER NULL,
  ADD COLUMN cutlist_part_overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN cutlist_surcharge_kind TEXT NOT NULL DEFAULT 'fixed'
    CHECK (cutlist_surcharge_kind IN ('fixed','percentage')),
  ADD COLUMN cutlist_surcharge_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN cutlist_surcharge_label TEXT NULL,
  ADD COLUMN cutlist_surcharge_resolved NUMERIC(12,2) NOT NULL DEFAULT 0;
```

`cutlist_surcharge_resolved` is the cutlist-only resolved amount used for child-row rendering. `surcharge_total` (existing from POL-71) remains the rolled-up total (BOM + cutlist) consumed by the order/quote totals trigger.

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
  ADD CONSTRAINT quote_items_cutlist_primary_backer_org_fk
    FOREIGN KEY (cutlist_primary_backer_material_id, org_id)
    REFERENCES components (component_id, org_id),
  ADD CONSTRAINT quote_items_cutlist_primary_edging_org_fk
    FOREIGN KEY (cutlist_primary_edging_id, org_id)
    REFERENCES components (component_id, org_id);
```

A `UNIQUE (component_id)` PK or single-column UNIQUE on `components` is normal current shape and does NOT block the new composite UNIQUE. STOP only if: (a) a constraint name collides, (b) data violates `(component_id, org_id)` uniqueness (duplicate rows), or (c) a migration lock prevents in-place ALTER.

### 2. `order_details` extensions

```sql
-- Rename the pre-existing order-side column to keep both sides symmetric.
-- Verified 2026-04-29: 0 SQL/RPC readers of `cutlist_snapshot`, so the rename
-- is safe at the DB layer. App-layer readers must be updated in the same PR
-- (see §Snapshot Consumers).
ALTER TABLE order_details RENAME COLUMN cutlist_snapshot TO cutlist_material_snapshot;

ALTER TABLE order_details
  ADD COLUMN cutlist_primary_material_id INTEGER NULL,
  ADD COLUMN cutlist_primary_backer_material_id INTEGER NULL,
  ADD COLUMN cutlist_primary_edging_id INTEGER NULL,
  ADD COLUMN cutlist_part_overrides JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN cutlist_surcharge_kind TEXT NOT NULL DEFAULT 'fixed'
    CHECK (cutlist_surcharge_kind IN ('fixed','percentage')),
  ADD COLUMN cutlist_surcharge_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN cutlist_surcharge_label TEXT NULL,
  ADD COLUMN cutlist_surcharge_resolved NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT order_details_cutlist_primary_material_org_fk
    FOREIGN KEY (cutlist_primary_material_id, org_id)
    REFERENCES components (component_id, org_id),
  ADD CONSTRAINT order_details_cutlist_primary_backer_org_fk
    FOREIGN KEY (cutlist_primary_backer_material_id, org_id)
    REFERENCES components (component_id, org_id),
  ADD CONSTRAINT order_details_cutlist_primary_edging_org_fk
    FOREIGN KEY (cutlist_primary_edging_id, org_id)
    REFERENCES components (component_id, org_id);
```

The rename targets the column that already exists (`order_details.cutlist_snapshot`) and brings it in line with the new `quote_items.cutlist_material_snapshot`. The JSONB shape extension applies (see §5).

Composite FK on backer mirrors the primary/edging pattern.

#### Deployment / schema-cache plan for the column rename

The DB-layer rename is atomic, but the app deployment is not. Many TS files reference `cutlist_snapshot` as a literal string or typed property: `lib/orders/build-cutlist-snapshot.ts`, `app/api/orders/from-quote/route.ts`, `app/api/orders/[orderId]/add-products/route.ts`, `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts`, `app/api/orders/[orderId]/export-cutlist/route.ts`, `app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts`, `lib/orders/cutting-plan-utils.ts`, the `OrderDetail` type, Supabase generated types, every test fixture using the old shape. A Codex implementation that lands the migration without coordinated app deployment will 500 every in-flight request the moment migration commits.

**Required deployment shape (pick ONE; A1-D5 added AC):**

**Option 1 — Maintenance window (default).** Take the app to a maintenance page, apply the A1 migration, regenerate `mcp__supabase__generate_typescript_types`, redeploy app, refresh PostgREST schema cache (`NOTIFY pgrst, 'reload schema'`), bring app back up. Expected downtime: 5–10 min. Acceptable since the workshop is single-tenant.

**Option 2 — Expand-contract migration.** Phase A1 ships only `ADD COLUMN cutlist_material_snapshot` (no rename) and copies data on every write to keep both columns in sync via a temporary sync trigger. App reads from `cutlist_material_snapshot` after redeploy. A separate "Phase A1.5" migration drops the old `cutlist_snapshot` column once the app is on the new path for at least one cycle. More moving parts, no downtime.

**Decision: Option 1 (maintenance window).** Greg can stage the rollout during a low-activity window (early morning, no salespeople active). A coordinated 10-minute downtime is cheaper than the expand-contract complexity. STOP and ask if any tenant constraint changes this assumption.

**A1-D5 (added):** Migration runbook documented in `docs/operations/migration-status.md` for this PR. Includes:
- Pre-migration: announce maintenance window
- Apply A1 migration via `mcp__supabase__apply_migration`
- Regenerate types: `mcp__supabase__generate_typescript_types > types/supabase.ts`
- Update hand-rolled types: `types/orders.ts`, any `lib/db/quotes.ts` interfaces referencing `cutlist_snapshot`
- Build + deploy app
- Refresh PostgREST schema cache: `mcp__supabase__execute_sql "NOTIFY pgrst, 'reload schema'"`
- Smoke: open an existing order's cutting plan tab, confirm 200 + correct render

If Phase A1 is split into multiple PRs (likely given the consumer audit size), the rename migration must land in the SAME PR as the consumer-update code that depends on it.

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

-- Keep updated_at fresh on every row update.
CREATE OR REPLACE FUNCTION board_edging_pairs_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER board_edging_pairs_updated_at_trigger
  BEFORE UPDATE ON board_edging_pairs
  FOR EACH ROW EXECUTE FUNCTION board_edging_pairs_set_updated_at();

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

### 5. Extended `cutlist_material_snapshot` JSONB shape

`CutlistSnapshotGroup` gains `effective_backer_id` / `effective_backer_name` (resolved per-group from `cutlist_primary_backer_material_id` for `-backer` board types; null otherwise). `CutlistSnapshotPart` adds the per-part effective fields:

```ts
type CutlistSnapshotGroup = {
  // existing:
  source_group_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: CutlistSnapshotPart[];

  // NEW (this spec):
  effective_backer_id: number | null;        // resolved from line primary backer for -backer types
  effective_backer_name: string | null;
};

type CutlistSnapshotPart = {
  // existing:
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

### 5b. Backer material model

`-backer` board types (`32mm-backer` today, possibly others later) carry an internal backer panel (typically 16mm) glued behind the visible 32mm laminated face. The backer panel is its own physical board and must be ordered, cut, and tracked — but it doesn't take edging because it's internal to the assembly.

Today's `MaterialAssignments.backer_default` stores ONE backer material at the order level. `regroupByAssignedMaterial()` returns null for `-backer` groups when no backer is resolved ([`lib/orders/material-regroup.ts:35-37`](../../lib/orders/material-regroup.ts)). Cutting plan generation emits `cutlist_backer` overrides via [`lib/orders/cutting-plan-types.ts:12`](../../lib/orders/cutting-plan-types.ts).

This spec:
- Persists backer **per line**, not per order. Each `quote_items` and `order_details` row gains `cutlist_primary_backer_material_id INTEGER NULL`.
- Lifecycle matches the primary's lifecycle (see §Three-layer model → NULL primary state). NULL is **valid pre-cutting-plan-generation**: a quote draft or order line just-added on a product with a `-backer` group may carry NULL until the user opens the dialog and picks a backer (or the workshop fills it in via the MaterialAssignmentGrid). NULL is **invalid at cutting-plan Generate**: validation surfaces an inline banner listing offending `-backer` lines.
- Lines whose product has NO `-backer` cutlist group leave `cutlist_primary_backer_material_id` NULL forever (the column has no semantic meaning for them).
- The snapshot builder reads `cutlist_primary_backer_material_id` and writes `effective_backer_id` per group when the group's `board_type` ends in `-backer`. For non-backer groups, `effective_backer_id` stays NULL (matches the existing snapshot shape).
- No per-part backer override (backer is not user-customisable per part — it's a single physical panel behind the assembly). If Greg's workflow ever needs per-part backer differences, that's a follow-up.
- Phase F backfill maps `orders.material_assignments.backer_default` to the line's `cutlist_primary_backer_material_id` for every order_detail in that order whose product has a `-backer` group. Orders with NULL `backer_default` and `-backer` products keep NULL — they will surface in the cutting-plan validator the next time the operator clicks Generate.

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

### 7. Surcharge resolution (DB-side trigger — Phase A2)

#### Why a trigger, not app-side recomputation

`surcharge_total` is multiplicatively dependent on `quantity` (BOM surcharges scale with line qty) and on both `quantity` AND `unit_price` (cutlist percentage surcharges). The existing generic order-detail PATCH at [`app/api/order-details/[detailId]/route.ts:36`](../../app/api/order-details/[detailId]/route.ts) accepts `{quantity, unit_price, bom_snapshot, surcharge_total}` independently — a salesperson editing qty alone leaves `surcharge_total` stale, and the POL-71 totals trigger then rolls a stale number into the order/quote total.

POL-71 itself has this drift exposure (its surcharge_total scales with qty too); it's been masked because per-row BOM surcharges are usually zero. With per-line cutlist percentage surcharges in the picture, the drift becomes a live correctness bug.

**Resolution: introduce a DB trigger that recomputes `surcharge_total` from the row's own columns whenever any input field changes.** App-side code can write whatever it wants to `surcharge_total`; the trigger overwrites it before commit.

#### Trigger definition (Phase A2 migration)

```sql
-- 1. Helper: compute cutlist surcharge from the row's columns
CREATE OR REPLACE FUNCTION compute_cutlist_surcharge(
  p_kind TEXT,
  p_value NUMERIC,
  p_quantity NUMERIC,
  p_unit_price NUMERIC
) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_kind = 'percentage' THEN ROUND(COALESCE(p_unit_price, 0) * COALESCE(p_quantity, 0) * COALESCE(p_value, 0) / 100, 2)
    ELSE ROUND(COALESCE(p_value, 0) * COALESCE(p_quantity, 0), 2)
  END;
$$;

-- 2. Helper: sum BOM-snapshot surcharges × quantity
CREATE OR REPLACE FUNCTION compute_bom_snapshot_surcharge_total(
  p_snapshot JSONB,
  p_quantity NUMERIC
) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  per_unit NUMERIC := 0;
BEGIN
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'array' THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(SUM(COALESCE((entry->>'surcharge_amount')::numeric, 0)), 0)
    INTO per_unit
    FROM jsonb_array_elements(p_snapshot) AS entry;
  RETURN ROUND(per_unit * COALESCE(p_quantity, 0), 2);
END;
$$;

-- 3. Trigger function: recompute surcharge_total + cutlist_surcharge_resolved on order_details
CREATE OR REPLACE FUNCTION recompute_order_detail_surcharge_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.cutlist_surcharge_resolved := compute_cutlist_surcharge(
    NEW.cutlist_surcharge_kind, NEW.cutlist_surcharge_value, NEW.quantity, NEW.unit_price
  );
  NEW.surcharge_total :=
    compute_bom_snapshot_surcharge_total(NEW.bom_snapshot, NEW.quantity)
    + NEW.cutlist_surcharge_resolved;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_details_recompute_surcharge_total
  BEFORE INSERT OR UPDATE OF
    quantity, unit_price, bom_snapshot,
    cutlist_surcharge_kind, cutlist_surcharge_value,
    -- Include the output columns themselves so direct writes to
    -- surcharge_total or cutlist_surcharge_resolved still fire the
    -- recompute. Without these, a `PATCH { surcharge_total: 999 }`
    -- with no other field changed would persist as-is.
    surcharge_total, cutlist_surcharge_resolved
  ON order_details
  FOR EACH ROW EXECUTE FUNCTION recompute_order_detail_surcharge_total();

-- 4. Mirror function and trigger for quote_items (column name `qty` not `quantity`)
CREATE OR REPLACE FUNCTION recompute_quote_item_surcharge_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.cutlist_surcharge_resolved := compute_cutlist_surcharge(
    NEW.cutlist_surcharge_kind, NEW.cutlist_surcharge_value, NEW.qty, NEW.unit_price
  );
  NEW.surcharge_total :=
    compute_bom_snapshot_surcharge_total(NEW.bom_snapshot, NEW.qty)
    + NEW.cutlist_surcharge_resolved;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quote_items_recompute_surcharge_total
  BEFORE INSERT OR UPDATE OF
    qty, unit_price, bom_snapshot,
    cutlist_surcharge_kind, cutlist_surcharge_value,
    surcharge_total, cutlist_surcharge_resolved
  ON quote_items
  FOR EACH ROW EXECUTE FUNCTION recompute_quote_item_surcharge_total();
```

#### Defense-in-depth at the API layer

The trigger is the **authoritative** correctness defense — derived fields written by clients are always overwritten before commit. The API's role is **observability**, not enforcement:

- `app/api/order-details/[detailId]/route.ts` PATCH — when the request body contains `surcharge_total` or `cutlist_surcharge_resolved`, **log a warning** identifying the caller and the field, then **pass the value through to the DB unchanged**. The trigger overwrites it. Do NOT strip; stripping would convert the request to "no fields to update" and the existing PATCH route returns 400 in that case, masking the trigger's recompute path. Same for any quote-item PATCH.
- The new `CutlistMaterialDialog` save mutation never sends these fields (no warning to log on the happy path).
- Mark the columns in TypeScript types as **read-only at the call-site** (literal `readonly` on the relevant types) so app code can't accidentally mutate them at compile time. Runtime API validation does not reject unknown values for these fields — the trigger is authoritative.

**A2-V5 (added AC):** integration test sends `PATCH /api/order-details/[id] { surcharge_total: 999 }` with no other field changed. Asserts: (a) request returns 200 (NOT 400 — the field reached the DB), (b) DB trigger fires and recomputes from the row's other columns, (c) response body returns the recomputed value (not 999), (d) server log captured a warning identifying the bad write. A second test asserts `PATCH { quantity: 5 }` (no derived field): no warning logged, trigger fires, recomputes against the new quantity.

#### Backfill (Phase A2)

The "no-op write" pattern (`UPDATE table SET col = col`) fires the trigger and back-corrects every row, but it overwrites the existing values instantly — to honour the stop-and-ask drift threshold, capture before/after deltas BEFORE the destructive update.

**Three-step backfill:**

```sql
-- Step 1: Preflight — capture current vs computed state into a temp table.
CREATE TEMP TABLE a2_backfill_preflight_orders AS
SELECT
  order_detail_id,
  surcharge_total           AS old_surcharge_total,
  cutlist_surcharge_resolved AS old_cutlist_resolved,
  -- compute what the trigger WOULD produce, without writing it
  compute_bom_snapshot_surcharge_total(bom_snapshot, quantity)
    + compute_cutlist_surcharge(cutlist_surcharge_kind, cutlist_surcharge_value, quantity, unit_price)
    AS new_surcharge_total,
  compute_cutlist_surcharge(cutlist_surcharge_kind, cutlist_surcharge_value, quantity, unit_price)
    AS new_cutlist_resolved
FROM order_details;

CREATE TEMP TABLE a2_backfill_preflight_quotes AS
SELECT
  id AS quote_item_id,
  surcharge_total           AS old_surcharge_total,
  cutlist_surcharge_resolved AS old_cutlist_resolved,
  compute_bom_snapshot_surcharge_total(bom_snapshot, qty)
    + compute_cutlist_surcharge(cutlist_surcharge_kind, cutlist_surcharge_value, qty, unit_price)
    AS new_surcharge_total,
  compute_cutlist_surcharge(cutlist_surcharge_kind, cutlist_surcharge_value, qty, unit_price)
    AS new_cutlist_resolved
FROM quote_items;

-- Step 2: Drift report — output captured in PR.
SELECT
  COUNT(*) FILTER (WHERE ABS(new_surcharge_total - old_surcharge_total) > 0.01) AS drift_count,
  COUNT(*) AS total_rows,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ABS(new_surcharge_total - old_surcharge_total) > 0.01) / NULLIF(COUNT(*), 0), 2) AS drift_pct
FROM a2_backfill_preflight_orders;
-- Same query for quote items.

-- STOP if drift > 5% of rows. Surface the worst 20 offenders by ABS(new - old)
-- and reconcile with Greg before continuing.

-- Step 3: Apply the backfill (only if drift is acceptable).
UPDATE order_details SET quantity = quantity;  -- fires the BEFORE trigger row-by-row
UPDATE quote_items   SET qty = qty;

-- Step 4: Parity check — temp tables compared against post-update state.
SELECT COUNT(*) FROM order_details od
JOIN a2_backfill_preflight_orders p ON p.order_detail_id = od.order_detail_id
WHERE ABS(od.surcharge_total - p.new_surcharge_total) > 0.01;  -- expected 0
-- Same query for quote_items.
```

**Cascading-write note.** The `order_details` no-op UPDATE fires POL-71's AFTER `order_details_total_update_trigger` for every touched row, which in turn writes to `orders.total_amount`. Not recursive but bulk: O(N) parent writes for N order_details. Run during the same maintenance window as the rename (A1-D5). Re-runnable: subsequent runs produce zero drift in step 2 and a no-op in step 3.

#### App-side helper (preview-only, must mirror the DB function exactly)

```ts
function resolveCutlistSurcharge(line: {
  cutlist_surcharge_kind: 'fixed' | 'percentage';
  cutlist_surcharge_value: number;
  unit_price: number;
  quantity: number;
}): number {
  // MUST mirror compute_cutlist_surcharge SQL exactly:
  //  - COALESCE every input to 0 if null/undefined/empty/NaN
  //  - percentage branch: round((unit_price ?? 0) * (qty ?? 0) * (value ?? 0) / 100, 2)
  //  - fixed branch:      round((value ?? 0) * (qty ?? 0), 2)
  //  - 2dp half-away-from-zero rounding (Math.round on cents matches Postgres ROUND default for positive;
  //    use a sign-aware helper to match Postgres ROUND behaviour for negatives)
}
```

Lives in `lib/orders/cutlist-surcharge.ts`. Used by the dialog to show "= R 245.00 on this line" live as the user types. The DB trigger remains authoritative on commit.

**Parity testing — split into two layers:**

- **A1-V1a (DB↔TS numeric parity):** property-style test runs the same numeric fixture set through both `resolveCutlistSurcharge` (TS) and `compute_cutlist_surcharge` (SQL via `mcp__supabase__execute_sql`). Fixtures: fixed positive, fixed negative, fixed zero, percentage 0%, percentage 7%, percentage 100%, percentage with `unit_price=0`, percentage with `quantity=0`, decimal `unit_price` (e.g. R1234.56), NULL `cutlist_surcharge_value`. **Both implementations MUST produce identical results to the cent for every fixture.** A drift here is a BLOCKER for shipping A2.
- **A1-V1b (TS/API normalization):** two-layer test covering inputs the SQL helper cannot accept (it takes `NUMERIC`, so `''` and other non-numeric strings fail at the type boundary).
  - **Layer 1 (TS helper):** fixture passes `''` for `cutlist_surcharge_value` to `resolveCutlistSurcharge`; helper normalizes to 0.
  - **Layer 2 (API route):** integration test sends `PATCH /api/order-details/[id] { cutlist_surcharge_value: '' }` to the actual route. Asserts the route's request validator coerces `''` to NULL before insert/update; the DB trigger then sees NULL, COALESCE returns 0, and the row's `cutlist_surcharge_resolved` is 0. This route-level layer is **required** — testing only the TS helper would miss the route-side coercion.

  End-to-end, an empty-string client write produces the correct stored value (0). The SQL parity test (A1-V1a) does NOT include `''` because it's not a valid SQL input — that case is covered by A1-V1b's two layers above.

#### Architecture impact

`surcharge_total` is now a **derived column** — application code may write any value, but the trigger overwrites it pre-commit. The POL-71 order-totals and `update_quote_totals` triggers then sum the corrected `surcharge_total` into the order/quote total. Two-stage trigger chain, both BEFORE+AFTER, no recursion concerns (the recompute trigger is BEFORE on the same row; POL-71's trigger fires AFTER on the parent).

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

When the user is about to apply (clicked Apply, validation passed):

1. Walk the line's primary + per-part overrides and build the set of `(board, thickness, edging)` triples actually used on this line.
2. Group those triples by `(board, thickness)`.
3. **Intra-line conflict check (NEW).** If a single `(board, thickness)` group has MORE than one distinct `edging_component_id` on this line (e.g. user picked Iceberg White board for two different parts but assigned different edgings to each via per-part overrides), the system **does NOT auto-learn or auto-update any pair** for that `(board, thickness)`. Reasoning: there's no single "this line uses X" answer to honestly show in the prompt. Skip pair-table mutation entirely for that group; the line's own per-part overrides are saved as operational truth regardless.
4. For each `(board, thickness)` group with exactly ONE edging:
   - **First-time pairing** (no existing row in `board_edging_pairs`): silently INSERT. No prompt.
   - **Conflict pairing** (existing row, different edging): collect into a confirmation list.
5. If the conflict list is non-empty, show a single confirmation dialog listing each conflict:

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

Each order line shows its existing summary. Two **independent** child-row sources, both rendered:

1. **BOM swap surcharge child rows** (POL-71 pattern, unchanged): one child row per `bom_snapshot[].swap_kind !== 'default' AND surcharge_amount !== 0`, amount = `surcharge_amount × line_quantity`.
2. **Cutlist surcharge child row** (this spec): a single child row when `cutlist_surcharge_resolved !== 0`. Amount = `cutlist_surcharge_resolved` (not `surcharge_total` — the latter is the rolled-up sum and would double-count). Label = `cutlist_surcharge_label || effectiveOverrideSummary(snapshot)` where `effectiveOverrideSummary` generates a string like `"Cherry Veneer Doors + Drawer Fronts (+15%)"`. Sign is preserved: positive amounts render as `+ R 1,050`; negative amounts (discounts) render as `− R 200` with explicit minus sign and the colour styling reused from the BOM removal child row pattern.

`surcharge_total` (the trigger-maintained rolled-up column) is the input to the order/quote totals trigger from POL-71 ONLY. It is never used for child-row rendering.

A line with both a BOM hardware swap (R200 surcharge on a knob upgrade) AND a cutlist colour upgrade (15% × R7000 = R1050) renders three rows:

```
2 × Panel Leg Desk                           R 7,000
  + Brushed Nickel Knobs              R 200    (BOM child row, qty=1)
  + Cherry Veneer Doors (+15%)        R 1,050  (cutlist child row)
─────────────                              ─────────
                                          R 8,250  (=line_total + surcharge_total = 7000 + 200 + 1050)
```

### Quote-line render

Identical visual model on the quote Line Items tab. Quote PDF renders parent + child rows.

### Quote PDF generation

A new helper `lib/quotes/render-cutlist-summary.ts:summariseLineCutlistDelta(snapshot, cutlistSurchargeResolved)` returns:

```ts
type CutlistDeltaSummary = {
  primaryChild: { description: string; amount: number } | null;
  secondaryChildren: Array<{ description: string }>;  // amount-less, descriptive only
};
```

**Single deterministic rule (no proportional distribution):**

- If snapshot has no overrides AND `cutlist_surcharge_resolved === 0` (exactly zero) → return `{ primaryChild: null, secondaryChildren: [] }`. No cutlist child rows render.
- If `cutlist_surcharge_resolved !== 0` (positive OR negative — discount lines are explicitly supported) → render the primary child as below, sign preserved.
- Otherwise, group overrides (parts where `is_overridden = true`) by `effective_board_id`. For each non-default group, build a description string: `"<Board name> <pluralised part roles>"` (e.g. `"Cherry Veneer Doors + Drawer Fronts"`).
- Sort groups by part-quantity-weighted count descending (tie-broken by ascending `effective_board_id` for determinism).
- The **first** group is the `primaryChild` and carries the **full** `cutlist_surcharge_resolved` amount. Description appends `(+<surcharge label or kind+value>)`.
- Subsequent groups become `secondaryChildren` — descriptive only, **no amount column**, no "(included above)" tag (the amount column is absent, not zeroed). Cap at 2 secondary children; if more groups exist, the second secondary becomes `"+ other variations"` summarising the remaining ones.
- If there are NO overrides but `cutlist_surcharge_resolved > 0` (uniform colour upgrade, all parts → cherry, no two-tone), the description is just `"<Primary board name>"` and there are no secondary children.

The PDF renderer interprets `secondaryChildren` as a sub-list under the primary child:

```
2 × Panel Leg Desk                           R 7,000
  + Cherry Veneer Doors + Drawer Fronts (+15%)  R 1,050    ← primaryChild
    Modesty Panel: Cherry Veneer                            ← secondaryChildren[0]
─────────────                                  ─────────
                                              R 8,050
```

The single-amount rule eliminates rounding and proportional-distribution edge cases. The amount column ALWAYS reconciles to `cutlist_surcharge_resolved` exactly. Salesperson reading the PDF sees one number once and gets a list of which parts use which colour without having to add fractional surcharges back together.

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
- Writes: redirect to the line's `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_primary_edging_id`, and `cutlist_part_overrides` based on the fingerprint's `order_detail_id`. Edging defaults / overrides translate the same way.
- `orders.material_assignments` is preserved as the rollback target. A separate cleanup ticket later removes it after a confidence period.

### Cutting-plan source revision hash extension

`lib/orders/cutting-plan-utils.ts:computeSourceRevision` currently hashes order detail quantity + `cutlist_snapshot` + `orders.material_assignments`. With the canonical state moving to the new line-level columns, this hash must extend to include them so stale-save detection catches every relevant change:

```ts
// computeSourceRevision input gains, per detail (operational-truth fields ONLY):
{
  order_detail_id, quantity,
  cutlist_material_snapshot,                  // renamed from cutlist_snapshot
  cutlist_primary_material_id,                // NEW
  cutlist_primary_backer_material_id,         // NEW
  cutlist_primary_edging_id,                  // NEW
  cutlist_part_overrides,                     // NEW (canonical-sorted before hashing)
}
```

**`cutlist_surcharge_kind`, `cutlist_surcharge_value`, `cutlist_surcharge_label`, `cutlist_surcharge_resolved`, and `surcharge_total` are deliberately EXCLUDED from the hash.** These are commercial fields — changing the surcharge from 7% to 15% must NOT stale a cutting plan, because boards, edging, backers, parts, and layouts are unchanged. The cutting plan is operational truth; its source revision hashes only operational inputs.

The function continues to also hash `orders.material_assignments` while legacy orders may still source their cutting-plan material state from it. **Removal condition (data-based, NOT time-based):** a follow-up cleanup ticket removes the `material_assignments` term from the hash only when ALL of the following are true:
- A read-only audit query reports zero `order_details` rows where the line's effective material/edging/backer state derives from `orders.material_assignments` rather than from the new line-level columns (i.e. every `order_details.cutlist_primary_material_id` is non-null on cutlist-bearing products, or the `material_assignments` data for that line has been migrated into `cutlist_part_overrides`).
- Phase F's grid-redirect smoke has run cleanly through at least one full release cycle on production data.
- A successful smoke confirms cutting-plan generation produces identical output before and after the hash term is removed (using a held-back snapshot of pre-removal cutting plans for comparison).

Concretely: do not file the cleanup ticket as "remove after one cycle"; file it as "remove once the audit query returns zero rows AND release cycle smoke passes." The cleanup ticket's first AC is running and capturing that audit query.

#### Audit query — sketch (for the cleanup ticket's head-start)

Non-blocking shape; the cleanup ticket can refine. The query identifies `order_details` rows where the cutting-plan-relevant material/edging/backer state is still being supplied by `orders.material_assignments` rather than the new line-level columns:

```sql
-- Rows that would change behaviour if the material_assignments hash term were removed.
-- A row appears here when the line has cutlist-bearing parts but the new line-level
-- columns are NULL while orders.material_assignments still supplies a matching fingerprint.
WITH cutlist_lines AS (
  SELECT
    od.order_detail_id,
    od.order_id,
    od.product_id,
    od.cutlist_primary_material_id,
    od.cutlist_primary_backer_material_id,
    od.cutlist_primary_edging_id,
    od.cutlist_part_overrides,
    o.material_assignments,
    EXISTS (
      SELECT 1 FROM product_cutlist_groups g
      WHERE g.product_id = od.product_id AND g.org_id = od.org_id
    ) AS has_cutlist_groups,
    EXISTS (
      SELECT 1 FROM product_cutlist_groups g
      WHERE g.product_id = od.product_id AND g.org_id = od.org_id
        AND g.board_type LIKE '%-backer%'
    ) AS has_backer_group
  FROM order_details od
  JOIN orders o ON o.order_id = od.order_id
)
SELECT
  order_id,
  order_detail_id,
  product_id,
  -- Line is "legacy-sourced" if its product needs a primary but the column is NULL
  -- AND material_assignments has any entry for this order_detail_id.
  (cutlist_primary_material_id IS NULL
    AND has_cutlist_groups
    AND jsonb_path_exists(material_assignments,
        '$.assignments[*] ? (@.order_detail_id == $oid)',
        jsonb_build_object('oid', order_detail_id)))
    AS legacy_primary_missing,
  (cutlist_primary_backer_material_id IS NULL
    AND has_backer_group
    AND material_assignments ? 'backer_default'
    AND material_assignments->'backer_default' IS NOT NULL)
    AS legacy_backer_missing,
  (cutlist_primary_edging_id IS NULL
    AND has_cutlist_groups
    AND jsonb_array_length(COALESCE(material_assignments->'edging_defaults', '[]'::jsonb)) > 0)
    AS legacy_edging_missing
FROM cutlist_lines
WHERE has_cutlist_groups
  AND (
    -- any of the three legacy-sourced predicates is true
    (cutlist_primary_material_id IS NULL
      AND jsonb_path_exists(material_assignments,
          '$.assignments[*] ? (@.order_detail_id == $oid)',
          jsonb_build_object('oid', order_detail_id)))
    OR (has_backer_group
      AND cutlist_primary_backer_material_id IS NULL
      AND material_assignments->'backer_default' IS NOT NULL)
    OR (cutlist_primary_edging_id IS NULL
      AND jsonb_array_length(COALESCE(material_assignments->'edging_defaults', '[]'::jsonb)) > 0)
  );
-- Removal precondition: zero rows returned. Refinements (e.g. tighter fingerprint
-- match against cutlist_part_overrides) are the cleanup ticket's job.
```

A1-CT3a (added AC): `computeSourceRevision` extension + tests for: same primary, different override → hashes differ; same line columns, different `material_assignments` → hashes differ until deprecation cycle closes; **same line columns, different cutlist surcharge → hashes IDENTICAL** (commercial fields don't stale operational state).

## Snapshot Consumers — full audit

Mirroring POL-71's audit, applied to all consumers of the cutlist snapshot column. Two changes per consumer:
1. **Rename:** the column was `order_details.cutlist_snapshot` and is now `cutlist_material_snapshot`. Every read/write site must update the column name.
2. **Shape:** consumers must shift from group-level `primary_material_id` reads to per-part `effective_*` fields, with a COALESCE fallback so old snapshots without `effective_*` continue working.

The column-name change is straightforward (find/replace + Supabase types regen). The shape change is the substantive work.

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
| from-quote conversion | [`app/api/orders/from-quote/route.ts`](../../app/api/orders/from-quote/route.ts) | Calls `deriveCutlistSwapEffectsFromBomSnapshot` and `buildCutlistSnapshot(materialOverrides, removedMaterialIds)` | **Update** to clone `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, and surcharge fields from quote_item to order_detail; rebuild snapshot using the new builder signature. |
| add-products endpoint | [`app/api/orders/[orderId]/add-products/route.ts`](../../app/api/orders/[orderId]/add-products/route.ts) | Builds cutlist snapshot from product defaults | **Update** to seed line primary from `product_cutlist_groups.primary_material_id` (when set) or NULL. Apply pair lookup for default edging if primary is set. |
| Export cutlist | [`app/api/orders/[orderId]/export-cutlist/route.ts`](../../app/api/orders/[orderId]/export-cutlist/route.ts) | Groups parts by `group.board_type|group.primary_material_id` (group-level material) | **Update** to group by per-part `effective_board_id` so two-tone/per-part overrides export under the right material. |
| Order detail cutlist GET/PATCH | [`app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts`](../../app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts) | GET returns `cutlist_snapshot`; PATCH writes raw JSONB | **Rewrite or remove**. Raw PATCH bypasses canonical line-level columns, pair learning, surcharge resolution, and downstream exception logic. Either (a) delete the PATCH and route consumers through the new cutlist mutation, or (b) gate PATCH behind a `?force=true` admin-only param + log every use. Default action: delete and migrate consumers in this PR. |
| Generic order detail PATCH | [`app/api/order-details/[detailId]/route.ts`](../../app/api/order-details/[detailId]/route.ts) | Accepts `{quantity, unit_price, bom_snapshot, surcharge_total}` | **Update** to also accept the new cutlist fields (primary, backer, edging, overrides, surcharge_kind, surcharge_value, surcharge_label). The A2 trigger ensures `surcharge_total` is recomputed regardless of what the client sends. |
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

### Affected component ID set (the question Phase D must answer)

The probe needs to query supplier-orders, work-pool, and job-card-items by **component_id**. POL-71's BOM probe used a single `sourceComponentId`. For cutlist swaps, the affected component set is:

```
affected_component_ids = (set of every component_id that appears as an effective_board_id,
                          effective_edging_id, or effective_backer_id in beforeSnapshot)
                       ∖ (same set in afterSnapshot)
```

In words: any component that the line *was* consuming and *is no longer* consuming after the swap. This is the set we need to look up against:
1. **Outstanding supplier orders** — was a PO sent for any of these components for THIS order?
2. **Work pool rows from cutting plan** — does the cutting plan have rows referencing any of these components for THIS order?
3. **Issued job cards** — do issued job cards consume any of these components for THIS order?
4. **Order dispatched** — has the order been dispatched at all (cutlist colour was already manufactured)?

Implementation contract: `probeForCutlistSwap` MUST collect the full affected set across boards + edging + backer (NOT just board). A change from "Iceberg White board + Alpine White edging" to "Cherry Veneer board + Cherry Edge" produces an affected set of `{IcebergWhite_id, AlpineWhite_id}` — both must be queried. A change from `(IcebergWhite, AlpineWhite)` to `(IcebergWhite, GlacierEdge)` produces `{AlpineWhite_id}` only.

A pure backer-only swap (e.g. user changes only the backer panel from Hardboard to MDF) likewise produces `{Hardboard_id}` and is probed.

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
| **A1** | Schema migrations + extended snapshot shape + builders + ALL consumer updates (TS + SQL/RPC audit) + data backfill | Yes (multiple) | Yes (RLS + tenant FKs + backfill + column rename) |
| **A2** | DB trigger that recomputes `surcharge_total` + `cutlist_surcharge_resolved` on quote_items and order_details. Backfill recomputes for all existing rows. | Yes (trigger + helper functions) | Yes (trigger introduction is a behavior change, mirrors POL-71's A2) |
| **B** | Order-line `CutlistMaterialDialog` + per-part override UI + auto-pair learn/confirm + surcharge UI wiring | No | No |
| **C** | Quote-line wiring + quote PDF rendering + quote→order conversion clones cutlist data | No | No |
| **D** | Downstream-exception integration + warning banner + activity log payload extension | Yes (CHECK widen) | Yes (RLS recheck) |
| **E** | Settings → Board↔Edging pairs admin + `components.surcharge_percentage` admin | No | No |
| **F** | MaterialAssignmentGrid behaviour switch (writes redirect to per-line `cutlist_part_overrides` and `cutlist_primary_backer_material_id`) | No (data-only fallback for legacy orders) | No |

A2 must land **after** A1 (the trigger references the new `cutlist_surcharge_*` columns introduced in A1). B/C/D/E/F may proceed in parallel after A2, with D depending on B (probe hook) and F depending on B/C (canonical UX must be live before grid flips).

## Acceptance Criteria

### Phase A1 — Schema + snapshot shape + consumers + backfill

**Migration discipline (each step is a separate AC line):**
- A1-D1 Migration files created at `supabase/migrations/<timestamp>_<name>.sql`. Multiple files acceptable; each named distinctly.
- A1-D2 Each migration applied via `mcp__supabase__apply_migration`.
- A1-D3 `mcp__supabase__list_migrations` reconciles against the local migration directory; output captured in PR.
- A1-D4 [`docs/operations/migration-status.md`](../operations/migration-status.md) updated in the same PR.

**Schema:**
- A1-S1 `quote_items` gains `cutlist_material_snapshot`, `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, `cutlist_surcharge_kind`, `cutlist_surcharge_value`, `cutlist_surcharge_label`, `cutlist_surcharge_resolved`.
- A1-S2 `order_details` is renamed (`cutlist_snapshot` → `cutlist_material_snapshot`) and gains the same new columns as quote_items (the rename plus all `cutlist_primary_*`, `cutlist_part_overrides`, `cutlist_surcharge_*`, `cutlist_surcharge_resolved`).
- A1-S3 `components.surcharge_percentage` added (nullable, range-checked).
- A1-S4 `UNIQUE (component_id, org_id)` added to `components`. STOP and ask if this conflicts with existing constraints.
- A1-S5 Composite FKs added on both sides for primary, backer, and edging (six FKs total: `quote_items_cutlist_primary_material_org_fk`, `quote_items_cutlist_primary_backer_org_fk`, `quote_items_cutlist_primary_edging_org_fk`, `order_details_cutlist_primary_material_org_fk`, `order_details_cutlist_primary_backer_org_fk`, `order_details_cutlist_primary_edging_org_fk`).
- A1-S6 `board_edging_pairs` table + indexes + 4 RLS policies + `updated_at` trigger per spec DDL.
- A1-S7 `board_edging_pairs_unique` constraint enforced.
- A1-S8 `order_details.cutlist_snapshot` renamed to `cutlist_material_snapshot` in the same migration; downstream code updates reflect the new name.

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
- A1-CT8 `app/api/orders/[orderId]/add-products/route.ts` seeds line primary from product, including backer for `-backer` groups. Browser smoke covers this.
- A1-CT9 `app/api/orders/[orderId]/export-cutlist/route.ts` groups by per-part `effective_board_id` (not group-level material). Test/browser smoke for two-tone export added.
- A1-CT10 `app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts` raw PATCH is **deleted** (default action) or gated behind admin-only `?force=true` with logging. GET continues to return `cutlist_material_snapshot` (renamed). Audit consumers; migrate any to the canonical mutation path.
- A1-CT11 `app/api/order-details/[detailId]/route.ts` PATCH accepts the new cutlist columns (primary material, backer, edging, overrides, surcharge_kind/value/label). Validation rejects unknown fields. The A2 trigger ensures `surcharge_total` is recomputed regardless of what the client writes for it.
- A1-CT12 `lib/orders/cutting-plan-utils.ts:computeSourceRevision` extends to hash the new line-level columns AND `cutlist_material_snapshot`. One-cycle transition: continues to also hash `orders.material_assignments` to catch legacy orders. Test asserts hash differs across all relevant changes.
- A1-CT13 If any other TS reader is discovered, it's added to AC and updated.

**Snapshot consumer updates (SQL/RPC):**
- A1-CS1 Re-confirm via `grep` and `pg_proc` query that no SQL/RPC reader of `cutlist_snapshot` exists. Document in PR. STOP and add ACs if any reader has been introduced between spec sign-off and execution.

**Backfill:**
- A1-BF1 Migration backfills `orders.material_assignments` per-line into the new line-level columns. The translation rule is **deterministic and lossless** for cutting plan operational truth:

  1. **Primary board**: most-common board across the line's parts by part-quantity-weighted count. Ties broken by ascending `component_id`. Written to `order_details.cutlist_primary_material_id`.
  2. **Per-part board overrides**: every part whose assigned board ≠ primary → `cutlist_part_overrides[].board_component_id`. Parts matching the primary are NOT written (sparse).
  3. **Primary edging**: per-board, derive the dominant edging from `edging_defaults` for the *line's primary board*. If `edging_defaults` lists exactly one edging for the primary board → use it. If multiple thicknesses exist with different edgings → pick the edging matching the primary board's most-common thickness (resolves the `(board, thickness)` axis). Written to `order_details.cutlist_primary_edging_id`.
  4. **Per-part edging overrides**: for every part where `edging_overrides` exists OR where the part's assigned board's `edging_defaults` entry differs from the line primary edging → write `cutlist_part_overrides[].edging_component_id`. Sparse.
  5. **Backer**: `orders.material_assignments.backer_default` → `order_details.cutlist_primary_backer_material_id` for every order_detail in that order whose product has a `-backer` cutlist group. NULL otherwise.
  6. **Pair-table seeding**: every distinct `(board, thickness, edging)` triple discovered during backfill is upserted into `board_edging_pairs` with `created_at = NOW()`. First-time wins on conflicts within a single backfill run; subsequent runs are no-ops on existing rows.
- A1-BF1a **Edging-loss validation**: post-backfill query proves no edged part with a board assignment lost an effective edging. Validation population: **every `order_details` row with a non-empty `orders.material_assignments` snapshot AND any `band_edges` value true on any part**, NOT just orders with an existing `cutting_plan`. Pre-cutting-plan orders are exactly the orders that still need the legacy grid state to survive into the new line model. Output: report unmatched edged parts by `(order_detail_id, part fingerprint, board_id, thickness_mm, legacy edging source)`. Zero violations expected; STOP and surface examples if any.
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

### Phase A2 — Surcharge recompute trigger + backfill

**Migration discipline (4 separate AC lines as in A1).**

**Trigger:**
- A2-T1 New Supabase migration creates helper functions `compute_cutlist_surcharge` and `compute_bom_snapshot_surcharge_total` per spec §7.
- A2-T2 BEFORE INSERT/UPDATE trigger `order_details_recompute_surcharge_total` on `order_details` recomputes `cutlist_surcharge_resolved` and `surcharge_total` whenever `quantity`, `unit_price`, `bom_snapshot`, `cutlist_surcharge_kind`, or `cutlist_surcharge_value` changes.
- A2-T3 Mirror trigger `quote_items_recompute_surcharge_total` on `quote_items` (note column name `qty` not `quantity`).

**Backfill (three-step preflight + apply):**
- A2-BF1 Step 1 — Preflight temp tables `a2_backfill_preflight_orders` and `a2_backfill_preflight_quotes` capture old vs computed `surcharge_total` and `cutlist_surcharge_resolved`.
- A2-BF2 Step 2 — Drift report query output captured in PR. STOP and surface worst 20 offenders if drift > 5% of rows OR if the absolute drift on any single row > R100 (likely indicates a bug, not float noise).
- A2-BF3 Step 3 — Apply via `UPDATE … SET col = col`. Re-runnable.
- A2-BF4 Step 4 — Post-apply parity check vs preflight temp tables. Zero rows with drift > R0.01 expected.
- A2-BF5 Backfill runs in the SAME maintenance window as A1-D5 (column rename). Cascading O(N) writes to `orders.total_amount` via POL-71's AFTER trigger are expected; document the maintenance window.

**Verification:**
- A2-V1 Unit/integration tests covering: insert with cutlist surcharge fixed → `cutlist_surcharge_resolved` and `surcharge_total` correct; insert with percentage → both correct; UPDATE qty alone → both recomputed; UPDATE unit_price alone → percentage surcharge recomputed; UPDATE bom_snapshot adds a per-row surcharge → `surcharge_total` reflects it; UPDATE neither qty/unit_price/snapshot/cutlist_surcharge_* → `surcharge_total` unchanged (no spurious trigger fires).
- A2-V2 `mcp__supabase__execute_sql` parity check: for every row, `surcharge_total = compute_bom_snapshot_surcharge_total(bom_snapshot, qty/quantity) + compute_cutlist_surcharge(...)`. Zero violations.
- A2-V3 `mcp__supabase__get_advisors --type security` returns no new issues (verify trigger functions don't introduce SECURITY DEFINER concerns).
- A2-V4 Browser smoke: on an order line with cutlist percentage surcharge, edit qty via the existing PATCH route → reload → total updated.

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
- B10 **Isolated browser smoke:** new order with Panel Leg Desk Test (product 856), open dialog, set primary Iceberg White, set 7% surcharge, override Doors to Cherry Veneer (no per-part surcharge — line surcharge stays 7%), save, reload. Confirm `cutlist_material_snapshot` per-part effective fields populated, `cutlist_surcharge_resolved` and `surcharge_total` correct, both BOM (if any) and cutlist child rows render distinctly.
- B10a **Edit-after-save smoke:** on the same order line, change `quantity` from 2 to 3 via the existing PATCH path; reload; confirm the A2 trigger updated `surcharge_total` to reflect the new quantity (15% × R7000 × 3 instead of × 2).
- B11 Lint + tsc clean.

### Phase C — Quote-line UI + PDF + conversion

- C1 `AddQuoteItemDialog` Product tab renders the `CutlistMaterialDialog` card below existing line fields when the chosen product has a `product_cutlist_groups` row.
- C2 Quote-line edit dialog uses the same component.
- C3 Quote PDF renders parent + cutlist child line(s) via `lib/quotes/render-cutlist-summary.ts:summariseLineCutlistDelta`.
- C4 Multi-board cap: max 3 child lines, residual rolls into "+ other variations."
- C5 Quote total auto-recalculates via POL-71's `update_quote_totals()` trigger (no change required).
- C6 Quote→order conversion (`app/api/orders/from-quote/route.ts`) clones `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`, `cutlist_surcharge_kind`, `cutlist_surcharge_value`, `cutlist_surcharge_label` from quote_item to order_detail; rebuilds `cutlist_material_snapshot` using the new builder. NULL primary on the source quote_item carries through to NULL on the order_detail (validation fires later at cutting plan generation).
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

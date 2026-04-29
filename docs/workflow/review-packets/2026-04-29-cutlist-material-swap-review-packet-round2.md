# GPT-5.5 Pro Round-2 Review Packet — Cutlist Material Swap & Surcharge

**Spec under review (v2):** [`docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md)
**Branch:** `codex/local-cutlist-material-swap-spec` at `ac6b41c` (post-rework)
**Round 1 packet:** [`docs/workflow/review-packets/2026-04-29-cutlist-material-swap-review-packet.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/workflow/review-packets/2026-04-29-cutlist-material-swap-review-packet.md)

> Paste everything below this line into the same ChatGPT conversation that produced round 1 (or a fresh GPT-5.5 Pro session — the packet is self-contained either way).

---

## Round 1 → Round 2 — what changed

You returned **3 BLOCKERs / 8 MAJORs / 2 MINORs** on round 1. All integrated. Summary of the rework, with section pointers so you can verify each fix landed:

### BLOCKERs (all resolved)

| # | Issue | Resolution | Verify in spec § |
|---|---|---|---|
| 1 | `quote_items.cutlist_snapshot` collision with existing `QuoteItem.cutlist_snapshot` TS property mapped to `quote_item_cutlists(*)` | New column is `cutlist_material_snapshot` on quote_items AND order_details (the order-side column of the same name is also renamed for symmetry; rename is safe because zero SQL/RPC readers exist). | §Data Model 1, §Data Model 2 (order_details rename migration), §Naming caution callout |
| 2 | No persistence target for `backer_default`; cutting-plan generation breaks for `-backer` orders if `material_assignments` writes are dropped | Added `cutlist_primary_backer_material_id` per line + composite FKs + snapshot `effective_backer_id`/`effective_backer_name` per group + Phase F backfill rule | §Data Model 1 + 2, §5b Backer material model, §A1-BF1 step 5 |
| 3 | `surcharge_total` drifts when quantity or unit_price edited via generic PATCH route | Phase A2 introduced. BEFORE INSERT/UPDATE trigger on `order_details` and `quote_items` recomputes both `cutlist_surcharge_resolved` and `surcharge_total` whenever quantity, unit_price, bom_snapshot, cutlist_surcharge_kind, or cutlist_surcharge_value changes. Backfill via `UPDATE … SET col = col` fires the trigger row-by-row. | §7 Surcharge resolution (DB-side trigger — Phase A2), §Phasing table (A2 row), §Phase A2 ACs |

### MAJORs (all resolved)

| # | Issue | Resolution | Verify in spec § |
|---|---|---|---|
| 4 | Snapshot consumer audit missed `export-cutlist` route + raw `cutlist` GET/PATCH route | Both added to audit table. Raw PATCH default action: delete; alternative: gate behind `?force=true` admin-only. Generic order-detail PATCH also added as A1-CT11 | §Snapshot Consumers table (last 3 rows), §A1-CT9, A1-CT10, A1-CT11 |
| 5 | Backfill didn't specify edging defaults / overrides | Six-step deterministic translation rule + edging-loss validation AC. Per-board dominant edging, thickness-aware pair lookup, sparse part overrides | §A1-BF1 (rewritten), §A1-BF1a |
| 6 | Combined `surcharge_total` ambiguous for child rendering — would double-count BOM child rows | Added `cutlist_surcharge_resolved NUMERIC(12,2)` column. Child-row rendering uses this; `surcharge_total` is reserved for the rolled-up total trigger consumes. Spec includes a worked example with both BOM and cutlist surcharges | §Order-line render (rewritten with worked example), §Data Model 1 (new column) |
| 7 | Phase D probe component-ID set ambiguous | Defined `affected_component_ids` as the diff of before/after snapshot's `effective_board_id`, `effective_edging_id`, `effective_backer_id` sets. Backer-only swaps explicitly probed | §Downstream-state Probe → Affected component ID set |
| 8 | Cutting-plan source revision excludes new canonical columns | `computeSourceRevision` extension AC (A1-CT12) hashes new line-level columns; one-cycle transition window keeps `material_assignments` term too | §Cutting-plan source revision hash extension, §A1-CT12 |
| 9 | Quote PDF surcharge distribution rule contradicts itself | Single deterministic rule: primary child carries full surcharge, secondary children are amount-less descriptive only. Cap at 2 secondary children, residual rolls into "+ other variations" | §Quote PDF generation (rewritten) |
| 10 | NULL primary contradicts "no NULL" architecture | NULL declared valid pre-cutting-plan. Cutting plan Generate validates and surfaces inline banner. Dialog renders as "Pick a cutlist material" with surcharge field neutralised. Quote→order conversion preserves NULL | §Three-layer model → NULL primary state lifecycle |
| 11 | Auto-pair learning didn't handle intra-line conflicts | New step 3 in the auto-pair flow: if a single line uses one (board, thickness) with multiple edgings, don't auto-learn for that group at all. Line's per-part overrides save as truth | §UI Auto-pair confirmation flow (rewritten step 1-5) |

### MINORs (all resolved)

| # | Issue | Resolution | Verify in spec § |
|---|---|---|---|
| 12 | Composite-unique STOP wording overly restrictive | Reworded to STOP only on actual constraint-name collision, duplicate `(component_id, org_id)` data, or migration-lock concern | §Data Model 1 last paragraph |
| 13 | `board_edging_pairs.updated_at` declared but not maintained | Added BEFORE UPDATE trigger `board_edging_pairs_set_updated_at` | §Data Model 4 (board_edging_pairs DDL) |

---

## Your task in round 2

You are GPT-5.5 Pro, plan-quality reviewer, working in the same trial role as round 1. The spec has been substantially reworked. Re-review with these explicit foci:

### Round 2 priority foci

1. **Did the BLOCKER fixes actually fix the BLOCKERs, or did they introduce new BLOCKERs of their own?**
   - The column rename (`cutlist_snapshot` → `cutlist_material_snapshot`) on `order_details` is data-bearing. Confirm the rename is safe (verify no live RPC, view, or generated-column references).
   - The A2 trigger writes `cutlist_surcharge_resolved` AND `surcharge_total`. Does it interact correctly with the existing POL-71 `update_order_total()` trigger? Specifically: BEFORE-trigger on `order_details` modifies `NEW.surcharge_total`, then AFTER-trigger on `order_details` (POL-71's update_order_total) sums `quantity * unit_price + surcharge_total` into `orders.total_amount`. Is the ordering correct?
   - The trigger is `BEFORE INSERT OR UPDATE OF (specific columns)`. Does PostgreSQL fire it correctly when ONLY `bom_snapshot` or ONLY `cutlist_surcharge_kind` is in the SET clause? Confirm column-listed UPDATE OF semantics.

2. **Did MAJOR #6's split (`cutlist_surcharge_resolved` vs `surcharge_total`) introduce inconsistencies elsewhere?**
   - Spec must consistently use `cutlist_surcharge_resolved` for child-row rendering and `surcharge_total` for trigger input.
   - Is there a path where the dialog's live "= R 245.00 on this line" preview drifts from the trigger's eventual computation?

3. **MAJOR #5's edging backfill — is the validation AC strong enough?**
   - Step 3 of the rule says "pick the edging matching the primary board's most-common thickness." Is this deterministic when a line has multiple thicknesses with different boards?
   - The "edging-loss validation" (A1-BF1a) covers no-loss for orders with cutting plans; what about pre-cutting-plan orders that should still survive backfill?

4. **The order_details column rename in the same migration as new column adds — is this safe under concurrent writes?**
   - The spec assumes the migration runs atomically. Are there transaction-boundary concerns with `RENAME COLUMN` + `ADD COLUMN` on a single ALTER?
   - Will any in-flight requests see the old column name temporarily?

5. **Phase A2 trigger row-write idempotence — is `UPDATE … SET col = col` truly safe?**
   - PostgreSQL optimises NO-OP updates only when no triggers are defined on the target column. The new trigger fires on this UPDATE. Does the trigger handle no-op updates without infinite recursion?
   - Are there any AFTER triggers on `order_details` (POL-71's order-totals) that would chain a write to `orders` and create cascading work?

6. **NULL primary state — does cutting plan validation really catch every path?**
   - Add-products endpoint, from-quote conversion, manual SQL inserts, MaterialAssignmentGrid edits — does the cutting-plan-side validation catch ALL of these, or does it only catch the ones that go through the dialog?
   - What about a `-backer` group where `cutlist_primary_backer_material_id` is NULL but `cutlist_primary_material_id` is set? Should that be valid?

### Round 2 things to skip

- Don't re-litigate things that already passed round 1 (the architecture, phasing structure, three-layer model).
- Don't propose alternate trigger architectures unless the current one is broken.
- Don't propose alternate column names unless `cutlist_material_snapshot` collides with something I haven't found.
- Don't re-flag the round 1 issues as still-present — they're resolved per the table above; if you disagree, flag the resolution as the BLOCKER.

### What you might find that's genuinely new in round 2

- The trigger introduces a new SECURITY DEFINER concern if any part of `compute_*` reads from a table other than the row itself. Both helper functions are pure (only operate on inputs), but verify.
- The order-details column rename touches `lib/orders/snapshot-types.ts` and dozens of consumer files. Has any test fixture got `cutlist_snapshot` hardcoded as a string literal that won't be caught by typed renames?
- The new `cutlist_surcharge_resolved` column needs to be added to TypeScript types and Supabase generated types. Any place that reads `surcharge_total` for child rendering must switch to `cutlist_surcharge_resolved`.
- The "intra-line auto-pair conflict" rule prevents pair upserts for lines with multiple edgings on the same `(board, thickness)`. But the line still saves the per-part overrides — does a SECOND line later with the same board+thickness then learn from the user's NEXT explicit choice? Edge case worth checking.

### Reply format

Same as round 1. Group by severity. Cite spec sections. Don't propose rewrites — describe the gap and fix shape.

---

## Self-contained context (in case you want fresh grounding)

### Schema state at time of v2

`order_details` after A1 migration applied (in order of migration steps):
- Pre-existing: `order_detail_id, order_id, product_id, quantity, unit_price, org_id, bom_snapshot, surcharge_total`
- Renamed: `cutlist_snapshot` → `cutlist_material_snapshot`
- New: `cutlist_primary_material_id, cutlist_primary_backer_material_id, cutlist_primary_edging_id, cutlist_part_overrides, cutlist_surcharge_kind, cutlist_surcharge_value, cutlist_surcharge_label, cutlist_surcharge_resolved`

`quote_items` after A1 migration applied:
- Pre-existing (POL-71 + earlier): `id, quote_id, description, qty, unit_price, total, ..., bom_snapshot, surcharge_total, product_id`
- New: `cutlist_material_snapshot, cutlist_primary_material_id, cutlist_primary_backer_material_id, cutlist_primary_edging_id, cutlist_part_overrides, cutlist_surcharge_kind, cutlist_surcharge_value, cutlist_surcharge_label, cutlist_surcharge_resolved`

`components`:
- Pre-existing: `component_id, internal_code, description, unit_id, category_id, image_url, org_id, is_active`
- New constraint: `UNIQUE (component_id, org_id)`
- New column: `surcharge_percentage NUMERIC(5,2) NULL`

`board_edging_pairs` (new):
- `pair_id, org_id, board_component_id, thickness_mm, edging_component_id, created_by, created_at, updated_at`
- 4 RLS policies, `updated_at` trigger, composite UNIQUE on `(org_id, board_component_id, thickness_mm)`

`bom_swap_exceptions` (POL-71 existing):
- Phase D widens CHECK constraint to include `cutlist_material_swapped_after_downstream_event`

### Trigger ordering

PostgreSQL fires triggers in alphabetical order by trigger name when multiple triggers of the same timing exist. POL-71 introduced:
- AFTER trigger on `order_details` named `order_details_total_update_trigger` that updates `orders.total_amount`

This spec adds:
- BEFORE trigger on `order_details` named `order_details_recompute_surcharge_total`

The BEFORE trigger fires first (correct), modifies `NEW.surcharge_total`, then PostgreSQL writes the row, then the AFTER trigger reads the new `surcharge_total` and updates `orders.total_amount`. No conflict.

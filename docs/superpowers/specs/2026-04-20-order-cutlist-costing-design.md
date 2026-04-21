# Order Cutlist Costing Design

**Date**: 2026-04-20
**Status**: Draft
**Scope**: How per-product cutlist cost snapshots propagate to orders, when material cost switches from padded to nested-real, and how `material_assignments` + `cutting_plan` + `product_cutlist_costing_snapshots` wire together into a single order-level cost surface.

## Problem

Three pieces of the "cutlist → money" pipeline already exist but are not connected:

1. **`product_cutlist_costing_snapshots`** — per-product *padded* cost (whole sheets + edging padding) drives the price list and the product costing tab. Shipped on `codex/local-cutlist-to-costing`.
2. **`orders.material_assignments`** — per-order-line / per-part-role material substitution via a 5-tuple role fingerprint (`order_detail_id|board_type|part_name|length_mm|width_mm`). Shipped on `codex/local-material-assignment`.
3. **`orders.cutting_plan`** — cross-product nested layout result, written once the order is ready to cut. Designed in `2026-04-01-order-cutting-plan-design.md`; data layer landed, UI surface partial.

On the order page today, line material cost still reads from `order_details.bom_snapshot` (legacy naive BOM). This:

- Ignores whole-sheet rounding from the product snapshot (understates cost on small orders).
- Ignores cross-product nesting savings (overstates cost once we could nest).
- Gives the purchasing flow no way to trigger a recalc when an operator substitutes a colour per line.

The user's mental model is simple and firm — this spec just ratifies it:

> Padded cost is what we pay the supplier for a single product. Real nested cost is what we pay when the whole order is planned together. The price list uses padded. The order uses padded until the operator runs the cutting plan — then it uses real.

## Goals

1. One clear rule for **which number drives which surface** across the product → quote → order → purchasing pipeline.
2. Order-line material cost shows the right figure (padded default, nested-real once plan exists) without requiring the operator to think about it.
3. The cutting plan respects `material_assignments` so a 5-white-and-5-black split produces two material groups, not one.
4. Editing an order line *after* a cutting plan exists marks the plan **stale**; the operator re-runs Generate — no auto-recalc churn.
5. Job cards, cutting lists, and purchase orders read from the cutting plan once it exists (not from per-product snapshots).

## Out of Scope

- **Quote-level "real costing" override** for competitive bids — deferred, captured separately.
- **Propagating product cutlist changes into existing orders**. `order_details.cutlist_snapshot` is frozen at line-add time by design — editing a product's cutlist does **not** retroactively change open orders. A separate "Refresh order lines from current product" operator action is deferred (see §7).
- Re-designing the Cutting Plan tab UI — we reuse what `2026-04-01-order-cutting-plan-design.md` already specs.
- Configurator → cutlist material flow (two-tone persistence) — separate workstream.
- Actual cost tracking during production (variance reporting) — separate workstream.

---

## Design

### 1. The lifecycle of a number

The single rule this spec anchors on:

| Phase | Cost basis per line | Source |
|---|---|---|
| Product costing tab | **Padded** board + padded edging × markup | `product_cutlist_costing_snapshots` |
| Price list | Padded | Product costing output |
| Quote (default) | Price-list / padded per line | Product snapshot × qty |
| Quote (competitive override) | Real un-padded cost | **Deferred** (see §7) |
| Order — composing, **no plan yet** | Padded per line | Product snapshot × qty (same as quote) |
| Order — **cutting plan generated** | **Nested real** per line | `orders.cutting_plan` allocated to each line |
| Order — edited after plan | Plan flagged **stale**; line falls back to padded until operator re-Generates | Padded with stale banner |

No "commit order" button exists — orders live-edit. The switch from padded → nested-real is driven by the explicit **Generate cutting plan** button on the Cutting Plan tab, which already exists per the prior spec.

### 2. How the three existing pieces connect

```
Product (per product)                   Order (per order)
─────────────────────                   ───────────────────
product_cutlist_costing_snapshots       orders.material_assignments
  - padded_sheets_per_unit                - role_fingerprint → component_id
  - padded_edging_per_unit                - per-line colour/material substitution
  - concrete material_ids                 - feeds cutting plan's material_groups
  - parts_hash                            
         │                                       │
         │                                       │
         ▼                                       ▼
   line.padded_cost   ── replaced once ──▶  orders.cutting_plan
   = snapshot × qty       plan exists         - material_groups (respects assignments)
                                              - nested sheets & offcuts
                                              - component_overrides[] (cutlist + non-cutlist)
                                              - source_revision hash (stale detection)
                                                     │
                                                     ▼
                                              line.nested_real_cost
                                              = allocated share of cutting_plan
```

### 3. Order-line cost computation

We introduce one helper (server-side) that every order-line cost surface routes through:

```typescript
// lib/orders/line-material-cost.ts
type LineMaterialCost = {
  amount: number;                         // rand amount to display on the line
  basis: 'padded' | 'nested_real';        // which branch ran
  source_snapshot_id?: number;            // FK to product_cutlist_costing_snapshots
  source_cutting_plan_revision?: string;  // matches orders.cutting_plan.source_revision
  stale: boolean;                         // true if basis=padded but a stale plan exists
};

async function getLineMaterialCost(orderDetailId: number): Promise<LineMaterialCost>;
```

**Branch logic:**

1. If `orders.cutting_plan` exists and is **not stale** → allocate the plan's total cost to this line (see §4 allocation rule). `basis = 'nested_real'`.
2. If `orders.cutting_plan` exists and **is stale** → `basis = 'padded'`, `stale = true`, surface the banner.
3. If no plan → `basis = 'padded'`, `stale = false`. Use `product_cutlist_costing_snapshots × qty`.

This helper replaces the current `effective-bom` reading from `order_details.bom_snapshot` for **cutlist products only**. Non-cutlist BOM items continue to use `bom_snapshot` (they're filtered by `is_cutlist_item`, already in place).

**Server-authoritative `total_nested_cost`.** The client may compute its own nested-cost preview for UI, but the value persisted on `orders.cutting_plan` is recomputed server-side in the PUT handler from authoritative component prices (fetched by the server, not trusted from the request body). This prevents client bugs, stale component-price caches, or bad data from producing a corrupt allocation.

### 4. Allocating nested-real cost back to lines

The cutting plan produces one total cost for the whole order (boards × price + edging × price per meter). We need to split it across lines so line-level margin still makes sense.

**Allocation rule — area-proportion, weighted by each line's cutlist part area:**

For each line, its share of the nested cost =

```
line_share = (line_cutlist_area_mm2 / sum_of_all_lines_cutlist_area_mm2) × total_nested_cost
```

where `line_cutlist_area_mm2` = the sum of `length_mm × width_mm × quantity` for every cutlist part on that line (after assignment resolution, though area itself is assignment-independent).

**Why area-weighted (not padded-cost-weighted):**

- **Substitution-safe**: 10 white cupboards + 10 cherry cupboards (same model, different board cost) get identical padded costs from the per-product snapshot — padded-weighted would allocate nested cost 50/50 even though cherry lines carry 2× more material cost. Area reflects physical consumption faithfully regardless of substituted materials.
- **Defensible and explainable**: "your line consumed N m² of the nested layout, your share is N / total" — operators and customers can follow the maths.
- **Well-defined edge cases**:
  - Non-cutlist-only lines have `line_cutlist_area_mm2 = 0` and are therefore **excluded from nested allocation entirely** — they receive zero nested share and their non-cutlist BOM cost adds on top unchanged.
  - If no lines have any cutlist parts (shouldn't happen if a plan exists at all, but defensive), allocation is empty and every line stays padded.

Rejected alternative: padded-cost-proportion with material-aware pricing. Accurate but requires re-pricing every line's sheets using `material_assignments` to resolve per-sheet `material_id` — adds complexity without better behaviour on the common case. Captured as deferred enhancement (§7).

We persist the allocation on `orders.cutting_plan` so it's deterministic and doesn't re-compute on every page load:

```jsonc
// orders.cutting_plan.line_allocations (new field)
[
  { "order_detail_id": 1234, "area_mm2": 8_450_000, "line_share_amount": 412.75, "allocation_pct": 32.4 },
  { "order_detail_id": 1235, "area_mm2": 17_620_000, "line_share_amount": 861.09, "allocation_pct": 67.6 }
]
```

### 5. Material assignments feed the cutting plan

`orders.material_assignments` already keys on the 5-tuple role fingerprint (including `order_detail_id`), so a 5-white + 5-black split of the same product produces two distinct entries. The cutting plan's input aggregator must:

1. Read every line's expanded parts.
2. For each part role, look up the per-role assignment; if none, fall back to the line's default **primary** material.
3. Resolve **backer** via `MaterialAssignments.backer_default` (order-level setting) when present; otherwise fall back to the line's default backer.
4. Group by the resolved `(primary_component_id, backer_component_id)` tuple (not the role's nominal `board_type`) when forming `material_groups`.

Once the plan runs, the `material_groups` therefore naturally reflect the operator's per-line primary colour choices AND the order-level backer choice — no extra step on the Generate button.

### 6. Stale-plan handling

**Trigger events** that mark `orders.cutting_plan.stale = true`:

- Any `order_details` insert/update/delete on the order (qty change, new line, removed line). *Already wired via existing `order-details/*` routes calling `markCuttingPlanStale`.*
- Any `orders.material_assignments` write. *Already wired in the PATCH handler.*
- Any referenced component's price changes — **deferred** (default off to avoid banner fatigue).

**Explicitly NOT a stale trigger**: a product's cutlist snapshot changing. `order_details.cutlist_snapshot` is frozen at line-add time, so product edits don't affect a live order. If operators later want to pull a product's current cutlist into an open order, that's an explicit "refresh order lines from current product" action (deferred, §7).

**Revision hash must cover both details and assignments.** `computeSourceRevision` currently hashes only order_details (id, quantity, cutlist_snapshot). To close the race where Tab A saves a stale plan over Tab B's assignment change, the revision must also incorporate the current `orders.material_assignments` JSONB. The PUT handler's `REVISION_MISMATCH` 409 then fires on any assignment drift, not just detail drift.

**While stale:**

- Order-line cost falls back to padded with `stale = true`.
- A banner on the Cutting Plan tab: *"Order has changed since the last plan was generated. Regenerate to refresh nested costs."*
- Purchase orders and job cards generated from the cutting plan show a "plan is stale" warning, but remain usable (operator can proceed if they don't want to recut). This surface is added to the existing PO / order components dialog flow.

### 7. Deferred enhancements

1. **Competitive-quote real-costing override**: on a quote line, allow an explicit toggle to use nested-real cost (requires a speculative cutting plan at quote time). Only for large, price-sensitive jobs. Captured separately.
2. **Auto-stale on component price changes**: default off. Add a per-org setting later.
3. **Multi-plan versioning**: today we overwrite `orders.cutting_plan` on regenerate. If operators need to compare plans ("what if I add an 11th cupboard?"), introduce a plan history table. Not needed yet.
4. **Refresh order lines from current product snapshot**: an explicit operator action to pull a product's current cutlist into an existing order's `order_details.cutlist_snapshot` (marking the plan stale). Needed if product cutlist changes are common on open orders. Until then, product edits don't retro-change live orders — if a mid-flight design change is required, the operator removes and re-adds the line.
5. **Material-aware padded allocation weighting**: allocate by `line_padded_cost_with_resolved_materials` instead of area, for more price-accurate distribution of savings. Adds complexity (per-sheet material_id resolution through the assignment index); not worth it until operators report that area-weighted allocation feels wrong.

---

## Migration / Rollout

1. Merge `codex/local-cutlist-to-costing` and `codex/local-material-assignment` into `codex/integration` (already done on `codex/local-order-cutlist-costing`).
2. Add `line_allocations` field to `orders.cutting_plan` JSONB — no migration, just additive.
3. Build `lib/orders/line-material-cost.ts` and route the order detail API + order costing view through it.
4. Add stale-trigger handlers (DB triggers or service-layer writes — prefer service layer to keep it debuggable).
5. Ship behind no feature flag — per-product snapshots already populated, per-line assignments already working, cutting plan data layer already there. This spec is mostly wiring.

## Open questions — resolved post-Codex review

- **Allocation rule** — resolved: area-weighted (§4). Padded-weighted fails on per-line material substitutions (same padded cost regardless of substituted board).
- **Assignment writes marking stale** — resolved: always stale on any assignment write, since the current handler does so and adding a "same component_id?" short-circuit adds complexity for marginal benefit. Operators rarely re-save identical assignments.
- **PO stale warning** — resolved: non-blocking warning + one-click "Regenerate plan first" affordance in the PO / OrderComponentsDialog flow.
- **Client-sent vs server-computed total_nested_cost** — resolved: server recomputes from authoritative pricing on PUT (§3).
- **Product snapshot → order stale** — resolved: removed. Orders are frozen at line-add time; propagation is an explicit, deferred operator action (§7 item 4).

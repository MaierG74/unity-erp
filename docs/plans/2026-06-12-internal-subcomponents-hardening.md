# Internal Subcomponents Hardening — sales guard, overhead rollup, snapshot refresh, flag removal, work-pool awareness

## Purpose / Big Picture


PR #154 shipped the Internal Subcomponents MVP: a product can be marked `internal_subcomponent`, attached to a sellable parent via `product_bom_links` (with a per-parent quantity called `scale`), and its BOM, labour and cutlist then flow into the parent's costing and into frozen quote/order snapshots. This plan closes the five gaps that keep the feature from being production-complete. After this lands: (1) no API client can put an internal subcomponent on a quote or order, even with a hand-crafted POST; (2) a subcomponent's overhead costs roll up into the parent's unit cost and into new quote costing, scaled, exactly like materials and labour already do; (3) an operator can press "Refresh from product" on an existing quote line or order line to pull the latest product definition into that line's frozen snapshots, with an audit stamp, without touching the selling price; (4) the former attach-BOM feature flag is gone — the Add Subcomponent UI is simply on, so no production env step can be forgotten; (5) the manufacturing Work Pool sees subcomponent labour — an order for a pedestal containing 3 drawer boxes produces drawer-assembly jobs at the right quantities, and the stale-pool detector agrees with the generator so no false "out of date" banners appear.

## Progress


- [x] Branch `codex/local-subcomponents-hardening` created off `codex/local-internal-subcomponents`, clean baseline verified — Done 2026-06-12T11:55:41Z (`npx tsx --test tests/cutlist-linked-groups.test.ts` pass 10/fail 0; `/tmp/tsc-baseline.txt` captured 39 pre-existing TypeScript erroring files)
- [x] W1: `assertProductsSellable` helper created with unit tests — Done 2026-06-12T11:57:18Z (`npx tsx --test tests/sales-guard.test.ts` pass 5/fail 0)
- [x] W1: quote add-product route rejects internal subcomponents with 422 `product_not_sellable` — Done 2026-06-12T11:57:18Z
- [x] W1: order add-products route rejects internal subcomponents with 422 `product_not_sellable` — Done 2026-06-12T11:57:18Z
- [x] W2: all former attach-BOM feature gates removed; attach UI and effective costing always on — Done 2026-06-12T12:00:28Z (`rg -n "NEXT_PUBLIC_FEATURE_ATTACH_BOM|FEATURE_ATTACH_BOM|featureAttach" --hidden -g '!node_modules'` returned no matches)
- [x] W3: `computeEffectiveOverheadLines` pure helper with unit tests — Done 2026-06-12T12:13:01Z
- [x] W3: `GET /api/products/[productId]/effective-overhead` route returning direct + linked scaled overhead — Done 2026-06-12T12:13:01Z
- [x] W3: product costing UI shows linked overhead rows (read-only, provenance) and includes them in unit cost — Done 2026-06-12T12:13:01Z
- [x] W3: quote costing cluster captures linked overhead lines at add time — Done 2026-06-12T12:13:01Z
- [ ] W4: migration adding `snapshot_refreshed_at` / `snapshot_refreshed_by` to `quote_items` and `order_details` (file written, NOT applied to live)
- [ ] W4: quote line refresh endpoint rebuilds snapshots + costing cluster, stamps audit fields
- [ ] W4: order line refresh endpoint rebuilds snapshots, stamps audit fields
- [ ] W4: refresh actions in quote items table and order detail UI with confirm dialog
- [ ] W5: shared `fetchOrderEffectiveBol` helper (direct + linked child BOL, scaled) with unit tests
- [ ] W5: work-pool generation paths use the shared helper (child jobs appear in pool)
- [ ] W5: `computeStalePoolOrders` uses the same helper (parity test passes)
- [ ] Full verification: lint, tsc note, all touched test files green, transcripts attached
- [ ] Branch pushed, PR opened (base: `codex/local-internal-subcomponents`)

## Surprises & Discoveries


(append as you work)

## Decision Log


- 2026-06-12T11:57:18Z — Left quote-copy and quote-to-order conversion routes unguarded. They reproduce already-existing line items; blocking those paths after a product is later reclassified would strand historical quotes/orders. Only new arbitrary direct product-add routes reject internal subcomponents.
- 2026-06-12T12:13:01Z — Child percentage overhead resolves against the child's own direct BOM material cost plus direct BOL labour cost, then multiplies by parent link scale. It does not use the parent product basis.
- 2026-06-12T12:13:01Z — Effective overhead v1 excludes child cutlist-padding cost from the child percentage basis. The route returns `meta.child_basis_note` documenting this approximation.
- 2026-06-12T12:13:01Z — The legacy client-side quote explosion paths now call `/effective-overhead` too, so overhead inclusion does not depend on whether the product was added through the newer server route or the older quote-table/product-cluster flows.

## Outcomes & Retrospective


(fill at completion)

## Context and Orientation


EXECUTION IS LOCAL DESKTOP ONLY. Work in the existing worktree at `/Users/gregorymaier/developer/unity-erp-subcomponents` (a sibling git worktree of the Unity ERP repo, currently on branch `codex/local-internal-subcomponents`, the unmerged PR #154 branch). Do not use Codex Cloud — it branches off `main`, which does not contain the subcomponents feature. Dependencies are already installed in this worktree (`node_modules` is a real directory; do not symlink). Tests run with `npx tsx --test <file>` (runner is `node:test` + `assert/strict`; there is no `npm test` script).

Unity ERP is a Next.js App Router app backed by Supabase (Postgres + RLS, multi-tenant via `org_id`). The system terms you need:

- **Internal subcomponent**: a row in `products` with `product_kind = 'internal_subcomponent'` (the other value is `'sellable'`). Hidden from sales UI pickers; intended to live only inside other products.
- **Link**: a row in `product_bom_links` — columns `product_id` (the parent), `sub_product_id` (the child), `scale` (numeric quantity-per-parent), `mode` (only `'phantom'` exists today; future `'stocked'` must NOT roll up), `org_id`, `created_at`. The feature is deliberately one level deep: children cannot have their own links (enforced in the attach route; do not add DB-level enforcement in this plan).
- **BOM**: `billofmaterials` (bom_id, product_id, component_id, quantity_required, supplier_component_id, …; no org_id column — org scoping is via the product). **BOL**: `billoflabour` (bol_id, product_id, job_id, quantity, time_required, time_unit, pay_type, piece_rate_id, hourly_rate_id, org_id).
- **Overhead**: two tables from `db/migrations/20260113_overhead_cost_elements.sql`. `overhead_cost_elements` defines org-wide elements: `element_id`, `code`, `name`, `cost_type` (`'fixed'` or `'percentage'`), `default_value`, `percentage_basis` (`'materials'` | `'labor'` | `'total'`, only for percentage type), `is_active`. `product_overhead_costs` joins them to products: `id`, `product_id`, `element_id`, `quantity` (multiplier), `override_value` (nullable; overrides the element's `default_value`). Served by `app/api/products/[productId]/overhead/route.ts`.
- **Effective BOM / effective BOL**: API routes `app/api/products/[productId]/effective-bom/route.ts` and `.../effective-bol/route.ts` return the product's direct rows PLUS each linked child's rows with quantities multiplied by `link.scale`, tagged `_source: 'direct' | 'link'`, `_sub_product_id`, `_editable: false` for linked rows. `components/features/products/product-costing.tsx` consumes these (query keys `['effective-bom', productId]`, `['effective-bol', productId]`) and computes `unitCost = totalMaterialsCost + labourCost + overheadCost`. Overhead today comes only from `['product-overhead', productId]` → the product's own rows — that is the rollup gap.
- **Former attach-BOM feature flag**: before this hardening branch, a client env flag gated the Add Subcomponent button and the effective-BOM/BOL code path. The API routes themselves were not flag-gated.
- **Snapshots**: when a product is added to a quote (`app/api/quotes/[id]/items/product/route.ts`), the route builds `bom_snapshot` (via `lib/orders/build-bom-snapshot.ts`, re-exported from `lib/quotes/build-bom-snapshot.ts`) and `cutlist_material_snapshot` (via `lib/orders/build-cutlist-snapshot.ts`, which already explodes linked child cutlist groups ×scale), inserts a `quote_items` row, then calls `ensureQuoteItemCostingCluster` (`lib/quotes/build-costing-cluster.ts`) which persists costing lines into `quote_item_clusters` / `quote_cluster_lines` (line_type `'component' | 'labor' | 'overhead' | 'manual'`, with `overhead_element_id`, `overhead_cost_type`, `overhead_percentage_basis`, `unit_cost`). Quote report costing (`lib/quotes/report-data.ts`) reads those cluster lines, not live product data. Orders: `order_details` carries the same two snapshot columns (plus cutlist intent columns `cutlist_primary_material_id`, `cutlist_primary_backer_material_id`, `cutlist_primary_edging_id`, `cutlist_part_overrides`); `app/api/orders/[orderId]/add-products/route.ts` builds snapshots when adding products directly, and `app/api/orders/from-quote/route.ts` copies/rebuilds them on quote→order conversion. `app/api/order-details/[detailId]/route.ts` PATCH already rebuilds the cutlist snapshot when cutlist intent changes (~line 579-594).
- **Work Pool**: `job_work_pool` (migration `supabase/migrations/20260305195332_create_job_work_pool.sql`) holds demand rows per order line per job: `pool_id, org_id, order_id, order_detail_id, product_id, job_id, bol_id, source ('bol'|'manual'|'cutting_plan'), required_qty, pay_type, piece_rate, piece_rate_id, hourly_rate_id, time_per_unit, status`, unique on `(order_detail_id, bol_id)`. BOL-source pool rows are generated CLIENT-SIDE in `components/features/orders/JobCardsTab.tsx`: `fetchOrderBOLPreview(orderId)` (~line 235) traverses `order_details → products → billoflabour` (direct BOL only — this is the gap) and the generate mutation (~line 1433-1495) inserts/updates pool rows with `required_qty = detail.quantity × bol.quantity`. A second call site at ~line 529 uses the same fetch. Separately, `computeStalePoolOrders` in `lib/queries/laborPlanning.ts` (~lines 763-800) recomputes live demand from the same direct-BOL traversal and flags orders where pool `required_qty` no longer matches — if the generator becomes link-aware and the comparator does not, every subcomponent order would be flagged stale forever (or vice versa). Job cards are issued from pool rows by the SQL RPC `issue_job_card_from_pool`; nothing downstream of the pool needs changing.
- **Auth in API routes**: routes resolve `auth.orgId` (see any route above) and use `supabaseAdmin` for privileged reads/writes scoped by `eq('org_id', auth.orgId)`. Error convention: 400 validation `{ error }`, 404 not found `{ error }`, 422 business rule `{ error, code }` (precedent: `code: 'product_has_no_bom'` in the quote add-product route), 500 `{ error }`.

Current verification baseline: `npm run lint` exits 0 with a known warning set; `npx tsc --noEmit` FAILS on broad pre-existing repo errors unrelated to this work — do not try to fix the repo-wide errors; instead confirm no NEW errors appear in files you touch (compare error file lists before/after). The subcomponents test suite `npx tsx --test tests/cutlist-linked-groups.test.ts` passes 10/10 on the baseline.

## Plan of Work


Work proceeds in five independent workstreams, each commit-sized. Branch off the PR #154 branch so the feature code is present; the PR for this plan stacks on it.

**W1 — Server-side sales guard.** Create `lib/products/sales-guard.ts` exporting `assertProductsSellable` (contract in Interfaces). It takes a Supabase client, org id, and product ids; queries `products` for `product_id, product_kind` scoped to the org; returns the subset of ids whose `product_kind = 'internal_subcomponent'`. In `app/api/quotes/[id]/items/product/route.ts`, after the existing product-exists check (which already selects from `products` — extend that select with `product_kind` rather than re-querying if convenient), reject internal subcomponents with 422 `{ error, code: 'product_not_sellable', product_ids }` before any snapshot building. In `app/api/orders/[orderId]/add-products/route.ts`, collect all incoming `product_id`s, call the guard once, and reject the WHOLE request with the same 422 shape if any id is internal (atomic — no partial inserts). Deliberately DO NOT guard the copy/convert routes (`app/api/quotes/[id]/copy/route.ts`, `app/api/orders/from-quote/route.ts`): they reproduce lines that already legitimately exist, and guarding them would strand historical quotes if a product is later reclassified. Record this in the Decision Log. Add `tests/sales-guard.test.ts` exercising the helper with a stubbed client (sellable passes, internal rejected, mixed list returns only offenders, missing product ignored by the guard — the routes' own 404 handles that).

**W2 — Feature flag removal.** Search for the former attach-BOM env flag across the worktree. Remove every gate so the gated path is unconditionally on: remove the local flag constants in `components/features/products/product-costing.tsx` and `components/features/products/product-bom.tsx` and all their conditionals (keep the effective-BOM/BOL branches, delete the fallback-only branches where the flag chose between them — preserve the fallback queries themselves if they serve products with no links cheaply; simplest correct outcome: the code always uses the effective endpoints). Remove the variable from any `.env.example` / docs references in this worktree. Do NOT edit `.env.local` (developer-owned).

**W3 — Overhead rollup.** Three layers, mirroring how materials/labour already roll up. First, a pure helper `lib/products/effective-overhead.ts` exporting `computeEffectiveOverheadLines` (contract in Interfaces) that merges direct overhead rows with each linked child's overhead rows scaled by `link.scale`. Percentage-type child overheads resolve against the CHILD's own cost basis (the child's direct BOM materials cost and direct BOL labour cost), producing a `resolved_unit_amount` — then scale. Fixed-type child overheads are `value × quantity × scale`. (Rationale: a child's "5% of materials" overhead means 5% of the drawer box's materials, not of the pedestal's; record in Decision Log. Known approximation: the child basis excludes cutlist-padding material cost that the full product-costing UI includes for the child itself — acceptable for v1, note it in the route response meta and Decision Log.) Second, a route `app/api/products/[productId]/effective-overhead/route.ts` modeled line-for-line on `effective-bol/route.ts`: resolve org, verify product, load direct `product_overhead_costs` + joined elements, load `product_bom_links` (filter `mode = 'phantom'`), load children's overhead rows and the child basis ingredients (child `billofmaterials` joined to `suppliercomponents` price like effective-bom does; child `billoflabour` with rate resolution copied from effective-bol's helpers), call the pure helper, return `{ items }`. Third, consumers: in `product-costing.tsx` add query `['effective-overhead', productId]` and render linked rows in the Overhead section read-only with the same provenance treatment the BOM tab uses (child name badge, no edit/delete actions), summing into `overheadCost`. In `lib/quotes/build-costing-cluster.ts` find where overhead cluster lines are built from the product's own overhead rows and switch that source to the effective set, so new quote lines capture child overhead with `unit_cost = resolved_unit_amount` and a description suffix naming the child (e.g. "Packaging — from Drawer Box 450mm ×3"); `lib/quotes/report-data.ts` then needs no change (verify with its existing test). Add `tests/effective-overhead.test.ts` covering: fixed ×scale; percentage-of-materials resolved on child basis then scaled; percentage with `override_value`; two children; `mode='stocked'` link excluded; child with no overhead contributes nothing.

**W4 — Refresh from latest.** One additive migration file `supabase/migrations/<UTC-timestamp>_snapshot_refresh_audit.sql` (write the file; do NOT apply it to the live database — the reviewer applies it via the Supabase MCP): add nullable `snapshot_refreshed_at timestamptz` and `snapshot_refreshed_by uuid` to `quote_items` and `order_details`. New route `app/api/quotes/[id]/items/[itemId]/refresh-snapshot/route.ts` (POST): resolve org + quote item; 404 if the item has no `product_id` (manual lines can't refresh); rebuild `bom_snapshot` with `buildBomSnapshot` and `cutlist_material_snapshot` with the quote cutlist builder, passing through the item's stored `cutlist_part_overrides` and any stored cutlist intent exactly as the original add-product route does; update the row; re-run `ensureQuoteItemCostingCluster` so cluster cost lines reflect the new definition; stamp `snapshot_refreshed_at = now()`, `snapshot_refreshed_by = auth user id`. NEVER modify `qty`, `unit_price`, `description`, or `bullet_points` — refresh changes cost truth, not the commercial promise; the operator reprices manually if needed (Decision Log). Respond `{ item, summary }` where summary counts entries before/after (`{ bom_entries, cutlist_groups, cutlist_pieces }`). New route `app/api/order-details/[detailId]/refresh-snapshot/route.ts` (POST): same shape for an order line, reusing the cutlist rebuild logic already present in the detail PATCH route (~line 579-594) and `buildBomSnapshot` for the BOM side, passing the stored `cutlist_primary_material_id` / backer / edging / `cutlist_part_overrides` columns as the rebuild intent. UI: in `components/features/quotes/QuoteItemsTable.tsx`, add a "Refresh from product…" item to the existing per-row dropdown menu, gated to rows with a `product_id`, opening a confirm `AlertDialog` whose body states exactly: materials, cutlist and cost lines will be rebuilt from the CURRENT product definition; the selling price will not change. On success, toast and invalidate the quote queries. Same action in the order line UI (`components/features/purchasing/order-detail.tsx` or wherever the per-line action menu lives — follow the existing menu component). Where a row has `snapshot_refreshed_at`, show a muted "Refreshed <date>" hint near the line (match house muted-text style). No staleness auto-detection in this plan (deferred deliberately — Decision Log).

**W5 — Work-pool subcomponent awareness.** Extract a shared helper `lib/labor/order-effective-bol.ts` exporting `expandOrderDetailBol` (contract in Interfaces): given an order detail (with `quantity` and product id), the product's direct BOL rows, the product's phantom links, and each child's BOL rows, emit flattened demand items where direct rows yield `required_qty = detail.quantity × bol.quantity` (today's behaviour) and child rows yield `required_qty = detail.quantity × bol.quantity × link.scale`, carrying the CHILD's `product_id` and `bol_id` (so job cards display the child product name, and the `(order_detail_id, bol_id)` uniqueness still holds because child bol_ids are distinct rows in `billoflabour`). Refactor `fetchOrderBOLPreview` in `components/features/orders/JobCardsTab.tsx` to fetch links + child BOL (two extra `.in()` queries — same two-step pattern `lib/cutlist/linkedCutlistGroups.ts` uses to avoid PostgREST FK-embed ambiguity) and run everything through the helper; both call sites (~line 529 and the dialog at ~line 1429) get this for free since they share the fetch. Update `computeStalePoolOrders` in `lib/queries/laborPlanning.ts` to compute its live-demand map through the SAME helper (extend its existing order query to bring links + child BOL, or fetch them alongside) so generator and comparator can never disagree. Add `tests/order-effective-bol.test.ts`: direct-only product unchanged; parent qty 2 × child bol qty 1 × scale 3 → 6; two children; stocked links excluded; and a parity case asserting the stale comparator's expected map equals the generator's output for the same fixture.

Finally: run all verification, push, and open a PR with `gh pr create --base codex/local-internal-subcomponents`.

## Concrete Steps


1. Baseline. In `/Users/gregorymaier/developer/unity-erp-subcomponents`: `git status --short` must be clean (a stray `docs/operations/internal-subcomponents-mvp-explainer.html` untracked file may exist; leave it). `git fetch origin && git checkout codex/local-internal-subcomponents && git pull --ff-only`. Then `git checkout -b codex/local-subcomponents-hardening`. Run `npx tsx --test tests/cutlist-linked-groups.test.ts` — expect `# pass 10`. Capture the CURRENT `npx tsc --noEmit 2>&1 | rg "error TS" | rg -o "^[^(]+" | sort -u > /tmp/tsc-baseline.txt` file list for later comparison.

2. W1 then W2 then W3 then W4 then W5, committing per workstream with messages `subcomponents: server-side sales guard`, `subcomponents: remove attach feature flag`, `subcomponents: overhead rollup (effective-overhead)`, `subcomponents: refresh line snapshots from product`, `subcomponents: work pool sees linked child labour`.

3. Per-workstream test runs (expected: every listed file ends `# fail 0`):
   - `npx tsx --test tests/sales-guard.test.ts`
   - `npx tsx --test tests/effective-overhead.test.ts tests/quote-report-data.test.ts`
   - `npx tsx --test tests/order-effective-bol.test.ts`
   - `npx tsx --test tests/cutlist-linked-groups.test.ts` (regression — must stay 10/10)

4. Whole-branch verification: `npm run lint` (expect exit 0, same warning set as baseline). `npx tsc --noEmit 2>&1 | rg "error TS" | rg -o "^[^(]+" | sort -u > /tmp/tsc-after.txt && diff /tmp/tsc-baseline.txt /tmp/tsc-after.txt` (expect empty diff — no newly-erroring files).

5. Push and PR: `git push -u origin codex/local-subcomponents-hardening` then `gh pr create --base codex/local-internal-subcomponents --title "Internal subcomponents hardening: sales guard, overhead rollup, snapshot refresh, flag removal, work-pool awareness" --body-file <(summarise from this plan)`. Paste the PR URL into Artifacts and Notes.

6. Do NOT apply the W4 migration to the live database and do NOT run a dev server against live data beyond what tests require. The reviewer (Claude session) applies the migration via the Supabase MCP and runs the live browser smoke afterwards.

## Validation and Acceptance


Acceptance is observable behaviour, verified in two stages — Codex proves the API/unit layer with transcripts; the reviewer proves the browser layer after applying the migration.

Codex-provable (attach transcripts):

1. Sales guard: `tests/sales-guard.test.ts` shows a stubbed internal product id rejected and a sellable id passed. Additionally, a code-level transcript (route source excerpt in Artifacts) shows both routes return `NextResponse.json({ error, code: 'product_not_sellable', product_ids }, { status: 422 })` before any snapshot build or insert.
2. Overhead rollup math: `tests/effective-overhead.test.ts` proves a child with a fixed R10 overhead, quantity 1, attached ×3 yields a linked line with `resolved_unit_amount` totalling R30 on the parent; a percentage child overhead of 5% on materials with child materials cost R200 yields R10 × scale; stocked-mode links contribute nothing.
3. Refresh endpoints: route source + a unit test or transcript showing the update payload contains ONLY snapshot columns, cluster rebuild call, and the two audit stamps — never `unit_price`/`qty`.
4. Work pool: `tests/order-effective-bol.test.ts` proves detail qty 2 × child scale 3 × child bol qty 1 → `required_qty` 6 with the child's `product_id`/`bol_id`, and the generator/comparator parity case passes.
5. Regression: `tests/cutlist-linked-groups.test.ts` 10/10; `tests/quote-report-data.test.ts` green; lint exit 0; tsc newly-erroring-files diff empty.

Reviewer-verified after merge-to-branch (listed so Codex knows what NOT to claim): apply migration; on the live app create drawer box (internal, R10 fixed overhead) + pedestal, attach ×3 → parent Overhead tab shows read-only "from Drawer Box" row and unit cost includes R30; quote the pedestal → cluster has the overhead line; direct POST of the drawer box to the quote API returns 422; add a screw to the drawer box, press "Refresh from product…" on the existing quote line → snapshot gains the screw ×3, price unchanged, "Refreshed <date>" appears; order the pedestal, generate work pool → drawer jobs at ×3 quantities and no stale banner; with no attach-BOM env var set anywhere, the Add Subcomponent button still renders.

## Idempotence and Recovery


Every workstream is an isolated commit on a dedicated branch stacked on `codex/local-internal-subcomponents`; `git revert <sha>` of any one workstream leaves the others functional (W3's cluster change is independent of W1's guard, etc.). The W4 migration is additive (two nullable columns, no backfill, no RLS change) and is only a file on the branch — nothing touches the live database during execution. Re-running any test command is side-effect free. If the branch gets into a bad state: `git checkout codex/local-internal-subcomponents && git branch -D codex/local-subcomponents-hardening` and restart from step 1 — the worktree contains no other state. If `git pull --ff-only` fails in step 1, stop and report; do not merge or rebase the PR #154 branch yourself.

## Artifacts and Notes


- 2026-06-12T11:55:41Z baseline:
  - Branch: `codex/local-subcomponents-hardening` created from `codex/local-internal-subcomponents` after `git pull --ff-only`.
  - `npx tsx --test tests/cutlist-linked-groups.test.ts`: pass 10 / fail 0.
  - `npx tsc --noEmit 2>&1 | rg "error TS" | rg -o "^[^(]+" | sort -u > /tmp/tsc-baseline.txt`: 39 pre-existing erroring files captured.
- 2026-06-12T11:57:18Z W1:
  - `tests/sales-guard.test.ts`: pass 5 / fail 0.
  - Guarded `app/api/quotes/[id]/items/product/route.ts` and `app/api/orders/[orderId]/add-products/route.ts` with status 422 `{ error, code: 'product_not_sellable', product_ids }` before snapshot builds/inserts.
- 2026-06-12T12:00:28Z W2:
  - Removed attach-BOM env gating from `components/features/products/product-costing.tsx`, `components/features/products/product-bom.tsx`, and `hooks/useProductBomLinks.ts`.
  - Updated stale docs references in the component, timekeeping, stocked-subassembly, and hardening docs.
  - `rg -n "NEXT_PUBLIC_FEATURE_ATTACH_BOM|FEATURE_ATTACH_BOM|featureAttach" --hidden -g '!node_modules'`: no matches.
- 2026-06-12T12:13:01Z W3:
  - Added `lib/products/effective-overhead.ts`, `app/api/products/[productId]/effective-overhead/route.ts`, and `tests/effective-overhead.test.ts`.
  - Product costing UI now reads effective overhead, shows linked rows read-only with child provenance, and includes linked overhead in unit cost.
  - Quote costing cluster generation now captures effective overhead. The assistant cost summary and legacy quote-table product explosion paths also call `/effective-overhead`.
  - `npx tsx --test tests/effective-overhead.test.ts tests/quote-report-data.test.ts tests/sales-guard.test.ts`: pass 31 / fail 0.
  - `npx tsc --noEmit` file-list comparison against `/tmp/tsc-baseline.txt`: no newly erroring files.

## Interfaces and Dependencies


No new packages. Supabase JS client and Next.js App Router conventions as already used in the repo. Pinned contracts:

`lib/products/sales-guard.ts`:

    export type SalesGuardClient = Pick<SupabaseClient, 'from'>  // or accept SupabaseClient<any, any, any>
    export async function assertProductsSellable(
      client: SupabaseClient<any, any, any>,
      orgId: string,
      productIds: number[],
    ): Promise<{ ok: true } | { ok: false; offendingIds: number[] }>

Rejection body (both sales routes, status 422): `{ "error": "Internal subcomponents cannot be sold directly", "code": "product_not_sellable", "product_ids": number[] }`.

`lib/products/effective-overhead.ts`:

    export type EffectiveOverheadLine = {
      id: number | null                 // product_overhead_costs.id (null never expected; direct rows keep theirs, child rows keep the child's)
      element_id: number
      code: string
      name: string
      cost_type: 'fixed' | 'percentage'
      percentage_basis: 'materials' | 'labor' | 'total' | null
      quantity: number                  // the overhead row's own multiplier (NOT link scale)
      value: number                     // override_value ?? default_value
      resolved_unit_amount: number      // per ONE parent unit, link scale applied for child rows
      _source: 'direct' | 'link'
      _sub_product_id?: number
      _sub_product_name?: string
      _editable: boolean                // false for link rows
    }
    export function computeEffectiveOverheadLines(input: {
      direct: DirectOverheadRow[]
      links: Array<{ sub_product_id: number; sub_product_name: string; scale: number; mode: string }>
      childOverheadBySubId: Map<number, DirectOverheadRow[]>
      childBasisBySubId: Map<number, { materialsCost: number; labourCost: number }>
    }): EffectiveOverheadLine[]

Direct rows' `resolved_unit_amount` for percentage type is left for the CLIENT to compute against the parent basis exactly as `product-costing.tsx` does today (no behaviour change for direct rows); the route sets `resolved_unit_amount` only for `_source: 'link'` rows and for direct fixed rows (`value × quantity`). Route: `GET /api/products/[productId]/effective-overhead` → `{ items: EffectiveOverheadLine[], meta: { links_count: number, child_basis_note: 'child percentage basis = child direct BOM + BOL; excludes cutlist padding' } }`.

W4 migration (exact SQL, one file):

    alter table quote_items
      add column if not exists snapshot_refreshed_at timestamptz,
      add column if not exists snapshot_refreshed_by uuid;
    alter table order_details
      add column if not exists snapshot_refreshed_at timestamptz,
      add column if not exists snapshot_refreshed_by uuid;

Refresh endpoints: `POST /api/quotes/[id]/items/[itemId]/refresh-snapshot` and `POST /api/order-details/[detailId]/refresh-snapshot`, request body `{}`, success 200 `{ item: <updated row>, summary: { bom_entries: number, cutlist_groups: number, cutlist_pieces: number } }`; 404 `{ error }` when the line lacks a `product_id` or isn't in the caller's org; 422 `{ error, code: 'product_missing' }` if the referenced product no longer exists.

`lib/labor/order-effective-bol.ts`:

    export type OrderBolDemandItem = {
      order_detail_id: number
      product_id: number        // child product id for link rows, parent's for direct
      job_id: number
      bol_id: number
      quantity: number          // final required_qty (detail.qty × bol.qty × scale-or-1)
      pay_type: 'hourly' | 'piece'
      piece_rate: number | null
      piece_rate_id: number | null
      hourly_rate_id: number | null
      time_per_unit: number | null
      _source: 'direct' | 'link'
      _sub_product_name?: string
    }
    export function expandOrderDetailBol(input: {
      detail: { order_detail_id: number; quantity: number; product_id: number }
      directBol: BolRow[]
      links: Array<{ sub_product_id: number; sub_product_name: string; scale: number; mode: string }>
      childBolBySubId: Map<number, BolRow[]>
    }): OrderBolDemandItem[]

Only `mode === 'phantom'` links expand, everywhere (overhead, BOL, existing cutlist loader already does this). All new Supabase reads must be org-scoped (`eq('org_id', …)` where the table has org_id; via the product join where it does not), following the exact patterns in `effective-bol/route.ts` and `lib/cutlist/linkedCutlistGroups.ts`.

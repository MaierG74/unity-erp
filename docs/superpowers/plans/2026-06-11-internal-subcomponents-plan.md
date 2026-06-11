# Reusable Internal Subcomponents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementation branches off `origin/codex/integration` (e.g. `codex/local-internal-subcomponents`). Migration work MUST follow `codex-skills/migration-hygiene/SKILL.md`. **LOCAL DESKTOP ONLY — do not run this from Codex Cloud (Cloud branches off `main` and will diverge).**

**Goal:** Let Greg define manufactured subcomponents (drawer boxes, six-band frames) once as internal products, attach them to sellable parent products with a quantity, and have the parent's effective BOM, BOL, **and cutlist/order snapshots** include the child's content multiplied by quantity — while customers only ever see the parent product.

**Architecture:** Reuse the existing `product_bom_links` phantom-link plumbing (already org-scoped + RLS'd). Add a `product_kind` classification to `products` to hide internal subcomponents from sales-facing pickers. Close the one real gap: cutlist explosion — `productCutlistLoader` and `build-cutlist-snapshot` currently read only the parent's own `product_cutlist_groups`.

**Tech Stack:** Next.js App Router API routes, Supabase (Postgres + RLS), React Query, existing cutlist snapshot JSONB pipeline.

**Status:** Plan awaiting Greg approval. No implementation started.

---

## 1. Objective

A user creates "Normal Drawer Box" once (BOM screws/runners, BOL assembly labour, cutlist groups for sides/bottom). On "3-Drawer Pedestal" they click **Add Subcomponent → Normal Drawer Box × 3**. From then on:

- Pedestal's effective BOM shows drawer-box components ×3, grouped under "Normal Drawer Box ×3" (expandable).
- Pedestal's effective BOL shows drawer-box labour ×3, same grouping.
- Pedestal's cutlist (builder view, order snapshot, cutting plan, costing) includes drawer-box parts ×3 with provenance.
- Quotes and orders show only "3-Drawer Pedestal". Internal subcomponents never appear in sales pickers.
- Editing "Normal Drawer Box" updates all parent **templates** (future quotes/orders); existing quote/order snapshots are untouched. A where-used warning shows on the subcomponent.

## 2. Non-goals (explicitly deferred)

- **`stocked` link mode** (build-to-stock subassemblies, pull-from-stock, requirements resolver, split fulfilment) — that is the existing `docs/plans/stocked-subassembly-policy-spec-v1.md` / `stocked-subassembly-manufacturing-plan.md` workstream (Phases 2–5). This plan is the *phantom* path only. `product_kind` is designed to be orthogonal to (and compatible with) that later work.
- **Multi-level nesting** (subcomponent containing subcomponents). Explosion stays single-level; we add a guard so users can't silently create unsupported nesting (see §6.3).
- **"Refresh from latest subcomponents" on existing quotes/orders.** Snapshots stay frozen. The refresh button is a named follow-up (POL issue in §13), not MVP.
- **Subcomponent finished-goods stock tracking / MTS replenishment.**
- **Versioning/pinning of links** (`product_bom_links` has no version column; templates always follow latest — that is the desired MVP behaviour).
- **Collections changes.** Collections stay as-is for hardware packs; no migration of "Normal drawer box" collection data (manual re-creation as products is fine — confirm in §14).

## 3. Current-state verification (all verified 2026-06-11 against `origin/codex/integration` @ `9150e94` + live DB)

| # | Fact | Evidence |
|---|------|----------|
| 1 | `product_bom_links(product_id, sub_product_id, scale numeric default 1, mode text check (mode='phantom'), org_id uuid NOT NULL, created_at)` exists, PK `(product_id, sub_product_id)` | live `information_schema` + `db/migrations/20250910_create_product_bom_links.sql`, `supabase/migrations/20260226145912_stocked_subassembly_tenancy_expand.sql` |
| 2 | RLS enforced on `product_bom_links` (org-member select/insert/update/delete) + BEFORE trigger `set_product_bom_links_org_id` enforcing parent/child same-org and stamping `org_id` | `supabase/migrations/20260226145953_stocked_subassembly_tenancy_enforce_rls.sql` |
| 3 | `attach-product` route upserts a link (mode hardcoded `phantom`); `apply-product` copies child BOM+BOL rows scaled by qty | `app/api/products/[productId]/bom/apply-product/route.ts`, `.../attach-product/route.ts` |
| 4 | `effective-bom` / `effective-bol` explode links **one level**, scale by `link.scale`, tag rows `_source:'link'`, `_sub_product_id`; **no recursion, no cycle guard** | `app/api/products/[productId]/effective-bom/route.ts`, `.../effective-bol/route.ts` |
| 5 | `productCutlistLoader.ts` loads only the parent's `product_cutlist_groups`; falls back to effective-BOM cutlist rows; **child groups never merged** | `lib/cutlist/productCutlistLoader.ts` |
| 6 | `buildCutlistSnapshot()` queries `product_cutlist_groups` with `.eq('product_id', productId)` only; snapshot frozen onto `order_details.cutlist_material_snapshot` by `app/api/orders/[orderId]/add-products/route.ts` and `app/api/orders/from-quote/route.ts` | `lib/orders/build-cutlist-snapshot.ts` |
| 7 | Order-line quantity multiplication happens once, downstream: `quantity: part.quantity * lineQty` in `lib/orders/cutting-plan-aggregate.ts` (~line 171) | confirmed by read |
| 8 | `products` already has `org_id uuid NOT NULL`, `is_stocked boolean NOT NULL DEFAULT false`, `make_strategy text NOT NULL DEFAULT 'phantom' CHECK (IN phantom/MTO/MTS)`; **no code reads either column** (`git grep` over app/lib/components/hooks/types = 0 hits); no `product_kind` anywhere | live DB + grep |
| 9 | Sales-facing product pickers: quote `AddQuoteItemDialog.tsx` → `fetchProducts()` in `lib/db/quotes.ts`; order `AddProductsDialog.tsx` → `fetchAvailableProducts()` in `lib/queries/order-queries.ts`; products list `src/pages.old/products/ProductsPage.tsx`. BOM picker = `components/features/shared/ItemSelectionDialog.tsx` (Product tab, has apply/attach mode already) | picker sweep |
| 10 | Where-used exists for *components* only (`components/features/inventory/component-detail/OrdersTab.tsx`); nothing for product→product links | grep |
| 11 | Quote costing explodes linked-child labour already (`lib/quotes/build-costing-cluster.ts`); cutlist materials in quotes come from `quote_items.cutlist_material_snapshot`, orders from `order_details.cutlist_material_snapshot` | reads |
| 12 | Existing policy spec (`stocked-subassembly-policy-spec-v1.md`) chose **stocked-style non-exploded** as the Phase-1 default for *that* workstream — tension with this feature's phantom default; resolved in §14 Q1 | doc read |

Pre-implementation re-verification commands (run on the implementation branch):

```bash
git fetch origin codex/integration
git grep -n "product_kind" origin/codex/integration -- 'app/' 'lib/' 'supabase/'   # expect: no hits
git grep -n "sub_product_id" origin/codex/integration -- 'lib/cutlist/' 'lib/orders/build-cutlist-snapshot.ts'   # expect: no hits (gap still open)
```

## 4. Recommended MVP scope

1. **M1 — Classification:** `products.product_kind` migration + create/edit UI + picker filtering + products-page filter.
2. **M2 — Add Subcomponent UX:** explicit "Add Subcomponent" action on the product BOM tab; attach (link) is the default; grouped provenance display for effective BOM + BOL.
3. **M3 — Cutlist explosion:** child `product_cutlist_groups` merged (read-only, scaled, provenance-tagged) into the product cutlist view AND into `buildCutlistSnapshot()` → flows automatically into orders, cutting plan, material cost, quote costing.
4. **M4 — Where-used + guards:** where-used panel/warning on subcomponent edit; attach-time nesting/cycle guard.
5. **M5 — Docs + reconciliation note** in the canonical subcomponent doc.

Everything else (refresh-from-latest, stocked mode, nesting) is deferred.

## 5. Data model changes and migrations

One migration. No new tables — the MVP adds a single column. Follow `codex-skills/migration-hygiene/SKILL.md`: versioned filename matching Supabase history, apply via `mcp__supabase__apply_migration`, verify with `list_migrations`, update `docs/operations/migration-status.md` (version, name, UTC timestamp, applied-by, verification note).

**File:** `supabase/migrations/<YYYYMMDDHHMMSS>_products_product_kind.sql`

```sql
-- Classification of products into sellable (customer-facing) vs
-- internal_subcomponent (manufacturing-only building block, e.g. drawer box).
-- Text + CHECK (house style — matches products.make_strategy), not an enum.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_kind text NOT NULL DEFAULT 'sellable';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_product_kind_chk'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_product_kind_chk
      CHECK (product_kind IN ('sellable', 'internal_subcomponent'));
  END IF;
END $$;

-- Picker queries filter org + kind together.
CREATE INDEX IF NOT EXISTS idx_products_org_kind
  ON public.products (org_id, product_kind);

COMMENT ON COLUMN public.products.product_kind IS
  'sellable = appears in quote/order pickers; internal_subcomponent = manufacturing building block, hidden from sales surfaces. Orthogonal to make_strategy (phantom/MTO/MTS, currently dormant).';
```

Notes:

- **Default `'sellable'`** backfills every existing product correctly; no data migration needed.
- **No RLS changes**: the column rides on the existing `products` RLS policies. No new org-scoped table is created in this plan.
- **Relationship to dormant columns:** `internal_subcomponent` + `make_strategy='phantom'` is the MVP combination. When the stocked-subassembly workstream lands, `make_strategy='MTS'/'MTO'` on an `internal_subcomponent` is exactly the "stocked child" case — the two columns compose rather than conflict. Do **not** touch `is_stocked`/`make_strategy` in this plan.
- **TypeScript:** add `product_kind: 'sellable' | 'internal_subcomponent'` to the product row type used by the pickers (`types/` — wherever `Product` for `fetchProducts` lives) and regenerate Supabase types if the repo uses them.

## 6. API / service changes

### 6.1 Where-used endpoint (new)

**File:** `app/api/products/[productId]/where-used/route.ts` (GET)

Same auth pattern as the sibling routes (`requireModuleAccess(MODULE_KEYS.PRODUCTS_BOM)` + org context). Query:

```ts
const { data, error } = await supabase
  .from('product_bom_links')
  .select('product_id, scale, parent:products!product_bom_links_product_id_fkey(product_id, internal_code, name)')
  .eq('sub_product_id', productId)
  .eq('org_id', auth.orgId);
// NOTE: two FKs to products exist on this table — the embed MUST be hinted
// (memory: un-hinted second FK ⇒ PGRST201/HTTP 300). Verify the FK constraint
// name with information_schema before coding; adjust hint to the real name.
return NextResponse.json({
  count: data?.length ?? 0,
  parents: (data ?? []).map(r => ({
    product_id: r.parent?.product_id, // RLS: embeds can be null — never assume
    internal_code: r.parent?.internal_code ?? null,
    name: r.parent?.name ?? null,
    scale: Number(r.scale ?? 1),
  })),
});
```

### 6.2 Attach route hardening

**File:** `app/api/products/[productId]/bom/attach-product/route.ts` (modify POST)

Add before the upsert:

```ts
// Guard 1: no nesting — explosion is single-level; a child that itself has
// links would silently lose its grandchildren in effective views.
const { count: childLinks } = await supabase
  .from('product_bom_links')
  .select('*', { count: 'exact', head: true })
  .eq('product_id', subProductId);
if ((childLinks ?? 0) > 0) {
  return NextResponse.json(
    { error: 'This subcomponent itself contains subcomponents. Nested subcomponents are not supported yet — flatten the child first.' },
    { status: 400 }
  );
}
// Guard 2: no cycles — reject if the parent is already used inside the child
// chain (with single-level links this reduces to a direct reverse link).
const { count: reverse } = await supabase
  .from('product_bom_links')
  .select('*', { count: 'exact', head: true })
  .eq('product_id', subProductId)
  .eq('sub_product_id', productId);
if ((reverse ?? 0) > 0) {
  return NextResponse.json(
    { error: 'Circular link: that product already uses this product as a subcomponent.' },
    { status: 400 }
  );
}
// Guard 3 (mirror): attaching A→B must also fail if B is used as a parent of A
// via Guard 2 above; additionally reject attaching anything to a product that
// is itself attached somewhere AND would become a grandparent:
const { count: usedAsChild } = await supabase
  .from('product_bom_links')
  .select('*', { count: 'exact', head: true })
  .eq('sub_product_id', productId);
if ((usedAsChild ?? 0) > 0) {
  return NextResponse.json(
    { error: 'This product is itself used as a subcomponent elsewhere. Nested subcomponents are not supported yet.' },
    { status: 400 }
  );
}
```

(Guards 1+3 together enforce "links form a strict one-level forest", which makes Guard 2 technically redundant but cheap; keep it for defence in depth.)

### 6.3 Cutlist child-group loading (new shared service)

**File:** `lib/cutlist/explodeLinkedCutlistGroups.ts` (new)

One function used by BOTH the product cutlist loader (client path, via the existing `/api/products/[productId]/cutlist-groups` route extended with `?include_linked=1`) and the order snapshot builder (server path, `supabaseAdmin`). Signature and core logic:

```ts
export type LinkedCutlistGroup = DatabaseCutlistGroup & {
  source_sub_product_id: number;
  source_sub_product_name: string;
  link_scale: number; // parts NOT yet multiplied here — see buildCutlistSnapshot
};

export async function fetchLinkedCutlistGroups(
  client: SupabaseClient,
  productId: number,
  orgId: string
): Promise<LinkedCutlistGroup[]> {
  const { data: links, error: linkErr } = await client
    .from('product_bom_links')
    .select('sub_product_id, scale, sub:products!product_bom_links_sub_product_id_fkey(product_id, name)')
    .eq('product_id', productId)
    .eq('org_id', orgId);
  if (linkErr) throw linkErr;
  if (!links?.length) return [];

  const subIds = links.map(l => l.sub_product_id);
  const { data: groups, error: grpErr } = await client
    .from('product_cutlist_groups')
    .select('id, product_id, name, board_type, primary_material_id, primary_material_name, backer_material_id, backer_material_name, parts, sort_order')
    .in('product_id', subIds)
    .eq('org_id', orgId)
    .order('product_id')
    .order('sort_order');
  if (grpErr) throw grpErr;

  const byProduct = new Map(links.map(l => [l.sub_product_id, l]));
  return (groups ?? []).map(g => {
    const link = byProduct.get(g.product_id)!;
    return {
      ...g,
      source_sub_product_id: g.product_id,
      source_sub_product_name: link.sub?.name ?? `Product ${g.product_id}`,
      link_scale: Number(link.scale ?? 1),
    };
  });
}
```

(Embed hint `products!product_bom_links_sub_product_id_fkey` — verify the real FK constraint name first; two FKs from `product_bom_links` to `products` exist, so the hint is mandatory.)

### 6.4 `buildCutlistSnapshot()` explosion

**File:** `lib/orders/build-cutlist-snapshot.ts` (modify)

After loading the parent's own groups (current behaviour unchanged), append child groups with quantities **baked in** (so every downstream consumer — `cutting-plan-aggregate.ts`, `material-cost` route, `CutlistMaterialsSection`, quote costing — keeps working with zero changes; they see ordinary groups with extra provenance fields):

```ts
const linked = await fetchLinkedCutlistGroups(supabaseAdmin, productId, orgId);
for (const g of linked) {
  snapshot.push({
    source_group_id: g.id,            // PK is global serial → no collision with parent group ids
    name: g.name,
    board_type: g.board_type,
    primary_material_id: g.primary_material_id,
    primary_material_name: g.primary_material_name,
    backer_material_id: g.backer_material_id,
    backer_material_name: g.backer_material_name,
    // provenance (additive JSONB fields — old snapshots simply lack them):
    source_sub_product_id: g.source_sub_product_id,
    source_sub_product_name: g.source_sub_product_name,
    link_scale: g.link_scale,
    parts: (g.parts ?? []).map(part => ({
      ...part,
      quantity: Number(part.quantity ?? 0) * g.link_scale,  // ×3 for drawer box ×3
      // then the same effective_board/thickness/edging resolution the parent
      // groups get (reuse the existing per-part mapping helper — extract it
      // into a local function rather than duplicating the override logic)
    })),
  });
}
```

Two behavioural decisions encoded here (flag in review):

- **Line-level material overrides (`options.linePrimary`, `options.overrides`) apply to parent groups only** in MVP; child groups keep the child's own materials. (A drawer box is typically white melamine regardless of the pedestal's face material.) Revisit if Greg wants overrides to cascade — §14 Q4.
- **`link_scale` is baked into part quantities at snapshot time**; `cutting-plan-aggregate.ts` then multiplies by order-line qty as today. Net: `part.qty × link_scale × lineQty`. Verified single multiplication point downstream (fact #7).

### 6.5 Product cutlist loader / cutlist-groups route

**Files:** `app/api/products/[productId]/cutlist-groups/route.ts` (modify GET: support `?include_linked=1`, return `{ groups, linkedGroups }`), `lib/cutlist/productCutlistLoader.ts` (modify: request linked groups, return them on a new `linkedGroups` field of `ProductCutlistData`; do NOT mix them into `groups` — the builder must treat them read-only).

### 6.6 Picker query changes

- `lib/db/quotes.ts` → `fetchProducts()`: add `.eq('product_kind', 'sellable')` (and keep signature; add optional `{ includeInternal?: boolean }` param defaulting false so the BOM picker can reuse it with `true`).
- `lib/queries/order-queries.ts` → `fetchAvailableProducts()`: add `.eq('product_kind', 'sellable')`.
- `ItemSelectionDialog.tsx` Product tab: call `fetchProducts({ includeInternal: true })`; when opened via the new "Add Subcomponent" entry point, pre-filter to `product_kind = 'internal_subcomponent'` with a "show all products" toggle.
- Products list page (`ProductsPage.tsx`): add a kind filter (segmented control `All | Sellable | Subcomponents`, default **All**, state in URL search params per the list-state-persistence rule), and a muted "Subcomponent" badge on internal rows.

(Org-filter gaps noted in the picker sweep are real but are covered by `products` RLS at the DB level; do not expand scope to fix them here — note them in the PR description instead.)

## 7. UI changes

All naming user-facing = **"Subcomponent"**. Never "phantom", "BOM link", or "explosion" outside debug contexts.

1. **Product create/edit (Details tab):** radio — `Sellable product` (default) / `Internal subcomponent — used inside other products, hidden from quotes & orders`. Editable later from the same place; switching kind on a product that's quoted/ordered is allowed (snapshots protect history).
2. **Product BOM tab (`product-bom.tsx`):** new **"Add Subcomponent"** button beside the existing add flow. Opens `ItemSelectionDialog` Product tab pre-set to: internal subcomponents, mode `attach`, quantity field labelled "Quantity per parent" (maps to `scale`). The existing buried apply/attach toggle stays for power users; attach is the default for this entry point.
3. **Effective BOM / BOL grouped provenance:** rows with `_source==='link'` group under a collapsible header `Normal Drawer Box ×3` (the `SubProductGroupHeader` pattern already exists in `product-bom.tsx` — extend to BOL display in `product-bol.tsx`). Read-only rows; "Edit subcomponent" link navigates to the child product.
4. **Product cutlist tab:** below the editable parent groups, render `linkedGroups` in a visually distinct read-only section per subcomponent: `Normal Drawer Box ×3 — 2 groups, 8 parts (×3 = 24)` with an "Edit in Normal Drawer Box" link. No drag/edit on these rows.
5. **Where-used:** on an internal subcomponent's product page, a persistent muted banner: `Used in 12 products` (popover lists parents with links). Additionally, on entering edit mode of BOM/BOL/cutlist of any product with `where-used count > 0`: inline warning `Changes apply to future quotes and orders for the 12 products using this subcomponent. Existing quotes and orders keep their snapshots.` Allow save — warning only.
6. **Quote/order surfaces:** zero visual change (pickers simply stop offering internal subcomponents).

Calm-over-density: the linked-group section and where-used banner are collapsed/minimal by default; no extra chrome on the common path.

## 8. Cutlist / order snapshot changes — flow summary

```
product_bom_links (Normal Drawer Box, scale=3)
        │
        ├─ effective-bom ──── already explodes ✓ (M2: grouping UI only)
        ├─ effective-bol ──── already explodes ✓ (M2: grouping UI only)
        │
        └─ NEW fetchLinkedCutlistGroups()
                 ├─ /api/.../cutlist-groups?include_linked=1 → product cutlist tab (read-only view)
                 └─ buildCutlistSnapshot() → order_details.cutlist_material_snapshot
                          └─ cutting-plan-aggregate (×lineQty, unchanged)
                          └─ material-cost route (unchanged)
                          └─ quote costing cluster (unchanged — reads snapshot)
```

Snapshot compatibility: provenance fields are additive JSONB; old snapshots without them render exactly as today. `source_group_id` stays globally unique (serial PK), so material-assignment maps keyed on it are safe.

Quote path: `quote_items.cutlist_material_snapshot` is built from the same group data at quote-item design time — verify during M3 that the quote-item snapshot writer (the `refresh_materials` path in `app/api/quote-items/[id]/costing/route.ts` and the cutlist editor save) goes through `buildCutlistSnapshot()` or gets the same explosion; if it has its own loader, extend it with `fetchLinkedCutlistGroups` in the same task.

## 9. Tenancy / RLS considerations

- **No new tables.** The only DDL is one column + check + index on `products`, which already has `org_id NOT NULL` + org RLS. Nothing for `get_advisors` to flag, but run it anyway post-migration (memory: advisors run from the Claude session, Codex's MCP lacks the tool).
- `product_bom_links` and `product_cutlist_groups` are already org-scoped with enforced RLS (facts #1, #2, migration `20260222_..._product_cutlist_groups_replace_broad_with_org.sql`); the same-org trigger already guarantees a parent can never link a child from another org, which transitively protects the cutlist explosion.
- All new queries (`fetchLinkedCutlistGroups`, where-used) filter `.eq('org_id', ...)` explicitly *and* ride RLS; embedded relations are treated as nullable (RLS null rule).
- Server paths use the established `requireModuleAccess` + org-context pattern from the sibling routes; the snapshot builder keeps using `supabaseAdmin` with explicit `org_id` filters as it does today.

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| **Doc/spec conflict:** policy-spec-v1 chose `stocked`-style default; this plan defaults phantom for `internal_subcomponent` | §14 Q1 to Greg; plan already frames the two as orthogonal (`product_kind` × `make_strategy`); M5 adds a reconciliation note to `subcomponent-planning-and-execution.md` so the next stocked-workstream session doesn't fight this one |
| Second-FK embed breakage (two FKs `product_bom_links`→`products`) | All embeds in new code are hinted with the explicit FK name (memory: PGRST201 outage class); verify constraint names via `information_schema.table_constraints` before coding |
| Downstream snapshot consumers choke on provenance fields | Fields are additive; M3 acceptance includes regression smoke of cutting plan + material cost + quote costing on an order with NO subcomponents (old shape) and one WITH |
| Double quantity multiplication (scale × lineQty applied twice) | Single bake-in point at snapshot build; unit test asserts `part.qty=2, scale=3, lineQty=5 → aggregate 30` |
| Users hide a product that's on open quotes/orders by flipping kind | Snapshots make this safe by construction; where-used banner shows usage; no hard block (MVP) |
| Nesting silently dropping grandchildren | Attach-route guards (§6.2) make one-level a hard invariant instead of a silent failure |
| Pickers missed in the hide sweep | Picker inventory in fact #9 is the checklist; acceptance criterion AC-5 verifies each surface by browser smoke |
| `effective-bom` fallback path in cutlist loader double-counts once linked groups exist | M3: loader prefers `groups`+`linkedGroups`; the BOM-fallback branch must exclude `_source==='link'` rows whenever linkedGroups were returned (single code path, unit-tested) |

## 11. Acceptance criteria

- **AC-1:** Creating a product as Internal subcomponent stores `product_kind='internal_subcomponent'`; it appears on the products page under the Subcomponents filter with a badge.
- **AC-2:** Internal subcomponents do NOT appear in the quote Add-Item product picker nor the order Add-Products picker; they DO appear in the BOM/Add-Subcomponent picker.
- **AC-3:** Attach "Normal Drawer Box" ×3 to "3-Drawer Pedestal": effective BOM and BOL each show a collapsible "Normal Drawer Box ×3" group with child rows at ×3 quantities, read-only, with an edit-child link.
- **AC-4:** Pedestal cutlist tab shows the drawer box's cutlist groups read-only at ×3; adding the pedestal (qty 5) to an order produces `order_details.cutlist_material_snapshot` containing the child groups with part quantities ×3 and provenance fields; the cutting plan aggregates those parts ×5 further (total ×15); order material cost includes them.
- **AC-5:** A quote line for the pedestal shows only "3-Drawer Pedestal" to the customer; quote costing includes child material + labour.
- **AC-6:** Editing the drawer box afterwards changes the pedestal's *template* (fresh effective views / new snapshots) but does NOT change the existing order's snapshot or the existing quote.
- **AC-7:** Opening the drawer box for editing shows "Used in N products"; save still permitted.
- **AC-8:** Attaching a child that has its own links, or creating a direct cycle, is rejected with a clear message.
- **AC-9:** An order for a product with NO subcomponents behaves byte-identically to before (snapshot shape regression).
- **AC-10:** `npm run lint` clean; `npx tsc --noEmit` clean or pre-existing-failures-only (reported explicitly).

## 12. Verification commands / tests

```bash
# Static
npm run lint
npx tsc --noEmit

# Unit (Node test runner / tsx harness, no dev server needed)
npx tsx --test tests/cutlist-linked-groups.test.ts
#   - fetchLinkedCutlistGroups: mocked client → scale + provenance mapping
#   - buildCutlistSnapshot: parent-only product unchanged (golden snapshot);
#     parent+child×3: part qty multiplied once; overrides don't touch child groups
#   - quantity chain: qty2 × scale3 × lineQty5 = 30 via resolveAggregatedGroups

# DB (run from Claude session via Supabase MCP after migration)
#   mcp__supabase__list_migrations  → new version present
#   mcp__supabase__get_advisors     → no new findings
#   execute_sql: select product_kind, count(*) from products group by 1;  → all 'sellable' pre-UI

# Browser smoke (Claude in Chrome, test account):
#   create subcomponent → attach ×3 → check BOM/BOL/cutlist tabs →
#   quote picker (absent) → order add (absent) → add parent to order →
#   open cutting plan → screenshot each as proof
```

`EXPLAIN ANALYZE` is not required (no report RPCs added); the where-used and linked-group queries are PK/index lookups.

## 13. Suggested Linear issue breakdown

Parent issue in the **Manufacturing** project (the cutlist-only slice could argue for Cutlist; manufacturing structure is the dominant theme — confirm in §14 Q6). Contract-shaped descriptions per `docs/workflow/linear-handoff.md`; `assignee=Greg`, `delegate=Codex` (write "Codex", never a literal `@` — Linear MCP mention parser). Sub-issues:

1. **`product_kind` foundation** — migration §5, product type updates, create/edit radio, products-page filter+badge, picker filtering §6.6. *(M1; AC-1, AC-2, AC-10)*
2. **Add Subcomponent UX + provenance grouping** — BOM-tab entry point, attach-default dialog preset, BOL grouped display, attach-route guards §6.2. *(M2+M4-guards; AC-3, AC-8)*
3. **Cutlist explosion** — `fetchLinkedCutlistGroups`, cutlist-groups route param, loader+builder read-only section, `buildCutlistSnapshot` explosion, quote-snapshot-path audit, unit tests. *(M3; AC-4, AC-5, AC-6, AC-9)*
4. **Where-used** — endpoint §6.1, banner + edit warning. *(M4; AC-7)*
5. **Docs + reconciliation** — update `docs/domains/components/subcomponent-planning-and-execution.md` (canonical) with product_kind, cutlist explosion, naming ("Subcomponent"), and an explicit note reconciling phantom-default-for-drawer-boxes with the stocked-subassembly spec. *(M5)*

Sequencing: 1 → 2 → 3 → 4 (4 can parallel 3); 5 closes. Issues 1–2 are independently shippable; the feature is honest only after 3.

Follow-up issues to file as Backlog (not MVP): "Refresh from latest subcomponents (with warning) on quote/order lines"; "Nested subcomponents (multi-level explosion + cycle guard at depth 5)" — link both to the stocked-subassembly plan docs.

## 14. Open questions for Greg

1. **Spec reconciliation:** `stocked-subassembly-policy-spec-v1.md` (finalized 2026-02-26) made non-exploded/`stocked` the Phase-1 default for linked children. This plan makes *phantom* the default for `internal_subcomponent` (drawer boxes: parts cut with the parent, no child stock). Proposed resolution: drawer-box-class children = phantom now; the stocked workstream later targets children with `make_strategy MTS/MTO`. OK to note this in the canonical doc, or do you want the policy spec amended first?
2. **Order picker visibility:** hide internal subcomponents from the *order* Add-Products dialog too, with no escape hatch? (Edge case: ad-hoc internal build orders for drawer boxes alone. MVP proposal: hard-hide; an internal build need is the stocked workstream's territory.)
3. **Attach picker scope:** should "Add Subcomponent" allow attaching *sellable* products as children too (toggle provided), or strictly `internal_subcomponent`? Plan assumes toggle-available but defaulting to subcomponents.
4. **Material override cascade:** when an order line overrides the parent's primary material, child subcomponent groups keep their own materials (drawer box stays white melamine). Confirm that's the wanted default.
5. **Collections page:** the "Normal drawer box" collection currently on /collections — leave as-is and recreate as a subcomponent product manually, or do you want a small "convert collection → subcomponent product" helper (not in MVP)?
6. **Linear home:** Manufacturing project (proposed) or Cutlist?

# Stocked Sub-Assembly Planning (BOM/BOL/Job Cards)

Status: Active implementation plan (policy decisions locked)  
Last updated: 2026-02-26

Policy baseline: [Stocked Sub-Assembly Policy Spec (v1)](./stocked-subassembly-policy-spec-v1.md)
Naming note: Policy "Phase 1" scope spans the delivery work currently laid out in Phases 1-4 below.

## Problem Statement

Current behavior allows a user to add a product into another product's BOM in two ways:

1. Apply (copy/explode): copies child BOM + BOL rows directly into the parent.
2. Attach (link/phantom): links the child product and explodes its rows at read time.

In both cases, planning screens ultimately reason about exploded leaf rows (components and labor jobs).  
For manufacturing execution, this can be confusing and operationally inefficient when a reusable sub-assembly (example: `QButtonLBracket`) should be treated as a stocked part first, not always exploded into raw material lines in the parent job context.

## Verified Current State (Code + DB)

### Product BOM/BOL authoring
- `components/features/products/AddProductToBOMDialog.tsx`
  - "Add Product" defaults to `apply`.
  - `attach` exists behind `NEXT_PUBLIC_FEATURE_ATTACH_BOM=true`.
- `app/api/products/[productId]/bom/apply-product/route.ts`
  - Copies child `billofmaterials` + `billoflabour` rows into parent.
- `app/api/products/[productId]/bom/attach-product/route.ts`
  - Writes to `product_bom_links`, `mode='phantom'` only.

### Effective resolvers
- `app/api/products/[productId]/effective-bom/route.ts`
  - Returns explicit rows + exploded linked rows (single-level).
- `app/api/products/[productId]/effective-bol/route.ts`
  - Returns explicit rows + exploded linked labor rows (single-level).

### Order and job-card flow
- `app/orders/[orderId]/page.tsx`
  - Component requirements use direct `billofmaterials` joins and existing RPCs.
- `components/features/orders/JobCardsTab.tsx`
  - "Generate from BOL" reads direct `products.billoflabour` rows only.
- `lib/queries/laborPlanning.ts`
  - Planning board also reads direct `products.billoflabour`.

### Schema / policy observations (Supabase MCP verified)
- `products` has `is_stocked` and `make_strategy` (`phantom | MTO | MTS`).
- `product_bom_links.mode` constraint currently allows `phantom` only.
- `product_bom_links` has no `org_id`, RLS disabled.
- `billoflabour` has no RLS enabled.
- `billofmaterials` has RLS enabled but permissive policy (`qual=true`, `with_check=true`).

## Target Outcome

When a parent product includes a reusable sub-assembly:

1. Planning screens should show the sub-assembly as a recognizable line item.
2. System should check sub-assembly stock first.
3. If shortage exists, system should direct user to the right action:
   - Build internally (work/job path), or
   - Purchase externally (supplier path, if enabled for products).
4. Child raw materials/labor should only explode when operationally required.

## Proposed BOM Link Modes

### `phantom` (existing)
- Explode child into parent for planning/costing.
- No independent stock behavior.

### `stocked` (new)
- Treat child product as a stocked sub-assembly requirement.
- Do not auto-explode into parent requirement lines.
- Explode only when building that child product due to shortage.

## Core Planning Rule (Order Requirements Engine)

Introduce a single resolver for order manufacturing requirements:

Input:
- order id (or product id + qty)
- context (`planning`, `purchasing`, `jobcards`, `costing`)

Output buckets:
1. `component_requirements` (raw components to procure/issue)
2. `subassembly_requirements` (stocked child products to pull/build/buy)
3. `labor_requirements` (jobs to execute now)

Traversal rule:
- Direct BOM rows always produce component requirements.
- Linked child with `mode='phantom'` recurses immediately.
- Linked child with `mode='stocked'` produces a sub-assembly requirement row.
- If stocked child shortage is marked "build now", recurse into that child for components/labor.

This preserves readability while still supporting full nested planning logic.

## Data Model Changes (Proposed)

### 1) Extend link mode
- Expand `product_bom_links_mode_check` to allow `('phantom','stocked')`.

### 2) Tenant isolation hardening
- Add `org_id uuid not null` + FK on `product_bom_links`.
- Enable RLS on `product_bom_links` with org-member policies.
- Enable org-safe access pattern for `billoflabour` and tighten `billofmaterials` policy.

### 3) Optional sourcing metadata for sub-assemblies
If we need external purchase of products (not just components), add a sourcing model:
- `product_procurement_profiles` (buy/make preference, lead times, vendor link).
- Or `product_supplier_links` for buy path.

Without this, "externally purchased sub-assembly" remains manual.

## API / Service Changes

### Security and tenancy first
- Add module/org guardrails to:
  - `POST /api/products/:id/bom/apply-product`
  - `POST|DELETE /api/products/:id/bom/attach-product`
  - `GET /api/products/:id/effective-bom`
  - `GET /api/products/:id/effective-bol`
- Ensure child and parent products belong to same org in server routes.

### New resolver endpoint
- Add `GET /api/orders/:id/requirements` (or RPC-backed route) returning all three buckets.
- Update order detail tabs and job-card generation to consume this endpoint, not ad hoc direct joins.

## UI/Workflow Changes

### Product BOM page
- Keep Add Product modes explicit:
  - Apply (copy)
  - Attach Phantom
  - Attach Stocked
- Default mode should be configurable; for manufacturing-first orgs, default to `Attach Stocked`.
- Show mode badges in BOM table and linked chip list.

### Order detail
- Replace one flat component shortfall view with:
  - Components to Buy
  - Sub-assemblies to Pull from Stock
  - Sub-assemblies to Build/Buy

### Job cards
- Generate jobs from requirement resolver:
  - Parent direct BOL
  - Plus child BOL only for sub-assemblies marked build-now
- Do not blindly include all nested child labor.

## Rollout Plan (Low Risk)

### Phase 0: Alignment + invariants
- Confirm business rules for stocked sub-assemblies, build-vs-buy, and shortage handling.
- Add regression fixtures (Apollo + QButtonLBracket scenario).

### Phase 1: Security + tenancy hardening (no UX change)
- RLS/org changes and API guardrails.
- Smoke test product BOM/BOL pages by normal user.

### Phase 2: Link mode support (`stocked`)
- DB migration + API update + BOM UI mode selector/badges.
- No order/job behavior change yet.

### Phase 3: Requirements resolver
- Implement order-level recursive resolver.
- Update order components and purchasing-prep cards to use resolver output.

### Phase 4: Job-card/labor planning integration
- Switch generation logic to resolver buckets.
- Add explicit "build sub-assemblies" decision step if shortage exists.

### Phase 5: Optional product buy-path
- If needed, add product-vendor procurement model and purchasing UI support.

## Test Matrix (Must Pass)

1. Parent product with stocked child, child has stock:
   - Parent order shows child requirement fulfilled from stock.
   - No child BOM components shown in parent shortage list.
   - No child labor auto-added to parent job card.

2. Parent product with stocked child, child stock shortage:
   - Shortage appears in sub-assembly bucket.
   - User can mark build-now; then child BOM/BOL appears in downstream buckets.

3. Parent product with phantom child:
   - Behavior remains current exploded planning.

4. Multi-level nesting with cycle guard:
   - Resolver halts and reports cycle safely.

5. Multi-tenant isolation:
   - Org A cannot link, read, or mutate Org B product links/BOL/BOM via API.

## Risks and Mitigations

- Risk: breaking quote/cost flows that currently rely on effective exploded rows.
  - Mitigation: keep existing effective endpoints for costing; add context-aware resolver for manufacturing.

- Risk: duplicate logic across order page, job cards, labor planning.
  - Mitigation: centralize requirement computation in one server endpoint/RPC.

- Risk: product procurement model gap for buy-sub-assembly.
  - Mitigation: phase it separately; support internal-build first.

## Decision Log

All prior open questions are resolved for Phase 1 and captured in:

- [Stocked Sub-Assembly Policy Spec (v1)](./stocked-subassembly-policy-spec-v1.md)

Any new unresolved items should be appended to that policy spec as explicit follow-ups.

## References
- `components/features/products/AddProductToBOMDialog.tsx`
- `app/api/products/[productId]/bom/apply-product/route.ts`
- `app/api/products/[productId]/bom/attach-product/route.ts`
- `app/api/products/[productId]/effective-bom/route.ts`
- `app/api/products/[productId]/effective-bol/route.ts`
- `app/orders/[orderId]/page.tsx`
- `components/features/orders/JobCardsTab.tsx`
- `lib/queries/laborPlanning.ts`
- `docs/domains/components/subcomponent-planning-and-execution.md`

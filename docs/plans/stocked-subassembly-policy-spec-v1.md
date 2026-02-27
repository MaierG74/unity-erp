# Stocked Sub-Assembly Policy Spec (v1)

Status: Approved for implementation  
Effective date: 2026-02-26  
Owner: Product + Engineering

Terminology note: "Phase 1" in this policy means the first delivery scope and maps to implementation plan Phases 1-4 in `stocked-subassembly-manufacturing-plan.md`.

## Purpose

Define the execution policy for internally manufactured sub-assemblies so costing stays readable, planning stays accurate, and production flows handle stock-first behavior without double counting labor.

This spec is the implementation source of truth for Phase 1.

## Scope (Phase 1)

In scope:
- Stock-first planning for internally manufactured child products.
- Manual-confirmed child build/job-card flow.
- Split fulfillment (stock + build, and rare manual buy-out exception).
- Order UI buckets for buy/pull/build decisions.
- Tenant safety hardening for product link/labor tables.

Out of scope (defer):
- Full automatic product-level external buy-out automation.
- Fine-grained role/group permissions model.
- Allocation-level returns logic.

## Core Principles

1. Parent-facing BOM/costing should remain readable (no forced explosion in quote UI).
2. Planning can recurse through child structures when needed.
3. Stock allocation is live and reassignable, with auditability.
4. Requirements definitions are snapshotted per order; stock state is live.
5. No labor double counting between parent and child build execution.

## Cluster Decisions

## A) Default Behavior & Permissions

1. Phase 1 default link behavior for reusable manufactured children is stocked-style attachment (non-exploded in parent view).
2. Apply/explode is not part of normal Phase 1 user flow.
3. Link-mode switching permissions remain broad for now (product editors), pending role system hardening.
4. Product editors can maintain BOM/BOL/overhead in Phase 1; restricted engineering role is a follow-up.

## B) Shortage Handling (Build vs Buy)

1. Default shortage action is supply-type driven:
- Manufactured: Build internally.
- Purchased: Buy externally.
- Hybrid: Build by default.
2. Split quantity is allowed (stock + build; and rare stock + buy/build combinations where valid).
3. Phase 1 supports manual buy-out exception only for product-level external supply.
4. Full automatic product-vendor buy-out selection is deferred.

## C) Job Card & Labor Logic

1. MTO child build jobs must link to the parent order for traceability.
2. MTS replenishment uses user confirmation with reorder minimum + target level guidance:
- Reorder minimum is a trigger.
- Target level is suggested; user selects final build quantity.
3. Child job cards are created with manual confirmation (no blind auto-create).
4. Child labor is included only when child is marked build-now. If fulfilled from stock, child labor is not counted again.

## D) Order & Planning UI

1. Orders UI must expose three operational buckets:
- Components to Buy
- Sub-assemblies to Pull
- Sub-assemblies to Build
2. Cutlist output excludes pulled-from-stock linked children by default and includes build-now items.
3. Order requirements snapshot product definition at order creation (BOM/BOL/overhead/rules).
4. Stock allocation remains live (soft reservation model), with allowed reallocation for urgent orders.
5. Reallocation must create an audit trail and automatically reopen shortage on source order when stock is moved away.

## E) Costing & Quotes

1. Quote costing uses rolled-up unit cost for manufactured child products.
2. Quote UI does not explode child raw costs by default.
3. UI should provide drill-down navigation to child manufactured product details.

## F) Safety & Change Management

1. Child BOM/BOL changes do not auto-update all open orders.
2. For planned/unallocated orders, allow explicit refresh from latest definition.
3. For released/in-progress orders, preserve snapshot unless manager-approved override path is invoked.
4. Changing link mode when open orders reference parent should be controlled:
- Prefer revision/effective-from behavior.
- At minimum, require impact warning and manager override.
5. Where-used warning is mandatory before editing linked child BOM/BOL.
6. Tenant safety hardening for `product_bom_links` and `billoflabour` is part of Phase 1.

## G) Technical Limits

1. Default recursion depth: 5.
2. Cycle guard: mandatory.
3. Future enhancement: optional per-org/admin depth override.

## Implementation Notes

1. Keep planning resolver context-aware:
- Costing/quote context: non-exploded presentation.
- Manufacturing/planning context: recurse as needed (depth 5 + cycle guard).
2. Treat stock allocations as soft reservations, not immutable hard binds.
3. Ensure shortage regeneration happens after reservation moves.
4. Preserve observability:
- reservation move logs,
- parent-child job links,
- refresh-from-latest audit events.

## Acceptance Criteria (Phase 1)

1. Parent order can consume child stock first and propose child build for shortage.
2. Planner can manually confirm child build qty (including above-min replenishment toward target level).
3. System supports split fulfillment for a single demand line.
4. Quote costing remains rolled-up and readable, with child drill-down available.
5. Parent execution labor totals do not double count child labor when child pulled from stock.
6. Where-used warnings display before linked child definition edits.
7. `product_bom_links` and `billoflabour` are organization-safe (org scoping + enforced access behavior).

## Related Docs

- [Stocked sub-assembly implementation plan](./stocked-subassembly-manufacturing-plan.md)
- [Subcomponent planning and execution](../domains/components/subcomponent-planning-and-execution.md)
- [Orders master](../domains/orders/orders-master.md)
- [Tenant data isolation runbook](../operations/tenant-data-isolation-zero-downtime-runbook.md)

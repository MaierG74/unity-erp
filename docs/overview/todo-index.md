---
title: TODO Index
last_updated: 2025-10-20
---

Unity ERP's documentation spreads TODOs and open questions across domain guides, changelogs, and technical references. Use this index as a single starting point to see what still needs attention and where the authoritative source of truth lives.

## How to Use This Index
- Scan the area that matches your current project or release scope.
- Follow the "Source" link for full context, acceptance criteria, and historical notes before making changes.
- Update the status/owner placeholders as work is planned or completed so downstream readers know who is driving each item.

## Purchasing
- **Seed missing supplier order statuses** — Status: _Addressed (seeded)_, Owner: _Unassigned_. Seeds now include Approved, Partially Received, and Fully Received alongside legacy names. Verify in your DB after running setup. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Define transactional receiving RPC** — Status: _Needs design_, Owner: _Unassigned_. Implement a single RPC to atomically: insert inventory transaction, insert receipt, update on‑hand inventory, and recompute SO totals/status. Frontend now uses `update_order_received_quantity` + direct updates as an interim. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Fix purchase order receiving insert** — Status: _Resolved_, Owner: _Unassigned_. `receiveStock` now looks up the component first, omits the sales‑order FK on `inventory_transactions`, records the receipt, updates inventory on‑hand, and recomputes SO totals/status. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Backfill schema snapshot** — Status: _Open_, Owner: _Unassigned_. Bring `schema.txt` up to date with the `supplier_orders.purchase_order_id` relationship to prevent drift between docs and migrations. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Harden receiving validation** — Status: _In progress_, Owner: _Unassigned_. Client now blocks over‑receipts; still add server‑side checks in the RPC to prevent bypass. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).

## UI Tech Debt
- **Avoid hard‑coded status IDs in dashboard** — Status: _Backlog_, Owner: _Unassigned_. Replace numeric `status_id` filters with name‑based joins to `supplier_order_statuses` in `app/purchasing/page.tsx` to avoid environment ID drift.

## AI Assistant
- **Deliver Phase 1 read-only assistant** — Status: _In refinement_, Owner: _Unassigned_. Build the NLQ + RAG tooling, chat dock, and logging required for the initial assistant rollout. Source: [AI assistant plan – Phase 1](AI%20Assistant.md#phase-1-%E2%80%94-read-only-nlq-%2B-rag).
- **Document cost rollups for quote insights** — Status: _Backlog_, Owner: _Unassigned_. Replace placeholder cost calculations in the quote metrics view with exploded BOM and labor rollups. Source: [AI assistant metrics SQL TODO](AI%20Assistant.md#phase-1-%E2%80%94-read-only-nlq-%2B-rag).
- **Derive job duration actuals** — Status: _Backlog_, Owner: _Unassigned_. Implement actual-minute capture for job variance reporting by wiring attendance or job logs into the view. Source: [AI assistant metrics SQL TODO](AI%20Assistant.md#phase-1-%E2%80%94-read-only-nlq-%2B-rag).

## Operations
- **Finalize user activity logging rollout** — Status: _Planning_, Owner: _Unassigned_. Resolve open questions around retention, masking, and SIEM integrations before implementation proceeds. Source: [user logging plan open questions](../operations/user-logging.md#open-questions).
- **Design sidebar personalization experiments** — Status: _Ideas_, Owner: _Unassigned_. Evaluate theme toggles, quick shortcuts, and section dividers for future sidebar iterations. Source: [sidebar enhancements ideas](../operations/sidebar-enhancements.md#ideas-for-future-iterations).

## Cross-Cutting / Historical Follow-Ups
- **Tighten todo module RLS** — Status: _Follow-up_, Owner: _Unassigned_. Revisit the permissive insert policy once JWT-based checks are validated for server routes. Source: [todo module fixes future improvements](../changelogs/todo-module-fixes-20251008.md#future-improvements).
- **Standardize date utilities across modules** — Status: _Follow-up_, Owner: _Unassigned_. Apply the new date formatting helpers to Labor/Staff, Purchasing, and Inventory workflows for consistent locale support. Source: [todo module fixes future improvements](../changelogs/todo-module-fixes-20251008.md#future-improvements).

## Maintenance Checklist (Optional)
Before major releases, run the following quick audit to keep this index accurate:

1. `rg --heading --line-number "TODO" docs | tee /tmp/docs-todo-scan.txt` to capture raw TODO references.
2. Review `/tmp/docs-todo-scan.txt` for new or resolved items; update `docs/overview/todo-index.md` entries accordingly.
3. Confirm each bullet still points to a valid source section and adjust anchors if headings move.
4. Commit updates alongside the relevant feature work so the index reflects the latest state.

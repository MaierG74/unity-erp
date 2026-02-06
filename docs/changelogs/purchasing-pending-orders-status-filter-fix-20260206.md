# Purchasing Pending/Approved Filter Fix (2026-02-06)

## Summary
- Fixed a purchasing dashboard bug where clicking the **Pending Orders** (or **Approved Orders**) card could still show unrelated recent orders with status `Unknown`.

## Root Cause
- The dashboard filtered on `supplier_order_statuses.status_name` while using an embedded relation on a left join.
- PostgREST kept the parent `purchase_orders` rows and nulled the embedded status object when the status name did not match the filter.
- The UI then rendered those rows as `Unknown`, which made approved orders appear in the pending view.

## Fix Implemented
- Updated `app/purchasing/page.tsx` to resolve status IDs from `supplier_order_statuses` by status name first.
- Applied the pending/approved filter directly on `purchase_orders.status_id` using those resolved IDs.
- Kept the existing card metric logic and approved-order post-filtering (excluding fully received orders).

## Result
- Pending and approved card drilldowns now return only matching orders.
- Orders no longer show `Unknown` due to relation-null side effects from embedded status-name filtering.

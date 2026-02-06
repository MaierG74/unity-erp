# Purchasing Partially Delivered Dashboard Card (2026-02-06)

## Summary
- Replaced the rightmost purchasing dashboard card (**This Month**) with a new **Partially Delivered** card.
- Added click-to-filter behavior so selecting the card drills down to partially delivered purchase orders.

## What Changed
- Updated `app/purchasing/page.tsx` to add a new `partialDelivered` dashboard filter mode.
- Replaced the monthly metric with a partially delivered metric (orders with received quantity but not fully received).
- Added card active-state styling and toggle text consistent with existing pending/approved cards.
- Updated filtered list behavior so the section title and empty-state copy reflect the partially delivered filter.

## Result
- Purchasing users can now surface actionable in-progress deliveries directly from the dashboard metric card.
- The card now works as a drilldown entry point instead of showing total orders created this month.

## Follow-Up Fix (2026-02-06)
- Fixed an issue where the **Partially Delivered** card count could be non-zero while the filtered list showed no orders.
- Root cause: the dashboard query applied a 10-row limit before running the client-side "partially delivered" check, so older matching orders were excluded.
- Resolution: for approved/partially delivered views, filter first and then apply the 10-row display limit.

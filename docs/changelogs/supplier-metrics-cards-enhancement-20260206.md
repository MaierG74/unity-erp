# Supplier Metrics Cards Enhancement (Suppliers Detail)

**Date**: 2026-02-06

## Summary

Enhanced the supplier detail metrics cards (`/suppliers/[id]`) to support period-aware analytics and fast drill-down workflows directly from the cards.

## Iteration 2 (Card-to-Orders + Risk Split + Month Drill-Down)

Follow-up improvements were added on the same day to make card analytics more actionable:

1. Card deep-links into Orders tab with pre-applied filters:
   - `Total Orders` and `Total Spend` now open the Orders tab for the selected metric period (`ordersStart` / `ordersEnd`).
   - `Outstanding` opens Orders tab with open/outstanding statuses only.
   - `Last Order` opens Orders tab filtered to that specific order date.
   - `Components` card opens the Components tab directly.
2. Outstanding risk split under the Outstanding card:
   - shows `overdue`, `due in 7 days`, and `later` counts
   - due timing is estimated from order date + supplier lead time per line item
3. Spend modal month drill-down:
   - clicking a month in the chart selects that month
   - selected month now shows:
     - top components by spend
     - top linked customer orders by spend allocation
4. Orders tab deep-link support:
   - `SupplierOrders` now reads URL params (`ordersStatus`, `ordersDateType`, `ordersStart`, `ordersEnd`, `ordersQ`)
   - added `Open / Outstanding` status option for quick filtering

## What Changed

1. Added a metric period toggle above cards:
   - `30D`
   - `90D`
   - `YTD`
   - `12M`
2. Updated `Total Orders` and `Total Spend` cards to:
   - respect the selected period
   - show period-over-period comparison text (`vs previous period`)
3. Added clickable icon action on `Total Spend`:
   - opens a dialog with a 12-month spend trend chart
   - includes monthly spend bars + order count line
   - shows summary stats: 12M spend, average monthly spend, peak month
4. Added clickable icon action on `Outstanding`:
   - opens outstanding orders modal for the current supplier
   - modal now supports an outstanding-only mode
   - improves "who for" visibility by showing customer names inline with linked order numbers
   - value column now reflects outstanding value (not full order value)
5. Improved `Last Order` card:
   - uses the true latest order date
   - adds "days ago" context

## Files Updated

- `app/suppliers/[id]/page.tsx`
- `components/features/suppliers/open-orders-modal.tsx`
- `components/features/suppliers/supplier-orders.tsx`

## Validation

- Ran ESLint on touched files:
  - `app/suppliers/[id]/page.tsx`
  - `components/features/suppliers/open-orders-modal.tsx`
- Result: no lint errors

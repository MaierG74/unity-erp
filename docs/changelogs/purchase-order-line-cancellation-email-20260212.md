# Purchase Order Line Cancellation Email Workflow (2026-02-12)

## Summary
- Cancelling a single PO line item now triggers a supplier cancellation email for that specific line.
- Users can now select multiple line items and cancel them in one action.
- A single batch action sends one cancellation email per affected supplier containing all cancelled lines in that action.
- Line cancellation emails always include default internal PO CC recipients (`po_default_cc_email`), merged with any explicit CC values and deduplicated.
- `purchase_order_emails` logging now stores structured email intent via:
  - `email_type` (`po_send`, `po_cancel`, `po_line_cancel`, `po_follow_up`)
  - `supplier_order_id` (nullable, populated for single-line cancellation sends)
- PO email activity UI now displays an email-type badge so teams can distinguish sends/cancellations/follow-ups.

## Why
Operationally, cancelling only one item in a multi-line PO must be communicated to suppliers immediately and auditable separately from full-order cancellations.

## Implementation
- Added migration:
  - `db/migrations/20260212_purchase_order_email_types.sql`
  - Adds `email_type` + `supplier_order_id` to `purchase_order_emails`
  - Adds constraints/indexes and backfills existing rows as `po_send`
- Extended cancellation API:
  - `app/api/send-po-cancellation-email/route.ts`
  - Supports scoped line cancellation using `supplierOrderIds` and auto-selects line vs full cancellation scope
  - Uses dynamic cancellation subject/body scope and typed email logging
- Updated cancellation email template:
  - `emails/purchase-order-cancellation-email.tsx`
  - Supports `cancellationScope: 'order' | 'line'` copy and headings
- Updated PO detail line-cancel flow:
  - `app/purchasing/purchase-orders/[id]/page.tsx`
  - Supports selecting multiple lines and cancelling in one action (`Cancel Selected`)
  - After cancelling selected line statuses, it calls cancellation email API once with `supplierOrderIds: [...]`
  - Shows success/failure toast counts and refreshes email activity
- Added typed logging in other PO mail routes:
  - `app/api/send-purchase-order-email/route.ts` → `po_send`
  - `app/api/send-po-follow-up/route.ts` → `po_follow_up`

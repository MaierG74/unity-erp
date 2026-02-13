# Purchase Order Internal CC "For Order" Update (2026-02-12)

## Summary
- Kept supplier-facing PO email content unchanged.
- Added a separate internal PO email copy for the default PO CC recipient(s).
- Internal copy now includes a `For Order` column per line item using linked customer order references.
- `For Order` values are now shown without a leading `#` in both:
  - the internal CC email table
  - the PO detail page `For Order` column links

## Why
Operations needed the internal CC email to clearly show which client order each PO line belongs to, without changing the supplier email layout and content.

## Implementation Details
- API route `app/api/send-purchase-order-email/route.ts` now:
  - fetches `supplier_order_customer_orders -> orders(order_number/order_id)` for each supplier order line
  - splits recipients into:
    - supplier CC recipients (non-default CC entries)
    - internal CC recipients (matches `quote_company_settings.po_default_cc_email`)
  - sends supplier emails using the existing template
  - sends a separate internal copy using a new internal template that includes `For Order`
- Added `emails/purchase-order-internal-email.tsx` for the compact internal-only layout.
- Updated `app/purchasing/purchase-orders/[id]/page.tsx` to remove the leading `#` from `For Order` display links.

## Notes
- Internal `For Order` references are normalized to remove leading hash characters.
- When a line includes both linked customer orders and stock allocation, the internal value shows `orders + Stock`.

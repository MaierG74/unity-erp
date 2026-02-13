# Purchase Order Cancellation Default CC (2026-02-12)

## Summary
- Cancellation emails now always include the default internal PO CC recipient(s) from Settings (`po_default_cc_email`).
- Any extra CC values sent by the client are merged with default CC values and deduplicated.

## Why
Operations needs an internal confirmation trail whenever a purchase order is cancelled.

## Implementation
- Updated `app/api/send-po-cancellation-email/route.ts` to:
  - parse default CC from `quote_company_settings.po_default_cc_email`
  - merge with request `cc`
  - dedupe normalized addresses
  - use merged list for outgoing cancellation emails and `purchase_order_emails.cc_emails` logging

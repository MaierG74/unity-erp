---
title: Purchasing — PO Detail UI Polish
date: 2025-10-20
---

Summary of UX improvements on the purchase order detail page.

Changes
- Sticky header with breadcrumbs, title, status badge, and action cluster.
- Compact summary bar (status, total items, total amount, PO number).
- Two‑column details/summary layout retained; stronger typography.
- Items table polish: zebra striping, right-aligned numerics, inline per-row “Receive”, plus aligned totals row beneath the lines.
- Empty-state for receipt history with guidance.
- Sticky action bar now opens a “Send Supplier Emails” dialog so approvers can review/override each recipient address, add CCs, and then dispatch (emails still fall back to any supplier contact if no primary).
- Supplier email template now mirrors the quote design and automatically injects the logo, addresses, and terms from Settings, so suppliers receive the same branded artifacts as customers.
- Cleaned up the supplier email body for the purchasing workflow (removed order summary block and customer-facing terms, widened line descriptions for readability).

Files
- `app/purchasing/purchase-orders/[id]/page.tsx`

Notes
- Inline receipt uses the existing `receiveStock` flow and invalidates cache keys for PO, list, and inventory.
- Alert on approval was replaced earlier with toasts that summarize email results.

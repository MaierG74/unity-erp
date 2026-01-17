# Dev Server Troubleshooting

## Inventory page build timeout (ETIMEDOUT)

**Date:** 2026-01-15

**Symptom:** `/inventory` fails to compile with a timeout when starting the Next.js dev server.

**Root cause:** `@react-pdf/renderer` pulled into the client bundle (via `ManualStockIssueTab`) brings in `jay-peg/pdfkit` which attempts a network read during build, causing `ETIMEDOUT`.

**Fast unblock (applied):**
- Remove static imports of `@react-pdf/renderer` and `ManualIssuancePDFDocument`.
- Lazy-load both modules inside the PDF handlers so the inventory page compiles without bundling PDF code up front.

```ts
const [{ pdf }, { ManualIssuancePDFDocument }] = await Promise.all([
  import('@react-pdf/renderer'),
  import('./ManualIssuancePDF'),
]);
```

**Revert (if needed):**
1. Restore static imports at the top of `ManualStockIssueTab.tsx`.
2. Remove the lazy-import block inside the PDF handlers.
3. Restart the dev server.

**Longer-term fix:**
Move PDF generation into a server-only API route (returning a PDF blob) so `@react-pdf/renderer` never enters the browser bundle.

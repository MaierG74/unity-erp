# Job Card Drawings - Audit Report

## Lane A - Issuance paths

| File:line | How card is created | Sets work_pool_id? | Sets drawing_url? | Notes |
|---|---|---|---|---|
| `components/features/orders/JobCardsTab.tsx:1613` | Order-page Issue Card button calls RPC `issue_job_card_from_pool`. | Yes | Yes | Latest repo migration is `supabase/migrations/20260506121000_issue_job_card_drawing_resolve.sql`, which inserts `work_pool_id` and resolves `drawing_url` by `order_detail_drawings` override, then `billoflabour.drawing_url`, then `products.configurator_drawing_url` when `billoflabour.use_product_drawing` is true. Deployed body needs reviewer DB check because Supabase MCP returned unauthorized. |
| `components/labor-planning/staff-lane-list.tsx:306` | Planned scheduler issuance calls RPC `issue_job_card_from_pool`. | Yes | Yes | Same RPC path as above. Static migration body is drawing-aware; deployed body needs reviewer DB check. |
| `components/labor-planning/staff-lane-list.tsx:456` | Scheduler fallback split branch creates a new `job_cards` row, decrements a source `job_card_items` row, then directly inserts a new `job_card_items` row. | No | No | Insert payload includes `job_card_id`, `product_id`, `job_id`, `quantity`, `piece_rate`, and `status` only. The preceding source-item select at `components/labor-planning/staff-lane-list.tsx:405` also omits `work_pool_id` and `drawing_url`, so this branch cannot preserve either field. This is POL-99. |
| `components/labor-planning/staff-lane-list.tsx:476` | Scheduler fallback full-balance branch creates a new `job_cards` row and moves an existing `job_card_items` row to that card with `update({ job_card_id })`. | Preserved if already present | Preserved if already present | This path does not resolve drawings itself, but because it moves the existing row it preserves any existing `work_pool_id` and `drawing_url`; if the source row was legacy/direct and blank, it remains blank. |
| `components/labor-planning/staff-lane-list.tsx:493` | Scheduler fallback fresh branch creates a new `job_cards` row and directly inserts a new `job_card_items` row. | No | No | Insert payload includes `job_card_id`, `product_id`, `job_id`, `quantity`, `piece_rate`, and `status` only. This is also part of POL-99. |
| `app/staff/job-cards/new/page.tsx:210` | Manual new job-card page creates `job_cards`, maps form rows to `jobCardItems`, then directly inserts `job_card_items`. | No | No | `jobCardItems` at `app/staff/job-cards/new/page.tsx:201` includes product/job/quantity/rate/status only; there is no work-pool link and no drawing resolution. |
| `lib/piecework/__tests__/cuttingPlanWorkPool.integration.test.ts:379` | Integration test fixture directly inserts an issued `job_card_items` row. | Yes | No | Test-only fixture sets `work_pool_id` to exercise issued-pool reconciliation; it does not model drawing snapshots. |
| `supabase/migrations/20260506121000_issue_job_card_drawing_resolve.sql:1` | Latest repo definition of `issue_job_card_from_pool`. | Yes | Yes | Inserts `job_card_items (..., work_pool_id, drawing_url)` at line 103 after the 3-tier drawing lookup at lines 81-99. This overrides the older `20260305195332_create_job_work_pool.sql` function. Deployed body needs reviewer DB check because Supabase MCP returned unauthorized. |
| `supabase/migrations/20260305195332_create_job_work_pool.sql:358` | Older repo definition of `issue_job_card_from_pool`. | Yes | No | Superseded by the 20260506121000 migration; included here because SQL grep surfaces it. |
| `supabase/migrations/20260311072949_reconcile_complete_assignment_with_card_rpc.sql:5` | `complete_assignment_with_card` completion RPC. | N/A | N/A | Does not create `job_card_items`; it only updates existing items and cards. Deployed body needs reviewer DB check. |
| `supabase/migrations/20260311073315_piecework_completion_payroll_phase1.sql:377` | `complete_assignment_with_card_v2` completion RPC. | N/A | N/A | Does not create `job_card_items`; it delegates card completion to `complete_job_card_v2`. Deployed body needs reviewer DB check. |

## Lane B - PDF render paths

| File:line | Inner Document | drawingUrl prop forwarded? | Conditional uses drawingUrl / items[].drawing_url / both? |
|---|---|---|---|
| `app/staff/job-cards/[id]/page.tsx:556` | `openJobCardPrintWindow` from `JobCardPDFDownload.tsx`, which builds `JobCardPDFDocument` from `JobCardPDFDocument.tsx`. | No | Final document supports both, but this auto-print call passes neither. The mapped item objects at lines 570-578 omit `drawing_url`, and no top-level `drawingUrl` is passed. |
| `app/staff/job-cards/[id]/page.tsx:734` | `JobCardPDFDownload` from `JobCardPDFDownload.tsx`, which builds `JobCardPDFDocument` from `JobCardPDFDocument.tsx`. | Yes | Both. The page maps `items[].drawing_url` at line 755 and also passes top-level `drawingUrl` at line 757. |
| `components/features/job-cards/JobCardPDFDownload.tsx:42` | Dynamically imports default `JobCardPDFDocument` from `JobCardPDFDocument.tsx`. | Yes | Both. `buildPDFBlob` declares `drawingUrl` at line 46 and forwards it to the document at line 60. |
| `components/features/job-cards/JobCardPDFDownload.tsx:67` | Calls `buildPDFBlob`, then opens the blob for print. | Yes | Both, if caller supplies either top-level `drawingUrl` or item-level `drawing_url`. |
| `components/features/job-cards/JobCardPDFDownload.tsx:87` | Calls `buildPDFBlob` for download and print. | Yes | Both, if caller supplies either top-level `drawingUrl` or item-level `drawing_url`. |
| `components/features/job-cards/JobCardPDFDocument.tsx:269` | Final current PDF document component. | N/A | Both. It resolves `drawingUrl ?? items.find((item) => item.drawing_url)?.drawing_url ?? null` at line 279 and renders when `resolvedDrawingUrl` is truthy at line 406. |
| `components/features/job-cards/JobCardPDF.tsx:285` | Legacy in-file `JobCardPDFDocument`. | N/A | `items[].drawing_url` only. It declares `drawing_url` on `JobCardItem` at line 267, finds the first item drawing at line 292, and renders it when present. |
| `components/features/job-cards/JobCardPDF.tsx:481` | Legacy in-file `JobCardPDFDownload` renders the legacy in-file `JobCardPDFDocument`. | No top-level prop exists | `items[].drawing_url` only. Its props interface at lines 467-479 declares `jobCard`, `items`, and `companyInfo`, not `drawingUrl`; it forwards only those props at lines 492-496, 539-543, and 561-565. No current app callsite imports this wrapper. |

Wrapper prop inventory:

| Wrapper file | Props declared | Props forwarded |
|---|---|---|
| `components/features/job-cards/JobCardPDFDownload.tsx` | `JobCardPDFDownloadProps`: `jobCard`, `items`, `companyInfo?`, `drawingUrl?`; `JobCardPDFPrintProps`: same. `buildPDFBlob` props: same. | `buildPDFBlob` forwards `jobCard`, `items`, `companyInfo`, generated `qrCodeDataUrl`, and `drawingUrl` to `JobCardPDFDocument`. `openJobCardPrintWindow` forwards all declared props to `buildPDFBlob`. |
| `components/features/job-cards/JobCardPDFDocument.tsx` | `JobCardPDFDocumentProps`: `jobCard`, `items`, `companyInfo?`, `qrCodeDataUrl?`, `drawingUrl?`. | Final document, no deeper wrapper. |
| `components/features/job-cards/JobCardPDF.tsx` | Legacy `JobCardPDFProps`: `jobCard`, `items`, `companyInfo?`; legacy `JobCardPDFDownloadProps`: same. | Legacy wrapper forwards only `jobCard`, `items`, and `companyInfo` to its in-file document. |

## Lane C - Drawing data flow

| File:line | Selects drawing_url? | Mapped into consumer? | Consumer type |
|---|---|---|---|
| `app/staff/job-cards/[id]/page.tsx:204` | Yes | Partially | Staff job-card detail fetch uses `*`, so `drawing_url` is present in `JobCardItem`. The visible download button maps it into PDF items and top-level `drawingUrl`, but the auto-print mapping at `app/staff/job-cards/[id]/page.tsx:570` drops it. |
| `app/staff/job-cards/[id]/page.tsx:267` | No | N/A | Status update path selects only `status` for auto-complete logic; not a PDF/drawing consumer. |
| `app/staff/job-cards/[id]/page.tsx:277` | Yes | N/A | Cancel path uses loaded `items` from the `*` query to collect `work_pool_id`; not a PDF/drawing consumer. |
| `app/staff/job-cards/[id]/page.tsx:351` | Yes | N/A | Reopen/status mutation uses `*`-loaded item data indirectly; not a PDF/drawing consumer. |
| `app/staff/job-cards/[id]/page.tsx:389` | Yes | N/A | Completion dialog uses loaded `items`; drawing is preserved in state but not relevant to completion. |
| `app/staff/job-cards/[id]/page.tsx:415` | Yes | Yes | Loaded item data is mapped into `JobCardPDFDownload`; normal button path preserves `drawing_url`. |
| `components/features/orders/JobCardsTab.tsx:350` | Yes | Yes | Order Job Cards tab explicitly selects `drawing_url` into `JobCardItemRow`; this is drawing-aware table data, not a PDF render path. |
| `components/features/orders/JobCardsTab.tsx:420` | Yes | No | Work-pool issuance-count query explicitly selects `drawing_url`, but aggregation only uses quantity/completed/status. It does not feed PDF output. |
| `components/labor-planning/staff-lane-list.tsx:405` | No | No | Source-item select for fallback issuance omits `drawing_url`; split inserts therefore cannot preserve the drawing snapshot. |
| `components/labor-planning/staff-lane-list.tsx:586` | No | No | Unissue/reverse lookup selects item fields needed for movement/cancellation only; if legacy rows are moved back, no drawing data is considered. |
| `components/labor-planning/staff-lane-list.tsx:598` | No | No | Same as above for target-card item lookup. |
| `components/labor-planning/staff-lane-list.tsx:619` | No | No | Same as above for fallback staff-card item lookup. |
| `lib/queries/laborPlanning.ts:698` | No | No | Scheduler work-pool aggregate query selects work-pool quantities/status only; not a PDF/drawing consumer. |
| `lib/queries/laborPlanning.ts:898` | No | No | Scheduler active-item query maps to `JobCardItemRow`, whose interface omits `drawing_url`; this feeds scheduler UI and fallback issuance context, not PDF. |
| `app/scan/jc/[id]/page.tsx:90` | No | No | QR scan job-card page item select and `JobCardItem` interface omit `drawing_url`; this page does not render PDFs, but it is a job-card UI that cannot display drawing state. |
| `app/staff/job-cards/new/page.tsx:210` | No | No | Manual creation constructs item objects without `drawing_url` before direct insert. |
| `app/payroll-review/page.tsx:654` | No | No | Payroll detail query omits `drawing_url`; not a PDF/drawing consumer. |
| `app/staff/payroll/page.tsx:136` | Yes | N/A | Legacy payroll query selects `*`; not a PDF/drawing consumer. |
| `lib/queries/factoryFloor.ts:135` | No | No | Completion-dialog item query omits `drawing_url`; not a PDF/drawing consumer. |
| `lib/assistant/manufacturing.ts:757` | No | No | Assistant manufacturing query omits `drawing_url`; not a PDF/drawing consumer. |
| `lib/orders/downstream-swap-exceptions.ts:212` | No | No | Downstream exception evidence query omits `drawing_url`; not a PDF/drawing consumer. |
| `app/api/order-details/[detailId]/route.ts:63` | No | No | Order-detail API issuance aggregate query omits `drawing_url`; not a PDF/drawing consumer. |
| `components/production/job-queue-table.tsx:43` | N/A | No | `JobCardItem` UI type omits `drawing_url`; this production queue UI is not PDF-specific. |
| `app/staff/job-cards/[id]/page.tsx:70` | N/A | Yes | `JobCardItem` includes `drawing_url`, and normal PDF mapping preserves it. |
| `app/scan/jc/[id]/page.tsx:44` | N/A | No | `JobCardItem` omits `drawing_url`; scan UI cannot preserve/display drawing state. |
| `components/features/orders/JobCardsTab.tsx:74` | N/A | Yes | `JobCardItemRow` includes `drawing_url`. |
| `lib/queries/laborPlanning.ts:850` | N/A | No | Scheduler `JobCardItemRow` omits `drawing_url`. |
| `lib/queries/factoryFloor.ts:121` | N/A | No | Completion `JobCardItemForCompletion` omits `drawing_url`. |
| `components/features/job-cards/JobCardPDFDocument.tsx:6` | N/A | Yes | `JobCardPDFItem` includes optional `drawing_url`. |
| `components/features/job-cards/JobCardPDF.tsx:260` | N/A | Yes | Legacy `JobCardItem` includes optional `drawing_url`. |
| `lib/assistant/manufacturing.ts:53` | N/A | No | Assistant relation type omits `drawing_url`; not a PDF/drawing consumer. |

## Findings - gaps that need fixing

1. `components/labor-planning/staff-lane-list.tsx:456` directly inserts split fallback job-card items without `work_pool_id` or `drawing_url`.
2. `components/labor-planning/staff-lane-list.tsx:493` directly inserts fresh fallback job-card items without `work_pool_id` or `drawing_url`.
3. `components/labor-planning/staff-lane-list.tsx:405` selects fallback source items without `work_pool_id` or `drawing_url`, so downstream fallback logic cannot preserve the snapshot even when a source item has one.
4. `app/staff/job-cards/[id]/page.tsx:556` calls `openJobCardPrintWindow` for the staff-page auto-print path without forwarding either top-level `drawingUrl` or item-level `drawing_url`.
5. `app/staff/job-cards/new/page.tsx:210` manually creates job-card items without `work_pool_id` or `drawing_url`.
6. `app/scan/jc/[id]/page.tsx:90` and `app/scan/jc/[id]/page.tsx:44` omit `drawing_url` from the scan-page item select and type, so the scan UI cannot consume drawing snapshots.
7. `lib/queries/laborPlanning.ts:898` and `lib/queries/laborPlanning.ts:850` omit `drawing_url` from scheduler item loading and typing, so scheduler code has no drawing snapshot data available outside the RPC path.
8. `components/features/job-cards/JobCardPDF.tsx:467` legacy PDF download props do not declare or forward a top-level `drawingUrl`; this is dormant today because current callsites use `JobCardPDFDownload.tsx`.
9. `supabase/migrations/20260506121000_issue_job_card_drawing_resolve.sql:1` could not be compared to the deployed `pg_proc.prosrc` body because Supabase MCP returned unauthorized; this needs reviewer DB check.

## Out of scope for this audit

- Storage bucket policies
- RLS policy wording on `order_detail_drawings`
- Configurator capture flow (the dom-to-image rewrite is in scope only insofar as `products.configurator_drawing_url` is the source-of-truth for tier-3 resolution)
- Cosmetic UI (cluttered radio layout, missing remove button - tracked separately as POL-97 and a Cowork chip)

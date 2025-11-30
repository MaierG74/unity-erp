# Receiving Inspection & Returns Documentation Plan

## Context & Goals
- **Why now:** Suppliers deliver goods with delivery notes and invoices. Operators need a clean way to reject defective units at the gate (before entering inventory) AND return goods later if defects are found after receiving. Currently there's no guaranteed paper/email trail for either scenario, making credit reconciliation difficult.
- **Scope:** Enhance the receiving inspection workflow to handle gate rejections, improve the Return Goods experience for later returns, and generate professional documentation (GRN PDFs + emails) for both scenarios to ensure supplier credit tracking.
- **Primary goals:**
  1. Enable rejection of defective units during receiving inspection (at the gate) without entering inventory, while documenting the rejection for credit protection.
  2. Make recording later returns (from stock) as quick as receiving stock (clear layout, inline validation, obvious remaining quantities).
  3. Generate professional "Goods Returned" PDFs (GRN format) containing product list, PO number, Goods Returned Number, signature blocks that can be signed by driver/operator.
  4. Prompt users to email suppliers immediately with documentation; track email, document, and signature status so history is unambiguous.

This plan builds on `docs/plans/supplier-returns-plan.md` and the schema/function already shipped in `supabase/migrations/20250102_create_supplier_returns.sql`.

## Current State
| Area | Status |
| --- | --- |
| **Receiving UI** | Basic receiving modal exists but lacks rejection workflow. No "Reject Qty" field, no GRN generation at gate, no signature collection prompt. Operators must receive all goods then manually return defective items later. |
| **Return Goods UI** | The Return Goods section (`app/purchasing/purchase-orders/[id]/page.tsx:1360-1491`) renders one card per line item with manual state tracking. No batching, no running totals, no doc/email hooks. |
| **Data** | `supplier_order_returns` table + `process_supplier_order_return` RPC exist. RPC currently decrements inventory for ALL return types (doesn't distinguish rejection vs later_return). No fields for documents, email status, or signature capture. |
| **Inventory Logic** | All returns currently decrement inventory regardless of `return_type`. Need conditional logic: rejections should skip inventory decrement (never entered stock), later returns should decrement (taking from stock). |
| **Docs & Emails** | Stock issuance already exports PDFs (`components/features/orders/StockIssuancePDF.tsx`) and purchasing emails suppliers via `app/api/send-purchase-order-email/route.ts`, but returns have no analogous assets. |

## Requirements

### A. Gate Rejection Requirements (Primary Use Case)
1. **Receiving Inspection Workflow**
   - Add "Reject Qty" field to receiving modal/workflow alongside "Receive Qty"
   - Display running totals: Ordered / Receiving / Rejecting / Balance
   - Inline validation prevents rejecting more than ordered, missing reasons
   - Support multi-component rejection in single receiving session
2. **Immediate Documentation**
   - Generate GRN automatically when rejections recorded during receiving
   - Show modal: "Print rejection slip for driver signature?" (Print / Email & Skip)
   - If Print: Open PDF in new tab, prompt for signed copy upload (now or later)
   - If Skip: Email supplier immediately with unsigned PDF
3. **Flexible Signature Collection**
   - Tier 1 (Ideal): Driver signs physical printout at gate → Upload signed PDF
   - Tier 2 (Acceptable): Email supplier unsigned PDF → Track acknowledgement
   - Tier 3 (Fallback): Operator signature only → Email supplier for records
   - Track signature status: None / Operator / Driver
4. **Inventory Accounting**
   - Rejections must NOT decrement inventory (goods never entered stock)
   - Create audit record and transaction for traceability
   - Update PO line totals: total_received excludes rejections

### B. Later Return Requirements (Secondary Use Case)
1. **Return Goods UI Refresh**
   - Break the section into a compact table (component, ordered, received, quantity to return, remaining balance) and a sidebar summary
   - Inline validation prevents over-returns, missing reasons, or empty submissions
   - Provide quick actions ("Return all received", "Clear row") to keep the workflow fast
   - Support multi-component returns with single GRN (batch returns)
2. **Inventory Accounting**
   - Later returns MUST decrement inventory (taking goods out of stock)
   - Create OUT transaction with SALE type (negative quantity)
   - Update PO line totals: total_received decreases

### C. Shared Requirements (Both Scenarios)
1. **Document Generation**
   - Produce a PDF per return/rejection batch containing: supplier info, Purchase Order number, Goods Returned Number (formatted `GRN-YY-####`), and per-component rows (code, description, quantity, reason)
   - Include two signature blocks (Operator, Supplier/Driver) plus dates
   - Auto-upload unsigned PDFs to Supabase Storage bucket `supplier-returns/{purchase_order_id}/{return_id}/auto.pdf`; allow uploading the signed copy later (`signed.pdf`)
   - Support multi-component batches (one GRN covers multiple components)
2. **Email Prompt & Tracking**
   - After successful return/rejection, display modal prompting email options
   - Include download link to PDF (not attachment for reliability)
   - Record `email_status` = `sent | skipped | failed`, `email_sent_at`, and optional `message_id`
   - Return history must surface this status so operators can see when a message was skipped
3. **History & Visibility**
   - Return history table should expose doc links, signature status, and email status badges
   - Provide filters to "break out" goods returned by component, supplier, or Goods Returned Number
   - Distinguish rejection vs later_return with badges
4. **Audit & Permissions**
   - Mirror the receiving activity log (user, timestamp, quantity, reason)
   - Permissions deferred to later phase; all authenticated users can process returns/rejections for MVP

## Technical Changes
### Backend & Schema
- Add columns to `supplier_order_returns`:
  - `document_url text`, `signed_document_url text`, `document_version smallint default 1`
  - `email_status text check (email_status in ('sent','skipped','failed'))`, `email_sent_at timestamptz`, `email_message_id text`
  - `goods_return_number text unique` (generated server-side)
  - `batch_id bigint` (REQUIRED for multi-component batches - one GRN per batch)
  - `signature_status text check (signature_status in ('none','operator','driver'))` default 'none'
- **Modify `process_supplier_order_return` RPC** to add conditional inventory logic:
  - Check `p_return_type` parameter ('rejection' vs 'later_return')
  - If 'rejection': Skip inventory decrement (goods never entered stock), create audit record only
  - If 'later_return': Decrement inventory (current behavior - taking goods out of stock)
  - Accept additional parameters: `p_goods_return_number`, `p_document_url`, `p_batch_id`, `p_signature_status`
  - Return the inserted row with all fields for client use
  - Emit errors if upstream validation fails (over-return, missing required fields)
- Create helper function `generate_goods_return_number(p_purchase_order_id)` to format `GRN-25-0004` with atomic sequence
- Create storage bucket `supplier-returns` + policies (read/write for authenticated users, defer role-based restrictions)
- Add `supplier_return_events` audit table triggered AFTER INSERT/UPDATE for traceability (optional - can defer)

### UI & Client
1. **Receiving Inspection Workflow** (NEW - Priority 1)
   - Enhance receiving modal to include "Reject Qty" field alongside "Receive Qty"
   - Display running totals: Ordered / Receiving / Rejecting / Balance
   - Validate: receiving + rejecting <= ordered, both >= 0
   - Add "Rejection Reason" dropdown/field (same catalog as returns)
   - Support multi-component receiving + rejections in single session
   - After receiving submission, if rejections exist:
     - Generate GRN via helper function
     - Call RPC with `return_type='rejection'` for each rejected component
     - Trigger document generation workflow (same as returns)
     - Show signature collection modal (Print / Email & Skip)

2. **Return Builder** (Later Return UI)
   - Replace card list with a table-driven form managed by `react-hook-form` or Zod for validation
   - Show "Remaining after return" column (calc = `total_received - quantity_to_return`)
   - Provide a summary sidebar with totals, next actions (Generate Doc, Email Supplier)
   - Support multi-component batch returns (single GRN)

3. **Mutation Orchestration** (Shared for both rejection + return)
   - `handleReturnSubmit` pipeline:
     1. Generate GRN number (call helper function or API route)
     2. Call RPC to record return/rejection + get `return_id` & `goods_return_number`
        - Pass `return_type='rejection'` for gate rejections
        - Pass `return_type='later_return'` for returns from stock
     3. Call Next.js API route to render PDF (server-side) and upload to Storage
     4. PATCH `supplier_order_returns` with `document_url`
     5. Show signature collection modal (Print / Email & Skip)
     6. If email accepted, call `/api/supplier-returns/[id]/send-email` with PDF download link

4. **Signature Collection Modal** (NEW)
   - Show after successful return/rejection
   - Options: "Print for Signature" / "Email & Skip"
   - If Print: Open PDF in new tab, show "Upload signed copy now?" prompt
   - If Skip: Immediately send email with unsigned PDF
   - Track signature status throughout workflow

5. **Email Workflow**
   - Build React Email template `emails/supplier-return-email.tsx` (header, items, next steps)
   - API route loads PO + supplier context, includes PDF download link (NOT attachment)
   - Updates email status fields in DB
   - Supports manual resend

6. **Return History Enhancements**
   - Add column grouping: Goods Returned #, Type (Rejection/Return), Qty, Reason, Document (View/Upload), Email status, Signature status
   - Provide filter/search controls (component code, GRN, supplier, type) at top of section
   - Badge for rejection vs later_return

7. **Status Badges & Empty States**
   - When no email sent, show "Not Sent" badge plus "Send now" button
   - When signed doc missing, show warning icon + upload CTA
   - Signature status badge: "Signed (Driver)" / "Signed (Operator)" / "Unsigned"

## Implementation Phases

### Phase 0 – Design Alignment & Prerequisites
- Produce wireframes covering receiving inspection, signature modal, and enhanced history table
- Confirm goods return numbering format with operations (GRN-YY-####)
- Confirm rejection reason catalog aligns with later return reasons

### Phase 1 – Schema & Storage (Foundation)
**Priority: CRITICAL - Blocks all other work**
- Migration for new `supplier_order_returns` columns:
  - `document_url`, `signed_document_url`, `document_version`
  - `email_status`, `email_sent_at`, `email_message_id`
  - `goods_return_number` (unique)
  - `batch_id` (required for multi-component batches)
  - `signature_status` (none/operator/driver)
- Create helper function `generate_goods_return_number(p_purchase_order_id)` with atomic sequence
- **Modify `process_supplier_order_return` RPC** to add conditional inventory logic:
  - If `return_type='rejection'`: Skip inventory decrement, create audit record only
  - If `return_type='later_return'`: Decrement inventory (current behavior)
  - Accept new parameters: `p_goods_return_number`, `p_batch_id`, `p_signature_status`
- Create `supplier-returns` storage bucket + policies (authenticated read/write)
- Unit tests for RPC changes (ensure rejection doesn't touch inventory, later_return does)

### Phase 2 – Receiving Inspection UI (Gate Rejections)
**Priority: HIGH - Primary use case**
- Enhance receiving modal to add "Reject Qty" field alongside "Receive Qty"
- Add rejection reason dropdown (shared with return reasons)
- Display running totals: Ordered / Receiving / Rejecting / Balance
- Validate: receiving + rejecting <= ordered
- Support multi-component receiving + rejection in single session
- Wire up rejection workflow:
  - Generate GRN when rejections exist
  - Call RPC with `return_type='rejection'`
  - Trigger document + email workflow

### Phase 3 – RPC Integration & Testing
**Priority: HIGH - Ensures data integrity**
- Test conditional inventory logic end-to-end:
  - Rejection: Verify inventory NOT decremented
  - Later return: Verify inventory IS decremented
- Test GRN generation (uniqueness, format, sequence)
- Test batch_id grouping for multi-component scenarios
- Verify total_received calculations

### Phase 4 – Document Generation (Shared Infrastructure)
**Priority: MEDIUM - Needed for both workflows**
- Implement `ReturnGoodsPDFDocument.tsx` via `@react-pdf/renderer`
  - Template based on `StockIssuancePDF.tsx` pattern
  - Include: supplier info, PO number, GRN, component rows, signature blocks
  - Support multi-component batches (one PDF per GRN)
- Create API route `/api/supplier-returns/[returnId]/document`
  - Server-side PDF rendering
  - Upload to Supabase Storage
  - Return document URL
- Hook UI to download/view/print documents

### Phase 5 – Signature Collection Workflow
**Priority: MEDIUM - Critical for gate rejections**
- Build signature collection modal
  - Options: "Print for Signature" / "Email & Skip"
  - Show after successful return/rejection
- If Print: Open PDF in new tab, prompt for signed copy upload (now/later)
- If Skip: Proceed directly to email
- Add signed copy upload functionality
  - Upload to `signed.pdf` path
  - Update `signature_status` field
  - Update `signed_document_url`

### Phase 6 – Email & Prompt (Shared Infrastructure)
**Priority: MEDIUM - Needed for both workflows**
- Build React Email template `emails/supplier-return-email.tsx`
  - Header with supplier info, PO number, GRN
  - Component rows with quantities and reasons
  - Download link to PDF (NOT attachment)
  - Next steps / contact info
- Create API route `/api/supplier-returns/[id]/send-email`
  - Load PO + supplier context
  - Send email with PDF download link
  - Update `email_status`, `email_sent_at`, `email_message_id`
  - Handle failures gracefully
- Add manual resend button in history

### Phase 7 – Later Returns UI Enhancement
**Priority: LOW - Secondary use case, existing UI functional**
- Replace card list with table-based Return Builder
- Add summary sidebar with totals
- Add "Remaining after return" column
- Support multi-component batch returns (single GRN)
- Add quick actions ("Return all received", "Clear row")
- Wire up same document + email workflow as rejections

### Phase 8 – History & Filters (Polish)
**Priority: LOW - Nice to have**
- Enhance Return History table:
  - Add columns: GRN, Type (badge), Document (View/Upload), Email Status, Signature Status
  - Filter controls: component, GRN, supplier, type (rejection/return)
  - Search by GRN or component code
- Status badges with color coding
- Empty states with CTAs ("Send email now", "Upload signed copy")
- Export to CSV (optional)

### Phase 9 – QA & Documentation
**Priority: ONGOING - Quality gates**
- End-to-end tests:
  - Gate rejection with driver signature (print workflow)
  - Gate rejection without signature (email & skip workflow)
  - Later return with email sent
  - Later return with email skipped
  - Multi-component batch (single GRN)
  - PDF generation failure fallback
  - Email sending failure fallback
- Update documentation:
  - `docs/domains/purchasing/purchasing-master.md` - Add receiving inspection + returns workflows
  - `docs/operations/email-integration.md` - Add supplier return email pattern
  - Add operational guide for operators (when to reject vs return)

## Open Questions

### Resolved ✅
1. **Roles/Permissions:** ✅ **DEFERRED** - All authenticated users can process returns/rejections for MVP. Role-based restrictions to be added in later phase.
2. **Batching:** ✅ **REQUIRED** - Multi-component batches supported from day one (one GRN per return/rejection action, can include multiple components).
3. **Email Attachments:** ✅ **DOWNLOAD LINKS** - Include PDF download link in email, not direct attachment (more reliable, smaller emails).
4. **Signature Collection:** ✅ **FLEXIBLE APPROACH** - Prefer driver signature at gate (print workflow), fall back to operator signature + email acknowledgement. Support upload of signed copy (no e-sign for MVP).

### Open (For Discussion)
1. **Return Reason Catalog:** Stick with current dropdown or move reasons into a managed table for reporting/translation? Recommend keeping dropdown for MVP, migrate to table later if needed.
2. **Invoice Reconciliation Integration:** Should we track credit memo issuance and link to rejections/returns? Or keep this in separate accounting workflow? Recommend tracking in comments/notes for MVP, formal integration later.
3. **Rejection at Different Stages:** Currently focused on gate rejection (during delivery). Should we support rejection during other stages (e.g., QC inspection days later)? Recommend gate-only for MVP.
4. **Audit Table:** `supplier_return_events` audit table for traceability - implement now or defer? Recommend defer unless compliance requires it.

## Operational Guidance

### When to Use Rejection vs. Later Return

**Use "Rejection" (at gate) when:**
- Defects found during delivery inspection (goods never enter warehouse)
- Quantity mismatch (ordered 10, received 8 - reject shortfall)
- Wrong items delivered (incorrect part number, color, spec)
- Visible damage to packaging or product
- Missing documentation (certs, test reports, etc.)
- Driver is still on-site and can take items back

**Use "Later Return" (from stock) when:**
- Defect discovered after goods entered inventory
- Quality control failure detected during production
- Compatibility issue found during assembly
- Excess stock being returned per supplier agreement
- Driver already left - goods were received initially

### Signature Collection Best Practices

**Tier 1 - Driver Signature (Strongest Documentation):**
1. Operator processes rejection during receiving
2. System generates GRN and PDF
3. Operator selects "Print for Signature"
4. PDF opens in new tab, operator prints
5. Driver signs physical copy acknowledging rejection
6. Operator scans/photos signed copy
7. Upload to system via "Upload Signed Copy" button
8. System emails supplier with signed PDF link

**Tier 2 - Email Acknowledgement (Acceptable):**
1. Operator processes rejection during receiving
2. System generates GRN and PDF
3. Operator selects "Email & Skip" (no time for signature)
4. System immediately emails supplier with unsigned PDF
5. Supplier replies to email confirming receipt
6. Operator can forward supplier reply to accounting for credit tracking

**Tier 3 - Operator Signature Only (Fallback):**
1. Operator processes rejection during receiving
2. System generates GRN and PDF
3. Driver refuses to sign or already left
4. Operator prints PDF and signs themselves
5. Upload signed copy (operator signature)
6. System emails supplier with operator-signed PDF
7. Note in comments: "Driver declined signature"

### Documentation Quality Tracking

The system tracks signature status to help prioritize follow-up:

- **"Signed (Driver)"** - Gold standard, strongest proof
- **"Signed (Operator)"** - Acceptable, note driver unavailable
- **"Unsigned - Email Sent"** - Supplier notified, awaiting acknowledgement
- **"Unsigned - Not Sent"** - ACTION REQUIRED: Send email ASAP

**Recommended SOP:**
- Aim for driver signature on 70%+ of gate rejections
- All rejections must be emailed within 2 minutes of recording
- Upload signed copies within same shift when possible
- Follow up on "Not Sent" rejections daily

### Credit Reconciliation Workflow

1. Operator rejects goods and generates GRN documentation
2. System emails supplier with PDF proof
3. Accounting receives copy of GRN (via email or system access)
4. When supplier invoice arrives, check for credit or deduction
5. If credit missing, reference GRN number and email sent date
6. Escalate to supplier with PDF proof
7. Track credit memo issuance in accounting system (external to ERP for MVP)

## Success Metrics

### Process Efficiency
- Time to record a rejection at gate (target < 2 minutes including signature collection)
- Time to record a later return (target < 30 seconds for single component)
- Time from rejection/return recorded to email sent (target < 2 minutes)
- % of rejections processed during receiving inspection vs. later returns (target: 80% at gate, 20% later)

### Documentation Quality
- 100% of rejections/returns have auto-generated PDF stored
- ≥70% of gate rejections have driver signature captured
- ≥80% of signed copies uploaded within same shift (8 hours)
- 100% of rejections/returns either have "Email Sent" or "Email Skipped (operator choice)" displayed

### Data Integrity
- Zero incidents of inventory discrepancies due to rejection/return accounting errors
- Zero incidents of rejections incorrectly decrementing inventory
- Zero incidents of later returns failing to decrement inventory
- 100% of GRN numbers unique and sequential

### Operational Impact
- Zero credit disputes due to missing documentation (GRN + email proof available)
- ≥90% of suppliers acknowledge receipt of rejection email within 48 hours
- Reduction in time to resolve credit issues (baseline TBD, track post-launch)

## References

### Current Implementation
- **Purchase Order detail page:** [app/purchasing/purchase-orders/[id]/page.tsx](../../../app/purchasing/purchase-orders/[id]/page.tsx)
  - Receiving workflow (lines ~400-600, needs rejection field enhancement)
  - Return Goods section (lines 1360-1491, needs table-based UI)
  - Return history display (lines 1493-1574, needs enhanced columns)
- **RPC & schema:** [supabase/migrations/20250102_create_supplier_returns.sql](../../../supabase/migrations/20250102_create_supplier_returns.sql)
  - Existing `supplier_order_returns` table structure
  - `process_supplier_order_return` RPC function (needs conditional inventory logic)

### Patterns to Follow
- **PDF generation:** [components/features/orders/StockIssuancePDF.tsx](../../../components/features/orders/StockIssuancePDF.tsx)
  - Uses `@react-pdf/renderer`
  - Server-side rendering pattern
  - Download and print support
- **Email sending:** [app/api/send-purchase-order-email/route.ts](../../../app/api/send-purchase-order-email/route.ts)
  - Resend SDK integration
  - Batch sending with per-supplier results
  - Message ID tracking
- **Email template:** [emails/purchase-order-email.tsx](../../../emails/purchase-order-email.tsx)
  - React Email components
  - Company branding
  - Responsive table layout

### Related Documentation
- **Baseline plan:** [docs/plans/supplier-returns-plan.md](./supplier-returns-plan.md)
- **Email integration:** [docs/operations/email-integration.md](../operations/email-integration.md)
- **Purchasing domain:** [docs/domains/purchasing/purchasing-master.md](../domains/purchasing/purchasing-master.md) (update after implementation)

### Assets to Create
- `emails/supplier-return-email.tsx` - Email template for rejection/return notifications
- `components/features/purchasing/ReturnGoodsPDFDocument.tsx` - PDF component for GRN
- `app/api/supplier-returns/[returnId]/document/route.ts` - PDF generation API
- `app/api/supplier-returns/[id]/send-email/route.ts` - Email sending API
- Storage bucket: `supplier-returns` (create in Supabase dashboard)
- Migration: `YYYYMMDD_enhance_supplier_returns.sql` (schema changes from Phase 1)

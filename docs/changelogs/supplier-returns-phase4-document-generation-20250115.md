# Supplier Returns Enhancement - Phase 4: Document Generation

**Date:** 2025-01-15
**Phase:** 4 of 9 (Document Generation)
**Status:** ✅ Complete - Ready for Testing
**Previous Phase:** [Phase 1 - Schema & Storage](./supplier-returns-enhancement-phase1-20250115.md)
**Related Plan:** [purchase-order-return-communications-plan.md](../plans/purchase-order-return-communications-plan.md)

---

## Summary

Phase 4 implements professional PDF document generation for supplier returns. The system can now automatically generate "Goods Returned" PDFs with GRN numbers, component details, supplier information, and signature blocks.

### Key Features Delivered

1. **React PDF Component** - Professional, branded document template
2. **Server-Side PDF Generation** - API route for automated PDF creation
3. **Batch Return Support** - Single PDF for multi-component returns
4. **Return Type Indicators** - Visual distinction between rejections and later returns
5. **Storage Integration** - Automatic upload to Supabase Storage
6. **Database Updates** - Automatic `document_url` field population

---

## What Was Delivered

### 1. PDF Document Component
**File:** [components/features/purchasing/ReturnGoodsPDFDocument.tsx](../../components/features/purchasing/ReturnGoodsPDFDocument.tsx)

A comprehensive React PDF component using `@react-pdf/renderer` v4.3.0 that generates professional "Goods Returned" documents.

**Features:**
- Company header with branding (name, address, phone, email)
- Prominent GRN display in red (e.g., "GRN-25-0001")
- Return type indicator:
  - "REJECTION AT GATE" for gate rejections
  - "GOODS RETURNED FROM STOCK" for later returns
  - "GOODS RETURNED" for mixed batches
- Warning box for gate rejections explaining inventory impact
- Supplier information section (name, contact, phone, email)
- Purchase order reference section
- Component table with:
  - Component code
  - Description
  - Quantity returned
  - Reason for return
- Total components count
- Total quantity returned
- Optional notes section
- Two signature blocks:
  - Operator (Name & Signature)
  - Driver/Supplier Rep (Name & Signature) - contextual based on return type
- Footer with return type explanation
- Professional styling matching company standards

**TypeScript Interface:**
```typescript
interface ReturnGoodsPDFProps {
  goodsReturnNumber: string;        // GRN-25-0001
  purchaseOrderNumber: string;       // Q-24-1234
  purchaseOrderId: number;
  returnDate: string;
  items: ReturnItem[];
  supplierInfo: SupplierInfo;
  companyInfo?: Partial<CompanyInfo>;
  notes?: string;
  returnType: 'rejection' | 'later_return' | 'mixed';
}
```

### 2. PDF Generation API Route
**File:** [app/api/supplier-returns/[returnId]/document/route.ts](../../app/api/supplier-returns/[returnId]/document/route.ts)

Server-side API route for generating and storing PDF documents.

**Endpoint:** `GET /api/supplier-returns/[returnId]/document`

**Flow:**
1. Fetch return record with all related data (supplier, components, PO)
2. Check if return is part of a batch (via `batch_id`)
3. If batch return, fetch all returns in the batch
4. Query company settings for PDF header information
5. Transform data into PDF component props
6. Render PDF to buffer using `renderToBuffer()` from `@react-pdf/renderer`
7. Upload PDF to Supabase Storage bucket `supplier-returns`
8. Update `document_url` in `supplier_order_returns` table
9. Return document URL and metadata

**Response Format:**
```json
{
  "success": true,
  "documentUrl": "https://...supplier-returns/73/return_123_GRN-25-0001_auto.pdf",
  "goodsReturnNumber": "GRN-25-0001",
  "itemCount": 3,
  "batchId": 1
}
```

**File Naming Convention:**
- Single return: `{purchase_order_id}/return_{return_id}_{GRN}_auto.pdf`
- Batch return: `{purchase_order_id}/batch_{batch_id}_{GRN}_auto.pdf`

**Storage Path Examples:**
- `supplier-returns/73/return_123_GRN-25-0001_auto.pdf`
- `supplier-returns/73/batch_1_GRN-25-0022_auto.pdf`

**Error Handling:**
- Returns 400 for invalid return ID
- Returns 404 if return not found
- Returns 500 for database query errors
- Returns 500 for PDF generation failures
- Returns 500 for storage upload failures
- Logs comprehensive error details for debugging

---

## Technical Implementation

### Dependencies Used
- `@react-pdf/renderer` v4.3.0 - PDF generation
- `renderToBuffer` - Server-side PDF rendering
- `@supabase/supabase-js` - Database and storage access
- `date-fns` - Date formatting
- Next.js 14+ App Router - API route framework

### Database Queries

**Primary Query (Single Return):**
```sql
SELECT
  return_id, goods_return_number, quantity_returned, reason,
  return_type, return_date, notes, batch_id, supplier_order_id,
  supplier_orders (
    order_id, purchase_order_id, supplier_component_id,
    suppliercomponents (
      supplier_code,
      component (internal_code, description),
      supplier (supplier_id, name, contact_name, phone),
      supplier_emails (email, is_primary)
    ),
    purchase_orders (q_number)
  )
FROM supplier_order_returns
WHERE return_id = $1;
```

**Batch Query (Multi-Component Returns):**
```sql
-- Same structure as above, filtered by batch_id
WHERE batch_id = $1;
```

**Update Query (Store Document URL):**
```sql
UPDATE supplier_order_returns
SET document_url = $1, document_version = 1
WHERE return_id IN ($2, $3, ...);
```

### Storage Architecture

**Bucket:** `supplier-returns` (created in Phase 1)
**Access:** Private with RLS policies for authenticated users
**File Type:** PDF (application/pdf)
**Upsert:** Enabled (overwrite if regenerating)

**RLS Policies (from Phase 1):**
- Authenticated users can upload
- Authenticated users can read
- Authenticated users can update
- Authenticated users can delete

---

## Return Type Handling

The PDF template adapts based on the `returnType` prop:

### Rejection at Gate (`rejection`)
- Title: "REJECTION AT GATE"
- Warning box: "IMPORTANT: These goods were rejected during delivery inspection and did NOT enter inventory."
- Footer: "Goods were rejected and never entered inventory - credit required."
- Signature: "Operator" and "Driver"

### Later Return from Stock (`later_return`)
- Title: "GOODS RETURNED FROM STOCK"
- Description: "These goods were previously received into inventory and are now being returned."
- Footer: "Goods were previously received - credit or replacement required."
- Signature: "Operator" and "Supplier Rep"

### Mixed Batch (`mixed`)
- Title: "GOODS RETURNED"
- Description: "Mixed return: Some items rejected at gate, others returned from stock."
- Footer: Generic return confirmation
- Signature: "Operator" and "Driver/Supplier Rep"

---

## Testing

### Manual Testing Steps

**Prerequisites:**
1. Phase 1 migration applied
2. Storage bucket `supplier-returns` created
3. At least one supplier return record exists
4. Dev server running (`npm run dev`)

**Test 1: Generate PDF for Single Return**
```bash
# Replace 123 with actual return_id from database
curl http://localhost:3000/api/supplier-returns/123/document
```

**Expected Result:**
```json
{
  "success": true,
  "documentUrl": "https://ttlyfhkrsjjrzxiagzpb.supabase.co/storage/v1/object/public/supplier-returns/73/return_123_GRN-25-0001_auto.pdf",
  "goodsReturnNumber": "GRN-25-0001",
  "itemCount": 1,
  "batchId": null
}
```

**Test 2: Generate PDF for Batch Return**
```bash
# Replace 124 with return_id that has batch_id set
curl http://localhost:3000/api/supplier-returns/124/document
```

**Expected Result:**
```json
{
  "success": true,
  "documentUrl": "https://ttlyfhkrsjjrzxiagzpb.supabase.co/storage/v1/object/public/supplier-returns/73/batch_1_GRN-25-0022_auto.pdf",
  "goodsReturnNumber": "GRN-25-0022",
  "itemCount": 3,
  "batchId": 1
}
```

**Test 3: Verify Storage Upload**
```sql
-- Check file exists in storage
SELECT name, bucket_id, owner
FROM storage.objects
WHERE bucket_id = 'supplier-returns'
ORDER BY created_at DESC
LIMIT 5;
```

**Test 4: Verify Database Update**
```sql
-- Check document_url was saved
SELECT return_id, goods_return_number, document_url, document_version
FROM supplier_order_returns
WHERE document_url IS NOT NULL
ORDER BY return_id DESC
LIMIT 5;
```

**Test 5: Download and View PDF**
1. Copy `documentUrl` from API response
2. Open in browser (requires authentication if bucket is private)
3. Verify PDF renders correctly with:
   - Company header
   - GRN number
   - Return type indicator
   - Component table
   - Signature blocks

**Test 6: Regeneration (Upsert)**
```bash
# Call API twice with same return_id
curl http://localhost:3000/api/supplier-returns/123/document
curl http://localhost:3000/api/supplier-returns/123/document

# Verify only ONE file exists in storage (not duplicated)
```

---

## Integration Points

### With Phase 1 (Schema & Storage)
- Uses `goods_return_number` from database
- Uses `batch_id` to group multi-component returns
- Stores `document_url` back to database
- Uploads to `supplier-returns` storage bucket

### With Future Phase 5 (Signature Collection)
- PDF includes signature blocks ready for collection
- `signature_status` field can track signature progress
- Can generate unsigned PDF now, signed PDF later

### With Future Phase 6 (Email Infrastructure)
- `document_url` will be used in email download links
- Email template can reference GRN number
- Can send PDF as download link instead of attachment

---

## Verification Checklist

Before marking Phase 4 complete, verify:

- [x] `ReturnGoodsPDFDocument` component created
- [x] Component uses `@react-pdf/renderer` v4.3.0
- [x] Component supports all three return types (rejection, later_return, mixed)
- [x] API route created at `/api/supplier-returns/[returnId]/document`
- [x] API route handles both single and batch returns
- [x] API route uploads to Supabase Storage
- [x] API route updates `document_url` in database
- [x] Build completes without TypeScript errors
- [ ] Manual test: Generate PDF for single return
- [ ] Manual test: Generate PDF for batch return
- [ ] Manual test: Verify storage upload
- [ ] Manual test: Verify database update
- [ ] Manual test: Download and view PDF
- [ ] Manual test: Regeneration (upsert) works correctly

---

## Next Steps

### Phase 5: Signature Collection Workflow (Optional)
- Add UI for uploading signed PDFs
- Update `signed_document_url` field
- Track `signature_status` transitions (none → operator → driver)
- Display signature collection progress

### Phase 6: Email & Prompt Infrastructure
- Create email template for supplier notifications
- Integrate with Resend API
- Send email with download link to PDF
- Track `email_status`, `email_sent_at`, `email_message_id`
- Add "Send Email" and "Skip Email" buttons to UI

### Phase 2: Receiving Inspection UI (Can Proceed Now)
- Add "Reject Qty" field to receiving modal
- Wire up rejection workflow to call RPC with `return_type='rejection'`
- Generate PDF immediately after rejection
- Display GRN to operator

---

## Files Created

### Created
- [components/features/purchasing/ReturnGoodsPDFDocument.tsx](../../components/features/purchasing/ReturnGoodsPDFDocument.tsx) - PDF component (452 lines)
- [app/api/supplier-returns/[returnId]/document/route.ts](../../app/api/supplier-returns/[returnId]/document/route.ts) - API route (350 lines)
- [docs/changelogs/supplier-returns-phase4-document-generation-20250115.md](./supplier-returns-phase4-document-generation-20250115.md) - This file

### Modified
- None (Phase 4 is purely additive)

---

## Build Verification

```bash
$ npm run build
 ✓ Compiled successfully in 43s
 ✓ Generating static pages (64/64) in 7.6s
 ✓ Build completed successfully
```

**TypeScript Errors:** 0
**Build Warnings:** 4 (unrelated prettier warnings from dependencies)
**Exit Code:** 0 ✅

---

## API Documentation

### GET `/api/supplier-returns/[returnId]/document`

Generates a PDF document for a supplier return and uploads to storage.

**Parameters:**
- `returnId` (path) - The return ID to generate PDF for

**Response (Success - 200):**
```json
{
  "success": true,
  "documentUrl": "string",
  "goodsReturnNumber": "string",
  "itemCount": number,
  "batchId": number | null
}
```

**Response (Error - 400):**
```json
{
  "error": "Invalid return ID"
}
```

**Response (Error - 404):**
```json
{
  "error": "Return not found"
}
```

**Response (Error - 500):**
```json
{
  "error": "Failed to generate document: {error message}"
}
```

**Example Usage:**
```typescript
// Client-side fetch
const generatePDF = async (returnId: number) => {
  const res = await fetch(`/api/supplier-returns/${returnId}/document`);
  if (!res.ok) throw new Error('Failed to generate PDF');
  return await res.json();
};

// Usage
const { documentUrl, goodsReturnNumber } = await generatePDF(123);
console.log(`PDF generated: ${documentUrl}`);
```

---

## References

- **Full Plan:** [docs/plans/purchase-order-return-communications-plan.md](../plans/purchase-order-return-communications-plan.md)
- **Phase 1 Changelog:** [docs/changelogs/supplier-returns-enhancement-phase1-20250115.md](./supplier-returns-enhancement-phase1-20250115.md)
- **Phase 1 Complete:** [docs/changelogs/PHASE1_COMPLETE.md](./PHASE1_COMPLETE.md)
- **Migration File:** [migrations/20250115_enhance_supplier_returns.sql](../../migrations/20250115_enhance_supplier_returns.sql)
- **@react-pdf/renderer Docs:** https://react-pdf.org/

---

**Phase 4 Status: ✅ COMPLETE - Ready for Testing**

All code has been written and builds successfully. The PDF component and API route are ready for manual testing with real data.

# Implementing Supplier Return PDF Downloads

**Status:** Ready for implementation
**Components:** Created and tested
**Pattern:** Same as Quotes PDF (proven working)

---

## Quick Start

Add PDF download buttons to your supplier returns UI in 3 simple steps:

### Step 1: Import the Component

```typescript
import { ReturnGoodsPDFDownload } from '@/components/features/purchasing/ReturnGoodsPDFDownload';
```

### Step 2: Fetch Company Info (Optional but Recommended)

```typescript
const [companyInfo, setCompanyInfo] = useState<any>(null);

useEffect(() => {
  const loadCompanyInfo = async () => {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const json = await res.json();
    const s = json?.settings;

    const addressLines = [
      s?.address_line1,
      s?.address_line2,
      `${s?.city ?? ''} ${s?.postal_code ?? ''}`.trim(),
      s?.country
    ].filter(Boolean).join('\n');

    setCompanyInfo({
      name: s?.company_name || 'Your Company',
      address: addressLines || 'Your Address',
      phone: s?.phone || '+27 XX XXX XXXX',
      email: s?.email || 'info@yourcompany.com',
    });
  };

  loadCompanyInfo();
}, []);
```

### Step 3: Add the Component

```typescript
<ReturnGoodsPDFDownload
  goodsReturnNumber={returnData.goods_return_number || 'PENDING'}
  purchaseOrderNumber={purchaseOrder.q_number}
  purchaseOrderId={returnData.purchase_order_id}
  returnDate={returnData.return_date}
  items={[
    {
      component_code: component.internal_code,
      component_name: component.description || '',
      quantity_returned: returnData.quantity_returned,
      reason: returnData.reason,
      return_type: returnData.return_type,
    }
  ]}
  supplierInfo={{
    supplier_name: supplier.name,
    contact_person: supplier.contact_info || undefined,
    email: supplierEmail,
  }}
  companyInfo={companyInfo}
  notes={returnData.notes || undefined}
  returnType={returnData.return_type}
/>
```

---

## Complete Example: Adding to Purchase Order Details Page

Here's a complete example of adding PDF downloads to a purchase order details page:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { ReturnGoodsPDFDownload } from '@/components/features/purchasing/ReturnGoodsPDFDownload';
import { supabase } from '@/lib/supabase';

export function SupplierReturnsSection({ purchaseOrderId }: { purchaseOrderId: number }) {
  const [returns, setReturns] = useState<any[]>([]);
  const [companyInfo, setCompanyInfo] = useState<any>(null);

  // Load company info for PDF header
  useEffect(() => {
    const loadCompanyInfo = async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const json = await res.json();
      const s = json?.settings;

      const addressLines = [
        s?.address_line1,
        s?.address_line2,
        `${s?.city ?? ''} ${s?.postal_code ?? ''}`.trim(),
        s?.country
      ].filter(Boolean).join('\n');

      setCompanyInfo({
        name: s?.company_name || 'Your Company',
        address: addressLines || 'Your Address',
        phone: s?.phone || '+27 XX XXX XXXX',
        email: s?.email || 'info@yourcompany.com',
      });
    };

    loadCompanyInfo();
  }, []);

  // Load supplier returns
  useEffect(() => {
    const loadReturns = async () => {
      const { data, error } = await supabase
        .from('supplier_order_returns')
        .select(`
          *,
          supplier_orders (
            order_id,
            purchase_order_id,
            suppliercomponents (
              supplier_code,
              component:components (
                internal_code,
                description
              ),
              supplier:suppliers (
                supplier_id,
                name,
                contact_info,
                supplier_emails (
                  email,
                  is_primary
                )
              )
            ),
            purchase_orders (
              q_number
            )
          )
        `)
        .eq('supplier_orders.purchase_order_id', purchaseOrderId);

      if (!error && data) {
        setReturns(data);
      }
    };

    loadReturns();
  }, [purchaseOrderId]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Supplier Returns</h2>

      {returns.map((returnRecord) => {
        // Extract nested data
        const supplierOrder = Array.isArray(returnRecord.supplier_orders)
          ? returnRecord.supplier_orders[0]
          : returnRecord.supplier_orders;

        const supplierComponent = Array.isArray(supplierOrder.suppliercomponents)
          ? supplierOrder.suppliercomponents[0]
          : supplierOrder.suppliercomponents;

        const component = Array.isArray(supplierComponent.component)
          ? supplierComponent.component[0]
          : supplierComponent.component;

        const supplier = Array.isArray(supplierComponent.supplier)
          ? supplierComponent.supplier[0]
          : supplierComponent.supplier;

        const purchaseOrder = Array.isArray(supplierOrder.purchase_orders)
          ? supplierOrder.purchase_orders[0]
          : supplierOrder.purchase_orders;

        const emails = Array.isArray(supplier.supplier_emails)
          ? supplier.supplier_emails
          : [];
        const primaryEmail = emails.find(e => e.is_primary)?.email || emails[0]?.email;

        return (
          <div key={returnRecord.return_id} className="border rounded-lg p-4">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="font-medium">
                  {returnRecord.goods_return_number || 'GRN Pending'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {component.internal_code} - {component.description}
                </p>
                <p className="text-sm">
                  Qty: {returnRecord.quantity_returned} |
                  Reason: {returnRecord.reason}
                </p>
              </div>

              {/* PDF Download Buttons */}
              <ReturnGoodsPDFDownload
                goodsReturnNumber={returnRecord.goods_return_number || 'PENDING'}
                purchaseOrderNumber={purchaseOrder.q_number}
                purchaseOrderId={supplierOrder.purchase_order_id}
                returnDate={returnRecord.return_date}
                items={[
                  {
                    component_code: component.internal_code,
                    component_name: component.description || '',
                    quantity_returned: returnRecord.quantity_returned,
                    reason: returnRecord.reason,
                    return_type: returnRecord.return_type,
                  }
                ]}
                supplierInfo={{
                  supplier_name: supplier.name,
                  contact_person: supplier.contact_info || undefined,
                  email: primaryEmail,
                }}
                companyInfo={companyInfo}
                notes={returnRecord.notes || undefined}
                returnType={returnRecord.return_type}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

---

## Batch Returns (Multiple Components, Single PDF)

For batch returns where multiple components share the same GRN:

```typescript
// Group returns by batch_id or goods_return_number
const batchReturns = returns.filter(r => r.batch_id === 1);

// Collect all items for the batch
const batchItems = batchReturns.map(ret => ({
  component_code: ret.component.internal_code,
  component_name: ret.component.description || '',
  quantity_returned: ret.quantity_returned,
  reason: ret.reason,
  return_type: ret.return_type,
}));

// Combine notes
const batchNotes = batchReturns
  .map(r => r.notes)
  .filter(Boolean)
  .join('\n\n');

// Determine return type (mixed if different types)
const returnTypes = new Set(batchReturns.map(r => r.return_type));
const batchReturnType = returnTypes.size > 1
  ? 'mixed'
  : Array.from(returnTypes)[0];

<ReturnGoodsPDFDownload
  goodsReturnNumber={batchReturns[0].goods_return_number}
  purchaseOrderNumber={purchaseOrder.q_number}
  purchaseOrderId={purchaseOrderId}
  returnDate={batchReturns[0].return_date}
  items={batchItems}  // Multiple items!
  supplierInfo={supplierInfo}
  companyInfo={companyInfo}
  notes={batchNotes}
  returnType={batchReturnType}
/>
```

---

## Styling the Buttons

The component uses your existing UI components and will inherit your theme:

```typescript
// Default appearance (primary + outline buttons)
<ReturnGoodsPDFDownload {...props} />

// Custom styling (modify the component)
<div className="flex items-center gap-2">
  <Button
    onClick={handleDownload}
    disabled={downloading}
    size="sm"           // Smaller buttons
    variant="secondary" // Different variant
  >
    <Download size={16} />
    {downloading ? 'Generating...' : 'Download'}
  </Button>
</div>
```

---

## TypeScript Types Reference

```typescript
interface ReturnItem {
  component_code: string;
  component_name: string;
  quantity_returned: number;
  reason: string;
  return_type: 'rejection' | 'later_return';
}

interface SupplierInfo {
  supplier_name: string;
  contact_person?: string;
  phone?: string;          // Optional - will hide if not provided
  email?: string;
}

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
}

type ReturnType = 'rejection' | 'later_return' | 'mixed';
```

---

## Testing Checklist

- [ ] PDF downloads with correct filename
- [ ] PDF opens in new tab
- [ ] GRN number displays prominently
- [ ] Return type indicator shows correctly
- [ ] Component table contains all items
- [ ] Signature blocks appear
- [ ] Warning box shows for rejections
- [ ] Company info loads from settings
- [ ] Supplier info displays correctly
- [ ] Notes section appears when provided
- [ ] Batch returns show all components

---

## Troubleshooting

### PDF doesn't download
- Check browser console for errors
- Verify all required props are provided
- Test with "Open PDF" button to see if generation works

### Missing company info
- Ensure `/api/settings` endpoint works
- Check `quote_company_settings` table has data
- Fallback defaults will be used if API fails

### Supplier email not showing
- Verify `supplier_emails` table has records
- Check `is_primary` flag is set correctly
- Email will be undefined if not found (won't break PDF)

### PDF shows "PENDING" instead of GRN
- GRN is generated when `process_supplier_order_return` RPC is called
- Ensure `goods_return_number` field is populated in database
- Use `generate_goods_return_number()` function to create GRNs

---

## Next Steps

1. **Immediate:** Add PDF buttons to existing supplier returns UI
2. **Phase 5:** Add signature collection workflow (upload signed PDFs)
3. **Phase 6:** Email integration (send PDF to supplier automatically)

---

## Support

- **PDF Component:** `components/features/purchasing/ReturnGoodsPDFDocument.tsx`
- **Download Component:** `components/features/purchasing/ReturnGoodsPDFDownload.tsx`
- **Pattern Reference:** `components/quotes/QuotePDF.tsx` (working example)
- **Documentation:** This file

---

**Ready to implement!** The PDF generation system is complete and follows your proven quotes pattern. Just add the component to your UI and you're done! 🎉

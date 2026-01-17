# Suppliers UI Redesign - New Prompt

Copy and paste this into a new Claude Code conversation:

---

I want to apply the same UI improvements we made to the Customers section to the Suppliers section. Here's what was done for Customers:

## What Was Done for Customers

1. **Main List Page** (`app/customers/page.tsx`):
   - Removed "View" and "Edit" buttons from the Actions column
   - Removed the Actions column header entirely
   - Made entire table rows clickable with hover effects
   - Clicking anywhere on a row navigates to the detail page

2. **Customer Detail Page** (`app/customers/[id]/page.tsx`):
   - Added key metrics row: Total Orders, Lifetime Value, Avg Order Value, Last Order
   - Redesigned layout with two-column grid
   - Left column: Customer Information, Address, Notes (all inline editable)
   - Right column: Monthly Purchases chart, Recent Orders, Recent Quotes
   - Inline editing with toggle Edit mode
   - "Unsaved changes" indicator when fields are edited
   - Warning dialog when navigating away with unsaved changes
   - Browser warning on page close with unsaved changes

3. **Database Migration**: Added address fields, notes, payment_terms, updated_at to customers table

## What I Want for Suppliers

### 1. Main List Page Changes

**File**: `components/features/suppliers/supplier-list.tsx` (lines 275-282)

- Remove the "View" and "Edit" buttons from the Actions column
- Remove the Actions column header (line 238-240)
- Make entire table rows clickable
- Add hover effect similar to customers
- Clicking row should navigate to supplier detail page

**Current state**:
```tsx
<td className="px-6 py-4 whitespace-nowrap text-right text-base font-medium flex gap-2 justify-end">
  <Link href={`/suppliers/${supplier.supplier_id}`} className="button-primary px-3 py-1 text-xs font-semibold">
    View
  </Link>
  <Link href={`/suppliers/${supplier.supplier_id}/edit`} className="button-primary bg-secondary text-secondary-foreground px-3 py-1 text-xs font-semibold">
    Edit
  </Link>
</td>
```

### 2. Supplier Detail Page Enhancements

**File**: `app/suppliers/[id]/page.tsx`

**Current structure**: The page uses tabs (Details, Components, Price Lists, Orders, Reports)

**Desired changes**:

#### Add Metrics Row (before tabs)
Similar to customers, add metric cards showing:
- Total Purchase Orders (count of orders from this supplier)
- Total Spend (sum of all purchase order amounts)
- Avg Order Value
- Last Order Date
- Active Components (count of components from this supplier)

#### Inline Editing in Details Tab
The Details tab currently shows `SupplierForm` - this should support inline editing:
- Toggle Edit mode with Edit button
- Show "Unsaved changes" indicator
- Warn on navigation with unsaved changes
- Keep the existing form functionality but make it look like the customer inline editing

#### Keep Existing Tabs
- Details tab: Supplier info + Emails (inline editable)
- Components tab: Keep as-is
- Price Lists tab: Keep as-is
- Orders tab: Keep as-is, but enhance with charts if needed
- Reports tab: Keep as-is

#### Optional Enhancements
- Add purchase trend chart in Reports tab (monthly spend over time)
- Show recent purchase orders in a summary card (similar to customer orders)
- Component count by category in a chart

### 3. Database Changes

Check if suppliers table needs additional fields (similar to how we added address, notes to customers):
- Check current schema for suppliers table
- Suggest any missing fields (notes, payment_terms, address if not present)
- Provide migration SQL if needed

### 4. TypeScript Types

Update supplier types if needed to match new fields.

## Reference Files

- Customer list page: `app/customers/page.tsx`
- Customer detail page: `app/customers/[id]/page.tsx` (see how inline editing, metrics, and charts are implemented)
- Supplier list component: `components/features/suppliers/supplier-list.tsx`
- Supplier detail page: `app/suppliers/[id]/page.tsx`

## Important Notes

- The supplier detail page structure is different from customers (uses tabs)
- Don't break existing functionality (components, pricelists, orders tabs)
- Focus on making the Details tab look and feel like customer inline editing
- Keep the price list thumbnails in the main list (they're useful)
- Use the same charting library (Recharts) for consistency
- Follow the same patterns for unsaved changes warnings

## Implementation Approach

1. First, examine the current supplier schema and suggest any needed database migrations
2. Update the supplier-list.tsx to remove buttons and make rows clickable
3. Enhance the supplier detail page with metrics row
4. Implement inline editing in the Details tab
5. Add charts/visualizations as appropriate
6. Test everything and ensure no TypeScript errors

Please proceed with this implementation. Start by examining the current supplier schema and files, then make the changes systematically.

---

## Additional Context from Customer Implementation

The customer detail page includes these key components you can reference:

**MetricCard component**:
```tsx
interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
}
```

**EditableField component**:
```tsx
interface EditableFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isEditing: boolean;
  type?: 'text' | 'email' | 'tel' | 'textarea';
  placeholder?: string;
}
```

**Unsaved changes tracking**:
- Use `useState` for `isEditing`, `hasUnsavedChanges`, `editedSupplier`
- Use `useEffect` to compare edited values with original
- Use `beforeunload` event for browser warning
- Use AlertDialog for navigation warning

**Monthly chart data generation**:
```tsx
function getMonthlyPurchaseData(orders) {
  // Initialize last 12 months with 0
  // Sum orders by month
  // Return array of { month, amount }
}
```

Let me know if you need any clarification before starting!

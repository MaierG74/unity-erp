# Customers UI Redesign

**Date**: January 17, 2026
**Status**: ✅ Completed

## Overview

Complete redesign of the customers section with streamlined navigation, inline editing, comprehensive metrics, and data visualization.

## Changes Made

### 1. Database Migration

**File**: `db/migrations/20260116_customer_address_notes.sql`

Added new fields to `customers` table:
- **Address fields**: `address_line_1`, `address_line_2`, `city`, `state_province`, `postal_code`, `country`
- **Business fields**: `notes`, `payment_terms`
- **Tracking**: `updated_at` with auto-update trigger

**Migration SQL**:
```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line_1 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line_2 text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state_province text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS postal_code text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

CREATE OR REPLACE FUNCTION update_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_updated_at_trigger ON customers;
CREATE TRIGGER customers_updated_at_trigger
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_customers_updated_at();
```

### 2. TypeScript Types

**File**: `types/orders.ts`

Updated `Customer` interface with new fields:
```typescript
export interface Customer {
  id: number;
  name: string;
  contact: string;
  email: string;
  telephone: string;
  contact_person?: string | null;
  phone?: string | null;
  // Address fields
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  // Additional fields
  notes?: string | null;
  payment_terms?: string | null;
  created_at?: string;
  updated_at?: string;
}
```

### 3. Main Customers List Page

**File**: `app/customers/page.tsx`

**Changes**:
- ❌ Removed "View" and "Edit" buttons from Actions column
- ❌ Removed Actions column header entirely
- ✅ Made entire table rows clickable with `cursor-pointer`
- ✅ Added hover effect (`hover:bg-accent/10`)
- ✅ Customer name highlights on hover with `group-hover:text-primary`
- ✅ Click anywhere on row navigates to detail page

**Before**:
```tsx
<td className="px-6 py-4 whitespace-nowrap text-right text-base font-medium flex gap-2 justify-end">
  <Link href={`/customers/${customer.id}`} className="button-primary">View</Link>
  <Link href={`/customers/${customer.id}/edit`} className="button-primary">Edit</Link>
</td>
```

**After**:
```tsx
<tr
  onClick={() => router.push(`/customers/${customer.id}`)}
  className="hover:bg-accent/10 dark:hover:bg-accent/30 transition-colors cursor-pointer group"
>
  <td className="px-6 py-4 whitespace-nowrap text-base font-semibold text-foreground group-hover:text-primary transition-colors">
    {customer.name || 'N/A'}
  </td>
  {/* ... other cells ... */}
</tr>
```

### 4. Customer Detail Page - Complete Redesign

**File**: `app/customers/[id]/page.tsx` (1000+ lines)

**New Layout Structure**:

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back    Customer Name              [Unsaved •]  [Delete]  │
│                                    [Edit] or [Cancel] [Save] │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │ Orders   │ │ Lifetime │ │ Avg      │ │ Last     │       │
│ │   12     │ │ R45,000  │ │ R3,750   │ │ Order    │       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├───────────────────────────┬─────────────────────────────────┤
│ Customer Information      │ Monthly Purchases Chart         │
│ [Inline Editable Fields]  │ ████ ██ ████ ██████            │
│                           │                                 │
│ Address                   ├─────────────────────────────────┤
│ [Inline Editable Fields]  │ Recent Orders                   │
│                           │ • ORD-001 - R5,000 - Completed  │
├───────────────────────────┤ • ORD-002 - R3,200 - In Prod    │
│ Notes                     ├─────────────────────────────────┤
│ [Editable Textarea]       │ Recent Quotes                   │
│ Payment Terms             │ • Q25-051 - R12,000 - Draft     │
└───────────────────────────┴─────────────────────────────────┘
```

#### Key Metrics Row

Four metric cards displaying:
1. **Total Orders**: Count of all orders for customer
2. **Lifetime Value**: Sum of all order amounts (formatted as ZAR currency)
3. **Avg Order Value**: Calculated average order value
4. **Last Order**: Date of most recent order (or "Never")

**Implementation**: Custom `MetricCard` component with icon, title, value, and optional subtitle.

#### Left Column

1. **Customer Information Card**
   - Name, Contact Person, Email, Telephone
   - All fields inline editable when in edit mode
   - Email and telephone are clickable links when not editing

2. **Address Card**
   - Address Line 1, Address Line 2
   - City, State/Province, Postal Code, Country
   - All fields inline editable

3. **Notes Card**
   - Free-form notes textarea
   - Payment terms field

**Component**: Custom `EditableField` component handles both read and edit states.

#### Right Column

1. **Monthly Purchases Chart**
   - Bar chart showing last 12 months of purchase data
   - Uses Recharts library
   - Y-axis formatted as "R{value}k"
   - Responsive container

2. **Recent Orders List**
   - Shows 5 most recent orders
   - Order number, date, amount, status
   - Color-coded status badges (green=completed, red=cancelled, blue=in progress)
   - Click to view order details
   - "View all X orders" link if more than 5
   - "Create Order" button

3. **Recent Quotes List**
   - Shows 5 most recent quotes
   - Quote number, date, amount, status
   - Color-coded status badges (green=accepted, red=rejected, yellow=draft)
   - Click to view quote details
   - "View all X quotes" link if more than 5
   - "Create Quote" button

### 5. Inline Editing Features

**Edit Mode Toggle**:
- Click "Edit" button to enter edit mode
- All editable fields become input/textarea components
- Header shows "Cancel" and "Save Changes" buttons

**Unsaved Changes Tracking**:
- Orange badge with dot appears when changes are made: `"Unsaved changes"`
- Tracks dirty state by comparing edited values to original
- Only shows when in edit mode AND changes detected

**Navigation Warning**:
- Browser `beforeunload` event prevents accidental page close
- Custom dialog when clicking "Back" or "Cancel" with unsaved changes
- Two options: "Keep Editing" or "Discard Changes"

**Save Functionality**:
- Validates and saves all fields to Supabase
- Invalidates React Query cache to refetch fresh data
- Exits edit mode on success
- Shows error alert on failure

### 6. Data Fetching

**React Query queries**:
1. `['customer', customerId]` - Customer details
2. `['customerOrders', customerId]` - All orders for customer
3. `['customerQuotes', customerId]` - All quotes for customer

**Supabase queries**:
```typescript
// Orders with status join
const { data } = await supabase
  .from('orders')
  .select(`
    order_id,
    order_number,
    order_date,
    total_amount,
    status:order_statuses(status_id, status_name)
  `)
  .eq('customer_id', customerId)
  .order('order_date', { ascending: false });

// Quotes
const { data } = await supabase
  .from('quotes')
  .select('id, quote_number, status, grand_total, created_at')
  .eq('customer_id', customerId)
  .order('created_at', { ascending: false });
```

### 7. Helper Functions

**`formatCurrency(amount)`**: Formats numbers as ZAR currency (R1,234.56)

**`getMonthlyPurchaseData(orders)`**:
- Generates last 12 months of data
- Groups orders by month
- Returns array of `{ month: string, amount: number }`

**`calculateMetrics(orders)`**:
- Calculates totalOrders, lifetimeValue, avgOrderValue, lastOrderDate
- Returns metrics object for display cards

### 8. Removed Files

**Deleted**: `app/customers/[id]/edit/page.tsx`
- Separate edit page no longer needed
- All editing done inline on detail page

## Dependencies

- **Recharts** (already installed): `^2.15.1`
- **Lucide React**: Icons (Package, DollarSign, TrendingUp, Calendar, Save, X, Trash2, ArrowLeft)
- **Radix UI**: AlertDialog, Card, Input, Textarea, Label, Button

## User Experience Improvements

1. **Faster navigation**: Click anywhere on row instead of finding small button
2. **Better visibility**: Metrics and charts provide instant insights
3. **Contextual actions**: Create orders/quotes directly from customer page
4. **Safer editing**: Warning prevents accidental data loss
5. **Progressive disclosure**: Recent items with "View all" links
6. **Visual feedback**: Clear indicators for edit mode and unsaved changes

## Testing Checklist

- [x] Database migration runs successfully
- [x] Main list page rows are clickable
- [x] Clicking row navigates to detail page
- [x] Metrics cards display correctly
- [x] Monthly chart renders with real data
- [x] Recent orders list shows correct data
- [x] Recent quotes list shows correct data
- [x] Edit mode enables all fields
- [x] Unsaved changes indicator appears
- [x] Browser warning works on page close
- [x] Navigation warning dialog works
- [x] Save functionality persists data
- [x] Cancel discards changes correctly
- [x] Delete customer with confirmation
- [x] TypeScript compiles without errors

## Future Enhancements

- Order status breakdown pie chart
- Activity timeline
- Multiple addresses support
- Payment history tracking
- Customer documents/attachments
- Email communication log
- Custom fields/metadata

## Related Files

- `app/customers/page.tsx` - Main list
- `app/customers/[id]/page.tsx` - Detail page with inline editing
- `types/orders.ts` - TypeScript interfaces
- `db/migrations/20260116_customer_address_notes.sql` - Database schema
- `lib/supabase.ts` - Database client

## Notes

- Existing customers will show "N/A" for new fields until edited
- Monthly chart shows $0 for months with no orders
- Chart library (Recharts) is already installed
- All currency formatting uses South African Rand (R)
- Date formatting uses `en-ZA` locale

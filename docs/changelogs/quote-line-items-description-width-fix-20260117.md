# Fix: Quote Line Items Description Column Width

**Date**: 2026-01-17
**Status**: ✅ Completed

## Issue

On the quote detail page's Line Items tab, the Description column became too narrow on smaller screens (especially with the sidebar extended), making line item descriptions unreadable or truncated.

**Affected screens:**
- Quote detail page → Line Items tab
- Especially noticeable when sidebar is expanded
- Impacted readability of product/item descriptions

## Root Cause

The `QuoteItemsTable` component had no minimum width constraint on the Description column:
1. All other columns had fixed widths (`w-32`, `w-36`, etc.)
2. Description column had no width class - only `font-medium`
3. Table container used `overflow-hidden` instead of `overflow-x-auto`
4. On smaller screens, the Description column would compress to fit remaining space

This caused descriptions like "PLANTER 1050 X 900 X 450" and "1600 X 800MM TOP, 32MM" to be truncated or illegible.

## Solution

Applied responsive table design pattern:
1. **Added minimum width** to Description column header: `min-w-[250px]`
2. **Enabled horizontal scroll** on table container: changed `overflow-hidden` to `overflow-x-auto`

### Changes Made

**File: `components/features/quotes/QuoteItemsTable.tsx`**

**Line 755-767 (Table container and header):**
```typescript
// Before
<div className="rounded-lg border bg-card overflow-hidden">
  <Table>
    <TableHeader>
      <TableRow className="bg-muted/50">
        <TableHead className="w-12 text-center"></TableHead>
        <TableHead className="font-medium">Description</TableHead>
        <TableHead className="w-32 text-center font-medium">Qty</TableHead>
        ...
      </TableRow>
    </TableHeader>

// After
<div className="rounded-lg border bg-card overflow-x-auto">
  <Table>
    <TableHeader>
      <TableRow className="bg-muted/50">
        <TableHead className="w-12 text-center"></TableHead>
        <TableHead className="font-medium min-w-[250px]">Description</TableHead>
        <TableHead className="w-32 text-center font-medium">Qty</TableHead>
        ...
      </TableRow>
    </TableHeader>
```

## Testing Performed

✅ **Description column readability**
- "PLANTER 1050 X 900 X 450" - fully visible
- "1600 X 800MM TOP, 32MM" - fully visible

✅ **Responsive behavior**
- Sidebar collapsed: Table fits comfortably
- Sidebar expanded: Description column maintains 250px minimum width
- Horizontal scroll appears when needed on smaller screens

✅ **Other columns unaffected**
- Qty, Unit Price, Total, Attachments, Actions columns maintain their fixed widths
- No layout breaking on larger screens

## Benefits

1. **Improved readability**: Line item descriptions are always readable regardless of screen size
2. **Better UX**: Users can scroll horizontally if needed rather than losing information
3. **Consistent with modern table patterns**: Horizontal scroll for data tables is standard practice
4. **No breaking changes**: Existing functionality preserved, only visual improvements

## Related Components

- `components/features/quotes/QuoteItemsTable.tsx` - Main table component
- `components/quotes/EnhancedQuoteEditor.tsx` - Parent quote editor component
- `app/quotes/[id]/page.tsx` - Quote detail page route

## Notes

- The 250px minimum width was chosen to accommodate typical product description lengths
- Horizontal scrolling only appears when screen width requires it (responsive)
- The fix maintains the existing table structure and doesn't affect any data handling

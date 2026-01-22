# SketchUp CSV Import for Product BOM Cutlists

> **Status**: Implemented
> **Files**: `lib/cutlist/csvParser.ts`, `components/features/cutlist/CutlistBuilder.tsx`
> **Related**: [Product Cutlist Calculator Plan](./product-cutlist-calculator-plan.md)

## Overview

Add CSV import functionality to the Product BOM editor allowing users to import SketchUp cutlist exports alongside manual entry. This provides a streamlined workflow for designers using SketchUp to define panel dimensions.

**Note**: CSV import is now available through the **Cutlist Builder** (accessed via the "Cutlist Builder" button on the Product Cutlist tab). The builder allows importing CSV files, grouping parts with drag-and-drop, and setting board lamination types.

## Problem Statement

Currently, cutlist items must be entered manually into the BOM editor one at a time. When working with SketchUp designs, users must:
1. Export a cutlist from SketchUp
2. Manually re-enter each panel's dimensions into the BOM
3. Repeat for each design iteration

This is time-consuming and error-prone for products with many panels.

## Solution

Add an "Import CSV" button to the BOM toolbar that:
1. Accepts SketchUp cutlist CSV exports
2. Parses and validates the data
3. Shows a preview for user review
4. Bulk inserts selected rows as cutlist-enabled BOM items

## SketchUp CSV Format

### Sample Structure
```csv
No.;Designation;Quantity;Length;Width;Thickness;Material type;Material name;Edge Length 1;Edge Length 2;Edge Width 1;Edge Width 2;Tags
A;top#35;1;900 mm;600 mm;16 mm;Sheet Goods;Natural Oak;36MM EDGING;36MM EDGING;36MM EDGING;36MM EDGING;Layer0
B;side#6;1;700 mm;580 mm;16 mm;Sheet Goods;Natural Oak;20MM EDGING;20MM EDGING;20MM EDGING;;Layer0
```

### Format Characteristics
- **Delimiter**: Semicolon (`;`)
- **UTF-8 BOM**: File starts with BOM marker (`\uFEFF`)
- **Row Types**: "Sheet Goods" (panels) and "Edge Banding" (separate edging rows, ignored)
- **Dimensions**: Numeric with " mm" suffix (e.g., "900 mm")
- **Edge Columns**: Contain edging spec when present, empty when no banding

### Column Mapping

| SketchUp Column | CutlistDimensions Field | Notes |
|-----------------|------------------------|-------|
| Designation | notes | Part name/label |
| Quantity | quantity_per | Number of pieces |
| Length | length_mm | Strip " mm" suffix |
| Width | width_mm | Strip " mm" suffix |
| Thickness | thickness_mm | Strip " mm" suffix |
| Material type | (filter) | Only import "Sheet Goods" |
| Material name | material_label | e.g., "Natural Oak" |
| Edge Length 1 | band_edges.top | Non-empty = has banding |
| Edge Length 2 | band_edges.bottom | Non-empty = has banding |
| Edge Width 1 | band_edges.right | Non-empty = has banding |
| Edge Width 2 | band_edges.left | Non-empty = has banding |
| Tags | cutlist_category | Optional grouping |

## Technical Implementation

### New Files

1. **`lib/cutlist/csvParser.ts`** - CSV parsing utilities
   - `parseCSVContent()` - Main parser with delimiter auto-detection
   - `parseDimension()` - Strips " mm" suffix, handles comma decimals
   - `detectEdgeBanding()` - Returns boolean from edge column value
   - Type definitions for parsed data

2. **`components/features/products/ImportCutlistCSVDialog.tsx`** - Dialog component
   - File upload via react-dropzone
   - Preview table with validation status
   - Row selection with checkboxes
   - Bulk import mutation

### Modified Files

1. **`components/features/products/product-bom.tsx`**
   - Add "Import CSV" button to toolbar
   - Dynamic import of dialog component

### Data Flow

```
SketchUp Export (.csv)
       ↓
   File Upload (react-dropzone)
       ↓
   CSV Parser (csvParser.ts)
       ↓
   Validation (per row)
       ↓
   Preview Table (user review)
       ↓
   Selection (checkboxes)
       ↓
   Bulk Insert (Supabase)
       ↓
   Query Invalidation (React Query)
       ↓
   BOM Table Refresh
```

### Insert Payload

```typescript
{
  product_id: productId,
  component_id: null,
  quantity_required: row.quantity,
  is_cutlist_item: true,
  cutlist_category: row.tags || null,
  cutlist_dimensions: {
    length_mm: number,
    width_mm: number,
    thickness_mm: number,
    quantity_per: number,
    grain: 'length',
    band_edges: { top, bottom, right, left },
    material_label: string,
    notes: string
  }
}
```

## User Interface

### UI Flow

1. User clicks "Import CSV" button in BOM toolbar
2. Dialog opens with drag-drop zone
3. User drops/selects SketchUp CSV file
4. Parser extracts rows, filters to Sheet Goods only
5. Preview table shows rows with validation icons
6. User reviews and adjusts selection if needed
7. User clicks "Import Selected"
8. Rows inserted as BOM items with `is_cutlist_item=true`
9. Dialog closes, BOM table refreshes

### Validation Indicators

- **Green checkmark**: Valid row, ready to import
- **Yellow warning**: Valid but missing optional data (thickness, material)
- **Red X**: Invalid row (missing length/width/quantity), cannot import

## Edge Cases

- **UTF-8 BOM**: Stripped automatically from file start
- **Empty files**: Show "No data found" message
- **Wrong delimiter**: Auto-detect semicolon vs comma
- **Missing columns**: Show which required columns are missing
- **Duplicate rows**: Allowed (user may intentionally have duplicates)
- **Large files**: Loading indicator during parse

## Future Enhancements

- Support other cutlist software formats (CutList Plus, etc.)
- Remember last-used column mapping preferences
- Export current BOM as CSV for round-trip editing
- Merge/update existing rows instead of always inserting new

## Related Documentation

- [Cutlist Nesting Plan](./cutlist-nesting-plan.md)
- [Cutlist Option Sets Plan](./cutlist-option-sets-plan.md)
- [BOM Options & Cutlist Integration](../domains/components/bom-option-cut.md)
- [Cutting Plan Implementation Notes](../operations/cuttingplan.md)
- [Product Cutlist Calculator](./product-cutlist-calculator-plan.md) - Phase 1 implementation

# Product Cutlist Calculator

## Overview

The Product Cutlist Calculator enables users to generate optimized sheet layouts directly from a product's Bill of Materials. This is Phase 1 of the order-level cutlist aggregation feature.

## Current Implementation (Phase 1)

### Components Created

1. **`ProductCutlistCalculator.tsx`** - Dialog component for calculating cutlists
   - Located at: `components/features/products/ProductCutlistCalculator.tsx`
   - Triggered from the "Generate Cutlist" button on the Cutlist tab

2. **Integration into ProductCutlistTab**
   - Added "Generate Cutlist" button to the overview card
   - Passes cutlist rows to the calculator dialog

### Features

- **Stock Sheet Settings**: Configure sheet dimensions (default: 2750 x 1830mm PG Bison)
- **Kerf Support**: Adjustable blade thickness for accurate calculations
- **Parts Preview**: View all parts with dimensions, materials, and quantities
- **Validation**: Warns about parts missing dimensions
- **Material Grouping**: Shows parts grouped by material code/label
- **Packing Algorithm**: Uses guillotine packing with grain orientation support
- **Results Display**:
  - Fractional sheets used
  - Billable sheets (rounded up)
  - Board utilization percentage
  - Edgebanding meters (16mm and 32mm separate)
- **Sheet Layouts**: Visual SVG preview of each sheet with part placements

### Data Flow

```
ProductCutlistTab
    │
    ├── Fetches effective BOM via /api/products/{id}/effective-bom
    │
    ├── Filters for is_cutlist_item = true
    │
    ├── Groups by material for display
    │
    └── "Generate Cutlist" button
            │
            ▼
    ProductCutlistCalculator
            │
            ├── Converts CutlistRow[] to PartSpec[]
            │
            ├── Configures stock sheet (size, kerf)
            │
            ├── packPartsIntoSheets() algorithm
            │
            └── Displays results + sheet previews
```

### Usage

1. Navigate to a product's **Cutlist** tab
2. Ensure BOM items have `is_cutlist_item = true` and valid dimensions
3. Click **"Generate Cutlist"** button
4. Review parts in the Inputs tab
5. Adjust stock sheet settings if needed
6. Click **"Calculate Cutlist"**
7. View results and sheet layouts

## Cutlist Builder (Phase 1.5)

### Overview

The Cutlist Builder provides drag-and-drop grouping for CSV-imported parts with support for laminated board types. This addresses the workflow where SketchUp designs are exported and parts need to be grouped for 32mm lamination.

### Components Created

1. **`CutlistBuilder.tsx`** - Main builder component
   - Located at: `components/features/cutlist/CutlistBuilder.tsx`
   - Triggered from the "Cutlist Builder" button on the Cutlist tab

2. **`PartCard.tsx`** - Draggable part card
   - Located at: `components/features/cutlist/PartCard.tsx`
   - Shows part name, dimensions, quantity, edge banding indicators

3. **`GroupCard.tsx`** - Group container with drop zone
   - Located at: `components/features/cutlist/GroupCard.tsx`
   - Board type selector, material pickers, parts list

4. **`boardCalculator.ts`** - Calculation logic
   - Located at: `lib/cutlist/boardCalculator.ts`
   - Expands groups based on board type

### Board Types

| Type | Primary Board | Backer Board | Edging | Use Case |
|------|--------------|--------------|--------|----------|
| 16mm Single | 1× 16mm | None | 16mm | Standard panels |
| 32mm Both Sides | 2× 16mm (same) | None | 32mm | Desk legs, visible both sides |
| 32mm With Backer | 1× 16mm | 1× 16mm (cheaper grade) | 32mm | Desk tops, only top visible |

### Features

- **CSV Import**: Drag-drop SketchUp CSV files
- **Drag-and-Drop Grouping**: Move parts between ungrouped area and named groups
- **Board Type Selection**: 16mm / 32mm Both Sides / 32mm With Backer
- **Material Assignment**: Primary and backer material pickers (melamine components)
- **Calculation**: Expands parts based on board type, runs packing algorithm
- **Results Display**: Sheet counts, utilization, edging totals, visual previews

### Data Flow

```
CSV Import (SketchUp)
    │
    ├── Parse with csvParser.ts
    │
    ├── Filter Sheet Goods rows
    │
    └── Add to Ungrouped Parts
            │
            ▼
    Drag-and-Drop to Groups
            │
            ├── Set group name
            │
            ├── Set board type (16mm/32mm-both/32mm-backer)
            │
            └── Assign materials
                    │
                    ▼
            Calculate Cutlist
                    │
                    ├── expandGroupsToPartSpecs()
                    │   ├── 16mm: parts as-is
                    │   ├── 32mm-both: qty × 2 same board
                    │   └── 32mm-backer: primary + backer
                    │
                    ├── packPartsIntoSheets() for primary
                    │
                    ├── packPartsIntoSheets() for backer
                    │
                    └── Display results + sheet previews
```

### Usage

1. Navigate to a product's **Cutlist** tab
2. Click **"Cutlist Builder"** button
3. Drop a SketchUp CSV file (or click to browse)
4. Parts appear in Ungrouped area
5. Click **"+ New Group"** to create groups
6. Drag parts into groups
7. Set board type and materials for each group
8. Click **"Calculate Cutlist"**
9. View results in the Results tab

## Future Phases

### Phase 2: Order Data Capture
- Add `selected_options JSONB` column to `order_details` table
- Update order creation to capture product configuration options
- Update quote-to-order conversion to preserve options

### Phase 3: Order-Level Cutlist Resolver
- New API: `GET /api/orders/[orderId]/cutlist`
- Resolve effective BOM for each order line item
- Aggregate cutlist items across all products in order
- Merge panels by material/colour

### Phase 4: Order Cutlist UI
- Add "Cutlist" tab to Order detail page
- Material-grouped panel list with quantities
- "Generate Optimized Cutlist" for entire order
- Combined sheet layouts and costing summary

### Phase 5: Production Integration
- Persist order cutlist snapshots to database
- Export to production worksheets
- Track actual vs. estimated material usage

## Architecture Decisions

### Why Separate from CutlistTool?

The existing `CutlistTool` component is designed for quote-level cutlists with:
- Manual part entry
- Export to quote costing lines
- Persistence to `quote_item_cutlists` table

The `ProductCutlistCalculator` is designed for:
- Automatic part extraction from BOM
- Preview/estimation use case (no persistence yet)
- Foundation for order-level aggregation

Future consideration: Merge common logic into shared utilities while keeping UI components separate for their specific use cases.

### Packing Algorithm Reuse

Both use the same `packPartsIntoSheets()` function from `components/features/cutlist/packing.ts`:
- Greedy best-fit guillotine packing
- Grain orientation support
- Kerf handling
- Edge banding calculation

### Type Compatibility

The `CutlistRow` interface in ProductCutlistTab matches the expected structure for the calculator:
- `dimensions.length_mm`, `dimensions.width_mm` for part sizes
- `dimensions.grain` for orientation
- `dimensions.band_edges` for edgebanding
- `dimensions.laminate` for 16mm vs 32mm banding split
- `totalParts` for quantity (quantityRequired × quantityPer)

## Files

| File | Purpose |
|------|---------|
| `components/features/products/ProductCutlistCalculator.tsx` | Calculator dialog component |
| `components/features/products/ProductCutlistTab.tsx` | Tab with "Generate Cutlist" and "Cutlist Builder" buttons |
| `components/features/cutlist/CutlistBuilder.tsx` | Drag-and-drop cutlist builder |
| `components/features/cutlist/PartCard.tsx` | Draggable part card |
| `components/features/cutlist/GroupCard.tsx` | Group container with drop zone |
| `components/features/cutlist/packing.ts` | Packing algorithm (shared) |
| `components/features/cutlist/preview.tsx` | Sheet visualization (shared) |
| `lib/cutlist/boardCalculator.ts` | Board type expansion logic |
| `lib/cutlist/csvParser.ts` | SketchUp CSV parser |
| `lib/cutlist/cutlistDimensions.ts` | Type definitions (shared) |

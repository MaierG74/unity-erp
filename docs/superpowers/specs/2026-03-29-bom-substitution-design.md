# BOM Component Substitution at Order Time

**Date:** 2026-03-29
**Status:** Approved

## Problem

Products are costed with default components in the BOM (e.g., a bow handle, white melamine). When a customer places an order, they may want different components (e.g., a Neptune handle, Brookhil melamine). The current "option sets" system requires pre-defining every possible substitute per BOM line per product — too cumbersome at scale with hundreds of products.

## Solution: Category-Based Substitution

Mark BOM lines as **substitutable**. At order time, the user sees default components but can swap any substitutable line by picking from a **category-filtered searchable combobox**. The initial filter is the default component's category, but the user can change the filter to any category or browse all inventory.

No per-product configuration needed. Adding a new component to inventory in the right category automatically makes it available as a substitute everywhere.

## Data Model

### Migration 1: Add `is_substitutable` to `billofmaterials`

```sql
ALTER TABLE billofmaterials
  ADD COLUMN is_substitutable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN billofmaterials.is_substitutable IS
  'When true, this BOM line can be swapped for another component at order time';
```

### Migration 2: Add `bom_overrides` to `order_details`

```sql
ALTER TABLE order_details
  ADD COLUMN bom_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN order_details.bom_overrides IS
  'Per-line component substitutions. Array of {bom_id, component_id, supplier_component_id?, note?}';
```

**`bom_overrides` shape:**
```jsonc
[
  {
    "bom_id": 42,
    "component_id": 315,           // the substitute component
    "supplier_component_id": 780,  // optional: specific supplier pricing
    "note": "Customer requested Neptune handle"  // optional
  }
]
```

An empty array `[]` means "use all defaults." Only overridden lines appear in the array.

### No new tables

The component's existing `category_id` (via `components.category_id → component_categories.cat_id`) determines what substitutes are available. No option set tables involved.

## Product Setup UX (BOM Tab)

Each BOM row in the product costing tab gets a **toggle/checkbox** labelled "Substitutable" (or a small swap icon toggle).

- Default: off (component is fixed)
- When on: this line can be swapped at order time
- Only meaningful for components that have a `category_id` set — if the component has no category, show a tooltip: "Set a category on this component to enable substitution"

This is the **only** setup required. No option sets, no override dialogs, no value lists.

## Order Entry UX

### Flow: Adding a Product to an Order

1. User clicks "Add Product" on an order
2. Selects a product and quantity
3. **If the product has zero substitutable BOM lines:** adds immediately (current behavior)
4. **If it has substitutable BOM lines:** a **configuration step** appears:

```
┌─────────────────────────────────────────────────────┐
│ Configure: Kitchen Cupboard (qty: 2)                │
│                                                     │
│ Board     [White Melamine ▾]              R45.00    │
│ Handle    [Bow Handle ▾]                  R12.50    │
│ Hinge     [Standard 110° ▾]              R8.00     │
│                                                     │
│ Material Cost: R65.50                               │
│                                    [Add to Order]   │
└─────────────────────────────────────────────────────┘
```

- Only substitutable BOM lines are shown (non-substitutable lines use defaults silently)
- Each line shows the component label and a searchable combobox
- The default component is pre-selected
- Cost updates in real-time as selections change

### Combobox Behavior

```
┌──────────────────────────────────────┐
│ 🔍 Search...        [Handles ▾]     │
│──────────────────────────────────────│
│ ★ Bow Handle (default)      R12.50  │
│ Neptune Handle               R18.00  │
│ Brookhil Handle              R15.50  │
│ T-Bar Handle                 R9.00   │
│──────────────────────────────────────│
│ Browse all categories...             │
└──────────────────────────────────────┘
```

- **Initial filter:** The default component's category (e.g., "Handles")
- **Category selector** `[Handles ▾]`: dropdown to switch to any other category
- **"Browse all categories"**: removes the category filter, shows entire inventory catalog
- **Search**: filters within the current category scope
- **Default marked**: the original BOM component is marked with a star and "(default)"
- **Price shown**: each option shows the unit price so the user can compare

### Pricing

Each combobox option shows the supplier component price. The material cost total at the bottom recalculates live:

```
Material Cost: R72.00 (+R6.50 from defaults)
```

The delta from the default BOM cost is shown so the user understands the impact.

### What Gets Saved

When the user clicks "Add to Order", the `order_details` row is created with:
- `product_id`: the selected product
- `quantity`: as entered
- `unit_price`: recalculated with substitutions factored in
- `bom_overrides`: JSON array of only the changed lines (lines left at default are omitted)

## Costing Logic

### At Order Time (live preview)

```
effective_material_cost = base_material_cost
  - SUM(default_component_cost for overridden lines)
  + SUM(substitute_component_cost for overridden lines)
```

Where component cost = `suppliercomponents.price * billofmaterials.quantity_required` for the chosen supplier component (or cheapest available if none specified).

### For Manufacturing / Job Cards

When generating job cards or work orders from an order line:
1. Load the product's BOM
2. Apply `bom_overrides` from the `order_details` row — swap `component_id` and optionally `supplier_component_id` for overridden lines
3. The result is the **effective BOM** for that specific order line

### For Purchasing

When creating purchase orders from an order's BOM:
- Use the effective BOM (with overrides applied) to determine which components to procure
- Substituted components reference the correct supplier

## Component Data Requirements

For this system to work well, components need:
- `category_id` set (so category filtering works)
- At least one `suppliercomponents` row with a price (so cost comparison works)

Components without a category can still be BOM items, but they won't appear as substitutes in the category-filtered view (only via "Browse all").

## API Endpoints

### Existing (modified)

**`GET /api/products/[productId]/bom`** — add `is_substitutable` to the response for each BOM row.

**`PATCH /api/products/[productId]/bom`** — accept `is_substitutable` in the update payload.

**`POST /api/orders/[orderId]/add-products`** — accept `bom_overrides` in the request body per product. Store in `order_details.bom_overrides`.

### New

**`GET /api/components/by-category/[categoryId]`** — returns components in a category with their cheapest supplier price. Used by the substitution combobox. Supports `?search=` query param.

**`GET /api/orders/[orderId]/details/[detailId]/effective-bom`** — returns the product BOM with overrides applied for a specific order line. Used by job card generation and purchasing.

## Migration Path from Option Sets

- The option sets system remains untouched (no breaking changes)
- Products can be gradually migrated: turn on `is_substitutable` on BOM lines, remove option set links
- Once all products are migrated, option sets can be deprecated in a future release
- The `bom_option_overrides`, `option_sets`, `option_set_groups`, `option_set_values`, and related tables stay until deprecation

## Scope Boundaries

**In scope:**
- `is_substitutable` flag on BOM lines
- `bom_overrides` JSONB on order details
- Configuration step when adding products to orders
- Category-filtered searchable combobox
- Live cost preview
- Effective BOM resolution for downstream (job cards, purchasing)

**Out of scope (future):**
- Curated preferred substitutes list per BOM line
- Substitution groups (narrower than categories)
- Customer-facing self-configuration (e-commerce)
- Bulk substitution across multiple order lines
- Deprecation/removal of option sets system

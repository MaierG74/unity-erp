# Product Configuration at Order Time

**Date:** 2026-03-29
**Status:** Approved

## Problem

Two related problems when adding products to orders:

1. **Component substitution:** Products are costed with default components (e.g., bow handle, white melamine). Customers may want alternatives (e.g., Neptune handle, Brookhil melamine). The current "option sets" system requires pre-defining every substitute per BOM line per product — too cumbersome at scale with hundreds of products.

2. **Cutlist portability:** Product cutlists live in `product_cutlist_groups` but don't follow the product onto an order. Users need to aggregate cutlists across an entire order (e.g., 10 cupboards + 10 tables = one combined cutting list) and sometimes adjust parts at order level (e.g., "add an extra shelf").

## Solution Overview

When a product is added to an order, a **configuration step** lets the user:
- **Swap substitutable components** via category-filtered combobox
- **Review and edit the cutlist** snapshot for that order line

Both are stored on the `order_details` row as JSONB, creating an order-specific freeze of the product configuration.

---

## Part 1: Category-Based BOM Substitution

### Concept

Mark BOM lines as **substitutable**. At order time, the user can swap any substitutable line by picking from a searchable combobox filtered by the default component's category. The user can change the category filter or browse all inventory.

No per-product configuration needed. Adding a new component to inventory in the right category automatically makes it available as a substitute everywhere.

### Data Model

**`billofmaterials` — add column:**

```sql
ALTER TABLE billofmaterials
  ADD COLUMN is_substitutable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN billofmaterials.is_substitutable IS
  'When true, this BOM line can be swapped for another component at order time';
```

**`order_details` — add column:**

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

### Product Setup UX (BOM Tab)

Each BOM row gets a **toggle/checkbox**: "Substitutable".

- Default: off (component is fixed)
- When on: this line can be swapped at order time
- Only meaningful for components with a `category_id` — if missing, show tooltip: "Set a category on this component to enable substitution"

No option sets, no override dialogs, no value lists.

### Order Entry UX — Substitution Combobox

```
┌──────────────────────────────────────┐
│ Search...               [Handles v]  │
│--------------------------------------│
│ * Bow Handle (default)       R12.50  │
│ Neptune Handle               R18.00  │
│ Brookhil Handle              R15.50  │
│ T-Bar Handle                  R9.00  │
│--------------------------------------│
│ Browse all categories...             │
└──────────────────────────────────────┘
```

- **Initial filter:** The default component's category (e.g., "Handles")
- **Category selector** `[Handles v]`: dropdown to switch to any other category
- **"Browse all categories"**: removes the category filter, shows entire inventory catalog
- **Search**: filters within the current category scope
- **Default marked**: the original BOM component is marked with a star and "(default)"
- **Price shown**: each option shows the unit price for cost comparison

### Costing

```
effective_material_cost = base_material_cost
  - SUM(default_component_cost for overridden lines)
  + SUM(substitute_component_cost for overridden lines)
```

Cost delta shown inline:
```
Material Cost: R72.00 (+R6.50 from defaults)
```

---

## Part 2: Cutlist Snapshot at Order Time

### Concept

When a product is added to an order, its cutlist is **snapshotted** (copied) to the order line. The user can then edit that copy — add a shelf, change a dimension, remove a part. Existing orders are never affected by later product cutlist changes.

The order-level cutlist export aggregates snapshots across all order lines, multiplied by quantity.

### Data Model

**`order_details` — add column:**

```sql
ALTER TABLE order_details
  ADD COLUMN cutlist_snapshot jsonb DEFAULT NULL;

COMMENT ON COLUMN order_details.cutlist_snapshot IS
  'Frozen copy of product cutlist groups at order time. Editable per order line. NULL = product has no cutlist.';
```

**`cutlist_snapshot` shape** — mirrors `product_cutlist_groups` structure:
```jsonc
[
  {
    "source_group_id": 220,          // reference back to product_cutlist_groups.id
    "name": "Panels (16mm)",
    "board_type": "16mm",
    "primary_material_id": 65,
    "primary_material_name": "White Melamine",
    "backer_material_id": null,
    "backer_material_name": null,
    "parts": [
      {
        "id": "uuid",
        "name": "Top and Base",
        "grain": "length",
        "quantity": 2,
        "width_mm": 450,
        "length_mm": 600,
        "band_edges": { "top": true, "left": true, "right": true, "bottom": true },
        "lamination_type": "none"
      }
      // ... more parts
    ]
  }
  // ... more groups
]
```

`NULL` means the product has no cutlist. An empty array `[]` means the cutlist was explicitly cleared.

### Cutlist-Material Interaction with BOM Substitution

When a user swaps a board material via BOM substitution (e.g., white melamine -> Brookhil melamine), the cutlist snapshot should update the corresponding group's `primary_material_id` and `primary_material_name` to match. This link is via `product_cutlist_groups.primary_material_id` matching a `components.component_id` in the BOM.

### Product Setup

No additional setup. The cutlist already exists in `product_cutlist_groups`. The snapshot is created automatically when the product is added to an order.

### Order Entry UX — Cutlist Review

After the substitution step, if the product has cutlist groups, show an expandable cutlist section:

```
┌─────────────────────────────────────────────────────┐
│ Configure: Kitchen Cupboard (qty: 2)                │
│                                                     │
│ COMPONENTS                                          │
│ Board     [Brookhil Melamine v]           R52.00    │
│ Handle    [Neptune Handle v]              R18.00    │
│ Hinge     [Standard 110° v]               R8.00    │
│                                                     │
│ CUTLIST                                    [Edit]   │
│ Panels (16mm) — 4 parts, Brookhil Melamine          │
│                                                     │
│ Material Cost: R78.00 (+R12.50 from defaults)       │
│                                    [Add to Order]   │
└─────────────────────────────────────────────────────┘
```

- Cutlist section is collapsed by default, showing a summary (group count, total parts, material name)
- **[Edit]** opens the cutlist editor (same UI as the product cutlist tab, but editing the snapshot)
- Edits here only affect this order line, not the product template
- Board material updates automatically when the corresponding BOM component is substituted

### Order-Level Cutlist Export

A new **"Export Cutlist"** action on the order page:
1. Collects `cutlist_snapshot` from all `order_details` rows for the order
2. Multiplies each part quantity by the order line quantity
3. Groups by board type and material
4. Outputs in the format the cutting diagram / nesting tool expects

---

## Combined Configuration Dialog

The full flow when adding a product to an order:

1. User selects product and quantity
2. **If no substitutable BOM lines AND no cutlist:** add immediately (current behavior)
3. **If either exists:** show the configuration dialog:

```
┌─────────────────────────────────────────────────────┐
│ Configure: Kitchen Cupboard (qty: 2)                │
│                                                     │
│ COMPONENTS                     [Use all defaults]   │
│ Board     [White Melamine v]              R45.00    │
│ Handle    [Bow Handle v]                  R12.50    │
│ Hinge     [Standard 110° v]               R8.00    │
│                                                     │
│ CUTLIST                                    [Edit]   │
│ Panels (16mm) — 4 parts, White Melamine             │
│                                                     │
│ Material Cost: R65.50                               │
│                                    [Add to Order]   │
└─────────────────────────────────────────────────────┘
```

- **"Use all defaults"** skips configuration and adds with all defaults
- Components section only shows substitutable lines
- Cutlist section shows a summary with an edit option
- Cost recalculates live

---

## API Endpoints

### Existing (modified)

- **`GET /api/products/[productId]/bom`** — include `is_substitutable` per row
- **`PATCH /api/products/[productId]/bom`** — accept `is_substitutable` in payload
- **`POST /api/orders/[orderId]/add-products`** — accept `bom_overrides` and `cutlist_snapshot` per product; snapshot auto-generated from product cutlist groups if not provided

### New

- **`GET /api/components/by-category/[categoryId]`** — components in a category with cheapest supplier price; supports `?search=` query param
- **`GET /api/orders/[orderId]/details/[detailId]/effective-bom`** — product BOM with overrides applied for a specific order line
- **`GET /api/orders/[orderId]/export-cutlist`** — aggregated cutlist across all order lines (multiplied by quantities, grouped by material)
- **`PATCH /api/orders/[orderId]/details/[detailId]/cutlist`** — update cutlist snapshot for a specific order line

## Downstream Integration

### Job Cards / Work Orders

When generating job cards from an order line:
1. Load the product's BOM
2. Apply `bom_overrides` — swap components for overridden lines
3. Use `cutlist_snapshot` for cutting instructions (not the product-level cutlist)

### Purchasing

When creating purchase orders from an order's BOM:
- Use the effective BOM (with overrides) to determine which components to procure
- Substituted components reference the correct supplier

### Cutting Diagram PDF

The existing cutting diagram generator should accept the order-level aggregated cutlist as input, not just product-level cutlist groups.

## Migration Path from Option Sets

- Option sets system remains untouched (no breaking changes)
- Products can gradually migrate: turn on `is_substitutable` on BOM lines, remove option set links
- Once all products are migrated, option sets can be deprecated
- All option set tables stay until formal deprecation

## Scope Boundaries

**In scope:**
- `is_substitutable` flag on BOM lines
- `bom_overrides` JSONB on order details
- `cutlist_snapshot` JSONB on order details
- Configuration dialog when adding products to orders
- Category-filtered searchable combobox for substitution
- Cutlist review/edit at order line level
- Order-level cutlist export (aggregated)
- Live cost preview
- Effective BOM resolution for downstream

**Out of scope (future):**
- Curated preferred substitutes list per BOM line
- Substitution groups (narrower than categories)
- Customer-facing self-configuration (e-commerce)
- Bulk substitution across multiple order lines
- Deprecation/removal of option sets system
- Auto-nesting optimization in the cutlist export

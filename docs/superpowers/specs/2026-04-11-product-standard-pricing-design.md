# Product Standard Pricing

**Date:** 2026-04-11
**Status:** Approved

## Overview

Add a pricing section to the product Costing tab that lets users set a standard selling price based on a markup (percentage or fixed amount) over unit cost. The data model supports multiple named price lists for future expansion, but the UI initially shows only a single "Standard" price.

## Placement

Inside the **Costing tab → Summary sub-tab**, directly below the cost summary card (hero unit cost + composition bar) and above the category cards.

## UI Design

### Markup Controls

- **Markup Type toggle** — segmented control switching between `% Percentage` and `R Fixed`
- **Markup value input** — numeric input for the markup amount (percentage or rand value)

### Price Flow Display

Visual horizontal layout: **Unit Cost** + **Markup (amount)** = **Selling Price**

- Unit Cost card — reads from the existing computed `unitCost` (materials + labor + overhead)
- Markup card — shows the calculated markup amount (amber text), with the percentage/fixed label
- Selling Price card — green-highlighted card showing the final price, with an editable amount so estimators can round or override the customer-facing price directly

### Footer Info

- Margin percentage (profit / selling price × 100)
- Profit per unit (selling price − unit cost)

### Summary Composition

- Before pricing exists, the Costing summary card shows **Total Unit Cost** with a stacked composition bar for materials, labor, and overhead.
- Once a standard selling price exists with profit above unit cost, the same card becomes **Selling Price Breakdown** and uses selling price as the denominator.
- The selling price breakdown bar includes materials, labor, overhead, and profit so the estimator can see where the customer-facing price goes.

### Save

- "Save Price" button, right-aligned
- Saves markup type, markup value, and computed selling price to the database
- If the estimator edits the selling price directly, save it as a fixed-rand markup equal to `selling_price - unitCost`
- Button disabled when no changes or when unit cost is zero

### Reactive Behaviour

- Selling price recalculates live as the user types a markup value
- Direct selling price edits recalculate the displayed profit and margin immediately
- If unit cost changes (BOM/BOL/overhead edits), the pricing section recalculates based on the saved markup type and value
- The "markup below target" warning should tolerate normal currency rounding so an effective markup that rounds to the saved target does not warn as below target
- When a saved percentage target exists, direct selling price edits should keep the warning visible if the typed price would fall below that target
- If no markup has been saved yet, the section shows empty/zero state with placeholder guidance

## Data Model

### `product_price_lists`

Holds named price lists. Starts with a single seed row.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | Default `gen_random_uuid()` |
| `org_id` | `uuid` FK → `organizations` | NOT NULL |
| `name` | `text` | NOT NULL, e.g. "Standard" |
| `description` | `text` | Nullable |
| `is_default` | `boolean` | Default `true` — marks the standard list |
| `created_at` | `timestamptz` | Default `now()` |

RLS: `org_id = (SELECT org_id FROM organization_members WHERE user_id = auth.uid())`

### `product_prices`

Stores per-product pricing within a price list.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | Default `gen_random_uuid()` |
| `org_id` | `uuid` FK → `organizations` | NOT NULL |
| `product_id` | `integer` FK → `products` | NOT NULL |
| `price_list_id` | `uuid` FK → `product_price_lists` | NOT NULL |
| `markup_type` | `text` | `'percentage'` or `'fixed'`, NOT NULL |
| `markup_value` | `numeric(12,2)` | NOT NULL |
| `selling_price` | `numeric(12,2)` | NOT NULL — computed at save time |
| `updated_at` | `timestamptz` | Default `now()` |
| `created_at` | `timestamptz` | Default `now()` |

Unique constraint: `(product_id, price_list_id)`

RLS: same `org_id` check via `is_org_member()`

### Seed Data

On migration, insert one row into `product_price_lists` per existing org:

```sql
INSERT INTO product_price_lists (org_id, name, is_default)
SELECT id, 'Standard', true FROM organizations;
```

## Quote Integration

When a product is added to a quote item, look up the product's standard price (default price list) and use it as the initial `unit_price` on the quote cluster line. The user can still override per quote — the standard price is just the default.

This is a follow-up enhancement, not part of the initial build. The initial scope is the pricing section on the product page only.

## Files to Modify

- **New migration** — create `product_price_lists` and `product_prices` tables with RLS
- **`components/features/products/product-costing.tsx`** — add pricing section below the cost summary in the summary sub-tab
- **New hook** — `hooks/useProductPricing.ts` — fetch/save product price for the default price list
- **Schema refresh** — run `npm run schema` after migration

## Out of Scope

- Multiple named price lists UI (future)
- Auto-populating quote prices from standard price (future enhancement)
- Price history / audit trail
- Bulk price updates across products

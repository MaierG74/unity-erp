# Collapsible Sub-Product Rows in Costing

**Date:** 2026-04-15
**Status:** Approved
**Scope:** Product Costing tab — Materials and Labor sections

## Problem

When a product has linked (phantom) sub-products, the sub-product's BOM and BOL items are exploded into the parent's costing tables as flat rows. Users cannot distinguish which items belong to the parent product vs which come from a sub-assembly like a "6 Bend Square Visitor Frame." This creates confusion about what's actually being manufactured and makes it hard to reason about costs at the sub-assembly level.

## Design

### Collapsed State (Default)

Sub-product items are grouped into a single summary row:

- **Background:** Subtle teal tint (`rgba(45,212,191,0.08)`)
- **Left content:** `▶` expand arrow + `SUB-PRODUCT` badge (teal pill) + product name (clickable link, opens sub-product page in new tab) + "· N items" count
- **Right content:** Scale quantity + rolled-up total cost in teal
- **Unit Price column:** Shows `—` (not meaningful for a grouped row)

### Expanded State (On Click)

Clicking the row or arrow expands to show:

- **Header row:** Same as collapsed but with `▼` arrow
- **Child rows:** Indented (left padding ~28px) with a 2px teal left border. Text is slightly muted compared to direct BOM items. Child rows are **read-only** — no edit/delete actions.
- Clicking the header row again collapses back.

### Applies to Both Tabs

- **Materials tab:** Groups `effective-bom` items where `_source === 'link'` by `_sub_product_id`
- **Labor tab:** Groups `effective-bol` items where `_source === 'link'` by `_sub_product_id`

### Sub-Product Name Link

Clicking the sub-product name in the header row navigates to `/products/{sub_product_id}?tab=costing` in a **new browser tab** (`target="_blank"`).

### Cost Drivers (Summary Tab)

No changes needed — sub-products already appear as single line items in Cost Drivers.

## Data Flow

The effective BOM/BOL APIs already return `_source` (`'direct'` | `'link'`) and `_sub_product_id` on each item. The grouping is purely a UI concern:

1. Partition items by `_source`
2. Group `link` items by `_sub_product_id`
3. For each group, fetch sub-product name (already available via the `product_bom_links` query or a lightweight lookup)
4. Render direct items as normal rows, linked groups as collapsible sections

## Files to Modify

- `components/features/products/product-costing.tsx` — Materials table rendering, add grouping logic and collapsible rows
- Labor table rendering (same file or its sub-component) — same pattern
- May need to enrich the effective-bom/bol API response with sub-product name if not already included

## Out of Scope

- Stocked sub-assembly mode (Phase 2 — separate work)
- Editing child items from the parent view
- Recursive multi-level nesting display
- Changes to the BOM editing tab (`product-bom.tsx`) — this is costing view only

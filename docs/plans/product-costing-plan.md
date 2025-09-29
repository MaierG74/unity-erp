# Product Costing Plan

Purpose: Provide a single place to see a product’s full unit cost combining materials (BOM) and labor (BOL), with clear assumptions and “as of” context.

## Placement (UX)
- Primary: Add a new tab on the product page named `Costing`.
  - Rationale: avoids crowding `Details`, keeps BOM/BOL focused, and follows common ERP convention (summary tab with drill‑downs).
- Secondary surfacing: show a compact cost pill in the header (e.g., `Unit Cost: R560.70`) that links to the Costing tab.

## Cost Model (v1)
- Materials cost: sum over BOM rows of `quantity_required * unit_price`.
  - Use `suppliercomponents.price` when `supplier_component_id` is set; otherwise show `—` and treat as 0 with a warning.
  - Note: no currency conversion in v1; assumes one currency.
- Labor cost: sum over BOL rows using mixed pay types.
  - Hourly lines: `(time_required in hours) * quantity * hourly_rate` with rate from `job_category_rates` effective today (or `job_categories.current_hourly_rate` fallback).
  - Piecework lines (planned): `quantity * piece_rate` with rate from `piece_work_rates` effective today using `(job_id, product_id)` or job default.
- Unit cost: `materials_cost + labor_cost`.
- Optional fields (later): overhead %, scrap %, freight, margin %, and target price.

## Data Sources
- BOM: `billofmaterials` with joins to `components` and `suppliercomponents`.
- BOL: `billoflabour` with joins to `jobs`, `job_categories`, and `job_category_rates`; for piecework, join `piece_work_rates` via `piece_rate_id` (planned).
- Collections: costs already flow into BOM rows when collections are applied. (Attach mode will be accounted for by the effective BOM resolver in a future phase.)

## UI Layout (Costing Tab)
- Summary cards at top:
  - Materials Cost, Labor Cost, Unit Cost
  - Optional: Overhead, Margin, Suggested Price (future)
- Two breakdown tables:
  - Materials Breakdown: Component code, description, qty, unit price, line total, provenance (if from collection).
  - Labor Breakdown: Category, job, time, qty, hourly rate, line total.
- Context footer: `As of <date/time>`, rate/version notes, and warnings for missing prices.

## Behavior Notes
- Real‑time: When BOM/BOL rows change, the Costing tab recomputes via queries.
- Missing prices: Show warnings and subtotal excluding missing items.
- “As of” rates: reads the current effective hourly or piecework rate (later: date selector to recalc historically).

## Implementation Sketch
- Component: `components/features/products/product-costing.tsx` (client) using React Query.
- Queries:
  - Materials: select `product_id, component_id, quantity_required, supplier_component_id, suppliercomponents(price)`.
  - Labor hourly: select `job_id, time_required, time_unit, quantity, job_category_rates(hourly_rate)`; convert minutes/seconds to hours.
  - Labor piecework (planned): select `quantity, piece_rate_id, piece_work_rates(rate)` when `pay_type='piece'`.
- Aggregate in component and display totals and tables.
- Optional API: `GET /api/products/:id/cost` to compute server‑side (useful for PDFs); not required for v1.

## Future Phases
- Attach (dynamic) integration via `effective_bom_view` or `lib/collections.resolveEffectiveBOM`.
- Overhead/scrap/markup modeling.
- Multi‑currency / supplier selection scenarios.
- Snapshotting costs at quote/WO creation time.

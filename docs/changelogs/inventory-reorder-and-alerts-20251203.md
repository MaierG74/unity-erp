# Inventory Reorder Level + Reports Fixes (2025-12-03)

## Summary
- Added minimum stock (`reorder_level`) and `location` fields to the Edit Component dialog and component Overview tab.
- Enforced a one-to-one `inventory` record per component (unique constraint on `inventory.component_id`) and updated frontend code to treat inventory as a single object instead of an array.
- Fixed low stock calculations in the Inventory → Reports tab, ensuring components with `quantity_on_hand` > 0 but ≤ `reorder_level` show up in the Low Stock Alert card.
- Added a reorder level reference line to the stock movement chart on the component detail page.
- Broadened React Query invalidation and Supabase RLS policies so inventory updates and reports refresh immediately for authenticated/anon sessions.

## Details
### Component Editing & Inventory Normalization
- `EditComponentDialog` now loads and saves `reorder_level` + `location` alongside core component fields. Submission upserts the `inventory` record so components without prior inventory rows inherit correct defaults.
- `inventory` table now enforces a unique `component_id`, allowing deterministic upserts and removing duplicate rows.
- Component detail, overview, transactions, reports, and list tabs were updated to treat `component.inventory` as a single object (Supabase returns `{ ... }` when the relationship is one-to-one). Helper utilities were added to fall back gracefully when no inventory record exists.

### Low Stock Alerts & Reports
- The Reports tab runs a fresh query on each visit/refresh and classifies stock into `inStock`, `lowStock`, and `outOfStock`. Low stock now explicitly checks `reorder_level > 0` to avoid noise from components without thresholds.
- Added debugging hooks (now removed) to verify Supabase data; discovered RLS gaps and fixed them via dedicated policies for `authenticated` and `anon` roles.
- UI cards now display accurate counts (e.g., DS40229 shows 45 on hand with a reorder level of 100 and correctly appears in Low Stock Alert).

### Stock Movement Chart
- `StockMovementChart` accepts a `reorderLevel` prop and renders a dashed orange `ReferenceLine` when the level is > 0.
- `TransactionsTab` and the component detail page pass the normalized `reorder_level` all the way through so the chart remains consistent with overview metrics.

### RLS & React Query
- Added Supabase policies granting SELECT/INSERT/UPDATE/DELETE on `public.inventory` for the `authenticated` role plus a read policy for `anon` to cover unauthenticated flows.
- React Query caches for `['inventory', ...]` keys are invalidated after edits to ensure the Reports tab, component list, and detail views immediately reflect new stock levels/thresholds.

## Follow-up
- Monitor the TODO index for further inventory backlog items (e.g., automated replenishment suggestions, digest emails).
- Future enhancements: tie reorder level changes to audit logs, expose location in supplier order creation, and surface `location` filters in Components tab.

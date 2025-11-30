## Components Module Plan

This plan tracks improvements to the Components/Inventory module. Treat as a working roadmap.

### Objectives
- Unify the two inventory page variants into a single, consistent UX.
- Standardize Supabase client usage and data access patterns.
- Improve performance and reliability for large datasets.
- Harden permissions and validation.

### Near-Term Tasks
- Decide canonical page: adopt `inventory-client` composition or `page.tsx` with `DataTable`.
- Standardize to one Supabase client import (`lib/supabase`).
- Consolidate `DataGrid` and `DataTable` into a single abstraction or choose one.
- Add server-side API endpoints for inventory CRUD and use them from the client.
- Add supplier filter to `InventoryFilters` if keeping the modular client.

### Performance
- Move filtering/pagination to server-side with query params (search, category, supplier, stock level, sort, page, size).
- Add indexes on `components.internal_code`, `components.category_id`, `inventory.component_id`, `suppliercomponents.component_id` if not present.

### UX/Features
- Bulk edits and CSV import/export.
- Better image management (drag/paste already supported; add thumbnailing/background worker).
- Reorder suggestions and alerts based on `reorder_level` and open orders.
- Audit trail on edits and stock adjustments.

### Testing
- Unit tests for mutation hooks.
- Integration tests for dialog flows and inline edits.
- E2E coverage for search/filter/sort and transactions view.

### Risks
- Client-side direct Supabase writes require careful RLS; server routes would centralize validation.
- Large joined queries can be slow; server pagination required.

### Open Questions
- Which table abstraction to keep? (`DataGrid` vs `DataTable`).
- Where should supplier linking live: in dialog only or inline too?

Keep this file in sync with decisions and progress.



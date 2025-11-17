# Products Section Upgrade Plan

Status: Draft – v0.1  
Owner: Unity ERP Frontend  
Last updated: 2025-01-??

## Why this project

The Inventory section overhaul delivered a tabbed detail view, global transaction explorer, and actionable reports (critical shortages, low stock cards, RPC-backed analytics). The Products area still relies on the legacy `/src/pages.old` table and a monolithic detail view, so PMs cannot inspect finished-good (FG) coverage, transactions, or risk signals directly. This plan brings the Products experience to parity with Inventory and extends reporting to finished goods.

## Goals

1. Replace the legacy products list/detail UI with a tabbed, React Query–driven experience consistent with `app/inventory/components/[id]`.
2. Surface FG transactions, reservations, and demand signals so planners can diagnose shortages without leaving the Products module.
3. Provide reports (low stock, out of stock, critical FG) similar to `components/features/inventory/ReportsTab.tsx`, but tailored to finished goods and costing.
4. Keep Supabase/RPC contracts aligned with Inventory so shared analytics (e.g., `get_global_component_requirements`) and permissions remain consistent.

## Latest progress

- Added a global `Transactions` tab under `/products` that queries `product_inventory_transactions`, supports search/type filters, and mirrors the Inventory experience (Jan 2025).
- Introduced an interim `Reports` snapshot that summarizes finished-good totals, reservations, and low/out-of-stock counts while deeper analytics are built.
- Per-product detail view now includes a dedicated Transactions tab, click-to-open navigation from the catalog list, and an image gallery that updates immediately after delete/set-primary actions (Jan 2025).

## Upcoming focus: detail-page parity (Sprint proposal)

| Track | Key steps | Notes |
|-------|-----------|-------|
| Detail shell | 1) Extract the current monolithic `app/products/[productId]/page.tsx` into tab components under `components/features/products/product-detail/*`, mirroring the inventory component detail folder. 2) Move data loading to React Query hooks (`useProduct`, `useProductInventory`, `useProductReservations`, etc.) so each tab can refresh independently. 3) Add skeleton states + optimistic cache updates for FG actions. | Enables code reuse, easier testing, and React Query invalidation parity. |
| Navigation UX | 1) Update the catalog list (temporary: `ProductsTable`) so clicking any row or pressing Enter navigates straight to `/products/[product_id]`; keep row actions for secondary operations. 2) Add breadcrumb/back link in the detail header consistent with Inventory detail pages. | Removes “open menu → edit” friction and keeps flow consistent across modules. |
| FG Transactions tab (per-product) | 1) Create `ProductTransactionsTab` (detail scope) that filters `product_inventory_transactions` by `product_id`, includes timeline view, and exposes “view in global feed” shortcut. 2) Ensure add/remove FG RPCs write rows with references (order id, note). 3) Show linked orders with quick nav. | Reuses the global tab query but narrows context. |
| Analytics tab | 1) Embed finished-good coverage: on-hand vs reserved vs required for active orders (reuse order/BOM logic used in inventory analytics). 2) Surface costing insights (avg unit cost, margin alerts) via existing costing component data. 3) Prepare placeholders for future charts (lead time, throughput). | Bridges the gap until full reports land. |
| Media & image management | 1) Audit `ImageGallery` interactions—currently delete/set-primary do not trigger state updates reliably. Convert to fully controlled component driven by React Query data so UI refreshes immediately after mutations. 2) Add optimistic updates + loading indicators for uploads/deletes, and expose “Replace primary image” action. 3) Investigate Supabase storage cleanup (delete object when record removed). | Addresses current “cannot delete or change images” issue. |
| Documentation | 1) Expand this plan with per-track acceptance criteria. 2) Update `docs/domains/components/components-section.md` (or new products doc) once detail page ships, highlighting navigation and image-management flows. | Keeps knowledge base current. |

### High-level implementation plan

1. **Data/API alignment**
   - Define shared hooks (`useProduct`, `useProductInventoryTransactions`, etc.) and ensure RPC/view coverage (consider `product_transactions_v` with order + user info).  
   - Add missing columns (e.g., `updated_at`, `user_id`) and ensure triggers log FG adds/removes.
2. **Detail page refactor**
   - Convert page to wrapper that loads product + FG stats and renders new tab components.  
   - Tabs to build first: Overview (details + FG cards), Inventory (location grid + add FG), BOM, Media, Transactions, Analytics.
3. **Navigation polish**
   - Update product list row interactions + breadcrumbs; add optional inline quick filters for “View detail” vs “Edit”.  
   - Provide deep links (e.g., `/products/[id]?tab=transactions`).
4. **Media fixes**
   - Ensure ImageGallery updates Supabase data and storage, provide delete confirmation, and emit `onMutate` events to React Query caches.
5. **Testing + docs**
   - Add Playwright smoke test covering row click → detail navigation, FG transaction listing, and image delete/upload.  
   - Document workflow updates + release in changelog.

## Out of scope

- Changing FG reservation business rules (existing RPCs stay as-is).  
- Revisiting BOM editing logic or cutlist authoring workflows beyond shelling them into dedicated tabs.  
- Major redesign of costing inputs; we only surface existing data.

## High-level workstream map

| Workstream | Description | Owners |
|------------|-------------|--------|
| Data & API | Define any missing SQL views/RPCs (e.g., `product_transactions_v`, finished-good analytics). Ensure Supabase policies support new queries. | Backend / DB |
| List Experience | Rebuild `/products` index with modern filters, saved views, and quick links into detail tabs. Replace `src/pages.old/products/ProductsPage.tsx`. | Frontend |
| Detail Tabs | Split current detail page into modular tabs (Overview, Edit, Inventory, BOM, Options, Cutlist, Media, Transactions, Reports/Analytics). | Frontend |
| Transactions & Reports | Mirror Inventory’s `TransactionsTab` + `ReportsTab` UX for FG data; add shortage/coverage cards for finished goods. | Frontend + DB |
| Documentation & Rollout | Update docs/README references, domain docs, changelog. | Docs |

## Detailed requirements

### 1. Unified tabbed detail page
- Use the same tab scaffold as `app/inventory/components/[id]/page.tsx`.
- Tabs: Overview, Edit, Inventory (location-level FG quantities), BOM, Options, Cutlist, Media, Transactions, Reports, Settings (optional).
- Each tab lives under `components/features/products/product-detail/`.
- Tabs consume React Query caches keyed by `['product', productId, tab]` for predictable invalidation (mirrors component detail).

### 2. Transactions parity
- Build `product_transactions_v` Supabase view (or RPC) that aggregates FG add/remove events, reservations, shipments, manual adjustments. Columns: `transaction_id`, `product_id`, `type`, `quantity`, `balance`, `order_reference`, `user_id`, `notes`, `created_at`.
- Global `ProductsTransactionsTab` component copies the Inventory UX: search, type filter, summary cards, 500-row cap, refresh button.
- Per-product `TransactionsTab` displays timeline filtered by `product_id`, with badges for source (“Add FG”, “Shipment”, “Reservation”).
- Ensure FG operations (add FG API, reservation RPCs, shipments) insert rows into the new view/table.

### 3. Reports & analytics
- Create `ProductsReportsTab` mirroring stock status cards: total FG SKUs, available vs reserved, low stock (at/below reorder), out of stock.
- Add “Critical Finished Goods” table (similar to Inventory critical components) that uses existing FG coverage logic plus open-order demand (orders without shipped status).
- Include costing highlights (avg unit cost, margin bands) by reusing `components/features/products/product-costing.tsx` data pipeline; show top 5 low-margin SKUs.
- Include filterable exports (CSV or copy-to-clipboard) for planners.

### 4. Products index upgrades
- Replace `/app/products/page.tsx` import of `ProductsPage` with a new Next.js server component built around `components/features/products/ProductsTab`.
- Feature parity with Inventory list: sticky filters (category, status, search), virtualization, “last updated” indicator, jump-to component detail.
- Bake in quick metrics (FG on hand, reserved, open orders) inside rows so planners see health at a glance.
- Support multi-select + bulk actions (e.g., open add-FG dialog, export BOM).

### 5. Supabase / RPC updates
- New view/RPC definitions live under `db/migrations/` with documentation in `docs/technical/supabase-query-patterns.md`.
- Reuse existing FG RPCs (`reserve_finished_goods`, `release_finished_goods`, `consume_finished_goods`) but emit transaction rows via triggers.
- Add policy tests to ensure read access for `select` queries used by the UI.

### 6. Documentation & rollout
- Update `docs/README.md` quick links to include the new plan.
- Extend `docs/domains/components/components-section.md` (or create `docs/domains/components/products-master.md`) with finished-good reporting details.
- Log release in `docs/changelogs/products-fg-upgrade-YYYYMMDD.md`.

## Milestones

1. **Planning complete** (this doc, RPC list, design sketches) – target +1 week.
2. **Data foundation** (views + triggers) – +2 weeks.
3. **New products list + detail scaffold** – +3 weeks.
4. **Transactions + reports parity** – +5 weeks.
5. **QA + documentation** – +6 weeks.

## Open questions / risks

- Do we need a direct mapping between FG transactions and component transactions for reconciliation? (If yes, we may store linkage IDs.)
- Will FG reservations ever require multi-site awareness? Inventory tabs assume single-site.
- Performance implications of joining BOM + orders for analytics; may need materialized views or caching.

Track answers here before moving into implementation.

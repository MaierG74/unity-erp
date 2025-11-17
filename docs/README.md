# Unity ERP Documentation

Welcome to the Unity ERP knowledge base. The documentation is now organized by topic so that product, design, and engineering contributors can quickly find the right starting point.

Start with the [TODO Index](overview/todo-index.md) when triaging work—it aggregates open items from domain docs, changelogs, and technical references so you know which source to consult next.

## Directory structure

- `overview/` – High-level orientation docs. Start here for the overall roadmap (`master-plan.md`), platform style guide, auth overview, and the AI assistant vision.
- `domains/`
  - `orders/` – Day-to-day order operations, including the master guide and reset instructions.
  - `purchasing/` – Purchasing workflows and reset checklist.
  - `components/` – Component modelling, product creation, and subcomponent execution references.
  - `timekeeping/` – Labor and time & attendance implementation notes.
  - `suppliers/` – Supplier master data standards and flows.
- `operations/` – Cross-cutting operational procedures such as the Bill of Labor system, sidebar updates, and logging guidance.
- `plans/` – Implementation plans and project briefs (`*-plan.md` / `*-plan.txt`).
- `changelogs/` – Historical release notes and change summaries.
- `technical/` – Technical guides and troubleshooting documentation for developers.
- `../migrations/` – Database migration files (see [`../migrations/README.md`](../migrations/README.md) for details)
- `scopes/` – Client-friendly scope summaries for Unity ERP modules and the overall platform.

## Quick links

- Overview
  - [`overview/master-plan.md`](overview/master-plan.md)
  - [`overview/STYLE_GUIDE.md`](overview/STYLE_GUIDE.md)
  - [`overview/auth.md`](overview/auth.md)
  - [`overview/AI Assistant.md`](overview/AI%20Assistant.md)
- Domains
  - Orders: [`domains/orders/orders-master.md`](domains/orders/orders-master.md)
  - Purchasing: [`domains/purchasing/purchasing-master.md`](domains/purchasing/purchasing-master.md)
  - Components: [`domains/components/components-section.md`](domains/components/components-section.md)
  - Inventory: [`domains/components/inventory-master.md`](domains/components/inventory-master.md), [`domains/components/inventory-transactions.md`](domains/components/inventory-transactions.md)
  - Timekeeping: [`domains/timekeeping/labor-section.md`](domains/timekeeping/labor-section.md)
  - Suppliers: [`domains/suppliers/suppliers-master.md`](domains/suppliers/suppliers-master.md)
- Operations:
  - [`operations/BOL_SYSTEM.md`](operations/BOL_SYSTEM.md)
  - [`operations/cutlist-standalone.md`](operations/cutlist-standalone.md)
  - [`operations/email-integration.md`](operations/email-integration.md)
  - [`operations/chrome-devtools-mcp.md`](operations/chrome-devtools-mcp.md)
  - [`operations/quote-email-implementation.md`](operations/quote-email-implementation.md) – ✅ Quote email implementation summary (completed)
- Plans: [`plans/`](plans/) – implementation briefs such as `quoting-module-plan.md`, `quote-email-plan.md`, `time-attendance-plan.md`, `cutlist-nesting-plan.md`, and other project plans
  - New: [`plans/permissions-and-logging-plan.md`](plans/permissions-and-logging-plan.md) – unified roadmap for role-based access control, permissions UI, and audit logging rollout
  - New: [`plans/todo-module-plan.md`](plans/todo-module-plan.md) – To-Do module planning doc covering cross-module task assignments
  - New: [`plans/products-section-upgrade.md`](plans/products-section-upgrade.md) – Modernize the Products area with inventory-parity tabs, transactions, and finished-good reports
  - New: [`plans/purchase-order-return-communications-plan.md`](plans/purchase-order-return-communications-plan.md) – Return Goods UX, document, and supplier email improvements
  - Completed: [`plans/stock-issuance-plan.md`](plans/stock-issuance-plan.md) – Stock issuance from customer orders (see [`changelogs/stock-issuance-implementation-20250104.md`](changelogs/stock-issuance-implementation-20250104.md) for implementation)
  - Completed: [`plans/fix-on-order-calculation-inner-join.md`](plans/fix-on-order-calculation-inner-join.md) – Fix "On Order" calculation with INNER JOIN patterns (see [`changelogs/on-order-calculation-fix-20250110.md`](changelogs/on-order-calculation-fix-20250110.md) for implementation)
  - New: [`plans/supplier-returns-plan.md`](plans/supplier-returns-plan.md) – Return goods to suppliers (rejections and later returns)
  - Completed: [`plans/quote-email-plan.md`](plans/quote-email-plan.md) – Quote PDF email integration plan (see [`operations/quote-email-implementation.md`](operations/quote-email-implementation.md) for implementation)
- Changelogs: [`changelogs/`](changelogs/)
  - [`changelogs/supplier-returns-rpc-overload-fix-20250113.md`](changelogs/supplier-returns-rpc-overload-fix-20250113.md) – Dropped legacy RPC overload to fix supplier return execution errors
  - [`changelogs/on-order-calculation-fix-20250110.md`](changelogs/on-order-calculation-fix-20250110.md) – Fixed "On Order" calculation discrepancies with INNER JOIN patterns and corrected supplier order statuses
  - [`changelogs/purchase-orders-date-filtering-verification-20250115.md`](changelogs/purchase-orders-date-filtering-verification-20250115.md) – Purchase orders date filtering verification and documentation
  - [`changelogs/nextjs-server-build-fix-20251107.md`](changelogs/nextjs-server-build-fix-20251107.md) – Fixed Next.js server build errors by removing webpack cache overrides
  - [`changelogs/supplier-components-search-fix-20251105.md`](changelogs/supplier-components-search-fix-20251105.md) – Fixed component search functionality in Supplier Components tab for adding/editing supplier component mappings
  - [`changelogs/todo-module-fixes-20251008.md`](changelogs/todo-module-fixes-20251008.md) – Todo module fixes: date format, RLS, profiles backfill
  - [`changelogs/todo-entity-link-picker-fix-20251009.md`](changelogs/todo-entity-link-picker-fix-20251009.md) – Entity link picker API and UI fixes
  - [`changelogs/quotes-cutlist-display-20251028.md`](changelogs/quotes-cutlist-display-20251028.md) – Cutlist export costing rows now display alongside manual lines in quotes
  - [`changelogs/inventory-responsive-performance-improvements-20250102.md`](changelogs/inventory-responsive-performance-improvements-20250102.md) – Inventory Components responsive design and performance optimizations
  - [`changelogs/stock-issuance-implementation-20250104.md`](changelogs/stock-issuance-implementation-20250104.md) – Stock issuance feature implementation with BOM integration and PDF generation
  - [`changelogs/inventory-component-detail-supplier-dialog-20250115.md`](changelogs/inventory-component-detail-supplier-dialog-20250115.md) – Component detail page supplier dialog improvements and products page build fix
  - [`changelogs/purchase-orders-date-filtering-verification-20250115.md`](changelogs/purchase-orders-date-filtering-verification-20250115.md) – Purchase Orders date filtering verification and documentation
  - [`changelogs/supplier-orders-reports-20250115.md`](changelogs/supplier-orders-reports-20250115.md) – Supplier Orders and Reports tabs implementation with filtering and analytics
- Analysis: [`analysis/`](analysis/)
  - [`analysis/inventory-components-performance-review.md`](analysis/inventory-components-performance-review.md) – Performance and responsiveness review of Components section
- Technical Guides: [`technical/`](technical/)
  - [`technical/supabase-query-patterns.md`](technical/supabase-query-patterns.md) – Supabase query patterns, common errors, and troubleshooting
  - [`technical/smoke-tests.md`](technical/smoke-tests.md) – How to run the Purchasing smoke test
  - See also: [`changelogs/nextjs-server-build-fix-20251107.md`](changelogs/nextjs-server-build-fix-20251107.md) for Next.js build troubleshooting
- Migrations: [`../migrations/README.md`](../migrations/README.md) – Database migration files and instructions
- Scope Documents:
  - [`scopes/Unity_ERP_Scope.md`](scopes/Unity_ERP_Scope.md) – High-level Unity ERP system overview
  - [`scopes/scope_authentication.md`](scopes/scope_authentication.md) – Authentication and User Roles mini scope

Use relative links when creating new docs so that navigation remains stable across moves. When referencing plans, prefer `docs/plans/...` paths to keep the directory consistent.

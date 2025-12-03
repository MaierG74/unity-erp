# Unity ERP Documentation

Welcome to the Unity ERP knowledge base. The documentation is now organized by topic so that product, design, and engineering contributors can quickly find the right starting point.

Start with the [TODO Index](overview/todo-index.md) when triaging work—it aggregates open items from domain docs, changelogs, and technical references so you know which source to consult next.

## Directory structure

- `overview/` – High-level orientation docs. Start here for the overall roadmap (`master-plan.md`), platform style guide, auth overview, and the AI assistant vision.
- `deployment/` – Production deployment guides, environment configuration, and operational procedures.
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
  - [`operations/deployment-guide.md`](operations/deployment-guide.md) – **Production deployment guide** (Netlify, env vars, rollback)
  - [`operations/BOL_SYSTEM.md`](operations/BOL_SYSTEM.md)
  - [`operations/cutlist-standalone.md`](operations/cutlist-standalone.md)
  - [`operations/email-integration.md`](operations/email-integration.md)
  - [`operations/chrome-devtools-mcp.md`](operations/chrome-devtools-mcp.md)
  - [`operations/quote-email-implementation.md`](operations/quote-email-implementation.md) – ✅ Quote email implementation summary (completed)
  - [`operations/airtable-sync-runbook.md`](operations/airtable-sync-runbook.md) – Airtable migration/sync checklist and incident response guide
- Plans: [`plans/`](plans/) – implementation briefs such as `quoting-module-plan.md`, `quote-email-plan.md`, `time-attendance-plan.md`, `cutlist-nesting-plan.md`, and other project plans
  - New: [`plans/permissions-and-logging-plan.md`](plans/permissions-and-logging-plan.md) – unified roadmap for role-based access control, permissions UI, and audit logging rollout
  - New: [`plans/todo-module-plan.md`](plans/todo-module-plan.md) – To-Do module planning doc covering cross-module task assignments
  - New: [`plans/products-section-upgrade.md`](plans/products-section-upgrade.md) – Modernize the Products area with inventory-parity tabs, transactions, and finished-good reports
  - New: [`plans/purchase-order-return-communications-plan.md`](plans/purchase-order-return-communications-plan.md) – Return Goods UX, document, and supplier email improvements
  - Completed: [`plans/stock-issuance-plan.md`](plans/stock-issuance-plan.md) – Stock issuance from customer orders (see [`changelogs/stock-issuance-implementation-20250104.md`](changelogs/stock-issuance-implementation-20250104.md) for implementation)
  - Completed: [`plans/fix-on-order-calculation-inner-join.md`](plans/fix-on-order-calculation-inner-join.md) – Fix "On Order" calculation with INNER JOIN patterns (see [`changelogs/on-order-calculation-fix-20250110.md`](changelogs/on-order-calculation-fix-20250110.md) for implementation)
  - New: [`plans/supplier-returns-plan.md`](plans/supplier-returns-plan.md) – Return goods to suppliers (rejections and later returns)
  - Completed: [`plans/quote-email-plan.md`](plans/quote-email-plan.md) – Quote PDF email integration plan (see [`operations/quote-email-implementation.md`](operations/quote-email-implementation.md) for implementation)
  - New: [`plans/inventory-traceability-po-consolidation-plan.md`](plans/inventory-traceability-po-consolidation-plan.md) – Inventory traceability through purchase cycle, PO consolidation, and reserved inventory system
- Changelogs: [`changelogs/`](changelogs/)
  - [`changelogs/november-2025-deployment-20251130.md`](changelogs/november-2025-deployment-20251130.md) – **November 2025 production deployment** (major release)
  - [`changelogs/inventory-component-ui-improvements-20251130.md`](changelogs/inventory-component-ui-improvements-20251130.md) – Inventory component page UI/UX improvements (header, tabs, gradients)
  - [`changelogs/inventory-issuance-and-deletion-fixes-20251202.md`](changelogs/inventory-issuance-and-deletion-fixes-20251202.md) – Manual issuance RPC, PDF workflow, and component deletion cleanup fixes
  - [`changelogs/stock-adjustment-feature-20251130.md`](changelogs/stock-adjustment-feature-20251130.md) – Stock adjustment feature for inventory corrections after stock take
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
  - [`changelogs/purchase-order-per-line-association-20251120.md`](changelogs/purchase-order-per-line-association-20251120.md) – `create_purchase_order_with_lines` now links each PO line to a specific customer order id
  - [`changelogs/grn-pdf-company-details-fix-20251121.md`](changelogs/grn-pdf-company-details-fix-20251121.md) – Fixed missing company details in Goods Returned (GRN) PDF generation
  - [`changelogs/nextjs-entrycss-runtime-fix-20251123.md`](changelogs/nextjs-entrycss-runtime-fix-20251123.md) – Documented the Next.js `entryCSSFiles` runtime failure and the Inter font loader fix
  - [`changelogs/purchase-order-edit-mode-20251126.md`](changelogs/purchase-order-edit-mode-20251126.md) – Added edit mode for Draft purchase orders (edit notes, quantities, delete line items)
- Analysis: [`analysis/`](analysis/)
  - [`analysis/inventory-components-performance-review.md`](analysis/inventory-components-performance-review.md) – Performance and responsiveness review of Components section
- Technical Guides: [`technical/`](technical/)
  - [`technical/supabase-query-patterns.md`](technical/supabase-query-patterns.md) – Supabase query patterns, common errors, and troubleshooting
  - [`technical/smoke-tests.md`](technical/smoke-tests.md) – How to run the Purchasing smoke test
  - [`technical/airtable-migration-guide.md`](technical/airtable-migration-guide.md) – Airtable → Supabase migration process plus MCP server configuration
  - [`technical/airtable-data-mapping.md`](technical/airtable-data-mapping.md) – Field-by-field Airtable to Supabase mapping reference
  - See also: [`changelogs/nextjs-server-build-fix-20251107.md`](changelogs/nextjs-server-build-fix-20251107.md) for Next.js build troubleshooting
- Migrations: [`../migrations/README.md`](../migrations/README.md) – Database migration files and instructions
 - Scope Documents:
  - [`scopes/Unity_ERP_Scope.md`](scopes/Unity_ERP_Scope.md) – High-level Unity ERP system overview
  - [`scopes/scope_authentication.md`](scopes/scope_authentication.md) – Authentication and User Roles mini scope
  - [`scopes/scope_inventory_stock_control.md`](scopes/scope_inventory_stock_control.md) – Inventory & Stock Control mini scope
  - [`scopes/scope_procurement_supplier_management.md`](scopes/scope_procurement_supplier_management.md) – Procurement & Supplier Management mini scope
  - [`scopes/scope_job_cards_work_orders.md`](scopes/scope_job_cards_work_orders.md) – Job Cards & Work Orders mini scope
  - [`scopes/scope_dashboard_reporting.md`](scopes/scope_dashboard_reporting.md) – Dashboard & Reporting mini scope
  - [`scopes/scope_invoicing_payments.md`](scopes/scope_invoicing_payments.md) – Invoicing & Payments mini scope
  - [`scopes/scope_integrations_automation.md`](scopes/scope_integrations_automation.md) – Integrations & Automation mini scope

Use relative links when creating new docs so that navigation remains stable across moves. When referencing plans, prefer `docs/plans/...` paths to keep the directory consistent.

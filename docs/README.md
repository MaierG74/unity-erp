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
  - Timekeeping: [`domains/timekeeping/labor-section.md`](domains/timekeeping/labor-section.md)
  - Suppliers: [`domains/suppliers/suppliers-master.md`](domains/suppliers/suppliers-master.md)
- Operations:
  - [`operations/BOL_SYSTEM.md`](operations/BOL_SYSTEM.md)
  - [`operations/cutlist-standalone.md`](operations/cutlist-standalone.md)
  - [`operations/email-integration.md`](operations/email-integration.md)
  - [`operations/chrome-devtools-mcp.md`](operations/chrome-devtools-mcp.md)
  - [`operations/quote-email-implementation.md`](operations/quote-email-implementation.md) – ✅ Quote email implementation summary (completed)
- Plans: [`plans/`](plans/) – implementation briefs such as `quoting-module-plan.md`, `quote-email-plan.md`, `time-attendance-plan.md`, `cutlist-nesting-plan.md`, and other project plans
- New: [`plans/todo-module-plan.md`](plans/todo-module-plan.md) – To-Do module planning doc covering cross-module task assignments
- Completed: [`plans/quote-email-plan.md`](plans/quote-email-plan.md) – Quote PDF email integration plan (see [`operations/quote-email-implementation.md`](operations/quote-email-implementation.md) for implementation)
- Changelogs: [`changelogs/`](changelogs/)
  - [`changelogs/todo-module-fixes-20251008.md`](changelogs/todo-module-fixes-20251008.md) – Todo module fixes: date format, RLS, profiles backfill
  - [`changelogs/todo-entity-link-picker-fix-20251009.md`](changelogs/todo-entity-link-picker-fix-20251009.md) – Entity link picker API and UI fixes
- Technical Guides: [`technical/`](technical/)
  - [`technical/supabase-query-patterns.md`](technical/supabase-query-patterns.md) – Supabase query patterns, common errors, and troubleshooting
- Migrations: [`../migrations/README.md`](../migrations/README.md) – Database migration files and instructions

Use relative links when creating new docs so that navigation remains stable across moves. When referencing plans, prefer `docs/plans/...` paths to keep the directory consistent.

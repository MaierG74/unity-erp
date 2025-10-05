# Unity ERP Documentation

Welcome to the Unity ERP knowledge base. The documentation is now organized by topic so that product, design, and engineering contributors can quickly find the right starting point.

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
- Plans: [`plans/`](plans/) – implementation briefs such as `quoting-module-plan.md`, `time-attendance-plan.md`, and other project plans
- New: [`plans/todo-module-plan.md`](plans/todo-module-plan.md) – To-Do module planning doc covering cross-module task assignments
- Changelogs: [`changelogs/`](changelogs/)
- Migrations: [`../migrations/README.md`](../migrations/README.md) – Database migration files and instructions

Use relative links when creating new docs so that navigation remains stable across moves. When referencing plans, prefer `docs/plans/...` paths to keep the directory consistent.

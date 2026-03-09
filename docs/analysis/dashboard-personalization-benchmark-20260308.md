# Dashboard Personalization Benchmark

Date: 2026-03-08

## Why This Research Was Done

The current Unity ERP dashboard started as a single generic homepage. The product question is whether ERP users should instead land on role-focused, configurable workspaces that emphasize the work they actually need to clear.

## Official ERP Patterns Reviewed

### Microsoft Dynamics 365 Business Central

- Business Central uses **Role Centers** as the main starting page for a user role, with role-specific cues and actions rather than one universal dashboard for everybody.
- Microsoft also documents user-level **personalization** so people can add/remove parts, move content, and create role-center bookmarks.
- Sources:
  - [Role Center](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-role-center)
  - [Personalize your workspace](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-personalization-user)
  - [Personalizing Role Centers with bookmarks](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-bookmarks)

### Oracle NetSuite

- NetSuite centers use **dashboard portlets** so users can assemble reminders, KPI meters, trend graphs, report snapshots, and shortcut lists.
- The most relevant pattern is that operational staff get modular, drillable widgets instead of a fixed executive-only layout.
- Sources:
  - [Dashboard portlets](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N679266.html)
  - [Reminders portlet](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N678294.html)

### SAP Business One

- SAP Business One documents the **Cockpit** as an operational homepage made up of widgets and workbench elements rather than a static report view.
- The product language emphasizes KPIs, alerts, and shortcuts in a single cockpit, which aligns more with task execution than passive reporting.
- Source:
  - [Cockpit](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/SAPbobsCOM~Cockpit.html)

### ERPNext

- ERPNext Workspaces are explicitly composed from **shortcuts, number cards, charts, and cards**.
- This is the clearest official example of an ERP product treating dashboards as configurable workspaces made from interchangeable blocks.
- Source:
  - [Workspace](https://docs.frappe.io/erpnext/user/manual/en/workspace)

## What These Sources Suggest For Unity ERP

These are inferences from the sources above rather than direct quotes:

- A single dashboard for every role is the exception, not the norm.
- ERP homepages work best when they are **role-entry surfaces** for action, not generic BI summaries.
- Operational users benefit more from **queues, shortages, approvals, receipts, and assigned work** than from total-order or revenue rollups.
- Personalization should be lightweight first: preset role views, widget visibility toggles, and saved quick links.
- The right long-term model is probably **org defaults + per-user overrides**, not only user-level customization.

## Recommended Unity ERP Dashboard Model

### 1. Start With Role Presets

Suggested starting presets:

- Purchasing Clerk
  - Low stock alerts
  - Purchasing queue
  - Assigned tasks
  - Purchasing quick actions
- General Manager
  - Executive stats
  - Revenue trend
  - Low stock alerts
  - Purchasing queue
  - Staff exceptions
- Operations Lead
  - Open-order/operations stats
  - Low stock alerts
  - Assigned tasks
  - Staff exceptions

### 2. Support Per-User Widget Visibility

- Let the user hide widgets that are not useful for their day-to-day work.
- Save preferences per user and per organization.
- Keep the first version simple: show/hide widgets, switch preset, reset to preset.

### 3. Bias Operational Dashboards Toward Queues

For purchasing specifically, the most useful widgets are likely:

- Items below reorder level
- Supplier lines awaiting receipt
- Pending approval purchase orders
- Supplier follow-up / overdue ETA list
- Assigned todo items

### 4. Separate Executive Reporting From Operational Work

- Executive metrics still matter, but they should not crowd out operational work widgets for clerks and coordinators.
- For users focused on execution, reporting widgets should be optional, not mandatory.

## Current Branch Example

This branch now includes a working dashboard personalization example:

- The default example view is **Purchasing Clerk**.
- Users can switch between presets and toggle widgets on the dashboard itself.
- Preferences are persisted per user, scoped by organization, in auth `user_metadata`.
- Two new operational widgets are included:
  - `My Tasks`
  - `Purchasing Queue`

## Recommended Follow-Up Slices

1. Add drag-and-drop widget ordering.
2. Add org-admin defaults by role/module so new users start from a sensible preset.
3. Add dedicated widgets for supplier ETA breaches, approvals, and production blockers.
4. Add a lightweight “My dashboard” settings surface under Settings/Profile if the inline dashboard customizer feels too prominent.

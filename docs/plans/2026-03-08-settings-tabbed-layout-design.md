# Settings Page — Tabbed Sidebar Layout

**Date:** 2026-03-08
**Status:** Approved

## Problem

The settings page is a single scrollable form with 6+ collapsible sections (~1,100 lines). As more settings are added, it's hard to find what you're looking for and hard to know where you are on the page.

## Solution

Replace the monolithic page with a **sidebar navigation layout**. Each settings category gets its own URL-routed page. A persistent sidebar on the left shows all sections grouped by domain.

## Route Structure

```
/app/settings/
  layout.tsx              ← sidebar + content shell
  page.tsx                ← redirect to /settings/company
  company/page.tsx        ← Company Details
  documents/page.tsx      ← Quote & PO Templates
  payroll/page.tsx        ← Week start, OT threshold
  schedules/page.tsx      ← Work Schedules (shift times, breaks)
  configurator/page.tsx   ← Board, overhang, gap defaults
  cutlist/page.tsx        ← Offcut thresholds
  option-sets/page.tsx    ← Already exists, stays as-is
  finished-goods/page.tsx ← Auto-consume toggle
```

## Sidebar Groups

| Group       | Items                              |
|-------------|------------------------------------|
| GENERAL     | Company Details                    |
| PRODUCTION  | Configurator, Cutlist, Option Sets |
| DOCUMENTS   | Templates                          |
| WORKFORCE   | Payroll, Work Schedules            |
| INVENTORY   | Finished Goods                     |

## Sidebar Behavior

- Uses `usePathname()` to highlight the active item
- Group headers: small uppercase text labels (muted color)
- Items: text links with left border accent when active
- `/settings` root redirects to `/settings/company`

## Page Extraction

Each page is self-contained with its own:
- Local state for form fields
- Save handler (individual save buttons per section — no global save)
- Loading/error states

Content extracted from the current `page.tsx`:
- **Company** (~250 lines): logo upload, name, address, contact, VAT, bank
- **Documents** (~200 lines): quote default terms, additional quote templates, PO contact/notice, CC email
- **Payroll** (~80 lines): week start select, OT threshold input
- **Schedules**: already a component (`WorkSchedulesContent`), minimal wrapper needed
- **Configurator** (~150 lines): all configurator default fields
- **Cutlist** (~80 lines): three numeric threshold fields
- **Finished Goods** (~40 lines): single auto-consume toggle
- **Option Sets**: already exists at `/settings/option-sets`, unchanged

## What Stays the Same

- All existing hooks (`useOrgSettings()`, company settings fetch, etc.)
- All API endpoints (`/api/settings`, `/api/document-templates`, etc.)
- Database schema — no migrations needed
- Individual save buttons per section
- Option Sets page (already separate)

## What Changes

- `layout.tsx` gains the sidebar navigation component
- Current `page.tsx` becomes a redirect
- Each section extracted into its own route page
- Work schedules sub-page at `/settings/work-schedules` moves to `/settings/schedules`

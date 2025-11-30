# Standalone Cutlist Calculator

This document records the behaviour and intent of the Cutlist calculator that now lives outside the Quotes workspace.

## Purpose
- Give production, estimating, or design staff a quick way to run sheet/edgebanding calculations without creating a quote line.
- Mirror the packing workflow of the Quotes tool so data entry is familiar and can be copy/pasted between the two experiences.
- Support side-by-side pricing for multiple melamine/edging combinations on the same run.

## Access & Navigation
- Reachable from the left navigation via **Cutlist** (between Quotes and To-Dos).
- Route: `/cutlist` (client component rendered under the authenticated shell).
- Breadcrumb link at the top returns the user to `/dashboard`.

## Page Structure
- **Layout & Inputs** (left column, wrapped in a card)
  - Embeds the shared `CutlistTool` with the full Costing tab.
  - Parts grid now includes a **Material** column. Clicking “Choose…” opens the component selector so you can pull sheet pricing straight from inventory or supplier records.
  - Results tab shows usage stats, sheet previews, and per-sheet billing overrides.
- **Quick Actions** (icons in the card header)
  - Snapshot icon opens a dialog that surfaces lamination state, sheet usage, and the per-material cost breakdown.
  - Info icon opens the condensed tips dialog explaining how defaults and the palette behave.

## Data Flow
- `CutlistTool` now accepts two props used by this page:
  - `onSummaryChange` receives `CutlistSummary` payloads whenever results update; the payload now contains `materials[]` entries with sheet/edgebanding/backer costs per palette item.
  - `persistCostingDefaultsKey="cutlist-standalone-costing"` instructs the tool to load/save costing descriptions + prices from `localStorage`, giving the backer board a persistent default.
- Material palette entries are persisted in `localStorage` (`cutlist-materials`) and written into quote snapshots for future editing.
- Selecting a material from the Inputs table either reuses an existing palette entry or creates/updates one by using the shared component selector (inventory or supplier component).
- Formatters use `Intl.NumberFormat('en-ZA', ...)` to stick with the unit and currency formatting used in Quotes.

## Differences vs. Quote Modal
- No export button — the page is intentionally standalone and does not push data anywhere else.
- Costing lives inside the familiar tab experience; component selection dialogs remain available for the primary/export material, while additional materials rely on manual pricing today.
- Standard materials persist across sessions thanks to the localStorage hooks for both defaults and the palette.
- The material palette and per-part material column are unique to this standalone page; the Quotes modal keeps the legacy costing fields (single sheet/backer/edgeband selectors) so estimators retain the existing flow.

## Future Considerations
- Allow setting shared defaults in Supabase so the same values travel with the account (multi-user).
- Optional per-material backer overrides (default stays global for now).
- Allow downloading a PDF or CSV summary for quick share with sales.
- Optional import/export with quote line snapshots if we later want bridge workflows.

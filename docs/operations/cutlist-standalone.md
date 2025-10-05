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
  - Embeds the shared `CutlistTool` with the Costing tab visible so material selection happens alongside the layout workflow.
  - Parts grid, stock sheet config, kerf / rotation options identical to the Quotes experience.
  - Results tab shows usage stats, sheet previews, and per-sheet billing overrides.
- **Usage Snapshot** (top-right card)
  - Displays the latest summary emitted by `CutlistTool`.
  - Includes lamination badge, fractional sheet usage, and total 16 mm / 32 mm edging.
- **Material Tips** (secondary card on the right)
  - Reminds users that the Costing tab values persist across sessions so their standard backer board and edging rates auto-populate next time.

## Data Flow
- `CutlistTool` now accepts two props used by this page:
  - `onSummaryChange` receives `CutlistSummary` payloads whenever results update; the page stores this in state for the snapshot card.
  - `persistCostingDefaultsKey="cutlist-standalone-costing"` instructs the tool to load/save costing descriptions + prices from `localStorage`, giving the backer board a persistent default.
- Formatters use `Intl.NumberFormat('en-ZA', 'decimal')` to stick with the unit formatting used in Quotes.

## Differences vs. Quote Modal
- No export button — the page is intentionally standalone and does not push data anywhere else.
- Costing lives inside the familiar tab experience; component selection dialogs remain available if needed.
- Standard materials persist across sessions thanks to the `persistCostingDefaultsKey` hook.

## Future Considerations
- Allow setting shared defaults in Supabase so the same values travel with the account (multi-user).
- Allow downloading a PDF or CSV summary for quick share with sales.
- Optional import/export with quote line snapshots if we later want bridge workflows.

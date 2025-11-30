# Quotes – Cutlist Cluster Display Fix (2025-10-28)

## Summary
- Ensured the quote costing table shows both manually-authored costing lines and cutlist-exported lines after a refresh.
- Added client-side flattening so the UI merges multiple costing clusters for a quote item when displaying line items.
- Confirmed `quote_cluster_lines.cutlist_slot` tagging remains the mechanism used to identify calculator-managed rows.
- Surfaced newly created (empty) clusters immediately so estimators can add costing lines without losing the cluster view.

## Files
- `components/features/quotes/QuoteItemsTable.tsx` – merges costing clusters when rendering a quote item.
- `components/features/cutlist/CutlistTool.tsx` – relies on existing tagging behaviour; no longer needs manual reconciliation.
- Docs updated in `docs/operations/cuttingplan.md` and `docs/plans/quoting-module-plan.md` to describe the merged display.

## Testing
- Added/edited manual costing line, exported from the cutlist calculator, refreshed the quote; verified all lines appear in the costing table and manual entries remain untouched.


# BOM Add Component Form – Alignment & Dropdown UX

Date: 2025-09-12
Files: `components/features/products/product-bom.tsx`, `docs/STYLE_GUIDE.md`

## Summary
Cleaned up the Add Component form in the Bill of Materials (BOM) UI:
- Aligned the "Component" and "Quantity" fields consistently.
- Normalized label-to-input spacing across Component, Quantity, and Supplier fields.
- Removed loud helper copy under Quantity (kept placeholder/title and validation).
- Improved dropdown UX with a subtle scrim, correct layering, and dismissal patterns.

## Changes
- Layout
  - Grid row set to align consistently with top-aligned labels; consistent `space-y-2` on each `FormItem`.
  - Quantity kept compact (`w-20`) to balance the row.
- Component search
  - Conditional bottom margin on the search input only when dropdown is open (`mb-1`).
  - Removed persistent empty spacer; selected chip only renders when a value is present and dropdown is closed.
- Supplier search
  - Mirrored the Component field structure (spacing, conditional margin, conditional chip).
- Dropdown UX
  - Added scrim overlay inside the form: `absolute inset-0 z-30 bg-background/40 backdrop-blur-[1px]` (click to close).
  - Elevated dropdowns: `z-[60] bg-background shadow-lg ring-1 ring-black/10` for contrast.
  - Inputs stay crisp using stacking context: `form` is `relative isolate`; grid gets `relative z-40`; active input wrappers get dynamic `z-50`.
  - Hide “Selected” chips while searching or while dropdowns are open (prevents overlap).
  - Added `Escape` to close component and supplier dropdowns.

## New: Browse by Supplier side panel (2025-09)
- Added a right-side panel to pick components by supplier when searching is noisy.
- Trigger: "Browse by supplier" button under the Component field.
- Panel behavior:
  - Left: supplier list with search; Right: that supplier’s components (joined to master) with filter.
  - Selecting a row sets `component_id` and, if enabled, `supplier_component_id` on the form.
  - Closes the panel and clears inline searches.
- Implementation: uses `Dialog` with right anchoring via utility overrides (`left-auto right-0 top-0 translate-x-0 translate-y-0 h-[100vh] sm:rounded-none`).
- Data:
  - `suppliers` simple list for the left pane.
  - `suppliercomponents` filtered by `supplier_id` with `components { internal_code, description }` joined for the right pane.

## Rationale
- Keeps the form visually balanced and consistent with the app’s spacing rhythm.
- Reduces cognitive load by removing non-essential helper text.
- Improves discoverability and readability of dropdown results (contrast + elevation).
- Prevents visual overlap when switching components with an existing supplier selected.

## How to revert quickly
- Remove scrim and elevation tweaks: delete the overlay block and revert dropdown containers to the previous `z-10 bg-background` without `shadow-lg ring`.
- Restore helper text under Quantity if desired.
- Revert `space-y-2` back to `space-y-1` if a tighter label spacing is preferred.

## Notes
- No backend changes.
- Accessibility: focus ring is preserved on inputs; overlay click and `Esc` provide clear dismissal.
- Follow-up option: immediately clear `supplier_component_id` when the user begins typing in the Component field (currently cleared on new component selection).

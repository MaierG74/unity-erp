# Supplier Components Search Fix - 2025-11-05

## Summary
Fixed component search functionality in the Supplier Components tab to enable proper server-side searching when adding or editing supplier component mappings. Previously, the ReactSelect component wasn't connected to update the search query, preventing users from finding components by typing.

## Problem
When adding or editing supplier components, users could not search for components by typing in the dropdown. The search functionality existed but wasn't connected - typing would not trigger the database query to search for components, only showing the first 100 components ordered by code.

## Root Cause
The ReactSelect component's `onInputChange` handler was missing, so the `componentSearchTerm` state was never updated when users typed. Additionally, the search term wasn't being cleared after selection, causing display issues where the selected value wouldn't show properly.

## Solution
### Changes Made
1. **Connected search input to state**: Added `onInputChange` handler to update `componentSearchTerm` when users type in the ReactSelect dropdown.
2. **Disabled client-side filtering**: Added `filterOption={() => true}` to disable ReactSelect's built-in filtering since we're doing server-side filtering via the query.
3. **Controlled input value**: Added `inputValue={componentSearchTerm}` prop to control the search input value.
4. **Clear search on selection**: Clear `componentSearchTerm` when an option is selected in both Add and Edit forms to ensure the selected value displays correctly.
5. **Reset search on form open/close**: Reset `componentSearchTerm` when opening/closing add/edit forms to ensure clean state.

### Technical Details
- **File**: `components/features/suppliers/supplier-components.tsx`
- **Query**: Uses React Query with key `['components-search', componentSearchTerm]`
- **Search Logic**: Searches `components` table using `internal_code.ilike.%term%` OR `description.ilike.%term%`
- **Performance**: Query limited to 100 results, ordered by `internal_code`
- **Debouncing**: Search term debounced at 300ms (already implemented via `useDebounce` hook)

## Testing
- ✅ Successfully searched for and added "OMEGAHB - Omega High Back" component to supplier Rosch
- ✅ Search finds components when typing partial codes (e.g., "ome" finds "OMEGAHB")
- ✅ Selected component displays correctly with code and description
- ✅ Search term clears after selection
- ✅ Works in both Add Component and Edit Component forms

## Related Documentation
- Updated: `docs/domains/suppliers/suppliers-master.md` - Documented component search functionality
- See: `docs/domains/suppliers/suppliers-master.md` for full supplier components implementation details

## Impact
- Users can now search for any component by code or description when adding/editing supplier component mappings
- Improved UX: Components are easily discoverable even if they're not in the first 100 alphabetical results
- Fixes issue where newly created or recently renamed components couldn't be found


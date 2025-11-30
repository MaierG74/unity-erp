# Option Set Defaults Enhancement

**Date**: 2025-10-06  
**Status**: Completed

## Overview
Extended the option set system to support default component metadata at the option value level. This eliminates the need to repeatedly configure BOM overrides for similar products that share the same option sets.

## Changes Made

### Database Schema
**Migration**: `db/migrations/20251005_option_set_defaults.sql`

Added columns to `option_set_values` table:
- `default_component_id` - References `components(component_id)`
- `default_supplier_component_id` - References `suppliercomponents(supplier_component_id)`
- `default_quantity_delta` - Numeric delta to apply to base BOM quantity
- `default_notes` - Text notes for the override
- `default_is_cutlist` - Boolean flag for cutlist treatment
- `default_cutlist_category` - Text category for cutlist grouping
- `default_cutlist_dimensions` - JSONB for dimensions (length, width, thickness, etc.)

Updated `option_value_catalog` view to expose these new fields for both global option sets and product-specific option values.

### API Endpoints

**New Routes**:
- `app/api/components/route.ts` - GET endpoint for searching/fetching components
  - Supports `?search=term` for filtering by code or description
  - Supports `?ids=1,2,3` for fetching specific components
  - Returns `{ components: [...] }` with `component_id`, `internal_code`, `description`

- `app/api/supplier-components/route.ts` - GET endpoint for supplier components
  - Supports `?componentId=123` to fetch suppliers for a component
  - Supports `?ids=1,2,3` for fetching specific supplier components
  - Returns `{ supplier_components: [...] }` with supplier details and pricing

**Updated Routes**:
- `app/api/option-sets/[setId]/groups/[groupId]/values/route.ts` - POST/GET now handle default metadata
- `app/api/option-sets/[setId]/groups/[groupId]/values/[valueId]/route.ts` - PATCH now persists default metadata

### Frontend Changes

**Option Set Library UI** (`app/settings/option-sets/page.tsx`):
- Replaced numeric inputs for `default_component_id` and `default_supplier_component_id` with searchable popover selectors
- Component picker: search by code or description, displays full component details
- Supplier picker: automatically loads suppliers for selected component, shows pricing and lead times
- Added clear buttons for both selectors
- Supplier picker is disabled until a component is selected
- Existing values automatically load display names when editing

**BOM Override Dialog** (`components/features/products/BOMOverrideDialog.tsx`):
- Extended `OptionValueDraft` interface to include all default metadata fields
- Override initialization now prioritizes: existing override → option set defaults → null
- Updated `hasOverrideData` to include `cutlist_dimensions` check
- Default metadata is stored alongside draft values for reference
- UI displays default values as hints/placeholders (future enhancement: add "Apply defaults" button)

**Type Definitions**:
- `hooks/useOptionSets.ts` - Updated `OptionSetValue` interface with default fields
- `lib/db/option-sets.ts` - Updated `OptionSetValue` interface and mapping logic

### Group Edit/Delete Buttons
Added edit and delete buttons to option set group headers in the Option Set Library UI, allowing full CRUD operations on groups.

## Benefits
1. **Reduced Configuration Overhead**: Set defaults once in the option set library; all products using that set inherit the defaults automatically
2. **Consistency**: Ensures similar products use the same component substitutions for the same option values
3. **Flexibility**: Products can still override defaults at the product level via the BOM override dialog
4. **Searchable Selection**: Component and supplier pickers provide better UX than manual ID entry
5. **Supplier Integration**: Direct access to supplier pricing and lead times when setting defaults

## Usage Example

### Before
For each product using "Handle Style" options:
1. Attach the Handle Style option set
2. Open BOM override dialog for each handle component
3. Manually configure component replacements for Bar Handle, Bow Handle, Neptune Handle
4. Repeat for every product (10+ products = 30+ manual configurations)

### After
1. In Option Set Library, edit "Handle Style" option set
2. For "Bar Handle" value, select default component "96mm Bar Handle (Stainless)" and supplier "Fit"
3. Set default quantity delta, cutlist flags, etc.
4. All products using this option set now inherit these defaults automatically
5. Products can still override at the product level if needed

## Testing Checklist
- [x] Database migration applied successfully
- [x] API endpoints return correct data with supplier joins
- [x] Component picker searches and selects components
- [x] Supplier picker loads suppliers for selected component
- [x] Saving option values persists default metadata
- [x] BOM override dialog displays defaults correctly
- [x] Group edit/delete buttons functional
- [ ] End-to-end: create option set → set defaults → attach to product → verify BOM override dialog shows defaults
- [ ] Verify effective BOM resolver uses defaults when no product-level override exists

## Future Enhancements
- Add "Apply option defaults" button in BOM override dialog to explicitly reset to defaults
- Add "Reset to defaults" action in BOM override dialog
- Display default metadata as visual hints/badges in override form fields
- Add bulk "Apply defaults to all values" action in BOM override dialog
- Consider adding `default_price_delta` for option-based pricing surcharges

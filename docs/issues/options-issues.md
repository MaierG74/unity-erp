# Product Options & Quote Override Issues

## Overview
- **Product:** `4 Drawer Desk High Pedestal - No Lock or Adjusters` (`products.product_id = 55`, code `S132`).
- **Problem:** When adding the product to a quote, configurator allows selecting Handle Style (Bar/Bow/Neptune) but costing cluster always shows the default `96mm Bar handle (Stainless)` component.
- **Goal:** Ensure quote import honours option-set overrides so selected option determines which component is exploded into the costing cluster.

## Current Status (2025-10-08)
- Option-set metadata now loads in the quote dialog (`components/features/quotes/AddQuoteItemDialog.tsx`).
- Overrides can be authored and persisted for option-set values (`bom_option_overrides` table).
- Database RPC `get_product_components` updated to consider option-set overrides.
- **Issue persists:** Selecting `Bow Handle` still yields the Bar handle component in the costing cluster.

## Reproduction Steps
1. Navigate to `Products › product_id=55` and confirm attached option set `Handle Library` with values `BARH`, `BOWH`, `NEPH`.
2. Open quotes, add new draft, click **Add Item**, search for `S132`.
3. In the dialog select `Handle Style → Bow Handle`, leave other toggles default, click **Add Item**.
4. Observe costing cluster: still shows default Bar handle component instead of Bow replacement.

## Investigation Timeline
- **2025-10-06** – Quote dialog reported "No configurable options" even though product had option sets. Fixed by normalising `/api/products/[productId]/option-sets` response and matching consumer (`lib/db/products.ts`).
  - Files: `app/api/products/[productId]/option-sets/route.ts`, `lib/db/products.ts`, `components/features/quotes/AddQuoteItemDialog.tsx`.
- **2025-10-06** – Verified option sets now appear in dialog; began debugging BOM override persistence.
- **2025-10-07** – Identified quote still returns default component because `bom_option_overrides` table had no rows. UI was failing to upsert overrides due to missing DB constraints.
- **2025-10-08** – Debugged override dialog network errors:
  - Added unique indexes to support UPSERT (`bom_option_overrides(bom_id, option_set_value_id)` and `...option_value_id`).
  - Relaxed NOT NULL constraint on `bom_option_overrides.option_value_id` for option-set-only overrides.
  - Migrations applied via Supabase MCP: `add_option_override_unique_indexes`, `allow_null_option_value_id`.
  - Override dialog saves now succeed; confirmed row inserted for Bow Handle: `override_id=15`, `bom_id=33`, `option_set_value_id=7`, `replace_component_id=693`.
- **2025-10-08** – Updated RPC `public.get_product_components` to include option-set overrides (replaced function body to join `option_set_groups`/`option_set_values`). Migration: `update_get_product_components_for_option_sets`.
- **2025-10-08** – Retested quotes: still returning Bar handle despite override row + updated resolver. Root cause remains unresolved; likely mismatch between selected option codes and resolver JSON payload.

## Code References
- `components/features/quotes/AddQuoteItemDialog.tsx` – Loads option groups via `fetchProductOptionGroups` and captures selections in `selectedOptions` (`{ [group.code]: value.code }`).
- `lib/db/products.ts` – `fetchProductOptionGroups` merges product-specific and option-set groups; `resolveProductConfiguration` calls Supabase RPC.
- `lib/db/quotes.ts` – `fetchProductComponents()` uses `resolveProductConfiguration` before falling back to simpler tables.
- API Routes:
  - `app/api/products/[productId]/option-sets/route.ts` – Normalises option-set payload for client.
  - `app/api/products/[productId]/options/bom/[bomId]/route.ts` – CRUD for BOM overrides; ensures option-set values belong to product.
- Database Function:
  - `public.get_product_components` – now selects from `applied_product_overrides` and `applied_set_overrides` CTEs.

## Database Changes
- **Unique indexes**
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS bom_option_overrides_bom_option_set_value_uidx
    ON bom_option_overrides (bom_id, option_set_value_id);
  CREATE UNIQUE INDEX IF NOT EXISTS bom_option_overrides_bom_option_value_uidx
    ON bom_option_overrides (bom_id, option_value_id);
  ```
- **Constraint updates**
  ```sql
  ALTER TABLE bom_option_overrides
    ALTER COLUMN option_value_id DROP NOT NULL;
  ```
- **RPC update:** `public.get_product_components` reauthored to union base rows with product overrides and option-set overrides.

## Observations & Hypotheses
- `selectedOptions` sent to backend uses option-set **codes** (e.g., `{"HS": "BOWH"}`), while new RPC compares `p_selected_options ->> sg.code` (group code) against `sv.code`. Should work if codes align — need to capture actual payload hitting `/api/products/[productId]/effective-bom` or `resolveProductConfiguration`.
- The effective BOM endpoint `/api/products/[productId]/effective-bom` may cache results without `selected_options` parameter. Quote flow might be calling API without passing selections.
- The fallback path in `resolveProductConfiguration` fetches base BOM if RPC call fails/returns empty. Need to ensure RPC returns rows when overrides match.
- Console logs show no errors after migrations; failure is logical rather than runtime.

## Next Debug Steps
- **Inspect selected options payload:** Instrument `fetchProductComponents()` or network tab to confirm POST body/JSON when add item is clicked.
- **Call RPC directly:** Use Supabase SQL or `mcp5_execute_sql` to run `select * from get_product_components(55, '{"HS":"BOWH"}')` and confirm it returns Bow component `component_id=693`.
- **Trace `fetchProductComponents()` result:** Temporarily log `resolved` array to ensure resolver returns override rows before mapping to costing cluster.
- **Verify costing cluster consumer:** Confirm `EnhancedQuoteEditor` uses the resolved list and doesn’t override with base BOM later.

## Related Documentation
- `docs/domains/components/bom-option-cut.md` – explains effective BOM resolver objectives.
- `docs/domains/orders/orders-master.md` – mentions reusing resolver for orders (context for expected behaviour).

## Outstanding Issues
- Quote costing cluster still defaults to Bar handle after selecting Bow handle.
- To-do linked-record modal (`/todos`) shows picker but options aren’t clickable (z-index or pointer-events regression); tracked separately.

## Useful SQL Snippets
Run via Supabase SQL console or MCP:
```sql
-- Check overrides for product 55
SELECT o.override_id, o.bom_id, o.option_set_value_id, o.replace_component_id
FROM bom_option_overrides o
JOIN billofmaterials b ON b.bom_id = o.bom_id
WHERE b.product_id = 55
ORDER BY o.override_id;

-- Test resolver manually
SELECT * FROM get_product_components(55, '{"HS":"BOWH"}');
```

## Contacts / Ownership
- **Engineering:** Cascade AI support (current assistance).
- **Stakeholders:** greg@apexza.net, gareth@qbbutton.co (from watchers list in todos).

---
Use this document to track further experiments, SQL, or code diffs related to option-set override behaviour.

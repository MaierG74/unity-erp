# Product Options & Quote Override Issues

## Overview
- **Product:** `4 Drawer Desk High Pedestal - No Lock or Adjusters` (`products.product_id = 55`, code `S132`).
- **Problem:** When adding the product to a quote, configurator allows selecting Handle Style (Bar/Bow/Neptune) but costing cluster always shows the default `96mm Bar handle (Stainless)` component.
- **Goal:** Ensure quote import honours option-set overrides so selected option determines which component is exploded into the costing cluster.

## Current Status (2025-10-10)
- Option-set metadata still loads correctly in the quote dialog (`components/features/quotes/AddQuoteItemDialog.tsx`).
- Overrides persist for option-set values (`bom_option_overrides`) and reflect the correct replacement component IDs.
- Database RPC `get_product_components(_product_id integer, _selected_options jsonb)` now returns override rows when called directly or via Supabase REST.
- Effective BOM API accepts `selected_options` and attempts the RPC before falling back to `billofmaterials`; the Next.js route now passes `_product_id`/`_selected_options` to match the redeployed signature.
- RPC updated to suppress base BOM rows when a matching override is triggered so Bow handle should be the only handle row returned for the selection. Need to retest the UI/import path to confirm duplicate removal end-to-end.

## Reproduction Steps
1. Navigate to `Products › product_id=55` and confirm attached option set `Handle Library` with values `BARH`, `BOWH`, `NEPH`.
2. Open quotes, add new draft, click **Add Item**, search for `S132`.
3. In the dialog select `Handle Style → Bow Handle`, leave other toggles default, click **Add Item**.
4. Observe costing cluster: Bow handle override should replace the default Bar handle component (currently still showing Bar handle).

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
- **2025-10-08** – Retested quotes: still returning Bar handle despite override row + updated resolver. Root cause remained unresolved pending further tracing.
- **2025-10-09** – Identified effective BOM API ignored `selected_options` and always returned base BOM, so quote flow never hit the option-aware resolver when overrides existed. Updated API + client helpers to serialize selections, call the RPC, and fallback only if RPC returns no rows.
- **2025-10-09** – Recreated `public.get_product_components(product_id integer, selected_options jsonb)` with mismatched parameter names removed, dropped the old positional signature, and reloaded the PostgREST schema cache with `SELECT pg_notify('pgrst', 'reload schema');`. Despite this, Supabase logs still showed `PGRST202` fallback warnings in the Next dev server when the quote flow ran.
- **2025-10-09** – Applied migration `fix_get_product_components` renaming parameters to `_product_id`, `_selected_options` and redeploying the RPC via Supabase MCP; direct SQL invocation returned both the base handle and Bow handle override rows.
- **2025-10-10** – Re-notified PostgREST schema cache and confirmed `authenticator`/`authenticated` roles retain EXECUTE privileges on the RPC via Supabase MCP queries.
- **2025-10-10** – Supabase REST smoke test: initial call returned `PGRST301 JWTClaimsSetDecodeError` due to truncated token; retry with full anon token succeeded, returning the base Bar handle and Bow handle override rows via `/rest/v1/rpc/get_product_components`.
- **2025-10-10** – Adjusted RPC to exclude base BOM rows whose overrides fire for the current selections, preventing duplicate handle rows in the costing cluster.
- **2025-10-10** – `AddQuoteItemDialog` now shows an inline loading state while costing calculations run so users know the import is processing before the modal closes.
- **2025-10-10** – Restored BOM edit actions by returning `bom_id` from `get_product_components`; Product BOM table now surfaces Edit/Overrides/Delete controls again for direct rows.
- **2025-10-10** – BOM override dialog seeds option-set defaults automatically; attaching a set with default components now writes `bom_option_overrides` rows without manual saves. Dialog still allows edits/clears on top of the seeded values.

## Code References
- `components/features/quotes/AddQuoteItemDialog.tsx` – Loads option groups via `fetchProductOptionGroups` and captures selections in `selectedOptions` (`{ [group.code]: value.code }`).
- `lib/db/products.ts` – `fetchProductOptionGroups` merges product-specific and option-set groups; `resolveProductConfiguration` calls Supabase RPC.
- `lib/db/quotes.ts` – `fetchProductComponents()` uses `resolveProductConfiguration` before falling back to simpler tables.
- API Routes:
  - `app/api/products/[productId]/option-sets/route.ts` – Normalises option-set payload for client.
  - `app/api/products/[productId]/options/bom/[bomId]/route.ts` – CRUD for BOM overrides; ensures option-set values belong to product.
- Database Function:
  - `public.get_product_components` – selects from `applied_product_overrides` and `applied_set_overrides` CTEs, now using `_product_id`, `_selected_options` parameters.

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
- **RPC updates**
  - `update_get_product_components_for_option_sets` – initial rewrite to include option-set overrides.
  - `fix_get_product_components` – parameter rename & redeploy to resolve ambiguity and support REST.

## Root Cause (Latest Hypothesis)
- PostgREST now sees the updated function and returns override rows. Remaining issue likely stems from client/API fallback still triggering (possibly due to non-200 response handling or Supabase client configuration).
- Need to ensure the Next.js API route handles the successful RPC response and does not incorrectly treat it as failure.

## Fix Attempts To Date
- Serialized selected options into `fetchEffectiveBOM` requests and updated the API route to forward JSON, falling back only when the RPC fails.
- Dropped and recreated `public.get_product_components(product_id integer, selected_options jsonb)` with named parameters to satisfy PostgREST lookup.
- Triggered schema cache reload via `SELECT pg_notify('pgrst', 'reload schema');` (multiple times).
- Added regression tests ensuring the client builds the correct URL.
- Renamed parameters to `_product_id`, `_selected_options` and redeployed via Supabase MCP.
- Verified function execution via direct SQL and Supabase REST.

## Current Verification Results
- Manual: Adding the product with Bow handle still yields the base Bar handle component; browser Network tab shows `/api/products/55/effective-bom?selected_options={"HS":"BOWH"}` returning the default component list (UI fallback still triggered).
- Terminal: `[effective-bom] get_product_components fallback { code: 'PGRST202', ... }` appeared prior to REST success; monitor after REST fix.
- Supabase MCP tests (2025-10-09 → 2025-10-10):
  - Override rows exist (`override_id=17`, `bom_id=36`, `option_set_value_id=7`, `replace_component_id=693`).
  - Direct call `SELECT * FROM get_product_components(55, '{"HS":"BOWH"}');` returns both the base Bar handle (`component_id=646`) and the Bow handle override (`component_id=693`).
  - `SELECT oid::regprocedure, proargnames FROM pg_proc WHERE proname = 'get_product_components';` reports `_product_id`, `_selected_options` signature only. `has_function_privilege` checks for `authenticator` and `authenticated` roles return `true`.
- Supabase REST smoke test (2025-10-10):
  - First attempt returned `PGRST301 JWTClaimsSetDecodeError` due to truncated Authorization token.
  - Retried with full anon token; `/rest/v1/rpc/get_product_components` responded with both base Bar handle and Bow handle override rows.

## Related Documentation
- `docs/domains/components/bom-option-cut.md` – explains effective BOM resolver objectives.
- `docs/domains/orders/orders-master.md` – mentions reusing resolver for orders (context for expected behaviour).
- `docs/domains/components/components-section.md` – references this issue doc under known inconsistencies.

## Outstanding Issues
- UI/API still appears to execute fallback despite REST success; need to retest logs to confirm whether `PGRST202` persists or if client logic needs adjustment.

## Next Steps
1. Monitor Supabase logs while triggering `/api/products/55/effective-bom?selected_options={"HS":"BOWH"}` to confirm the fallback warning disappears now that REST works and the RPC arguments are corrected.
2. Validate the Next.js API route parses the REST response correctly and returns the override rows to the client (covering both direct fetch and linked sub-products).
3. Retest the quote flow end-to-end ensuring the costing cluster shows only the Bow handle override when `Handle Style → Bow Handle` is selected (no duplicate Bar handle row).
4. Update automated/backend tests covering `fetchEffectiveBOM` to assert the override component is present (route test added for RPC payload; extend coverage to UI integration as needed).

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

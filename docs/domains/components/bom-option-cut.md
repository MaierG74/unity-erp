# BOM Options & Cutlist Integration Plan

## Background & References
- Current product creation & BOM tooling is documented in `docs/domains/components/product-creation-guide.md`, including the Product BOM UI and supplier-aware component rows.
- Cost rollups for materials and labour are planned in `docs/plans/product-costing-plan.md`; option-driven BOM changes must keep costing consistent.
- Quoting flows (`docs/plans/quoting-module-plan.md`) already explode product BOMs into quote clusters, which we should extend to respect option selections.
- Cutlist expectations (`docs/operations/cuttingplan.md` and `docs/plans/cutlist-nesting-plan.md`) outline how sheet optimisations consume BOM data flagged as cut parts.

## Goals
1. Define reusable configuration building blocks that can be shared across many products (e.g., a single "Handles" definition used by pedestals, cupboards, credenzas).
2. Map option selections to BOM consequences so default components can be swapped, quantities adjusted, or optional rows toggled with minimal duplication.
3. Flag relevant BOM entries as cutlist parts so orders can aggregate material usage automatically when options vary per line item.
4. Keep quoting → order → production data consistent, leveraging overrides with a single dialog flow rather than hopping between pages.

## Reusable Option Sets
- **Global Option Sets**: New top-level catalog of reusable option definitions.
  - `option_sets` — named library entries (e.g., `Handles`, `Top Finish`).
  - `option_set_groups` — groups within a set (code, label, required flag, display order).
  - `option_set_values` — values for a group (code, label, default flag, attributes JSON for metadata like colour hex or SKU mapping).
- **Product Links**: Join table `product_option_set_links(product_id, option_set_id, display_order, alias_label?, alias_code?)` attaches a set to a product.
  - Per-product aliases allow renaming a group/value while still resolving back to the shared code.
  - Overrides at the product level can toggle defaults or hide individual values without editing the global set (stored in an overlay table `product_option_overlays`).
- **Product-Specific Extras**: Existing `product_option_groups` / `product_option_values` remain for bespoke cases; the resolver merges linked sets + per-product groups.

## Authoring Workflow
1. Create a global option set in the **Option Set Library** (new admin page) or reuse an existing set.
2. Attach the set to a product from the Options tab or directly from the BOM override modal.
3. (Optional) Apply product-specific aliases/defaults via lightweight inline edits.
4. Configure BOM overrides per component row using the shared groups/values.

## UI Surfacing
- **Option Set Library Page**
  - `/products/options/sets` shows all sets with usage counts, clone/version actions, and value previews.
  - Supports bulk maintenance (e.g., add a new handle value once, push to all linked products).
- **Product Options Tab** (`components/features/products/ProductOptionsTab.tsx`)
  - Reworked to focus on attaching option sets and managing per-product overlays.
  - Quick actions: attach existing set, create set inline, edit aliases, toggle defaults, detach.
  - Shows which BOM rows currently reference each group via badges.
- **Configure Option Overrides Dialog** (`components/features/products/BOMOverrideDialog.tsx`)
  - Primary entry point for override mapping; includes shortcuts to attach sets if none are present.
  - Displays reusable groups/values with status summaries (configured / pending) and supports bulk apply across selected BOM rows.
  - Remains the single modal used while editing the Bill of Materials, avoiding context switching to the Options tab.
  - When a linked option set provides defaults (component, supplier, quantity delta, cutlist flags), the dialog auto-seeds corresponding `bom_option_overrides` rows so product authors don’t have to click **Save** for every value. Any edits overwrite the seeded data; clearing removes the override.
- **Quoting / Ordering Flows**
  - `AddQuoteItemDialog` and upcoming order editors load merged option definitions (global set + product overlays) and persist `selected_options` JSON for resolvers.

## BOM Integration Strategy
- **Default BOM Rows**: Continue storing the most common configuration in `billofmaterials`; tag each row with `configuration_scope`: `"base" | "option"`.
- **Option Overrides Table**: Existing `bom_option_overrides` links `(bom_id, option_value_id)` to override payload (replacement component, supplier, quantity delta, notes, cutlist metadata).
- **Set-aware Overrides**: When a global set is attached, `option_value_id` references `option_set_values`. Product-specific values continue referencing `product_option_values`. A database view exposes a unified `option_value_catalog` so the modal can treat both paths uniformly.
- **Optional Components**: Supported via `quantity_delta = -base_qty` or by authoring virtual option-only BOM rows (`configuration_scope = 'option'`).
- **Supplier Handling**: Overrides may specify `replace_supplier_component_id` and inherit cost metadata from shared sets where available.
- **Effective BOM Resolver**:
  - `resolveProductConfiguration(productId, selectedOptions)` loads attached sets, overlays, and product-specific groups, then applies overrides before returning quantities/cutlist flags.
  - Resolver caches linked set metadata to minimize round trips and provides trace data (which set supplied a value) for debugging.

## Order & Quote Workflow Changes
- **Selection Capture**: Quote items already persist `selected_options jsonb`. Order details will add the same column (`docs/domains/orders/orders-master.md`) so selections flow end-to-end.
- **Dialogs**: Option pickers render merged groups. Required fields inherit default values from the attached set; optional groups allow "No selection" when permitted.
- **Pricing**: BOM resolver continues to drive cost clusters. Future enhancement: allow set values to carry `unit_price_delta` for surcharge scenarios.
- **Production Context**: Work orders and PDFs will surface option labels using aliases so teams see the terminology familiar for that product.

## Cutlist Flagging & Aggregation
- **BOM Flag**: Continue to use `is_cutlist_item`, `cutlist_category`, and dimension metadata. Overrides can mark the replacement component as a cutlist row even if the base BOM was not.
- **Resolver Output**: Includes `option_set_code` and `option_value_code` so aggregated cutlist jobs can show which configuration generated a part.
- **Automation**: Future cutlist automation still leverages aggregated parts; no workflow change beyond referencing shared value codes.

## Implementation Roadmap
1. **Schema & Policies**
   - Add `option_sets`, `option_set_groups`, `option_set_values`, `product_option_set_links`, and overlay tables.
   - Extend RLS so product managers can manage the library and attach sets to products.
   - Update views/RPC (`get_product_components`) to emit merged option catalogs.
2. **Data Migration**
   - Seed initial sets (e.g., Handles, Locks, Finishes) by promoting existing product option groups.
   - Backfill `product_option_set_links` for current products using identical groups.
3. **Backend Utilities**
   - Update `resolveProductConfiguration` and related helpers to resolve via the unified catalog.
   - Add logging/tests covering global set usage versus product-specific overrides.
4. **UI Updates**
   - Build Option Set Library page.
   - Refactor Product Options tab for set attachment + overlays.
   - Enhance BOM override dialog with set awareness and attach shortcuts.
5. **Quote / Order Parity**
   - Update order detail UI to capture `selected_options` using shared sets.
   - Add summary chips / tooltips referencing the set + value labels.
6. **Testing & QA**
   - Unit tests for resolver exploring: base only, set value substitution, overlay aliasing, quantity deltas, cutlist toggles.
   - E2E smoke for: attach set → configure overrides → create quote → verify exploded BOM.

## Open Questions & Next Steps
- How should versioning work when a global set changes? Proposal: store `option_set_version` on the link so products can opt-in to updates.
- Do we allow partial adoption (e.g., product hides certain values) without cloning the set? Overlay table covers simple excludes; evaluate complex cases later.
- Should we surface analytics (usage counts) to help deprecate unused values? Library page can expose this if we track it in a materialized view.
- Evaluate whether `bom_option_overrides` needs `option_set_id` for faster joins versus relying on the catalog view.

## Immediate Action Items
- Design database migrations for the new set tables and overlays.
- Outline Supabase policy updates so only authorised roles manage global sets.
- Draft API/RPC changes for merged option catalogs and override persistence.
- Prepare UI tickets: option set library, product attachment UX, enhanced override modal.

## How to Model a Configurable Cutlist Product (current workflow)
1. **Author the base BOM**
   - Add every required component in `Bill of Materials`.
   - For panels that feed the cutlist, tick `is_cutlist_item` and populate `cutlist_dimensions`/`attributes` (length, width, thickness, grain, edge banding, laminate code, etc.).
2. **Create option groups & values**
   - Use the Product → Options tab to add groups (`code`, `label`, required flag) and populate values with defaults (Oak, White, Black, etc.). Include a “Custom / Specify” value when you need ad-hoc picks.
   - Backend tables `product_option_groups` / `product_option_values` receive the writes automatically.
3. **Define overrides**
   - Open the BOM row’s “Configure option overrides” dialog and map each value to a replacement component, quantity delta, and cutlist tweaks. Leave the “Custom” value blank so quoting can prompt for a manual component.
4. **Test via quote dialog**
   - Use the updated quote flow to select your product and choose option values; verify the exploded cluster swaps components and that `selected_options` persists.
5. **Cutlist preview** *(once automation arrives)*
   - Generated cutlists will aggregate by the substituted components and use the per-row dimensions you flagged in step 1.
- Surface option summary chips in quote UI and order PDFs once selections persist end-to-end.

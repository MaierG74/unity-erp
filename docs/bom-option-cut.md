# BOM Options & Cutlist Integration Plan

## Background & References
- Current product creation & BOM tooling is documented in `docs/product-creation-guide.md`, including the Product BOM UI and supplier-aware component rows.
- Cost rollups for materials and labour are planned in `docs/product-costing-plan.md`; option-driven BOM changes must keep costing consistent.
- Quoting flows (`docs/quoting-module-plan.md`) already explode product BOMs into quote clusters, which we should extend to respect option selections.
- Cutlist expectations (`docs/cuttingplan.md` and `docs/cutlist-nesting-plan.md`) outline how sheet optimisations consume BOM data flagged as cut parts.

## Goals
1. Allow each product to define configurable option groups (e.g., handle style, carcass finish, lock inclusion).
2. Map option selections to BOM consequences so default components can be swapped, quantities adjusted, or optional rows toggled.
3. Flag relevant BOM entries as cutlist parts so orders can aggregate material usage automatically when options vary per line item.
4. Keep quoting → order → production data consistent, leveraging existing dialogs and cost exports with minimal duplication.

## Product Option Modelling
- **Option Groups**: Define a new `product_option_groups` table with `product_id`, `code`, `label`, `display_order`, and `is_required`.
- **Option Values**: Child table `product_option_values` with `group_id`, `value_id`, `code`, `label`, `is_default`, `attributes (JSONB)` for metadata (e.g., colour hex, SKU overrides).
- **Selection Templates**: Optional `product_option_presets` to store named bundles (e.g., "Standard Pedestal") for quick apply during quoting/orders.
- **Validation Rules**: Later support `dependencies` (e.g., only allow locks when drawers ≥1) via a JSON rule set or join table.
- **UI Surfacing**:
  - Product page: new **Options** tab to maintain groups/values, using components similar to BOM tables.
  - Quote/Order flows: extend existing selection modals to render dropdowns (leveraging ShadCN `Select`). Defaults auto-populate.

## BOM Integration Strategy
- **Default BOM Rows**: Continue storing the most common configuration in `billofmaterials`; tag each row with `configuration_scope`: `"base" | "option"`.
- **Option Overrides Table**: Introduce `bom_option_overrides` linking `(bom_row_id | component_id)` to `(group_id, value_id)` with fields for `quantity_delta`, `replace_component_id`, and `notes`. Supports two scenarios:
  1. **Substitution**: Swap the default handle with a selected handle component.
  2. **Adjustment**: Add/remove components (locks) or tweak quantity (drawer fronts count for wider pedestals).
- **Optional Components**: Permit `quantity_delta = -1 * base_quantity` to remove defaults when an option deselects it. When no base row exists (pure add-on), create a virtual base row flagged as `configuration_scope="option"` and only include when selected.
- **Supplier Handling**: Allow override rows to specify `supplier_component_id` so costing pulls correct pricing.
- **Effective BOM Resolver**:
  - Extend existing effective BOM logic (`lib/db/quotes.ts`, order BOM fetch) to accept an `optionSelections` map and resolve replacements before cost aggregation.
  - Cache computed BOM snapshots per quote/order line to avoid recomputation when editing other fields.

## Order & Quote Workflow Changes
- **Selection Capture**: For quote items and order details, store option selections in a JSONB column (e.g., `selected_options` keyed by option group code → value code).
- **Dialogs**: Update `AddQuoteItemDialog` and order item editors to prompt for options (prefill defaults, allow edits later).
- **Pricing**: After selection, run the effective BOM resolver to populate cost clusters (quotes) or consumption rows (orders). Ensure totals update when selections change.
- **Work Orders / Production Sheets**: Include option summary so downstream teams know which handle/fabric applies.

## Cutlist Flagging & Aggregation
- **BOM Flag**: Add `is_cutlist_item boolean` (default false) and optional `cutlist_category` (e.g., `drawer_front`, `carcass_panel`) to BOM rows.
- **Dimension Metadata**: Leverage `attributes` JSON for dimensions (`length_mm`, `width_mm`, `thickness_mm`, `grain`, `laminate`, `edge_banding`) aligned with `packing.ts` expectations.
- **Resolver Output**: When generating the effective BOM for an order, aggregate rows with `is_cutlist_item=true` into a structured payload: `{ component_id, dimensions, qty, optionContext }`.
- **Cutlist Job Trigger**: On order confirmation (or manual action), feed aggregated parts into the cutlist module via a new API endpoint (e.g., `/api/cutlists/generate-from-order`). Reuse algorithms defined in `components/features/cutlist/` to produce sheet usage and attach previews to the order.
- **Multi-Product Aggregation**: Ensure deduping merges identical parts across different products/options; preserve metadata (grain, laminate) for accurate nesting.

## Implementation Roadmap
1. **Schema Draft (Backend)**
   - ✅ Added option metadata tables (`product_option_groups`, `product_option_values`, presets) plus `bom_option_overrides` and new `billofmaterials` columns (`is_cutlist_item`, `cutlist_dimensions`, `attributes`) in `db/migrations/20250921_configurable_product_options.sql`.
   - Provide Supabase RLS updates so product managers can edit options. *(pending)*
   - ✅ Added `quote_items.selected_options jsonb` column to persist captured selections (`db/migrations/20250921_add_selected_options_to_quote_items.sql`).
2. **Backend Utilities**
   - ✅ Extend RPC `get_product_components` to accept optional `selected_options` JSON, returning resolved components plus cutlist/cost metadata even when option tables are absent (`db/migrations/20250921_get_product_components.sql`).
   - ✅ Add helper `resolveProductConfiguration(productId, options)` in `lib/db/products.ts`, now used by quote BOM lookups via `fetchProductComponents`.
   - 🔬 Follow-up testing: add unit coverage that exercises base-only and option-aware branches of `resolveProductConfiguration` once override tables land.
3. **Product Admin UI**
   - ✅ Options tab implemented with CRUD for groups/values, default selection toggles, and ordering controls (Product page → Options tab).
   - Add ability to associate BOM rows with option overrides (e.g., inline editor or dedicated dialog from BOM table).
4. **Quote Integration**
   - ✅ `AddQuoteItemDialog` now fetches product option groups, captures selections, and forwards `selected_options` into the BOM resolver when exploding clusters.
   - Display option summary chips in `QuoteItemsTable` and include in PDF export later.
5. **Order Integration**
   - Mirror the quote UI when converting quotes → orders (carry selections forward).
   - Allow editing selections within order detail page, re-running resolver to update material reservations.
6. **Cutlist Automation (Phase 2)**
   - After orders capture options, build aggregation service + UI to generate cutlists, leveraging existing `CutlistTool` components for rendering/export.
   - Consider background job to refresh cutlists when orders change.

## Open Questions & Next Steps
- How to handle price differentials driven by options (e.g., premium handle surcharge)? Option override rows could include `unit_price_delta`.
- Should option presets live at product or category level for reuse across similar items (e.g., desks vs pedestals)?
- Decide on versioning strategy when option/BOM rules change post-order—do we snapshot resolved BOM per order line?
- Confirm whether cutlist generation should be automatic on order creation or triggered manually with review.

## Immediate Action Items
- Build override editor on the product Options tab (map option values → BOM rows, cutlist overrides).
- Prototype resolver logic unit tests (input: base BOM, overrides, selections → output BOM lines + cutlist parts).
- Audit existing BOM records to identify which components need `is_cutlist_item` tagging and collect dimensional metadata for pedestals.
- Wire quote → order conversion to carry `selected_options` through to order_details and downstream reservation logic (next task).

## How to Model a Configurable Cutlist Product (current workflow)
1. **Author the base BOM**
   - Add every required component in `Bill of Materials`.
   - For panels that feed the cutlist, tick `is_cutlist_item` and populate `cutlist_dimensions`/`attributes` (length, width, thickness, grain, edge banding, laminate code, etc.).
2. **Create option groups & values**
   - Use the Product → Options tab to add groups (`code`, `label`, required flag) and populate values with defaults (Oak, White, Black, etc.).
   - Backend tables `product_option_groups` / `product_option_values` receive the writes automatically.
3. **Define overrides**
   - For each BOM row affected by an option, add a `bom_option_overrides` entry pointing at the value and supplying `replace_component_id`, `quantity_delta`, and optional cutlist overrides (e.g., change edging attributes).
4. **Test via quote dialog**
   - Use the updated quote flow to select your product and choose option values; verify the exploded cluster swaps components and that `selected_options` persists.
5. **Cutlist preview** *(once automation arrives)*
   - Generated cutlists will aggregate by the substituted components and use the per-row dimensions you flagged in step 1.
- Surface option summary chips in quote UI and order PDFs once selections persist end-to-end.

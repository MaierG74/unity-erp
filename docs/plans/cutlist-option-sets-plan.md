# Cutlist Option Sets Plan

## Goal
- Deliver reusable cutlist-aware option sets so product authors can model sheet parts, lamination, and edge treatments once, then attach those definitions across products.
- Ensure option selections automatically persist cutlist defaults (flagging BOM rows, category, dimensional metadata) without requiring manual saves in the override dialog.
- Keep quoting and production flows aligned by flowing the selected cutlist metadata through `get_product_components` and into downstream calculators.

## Current Context
- Option-set overrides, RPC plumbing, and Supabase schema fixes are live per the recent timeline (`docs/issues/options-issues.md`) and already return cutlist metadata alongside component overrides.
- The Product Options tab and BOM override dialog auto-seed default overrides from option sets, including `default_is_cutlist`, `default_cutlist_category`, and `default_cutlist_dimensions` (`docs/domains/components/product-creation-guide.md`, `docs/domains/components/bom-option-cut.md`).
- Cutlist tooling expects BOM rows to provide `is_cutlist_item`, category, and JSON dimensions; today the data must be authored directly on BOM rows, not centrally via option sets.

## Guiding Principles
- Option sets remain the single source for reusable defaults; authors should not have to re-key cutlist metadata per product.
- Auto-seeded overrides must stay idempotent: linking a set should hydrate defaults once, and manual edits should only be required for deviations.
- Quoting, ordering, and cutlist calculators must consume the same resolver (`get_product_components`) so option-driven overrides behave consistently end-to-end.

## Workstreams

### 1. Schema & Data Modelling
- Audit `option_set_values` defaults (component, supplier component, quantity delta, notes, cutlist flags) and add migrations if additional cutlist fields are needed (e.g., default banding edges, sheet thickness tags).
- Extend seed data so the initial option-set catalog includes common cutlist templates (e.g., carcass panels, drawer fronts, backer defaults) with populated `default_is_cutlist`, `default_cutlist_category`, and `default_cutlist_dimensions`.
- Backfill existing overrides to ensure products already using manual cutlist flags are migrated into the new option-set-driven shape or explicitly excluded.
- ✅ Current schema already stores `default_cutlist_dimensions` as JSONB, so the richer payload below can ship without changing the table; effort shifts to seed data, validation, and tooling.

### 2. Authoring & Library UX
- Update the Option Set Library (`/settings/option-sets`) to expose any new cutlist metadata fields with validation (JSON schema helpers, category pickers, preview of seeded overrides).
- Add contextual guidance so authors understand which defaults propagate automatically versus which require a manual save.
- Provide read-only previews in the Product Options tab showing the cutlist defaults that will seed BOM overrides when a set is linked.
- Offer a prefilled JSON template + inline formatter so authors can insert the canonical payload quickly and see validation errors before saving.

### 3. Product & BOM Override Pipeline
- Confirm the override seeding in `app/api/products/[productId]/options/bom/[bomId]/route.ts` hydrates all cutlist fields and remains idempotent when multiple sets share groups/values.
- Ensure overrides stored for option-set values emit the correct component references for each selected size/material so downstream aggregations stay aligned with the product’s option definitions.
- Surface cutlist defaults within the BOM override dialog UI (e.g., badges or tooltips) so authors can spot inherited metadata before editing.
- Add safeguards to prevent auto-seeded cutlist rows from being deleted unintentionally when authors clear overrides.
- Product BOM editor now captures cutlist size/backer/edging metadata directly on the row, providing the base payload that option-set overrides inherit.
- The Product Cutlist tab (`components/features/products/ProductCutlistTab.tsx`) aggregates those rows, lets authors assign melamine boards sourced from the `Melamine` component category, and exposes a toggle to include/exclude linked sub-products when reviewing cutlist payloads.

### 4. Resolver & Runtime Flows
- Extend `get_product_components` assertions to guarantee cutlist metadata is present whenever option-linked BOM rows are resolved, logging gaps for debugging.
- Update quoting/order flows (`AddQuoteItemDialog`, server routes) to keep passing `_selected_options` and to store the resulting cutlist metadata on quote line components.
- Ensure the cutlist calculator reads the resolved metadata so selected options immediately adjust board categories, lamination flags, and dimensional hints.

### 5. QA, Tooling, and Rollout
- Add integration tests covering: attaching an option set, auto-seeded cutlist overrides, selecting an option in the quote dialog, and verifying `is_cutlist_item` + category travel through to costing.
- Capture Supabase RLS and permission updates if new tables or RPC inputs are introduced; reference the existing fixes noted in `docs/issues/options-issues.md`.
- Document authoring workflows and update `docs/domains/components/bom-option-cut.md` once the implementation ships so the components domain guide stays accurate.
- Migration checklist:
  1. Export current `billofmaterials` rows with `is_cutlist_item = true` (including existing `cutlist_dimensions` payloads).
  2. Map rows to their corresponding option-set values and seed `default_cutlist_dimensions` with matching payloads.
  3. Flag any residual product-only overrides for manual follow-up or future option-set coverage.
  4. Reopen the BOM override dialog for sampled products to confirm default seeding and avoid duplicate overrides.

### 6. Order-Level Aggregation & Size Reporting
- Enhance the resolver/output format so each cutlist-ready BOM row emits normalized dimensional data (length, width, thickness, grain, laminate, colour/material) even when sourced from option-set overrides.
- Extend quote/item persistence to store resolved cutlist payloads when products are added to an order so we can aggregate across multiple products later without re-resolving; allow ad-hoc quote previews that run the same resolver without persisting snapshots.
- Build an order-level cutlist generator that pulls all line items (respecting selected options and quantities), merges panels by material/colour, and produces combined sheets + banding totals, with a lightweight “quote preview” mode that estimates pricing but keeps persistence behind a guardrail (e.g., “Preview Only” vs “Export to Quote” with explicit confirmation).
- Surface per-product size listings during configuration (e.g., “Cutlist Preview” panel) so estimators can validate panel dimensions before committing to the order aggregate.
- Feed the combined output into the existing cutlist calculator UI or a new “Order Cutlist” view to drive a single packed layout across the entire order, keeping the source data tied back to the option sets attached on the product BOM.

#### Cutlist Dimensions Payload (Draft)
- Store normalized sizing/material metadata in `default_cutlist_dimensions` for each option-set value. Proposed structure (all optional unless marked):
  ```json
  {
    "length_mm": 0,          // required for panels
    "width_mm": 0,           // required for panels
    "thickness_mm": 0,       // optional (mm)
    "quantity_per": 1,       // optional, defaults to 1 panel per BOM row
    "grain": "length",       // 'length' | 'width' | 'any'
    "band_edges": {          // boolean flags for edgebanding per side
      "top": true,
      "right": true,
      "bottom": true,
      "left": true
    },
    "laminate": {
      "enabled": true,
      "backer_component_id": null
    },
    "material_code": "MEL-WHITE-16",
    "material_label": "White Melamine 16mm",
    "colour_family": "White",
    "finish_side": "double", // single | double | none
    "notes": "Door front"
  }
  ```
- Authoring UI should validate numeric fields, provide defaults for grain/banding, and allow selecting `material_code` via option set attributes to keep colour variants in sync.
- Validation expectations:
  - Require `length_mm` and `width_mm` when a value is flagged as cutlist-enabled; enforce > 0 for `length_mm`, `width_mm`, `thickness_mm`, and `quantity_per`.
  - Constrain `grain` to `any`, `length`, or `width`.
  - Normalize `band_edges` keys to boolean flags (default false) and reject unknown entries.
  - Warn when laminate/backer data is incomplete (e.g., laminate enabled without a backer reference).
  - Treat `material_code`/`material_label` as trimmed strings and encourage linking to existing component attributes for colour consistency.

## Milestones & Checkpoints
1. Schema audit + seed catalog definition.
2. Library and product UI updates with seeded previews.
3. Resolver + API verification in dev (quote flow, cutlist calculator).
4. Order-level aggregation prototype with combined sheet generation.
5. QA regression pass and doc updates prior to release.

## Implementation Task Outline
1. **Resolver & Schema Enhancements**
   - Verify `option_set_values` columns cover all panel sizing attributes; add migrations if we need extra fields (e.g., finish side indicators).
   - Update `get_product_components` to output normalized cutlist payloads tied to the option-set value that supplied them.
   - Define a shared JSON schema/type for `cutlist_dimensions` and reuse it across server + client validation to avoid drift.
2. **Product BOM Authoring**
   - Extend the BOM override dialog so seeded option-set overrides display size/material metadata alongside component swaps (badges + expandable JSON preview).
   - Ensure clearing an override retains the option-set default sizing rather than dropping cutlist metadata; provide a “Restore defaults” action to rehydrate from the linked option set.
   - Add inline validation messages when an override diverges from the option-set payload (e.g., missing length/width) so authors can fix discrepancies before saving.
3. **Quote Preview & Guardrail**
   - Add a quote-mode flag to the cutlist calculator that treats runs as read-only until “Export to Quote” is confirmed.
   - Implement a confirmation modal when exporting from a preview, capturing acknowledgement plus an optional note, and tag the resulting costing lines (`cutlist_preview_export = true`).
4. **Order Aggregation Flow**
   - Persist resolved cutlist payloads (including option-set references) when orders are created; store both the canonical payload and any per-order overrides.
   - Build an aggregated order cutlist view that merges panels by material/colour and feeds the combined payload into the packing tool.
   - Provide filters for quote vs order mode and annotate panels with the originating product + option-set value for traceability.
5. **Testing & Documentation**
   - Add integration tests covering option-set-driven sizing, preview exports with guardrail, and order aggregation.
   - Introduce schema validation tests for the canonical `cutlist_dimensions` payload (server + client) so regressions surface early.
   - Update components domain docs and order workflows to show the new sizing previews and export behaviour.

## Open Questions
- Do we need an explicit taxonomy for `cutlist_category`, or can we continue using free-form strings with validation?
- Should option sets support multiple cutlist payload variants per value (e.g., different dimensions per board thickness) or is one JSON payload sufficient?
- How will we migrate legacy overrides that already contain handwritten cutlist dimensions without overwriting bespoke data?
- What heuristics should drive order-level sheet grouping (e.g., per material/colour only, or split by finish side requirements) to keep nesting efficient without overwhelming operators?
- What guardrail do we want on quote-time exports (e.g., confirmation modal, role restriction, or “export for pricing” tag) so costing changes triggered from a preview are intentional?

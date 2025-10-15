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

### 2. Authoring & Library UX
- Update the Option Set Library (`/settings/option-sets`) to expose any new cutlist metadata fields with validation (JSON schema helpers, category pickers, preview of seeded overrides).
- Add contextual guidance so authors understand which defaults propagate automatically versus which require a manual save.
- Provide read-only previews in the Product Options tab showing the cutlist defaults that will seed BOM overrides when a set is linked.

### 3. Product & BOM Override Pipeline
- Confirm the override seeding in `app/api/products/[productId]/options/bom/[bomId]/route.ts` hydrates all cutlist fields and remains idempotent when multiple sets share groups/values.
- Surface cutlist defaults within the BOM override dialog UI (e.g., badges or tooltips) so authors can spot inherited metadata before editing.
- Add safeguards to prevent auto-seeded cutlist rows from being deleted unintentionally when authors clear overrides.

### 4. Resolver & Runtime Flows
- Extend `get_product_components` assertions to guarantee cutlist metadata is present whenever option-linked BOM rows are resolved, logging gaps for debugging.
- Update quoting/order flows (`AddQuoteItemDialog`, server routes) to keep passing `_selected_options` and to store the resulting cutlist metadata on quote line components.
- Ensure the cutlist calculator reads the resolved metadata so selected options immediately adjust board categories, lamination flags, and dimensional hints.

### 5. QA, Tooling, and Rollout
- Add integration tests covering: attaching an option set, auto-seeded cutlist overrides, selecting an option in the quote dialog, and verifying `is_cutlist_item` + category travel through to costing.
- Capture Supabase RLS and permission updates if new tables or RPC inputs are introduced; reference the existing fixes noted in `docs/issues/options-issues.md`.
- Document authoring workflows and update `docs/domains/components/bom-option-cut.md` once the implementation ships so the components domain guide stays accurate.

### 6. Order-Level Aggregation & Size Reporting
- Enhance the resolver/output format so each cutlist-ready BOM row emits normalized dimensional data (length, width, thickness, grain, laminate, colour/material) even when sourced from option-set overrides.
- Extend quote/item persistence to store resolved cutlist payloads when products are added to an order so we can aggregate across multiple products later without re-resolving; allow ad-hoc quote previews that run the same resolver without persisting snapshots.
- Build an order-level cutlist generator that pulls all line items (respecting selected options and quantities), merges panels by material/colour, and produces combined sheets + banding totals, with a lightweight “quote preview” mode that estimates pricing without booking outputs.
- Surface per-product size listings during configuration (e.g., “Cutlist Preview” panel) so estimators can validate panel dimensions before committing to the order aggregate.
- Feed the combined output into the existing cutlist calculator UI or a new “Order Cutlist” view to drive a single packed layout across the entire order.

## Milestones & Checkpoints
1. Schema audit + seed catalog definition.
2. Library and product UI updates with seeded previews.
3. Resolver + API verification in dev (quote flow, cutlist calculator).
4. Order-level aggregation prototype with combined sheet generation.
5. QA regression pass and doc updates prior to release.

## Open Questions
- Do we need an explicit taxonomy for `cutlist_category`, or can we continue using free-form strings with validation?
- Should option sets support multiple cutlist payload variants per value (e.g., different dimensions per board thickness) or is one JSON payload sufficient?
- How will we migrate legacy overrides that already contain handwritten cutlist dimensions without overwriting bespoke data?
- What heuristics should drive order-level sheet grouping (e.g., per material/colour only, or split by finish side requirements) to keep nesting efficient without overwhelming operators?
- How should the quote-time preview behave (e.g., read-only pricing snapshot, or allow exporting costing lines without creating order records)?

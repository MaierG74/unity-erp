# Subcomponent Planning and Execution

This document proposes a complete approach for reusable, composable sets of components and labor that can be attached to a product’s Bill of Materials (BOM) and Bill of Labor (BOL). These sets are called collections and enable faster product setup, consistency, and reliable costing.

## Current Status (collections)
- Status field: `status` shows `draft | published | archived`.
- Using a draft: You can Apply (copy) a draft collection to a product’s BOM.
- Publish workflow: **Implemented.** The "Publish" action bumps `version` and sets `status='published'`.
- Attach (dynamic): Not implemented yet; Phase 2. Until then, Apply (copy) is the supported flow.
- Merge-on-apply: Not enforced yet; applying adds rows as-is. A follow-up will sum duplicates by `component_id`.

## Decisions Pending
- Apply: merge duplicates on apply (sum by `component_id`) vs keep separate rows; potentially make it a toggle.
- Attach: follow latest vs pin to a snapshot/version; timeline for introducing `bom_snapshots`.
- Merge key for totals: merge by `component_id` only or by `(component_id, supplier_component_id)` when presenting the effective BOM.
- Modes: keep `phantom` only for now; add `stocked sub‑assembly` later with inventory/WO rules.
- Depth: single‑level now; add recursive expansion with cycle detection and max depth later.
- Overrides: allow parent-level overrides (supplier/qty) on linked items and how they interact with merges.
- Bake/Detach: behaviors, audit trail, and provenance retention when converting links to static rows.
- Performance: materialized view/caching vs live compute; invalidation triggers (parent BOM change, sub‑product BOM change, link edit).

### Phase 1.5 — Product as Sub‑assembly (Apply)
- UI: BOM tab → "Add Product" → search product → preview BOM → set Quantity → Apply.
- Behavior: copies the selected product’s BOM rows into the current product’s BOM, scaling each child quantity by Quantity (phantom explosion; no separate inventory line).
- Supplier carry‑through: `supplier_component_id` is preserved for costing.
- Guardrails: cannot apply a product to itself; single‑level explosion; no auto‑merge of duplicates yet.
- API: `POST /api/products/:productId/bom/apply-product` with `{ sub_product_id, quantity }`.
- Future options: merge duplicates on apply; optional "stocked sub‑assembly" mode that adds a single product line and consumes inventory.

### Phase 2 — Attach Product (Dynamic Link)
- Purpose: keep a product linked to another product’s BOM so changes propagate automatically (ideal for shared frames used across many chairs).
- Model (proposed): `product_bom_links { product_id, sub_product_id, scale numeric default 1, mode text default 'phantom', pinned_snapshot_id int null, effective_from/to }`.
  - `mode='phantom'` explodes children into the parent; `mode='stocked'` adds a single line for the sub‑product (inventory/WO integration later).
  - Pinning: until we have BOM versioning/snapshots, only “follow latest” is supported. Next step is `bom_snapshots` + a publish/pin flow for products.
- Effective BOM resolution:
  - Start with explicit parent BOM rows.
  - For each link in `product_bom_links`, read the sub_product’s BOM (or snapshot), multiply by `scale`, and add to the set.
  - Merge by `component_id` (and optionally `supplier_component_id`) when presenting totals; keep raw provenance for drill‑down.
  - Depth: begin single‑level; later add recursive expansion with cycle detection and max depth.
- Supplier behavior: propagate `supplier_component_id` from the linked sub‑product rows; allow parent overrides to replace supplier/qty for a given component.
- Guardrails: prevent self‑links and cycles; show “where used” before saving breaking changes to a linked sub‑product; require confirmation.
- UI:
  - BOM tab → Add Product → choices: `Apply (copy)` or `Attach (link)`.
  - Options: scale, mode (phantom/stocked), pin (when snapshots exist).
  - Show linked badges on rows with quick actions: “Open source”, “Bake (convert to rows)”, “Detach”.
- API (proposed):
  - `POST /api/products/:productId/bom/attach-product { sub_product_id, scale, mode, pinned_snapshot_id? }`
  - `GET /api/products/:productId/effective-bom` returns merged view including links.
  - Future: `POST /api/products/:id/bom/publish` to create/pin snapshots.

#### Implementation Status (Phase A, shipped behind feature flag)
- Flag: set `NEXT_PUBLIC_FEATURE_ATTACH_BOM=true` in `.env.local` to enable UI.
- Schema: `product_bom_links(product_id, sub_product_id, scale, mode='phantom')` added (see `db/migrations/20250910_create_product_bom_links.sql`).
- Endpoints:
  - `POST /api/products/:productId/bom/attach-product` (create/update link)
  - `DELETE /api/products/:productId/bom/attach-product?sub_product_id=…` (detach link)
  - `GET /api/products/:productId/effective-bom` (explicit rows + attached, single‑level)
- UI: Add Product dialog offers `Apply (copy)` or `Attach (link)` when flag is on. Table still shows explicit rows; totals use effective BOM when flag is on.
- Limits: single-level; phantom only; no Bake/Detach UI yet; no snapshots/pinning yet; where‑used warning planned.

### Next Steps (Phase A polish)
- UI
  - Add a small "Linked to <code>" badge on the BOM tab when links exist.
  - Add "Detach" control (per linked sub‑product) in the BOM toolbar/dialog.
  - Optional: "Bake" action to convert a link into static rows (defer if needed).
- Where‑used
  - On saving a sub‑product BOM change, show a confirm with count/list of parent products from `product_bom_links`.
- Effective BOM
  - Keep table editable using explicit rows; totals read `GET /effective-bom`.
  - Cache via React Query; invalidate on: parent BOM change, sub‑product BOM change, link add/remove.
- Merge rules (for totals)
  - Quantity chips by `component_id`.
  - Cost totals sum per-row (or group by `(component_id, supplier_component_id)`).
- Ops
  - Log attach/detach events.
  - Flag gating: `NEXT_PUBLIC_FEATURE_ATTACH_BOM=true` only on dev/staging until QA passes.

### Verification Checklist
- Apply link → totals include sub‑product BOM; no rows copied.
- Edit sub‑product BOM (qty or supplier/price) → parent totals reflect change.
- Detach → totals revert; no explicit rows left behind.
- Self‑link and duplicate link blocked.

### Prerequisites
- Database migration applied: `db/migrations/20250910_create_product_bom_links.sql`.
- Env: `.env.local` has `NEXT_PUBLIC_FEATURE_ATTACH_BOM=true`.

## Phased Implementation Plan (Attach)
- A1. Schema: create `product_bom_links`; add minimal indexes and FKs; prepare `bom_snapshots` table (nullable, used later).
- A2. Resolver: implement effective BOM expansion (parent rows + linked explosion + merge by `component_id`).
- A3. API: `POST /api/products/:productId/bom/attach-product` (create link), `GET /api/products/:productId/effective-bom` (merged read).
- A4. UI: Add Product dialog adds Attach option with scale/mode; chip/badge for linked rows with Open/Bake/Detach.
- A5. Guardrails: block self-link; detect cycles (single-level in A, recursive later); confirm impact when editing linked sub-product.
- B1. Snapshots/Pinning: add `bom_snapshots` + publish flow; allow `pinned_snapshot_id` on links; optional date-based “as of”.
- C1. Stocked mode: extend resolver and costing to treat sub-assembly as a single inventory line; WO/backflush rules follow.

## Goals
- Create reusable “BOM/BOL collections” for common bases or option packs.
- Allow two usage modes:
  - Attach (dynamic/phantom): stays linked to the collection and can be version‑pinned.
  - Apply (copy/frozen): copies items into the product’s BOM/BOL once, then becomes independent.
- Support scaling (e.g., size variants), supplier defaults, and per‑product overrides.
- Preserve auditability and predictable rollups for cost and planning.

## Terminology
- Collection: A named set of components (and optionally jobs) with quantities and optional supplier mappings.
- Attach: Reference a collection on a product so it “explodes” into BOM/BOL at compute time (can pin a version).
- Apply: One‑time copy of collection items into the product’s BOM/BOL (rows keep provenance for traceability).
- Phantom: Inventory does not track a separate SKU for the collection; it explodes into child rows.

## Data Model

### Tables (new)
- `bom_collections`
  - `collection_id serial primary key`
  - `code text unique not null` — human code (e.g., BASE-CHAIR)
  - `name text not null`
  - `description text null`
  - `is_phantom boolean not null default true` — always explode (no separate stock)
  - `version integer not null default 1` — increment on release
  - `status text not null default 'draft'` — draft | published | archived
  - `created_at timestamptz default now()`
  - `updated_at timestamptz default now()`

- `bom_collection_items`
  - `item_id serial primary key`
  - `collection_id int references bom_collections(collection_id) on delete cascade`
  - `component_id int references components(component_id) not null`
  - `quantity_required numeric not null`
  - `supplier_component_id int null references suppliercomponents(supplier_component_id)`
  - Future: `notes text`, `scrap_rate numeric`, `alt_component_id int`

- `product_bom_collections`
  - `product_id int references products(product_id) on delete cascade`
  - `collection_id int references bom_collections(collection_id) on delete cascade`
  - `pinned_version int null` — freeze to a released version
  - `scale numeric not null default 1.0` — multiplies all quantities in the collection
  - `effective_from date null`
  - `effective_to date null`
  - `created_at timestamptz default now()`
  - Primary key: `(product_id, collection_id)`

- `bol_collection_items` (optional now, can follow after BOM)
  - `item_id serial primary key`
  - `collection_id int references bom_collections(collection_id) on delete cascade`
  - `job_id int references jobs(job_id) not null`
  - `time_required numeric not null`
  - `time_unit text not null default 'minutes'` — hours | minutes | seconds
  - `quantity numeric not null default 1`

- `product_bol_collections`
  - Same shape as `product_bom_collections` but for labor collections

### Provenance on existing rows (minimal columns)
- `billofmaterials`
  - `source_collection_id int null references bom_collections(collection_id)`
  - `source_collection_version int null`
  - `overridden boolean not null default false`

- `billoflabour`
  - `source_collection_id int null references bom_collections(collection_id)`
  - `source_collection_version int null`
  - `overridden boolean not null default false`

### Materialized/Flattened View (optional, for performance)
- `effective_bom_view` — SELECT that unions explicit product BOM rows with the expansion of attached collections (merging by `component_id`, summing quantities, honoring `scale` and `pinned_version`). Can be a materialized view refreshed on change or a cached read layer.
- `effective_bol_view` — analogous for labor.

## Versioning
- Collections are edited as drafts; publishing bumps `version`.
- Attachments can either:
  - Follow latest published version (no pin), or
  - Pin to the current `version` (stable).
- Applying (copy) always stores `source_collection_id` + `source_collection_version` on the created rows.

### Publish Semantics (plain English)
- Publish freezes a snapshot of the collection as a numbered version. Future edits happen in a new draft and are released as the next version when published.
- Purpose: stability, auditability, and reproducibility. It lets products “pin” to a specific version, so results don’t change unexpectedly.
- Effect when things change later:
  - Apply (copy): previously copied rows in a product’s BOM never change; they already hold their own quantities and note which collection/version they came from.
  - Attach (dynamic, future):
    - Pinned: the product stays on the pinned version and won’t pick up later changes until you repin.
    - Not pinned: the product follows the latest published version, so updates to the collection will flow through after republish.
- Current state: status/publish is informational-only until we wire the Publish action and the attach/pin behavior. Apply works today with drafts.

## Attach vs Apply — Behavior
- Attach (dynamic): Product reads include explosion of the attached collection (optionally pinned to a version). Edits to the collection will reflect in products unless pinned.
- Apply (copy): Copies items into BOM/BOL one time. Items are regular rows and can be edited; collection changes do not propagate. A “Re‑apply updates” tool can diff and merge later.

### Scale — What it does
- Definition: `scale` multiplies every item quantity in the collection when attaching or applying.
- Examples:
  - Scale 2 → each item quantity doubles (use when a kit needs two sets).
  - Scale 0.5 → halves quantities (only if meaningful for your UoM).
- Limits today: must be positive; decimals allowed. No automatic unit conversions.
- Apply now: scaled quantities are written into `billofmaterials` immediately.
- Attach (future): the effective BOM will reflect `scale` at read time.

## Merge & Overrides
- When attaching/applying, if a product already contains the same `component_id`, merge by summing quantities (configurable).
- Overrides:
  - If a copied row is edited, mark `overridden=true` and it stops auto‑update merge.
  - For attached sets, enable per‑row product overrides by writing explicit rows that supersede the exploded value for that component (computed: `explicit + exploded`, or “prefer explicit” strategy).

## Supplier Defaults
- `bom_collection_items.supplier_component_id` can carry default supplier/price. Products may override the supplier at the product level.

## Costing & MRP
- Rollup formula remains: sum of (qty × unit_price) across the flattened BOM plus labor cost from flattened BOL.
- Phantom collections never appear as inventory items; only children do.
- Cache or materialize flattened views for performance; invalidate on:
  - Product BOM/BOL changes
  - Collection item changes (for attached products)
  - Attachment updates (scale, pin/unpin)

## UI/UX

### Collections Management (new area)
- List + search collections
- Edit collection items (components and, later, jobs)
- Publish new version (draft → published)
- Create a collection from a selection of rows in a product’s BOM/BOL

### Product → BOM Tab
- New “Add From Collection” button
  - Dialog: search collections → preview content → choose Attach or Apply
  - Options:
    - Scale factor (default 1.0)
    - Supplier behavior: use collection defaults vs keep as unspecified
    - Version pin (when attaching)
  - Pre‑merge preview (show duplicates and final quantities)

### Product → BOL Tab
- Same flow with labor collections once BOL collections are enabled.

### Visual Patterns
- Reuse existing table action style (Edit = ghost icon, Delete = destructiveSoft)
- Keep summary chips for totals (BOM total cost; BOL total hours/cost)
- Use the established light/dark image and card styling (see STYLE_GUIDE.md)

## API / Backend Plan

We can implement via Supabase client calls or dedicated API routes. A pragmatic start:

### Endpoints (Next.js API)
- `POST /api/collections` — create/edit collection (draft)
- `POST /api/collections/:id/publish` — bump version and publish
- `GET /api/collections` — list/search
- `GET /api/collections/:id` — get with items (and latest published version)
- `POST /api/products/:productId/bom/attach-collection` — attach with `{ collection_id, scale, pinned_version? }`
- `POST /api/products/:productId/bom/apply-collection` — copy into BOM, store provenance, merge duplicates
- Same pairs for BOL when ready

### Attach Explosion Logic (server/lib)
- A helper to resolve a product’s effective BOM/BOL:
  1. Read explicit rows
  2. Expand attached collections at the chosen version
  3. Merge by `component_id` (respect overrides where configured)

## Affected Code Areas

If fully implemented, the following files/directories will be touched or added:

- New
  - `app/api/collections/route.ts` and `app/api/collections/[id]/route.ts` **(Implemented)**
  - `app/api/collections/[id]/publish/route.ts` **(Implemented)**
  - `components/features/collections/CollectionsList.tsx` **(Implemented)**
  - `components/features/collections/CollectionEditor.tsx` **(Implemented)**
  - `app/api/products/[productId]/bom/attach-collection/route.ts`
  - `app/api/products/[productId]/bom/apply-collection/route.ts`
  - `components/features/products/AddFromCollectionDialog.tsx` (BOM)
  - `components/features/products/AddLaborCollectionDialog.tsx` (BOL, later)
  - `lib/collections.ts` — helpers (resolve effective BOM, merge rules)
  - `migrations/XXXX_create_bom_collections.sql` **(Implemented)**

- Updated
  - `components/features/products/product-bom.tsx` — add button + preview + post attach/apply
  - `components/features/products/product-bol.tsx` — labor counterpart
  - `app/products/[productId]/page.tsx` — wire dialogs and refresh after changes
  - `components/features/products/AddFromCollectionDialog.tsx` — preview now shows component code and description
  - `docs/overview/STYLE_GUIDE.md` — confirm patterns (already updated with action styles and image frames)
  - `docs/domains/components/product-creation-guide.md` — link to this document

## Migration Sketch (Postgres)

```sql
create table bom_collections (
  collection_id serial primary key,
  code text unique not null,
  name text not null,
  description text,
  is_phantom boolean not null default true,
  version int not null default 1,
  status text not null default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table bom_collection_items (
  item_id serial primary key,
  collection_id int not null references bom_collections(collection_id) on delete cascade,
  component_id int not null references components(component_id),
  quantity_required numeric not null,
  supplier_component_id int references suppliercomponents(supplier_component_id)
);

create table product_bom_collections (
  product_id int not null references products(product_id) on delete cascade,
  collection_id int not null references bom_collections(collection_id) on delete cascade,
  pinned_version int,
  scale numeric not null default 1.0,
  effective_from date,
  effective_to date,
  created_at timestamptz default now(),
  primary key (product_id, collection_id)
);

alter table billofmaterials
  add column source_collection_id int references bom_collections(collection_id),
  add column source_collection_version int,
  add column overridden boolean not null default false;
```

(Repeat analogous tables/columns for BOL if/when enabled.)

## Security & Permissions
- Limit collection editing to authorized roles.
- Publishing a version should be an explicit action with audit trail (user, timestamp).
- Prevent collection cycles (no nested collections initially; later, allow nesting with cycle detection).

## Testing Strategy
- Unit: merge/attach/apply helpers; version selection; scaling math; duplicate merges.
- Integration: API endpoints attach/apply; optimistic UI updates on product pages.
- E2E: Create collection → attach to product → cost rollup reflects changes; pin version and publish new version → pinned products remain stable; apply copy and verify drift behavior.

## Rollout Plan
1. Phase 1 (Low risk): Collections (BOM only) + Apply (copy). UI: Add from Collection dialog (copy mode only). Metrics: adoption, speed of product setup.
2. Phase 2: Attach (dynamic) with version pinning; add miniature “linked” indicator rows in BOM.
3. Phase 3: Labor collections (BOL) and re‑apply updates with visual diff.
4. Phase 4: Optional nesting, effective dates, and advanced supplier mapping.

## Open Questions
- Do we need cross‑unit conversions at attach time? If yes, where is the canonical UoM per component?
- Should we allow partial selection from a collection during Apply?
- How aggressive should merge rules be by default (sum vs keep separate rows)?

---

This plan complements the current Product and BOM/BOL features and uses existing UI/UX patterns (buttons, dialogs, image frames, and destructiveSoft actions). It keeps operations auditable, cost rollups deterministic, and gives teams the choice between dynamic reuse and frozen copies.

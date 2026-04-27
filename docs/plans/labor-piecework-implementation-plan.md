# Labor & Piecework — Implementation Plan

This document records the plan to finalize Labor Management with explicit support for piecework and hourly jobs, align costing and payroll, and stage future team‑piecework allocation. No code changes are made by this document.

## Objectives

- Decouple taxonomy (categories) from tariffs (rates).
- Allow each job to be costed/paid as hourly or piece on a per‑use basis.
- Capture exact rate versions on BOL lines for stable costing.
- Keep a standard time per unit for capacity planning and effective‑hourly analytics.
- Allow piecework quantities to be derived from cutlist production metrics where appropriate, while still supporting manual quantities for companies that do not use cutlist-based pay.
- Allow specific cutlist parts to be excluded from payable piecework metrics without removing them from the manufacturing cutlist.
- Prepare for team piecework allocation in a future phase.

## Current State (as of this plan)

- UI
  - Labor page tabs: Job Categories, Jobs, Piecework Rates (`app/labor/page.tsx`).
  - Piecework rates manager implemented (`components/features/labor/piecework-rates-manager.tsx`).
  - Product BOL supports `pay_type` and `piece_rate_id` in code (`components/features/products/product-bol.tsx`).
  - Product Costing handles piece vs hourly in code (`components/features/products/product-costing.tsx`).
- DB
  - `piece_work_rates` exists.
  - `billoflabour` currently lacks `pay_type` and `piece_rate_id` (must apply migration).
  - Category hourly rates exist via `job_category_rates`; `job_categories` is taxonomy only.

## Target Model

- Categories (`job_categories`): taxonomy only. No rates.
- Jobs (`jobs`): operations; optional hint for UI: `allowed_comp_modes = 'hourly' | 'piece' | 'either'` (default 'either').
- Rates (versioned)
  - Hourly: `job_hourly_rates(job_id, hourly_rate, effective_date, end_date, created_at)` unique `(job_id, effective_date)`.
  - Piece: keep `piece_work_rates(job_id, product_id nullable, rate, effective_date, end_date, created_at)` with unique `(job_id, product_id, effective_date)`.
- BOL lines (`billoflabour`)
  - Columns: `job_id`, `pay_type` ('hourly' | 'piece'), `hourly_rate_id` (FK job_hourly_rates), `piece_rate_id` (FK piece_work_rates), `time_required`, `time_unit`, `quantity`.
  - Future cutlist-derived piecework columns: `quantity_source` (`manual` | `cutlist_metric`), `quantity_driver` (for example `cutlist_cut_piece_count`), and `quantity_overrides`/metadata for exceptional cases.
  - Store the resolved rate ID at insert/update time.
- Job Cards
  - On issuance, copy down: `pay_type` and numeric `piece_rate` or `hourly_rate` to `job_card_items` (existing `piece_rate` present). Time logs remain for hourly tracking.

## Cutlist-Derived Piecework Quantities

Some tenants pay piecework from cutlist activity instead of a manually-entered BOL quantity. This must be organization-scoped configuration layered on top of cutlist facts, not a Qbutton-only shortcut.

### Driver Registry

Introduce a small, code-backed registry of quantity drivers. BOL rows reference a driver when `pay_type = 'piece'` and `quantity_source = 'cutlist_metric'`.

Initial drivers:

| Driver | Meaning | Example use |
| --- | --- | --- |
| `manual_quantity` | Existing manually-entered BOL quantity | Generic piecework not tied to cutlist |
| `cutlist_cut_piece_count` | Count payable sheet pieces physically cut, including backer pieces | Qbutton cutting at R6.50 per cut piece |
| `cutlist_edged_finished_item_count` | Count payable finished assemblies that receive edging | Edging team paid per item edged |
| `cutlist_edging_meters` | Count payable edging length in meters | Future tenants that pay edging by meter |
| `cutlist_sheet_count` | Count billable/used sheets | Future sheet handling or loading work |

Qbutton defaults:

- Cutting per Piece: `piece_work_rates.rate = 6.50`, `quantity_driver = cutlist_cut_piece_count`.
- Edging per Piece: `quantity_driver = cutlist_edged_finished_item_count`, with one payable item per finished edged assembly regardless of whether one edge or four edges are banded.
- Backer pieces count for cutting pay. Example: a top with backer has one primary cut piece plus one backer cut piece, so it contributes `2` to `cutlist_cut_piece_count`.

### Metric Semantics

`cutlist_cut_piece_count` counts selected payable cut pieces:

- `none`: `quantity`
- `with-backer`: `quantity` primary pieces + `quantity` backer pieces
- `same-board`: `quantity` cut pieces
- custom lamination: sum layer quantities

`cutlist_edged_finished_item_count` counts selected payable finished assemblies with at least one edge banded:

- `none`: `quantity`
- `with-backer`: `quantity` finished 32mm assemblies
- `same-board`: `floor(quantity / 2)` finished 32mm assemblies
- lamination groups: one assembly per matched group set, using the minimum member quantity
- custom lamination: `quantity` finished assemblies

For `same-board` rows with odd quantities, the system should warn or block because two cut pieces form one finished laminated item. Example: quantity `3` means three pieces are cut, but only one complete pair can be edged and one piece is left unpaired. Default plan: block or require an explicit override before costing/payroll can use the derived edging metric.

### Payable Part Inclusion

The cutlist part row needs operation-level payable flags. These flags affect labor/payroll metrics only; they do not remove the part from the cutlist or optimizer.

Proposed part metadata:

```json
{
  "payable_operations": {
    "cut": true,
    "edge": true
  }
}
```

Default values should come from an org-scoped setting or product template. For Qbutton, default both to `true`, then allow a user to unselect parts that should not be paid as piecework. A part with `payable_operations.cut = false` still appears in the cutlist and can still be cut, but it is excluded from `cutlist_cut_piece_count`. A part with `payable_operations.edge = false` can still carry edge-banding information for material costing, but it is excluded from `cutlist_edged_finished_item_count`.

UI direction:

- Add compact payable toggles on the product cutlist builder, likely in a row action/menu or a dedicated compact "Pay" column rather than adding noisy text-heavy controls.
- Support bulk actions: mark selected/all rows payable or not payable for cutting/edging.
- In the Product Costing Labor tab, display both the driver and resolved quantity, for example `Cutlist cut pieces: 5 payable of 7 total`.
- Preserve manual override for exceptional products.

### Snapshotting for Orders and Payroll

Derived quantities should be live for product costing, but frozen when production work is issued:

- Product costing can recalculate from the current product cutlist.
- Order/job-card issuance should snapshot the resolved quantity, quantity driver, part inclusion state/hash, and numeric rate.
- Payroll should use the issued snapshot so historical pay does not change if the product cutlist is edited later.

## Phase 1 — Database

1) Apply existing BOL extension (piecework) if not applied
- File: `db/migrations/20250909_bol_piecework.sql`
- Outcome on `billoflabour`:
  - `pay_type text check (pay_type in ('hourly','piece'))`
  - `piece_rate_id integer references public.piece_work_rates(rate_id)`
  - Pairing CHECK: hourly → `rate_id not null` and `piece_rate_id null`; piece → `piece_rate_id not null`.

2) Introduce job‑level hourly rates (new migration)
- New table `job_hourly_rates`:
```sql
create table public.job_hourly_rates (
  rate_id serial primary key,
  job_id int not null references public.jobs(job_id) on delete cascade,
  hourly_rate numeric not null,
  effective_date date not null,
  end_date date,
  created_at timestamptz default now(),
  constraint unique_job_hourly_date unique (job_id, effective_date)
);
create index if not exists idx_job_hourly_rates_lookup on public.job_hourly_rates (job_id, effective_date);
```
- Optional: exclusion or trigger to prevent overlapping date ranges per job.

3) Backward compatibility bridge (optional, transitional)
- Category rate display now reads from `job_category_rates`; future job-level hourly rates can be introduced without another denormalized category-rate column.

4) Integrity & enums
- Add CHECK on `billoflabour.time_unit in ('hours','minutes','seconds')`.
- Consider enabling RLS later (see Security).

## Phase 2 — Frontend

A) Labor Management
- Keep: Piecework Rates Manager (already built).
- Add: Job Hourly Rates Manager (mirror of piecework manager but per job; no product override).
- Update: Jobs Manager to include optional `allowed_comp_modes` for UI hints.
- Deprecate: Editing category hourly rates in UI. Categories remain for search/filter.

B) Product BOL (`components/features/products/product-bol.tsx`)
- Already supports `pay_type` and `piece_rate_id`.
- Update hourly path to resolve from `job_hourly_rates` instead of category rates and store `hourly_rate_id`.
- Keep time fields always present; disable when `pay_type='piece'`.
- Display both rate kinds with clear labels; show total hours only for hourly lines.
- Add quantity source controls for piece rows:
  - Manual quantity (existing behavior)
  - Cutlist-derived quantity driver, selected from the supported driver registry
  - Read-only resolved quantity preview with stale/missing cutlist warnings

C) Product Costing (`components/features/products/product-costing.tsx`)
- Use stored rate IDs:
  - Hourly: join `job_hourly_rates` via `hourly_rate_id`.
  - Piece: join `piece_work_rates` via `piece_rate_id`.
- Still show standard hours for capacity, even when costed as piece.
- For cutlist-derived piecework rows, calculate line totals from the resolved driver quantity and show the driver source beside the row.

D) Product Cutlist Builder (`components/features/cutlist/CutlistCalculator.tsx`)
- Persist operation-level payable flags on product cutlist parts.
- Add per-row and bulk controls to include/exclude parts from payable cutting and payable edging.
- Derived labor metrics should use the payable flags while material costing and layout optimization continue to use all manufacturing parts.

E) Job Cards
- Generation: inherit `pay_type` and the numeric rate (resolved at issuance) onto `job_card_items`.
- Existing fields support piece; add numeric hourly if needed later.
- For cutlist-derived BOL lines, snapshot the resolved quantity and driver at issuance.

## Phase 3 — Team Piecework (Future)

- Minimal data additions:
  - `job_card_item_periods(job_card_item_id, start_time, end_time, policy)`
  - `job_card_item_period_members(period_id, staff_id, weight default 1)`
  - Optionally daily production logs per item.
- Default policy: equal per attendance‑day; alternative: hours‑weighted; manual override at close.

## Security (RLS) — Later

- Enable/verify RLS for: `jobs`, `job_hourly_rates`, `piece_work_rates`, `billoflabour`, and any org-level driver/default settings with authenticated org-member policies similar to `job_cards`.
- Keep admin/service role for migrations and batch ops.

## Migrations & Rollout Plan

1) Apply piecework columns to `billoflabour` (if not applied).
2) Create `job_hourly_rates` table.
3) UI changes behind a feature flag (hourly rates by job). Gradually remove category rate dependency.
4) Update BOL hourly path and Costing to use job hourly rate IDs.
5) Data backfill (optional): seed initial `job_hourly_rates` from existing category rates with a one‑time script (maps each job to its category’s current rate as of today).
6) Add cutlist-derived quantity driver fields to BOL and implement the initial driver registry.
7) Add payable operation flags to product cutlist part persistence and cutlist builder UI.
8) Snapshot resolved derived quantities at job-card/order issuance.
9) Monitor: verify costing parity for hourly lines; verify manual piece lines unaffected; verify Qbutton cutting and edging quantities against sample products.

## Testing

- Unit/logic tests (by inspection/manual for now):
  - Rate resolution as of date for both tables.
  - BOL insert/update stores the correct rate_id / piece_rate_id.
  - Costing totals match expected formulas for hourly and piece lines.
  - Cutlist driver tests:
    - Backer pieces count in `cutlist_cut_piece_count`.
    - With-backer assemblies count once in `cutlist_edged_finished_item_count`.
    - Excluded cut rows do not contribute to cutting pay but still appear in layout/material costing.
    - Excluded edge rows do not contribute to edging pay but still contribute to edge-banding material cost when banded.
    - Odd `same-board` quantities warn/block or require override.
- UI manual tests:
  - Create/edit piece rates (job default and product‑specific), verify BOL resolution.
  - Create/edit hourly rates (per job), verify BOL resolution.
  - Switch pay_type on a BOL line and confirm fields and totals.
- Regression checks:
  - Job cards continue to read piece rates; issuance from BOL prepopulates correctly.

## Risks & Mitigations

- Divergent sources of hourly rates (category vs job):
  - Mitigation: Stage rollout; keep category rates available until job rates are in use everywhere; add migration/backfill.
- Historical correctness:
  - Mitigation: Always store rate IDs on BOL; copy numeric rates to job cards at issuance.
- Data overlaps in rate versions:
  - Mitigation: add unique + optional exclusion/trigger; validate in UI on insert.

## Open Questions

- Do we want product‑specific hourly overrides like we have for piece? (Not required initially.)
- Any plant/line/location scoping for rates? (Future.)
- Do we expose an “as of date” selector when editing BOL to lock rates to a date other than today?
- Should odd `same-board` quantities be strictly blocked at cutlist entry, or allowed with a warning and manual piecework override?
- Should payable cut/edge defaults be configured globally per organization, per product category, or both?

## Acceptance Criteria (Phase 1–2)

- `billoflabour` has `pay_type` and `piece_rate_id` in DB and is used by BOL UI without errors.
- New `job_hourly_rates` exists; BOL hourly path resolves and stores `hourly_rate_id`.
- Costing uses stored rate IDs for both modes; totals correct.
- Piecework Rates manager remains functional; Job Hourly Rates manager is available.
- No dependency on category rates for costing or BOL creation/editing.
- Piece BOL rows can optionally derive quantity from cutlist metrics.
- Product cutlist parts can be included/excluded from payable cutting and edging without affecting material layout/costing.
- Qbutton sample product verifies:
  - cutting quantity includes backers,
  - edging quantity counts finished edged assemblies once,
  - excluded pieces are omitted from piecework pay.

---

References
- Piecework manager: `components/features/labor/piecework-rates-manager.tsx`
- BOL component: `components/features/products/product-bol.tsx`
- Costing: `components/features/products/product-costing.tsx`
- Labor page shell: `app/labor/page.tsx`

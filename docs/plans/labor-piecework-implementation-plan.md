# Labor & Piecework — Implementation Plan

This document records the plan to finalize Labor Management with explicit support for piecework and hourly jobs, align costing and payroll, and stage future team‑piecework allocation. No code changes are made by this document.

## Objectives

- Decouple taxonomy (categories) from tariffs (rates).
- Allow each job to be costed/paid as hourly or piece on a per‑use basis.
- Capture exact rate versions on BOL lines for stable costing.
- Keep a standard time per unit for capacity planning and effective‑hourly analytics.
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
  - Category hourly rates exist via `job_category_rates` and `job_categories.current_hourly_rate` (legacy approach).

## Target Model

- Categories (`job_categories`): taxonomy only. No rates.
- Jobs (`jobs`): operations; optional hint for UI: `allowed_comp_modes = 'hourly' | 'piece' | 'either'` (default 'either').
- Rates (versioned)
  - Hourly: `job_hourly_rates(job_id, hourly_rate, effective_date, end_date, created_at)` unique `(job_id, effective_date)`.
  - Piece: keep `piece_work_rates(job_id, product_id nullable, rate, effective_date, end_date, created_at)` with unique `(job_id, product_id, effective_date)`.
- BOL lines (`billoflabour`)
  - Columns: `job_id`, `pay_type` ('hourly' | 'piece'), `hourly_rate_id` (FK job_hourly_rates), `piece_rate_id` (FK piece_work_rates), `time_required`, `time_unit`, `quantity`.
  - Store the resolved rate ID at insert/update time.
- Job Cards
  - On issuance, copy down: `pay_type` and numeric `piece_rate` or `hourly_rate` to `job_card_items` (existing `piece_rate` present). Time logs remain for hourly tracking.

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
- While UI still references `job_categories.current_hourly_rate`, we can:
  - Keep category rate fields untouched for now, or
  - Create a view later when we switch to job‑level rates.

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

C) Product Costing (`components/features/products/product-costing.tsx`)
- Use stored rate IDs:
  - Hourly: join `job_hourly_rates` via `hourly_rate_id`.
  - Piece: join `piece_work_rates` via `piece_rate_id`.
- Still show standard hours for capacity, even when costed as piece.

D) Job Cards
- Generation: inherit `pay_type` and the numeric rate (resolved at issuance) onto `job_card_items`.
- Existing fields support piece; add numeric hourly if needed later.

## Phase 3 — Team Piecework (Future)

- Minimal data additions:
  - `job_card_item_periods(job_card_item_id, start_time, end_time, policy)`
  - `job_card_item_period_members(period_id, staff_id, weight default 1)`
  - Optionally daily production logs per item.
- Default policy: equal per attendance‑day; alternative: hours‑weighted; manual override at close.

## Security (RLS) — Later

- Enable RLS for: `jobs`, `job_hourly_rates`, `piece_work_rates`, `billoflabour` with authenticated role policies similar to `job_cards`.
- Keep admin/service role for migrations and batch ops.

## Migrations & Rollout Plan

1) Apply piecework columns to `billoflabour` (if not applied).
2) Create `job_hourly_rates` table.
3) UI changes behind a feature flag (hourly rates by job). Gradually remove category rate dependency.
4) Update BOL hourly path and Costing to use job hourly rate IDs.
5) Data backfill (optional): seed initial `job_hourly_rates` from existing category rates with a one‑time script (maps each job to its category’s current rate as of today).
6) Monitor: verify costing parity for hourly lines; verify piece lines unaffected.

## Testing

- Unit/logic tests (by inspection/manual for now):
  - Rate resolution as of date for both tables.
  - BOL insert/update stores the correct rate_id / piece_rate_id.
  - Costing totals match expected formulas for hourly and piece lines.
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

## Acceptance Criteria (Phase 1–2)

- `billoflabour` has `pay_type` and `piece_rate_id` in DB and is used by BOL UI without errors.
- New `job_hourly_rates` exists; BOL hourly path resolves and stores `hourly_rate_id`.
- Costing uses stored rate IDs for both modes; totals correct.
- Piecework Rates manager remains functional; Job Hourly Rates manager is available.
- No dependency on category rates for costing or BOL creation/editing.

---

References
- Piecework manager: `components/features/labor/piecework-rates-manager.tsx`
- BOL component: `components/features/products/product-bol.tsx`
- Costing: `components/features/products/product-costing.tsx`
- Labor page shell: `app/labor/page.tsx`

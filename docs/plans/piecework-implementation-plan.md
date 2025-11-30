# Piecework Implementation Plan — Spec, Status, and Next Steps

Purpose: Introduce per‑piece pay alongside hourly labor, end‑to‑end across schema, UI (Labor and BOL), and costing. This doc is the working spec and handoff checklist.

## Goals
- Let users select pay basis per BOL line: `Hourly` or `Piecework`.
- Maintain effective rate history for both hourly (by category) and piece (by job, optionally product).
- Ensure costing includes both bases correctly.
- Keep a stable audit trail by capturing the exact rate version used on each BOL line.

## Data Model

Tables in scope (existing in repo):
- `job_categories` and `job_category_rates` — versioned hourly rates by category.
- `jobs` — operations, each assigned to a category.
- `billoflabour` — lines on a product’s Bill of Labor.
- `piece_work_rates` — per‑piece rates; supports product‑specific overrides or job defaults.

Changes (migration added): `db/migrations/20250909_bol_piecework.sql`
- `billoflabour.pay_type TEXT NOT NULL DEFAULT 'hourly' CHECK (pay_type IN ('hourly','piece'))`
- `billoflabour.piece_rate_id INTEGER REFERENCES public.piece_work_rates(rate_id)`
- Pairing constraint `billoflabour_pay_pairing_chk`:
  - If `pay_type='hourly'` → `rate_id` must be set and `piece_rate_id` is NULL
  - If `pay_type='piece'` → `piece_rate_id` must be set (time fields are ignored)
- Index: `idx_piece_rates_lookup ON piece_work_rates(job_id, product_id, effective_date)` for as‑of queries.

Piecework key and fallback:
- Primary key: `(job_id, product_id, effective_date)` uniqueness.
- Fallback order when saving BOL: prefer `(job_id, product_id)`; if none, fallback to job default `(job_id, product_id IS NULL)`.

Time fields guidance:
- Hourly lines: `time_required` and `time_unit` are used (minutes/seconds converted to hours).
- Piece lines: UI disables time inputs; server treats time as unused for totals.

## UI/UX

### Labor Management (`/labor`)
- Tabs: Job Categories, Jobs, Piecework Rates.
  - Piecework Rates: CRUD job‑ and product‑level rates with effective date ranges.
  - “Applies to”: All products (job default) or Specific product.
  - List history with current effective highlighted; prevent overlapping ranges.
  - Optional bulk apply by product category (future).
  - Job selection at scale:
    - Optional Category filter; if not selected, users must type at least 3 characters to search.
    - Server-side pagination with page size 25 and debounced search (~300ms).
    - “Create New Job” inline via CreateJobModal with category preselected when available.

### Product BOL (on product page)
- Component: `components/features/products/product-bol.tsx`
- New: Pay Type selector per line: Hourly or Piecework.
- Hourly behavior: look up `job_category_rates` effective today; store `rate_id`.
- Piecework behavior: look up `piece_work_rates` effective today for `(job_id, product_id)` else default; store `piece_rate_id`.
- Table columns: Category, Job, Time Required (— for piece), Quantity, Rate (R…/hr or R…/pc), Total Time (— for piece), Total Cost.

### Product Costing (Costing tab)
- Component: `components/features/products/product-costing.tsx`
- Computes mixed totals:
  - Hourly: `hours × qty × hourly_rate` (category rate as of now).
  - Piece: `qty × piece_rate`.
- Rate column renamed to “Rate”; time shown as 0 for piece lines.

## Effective Rate Queries (as used in code)

Hourly (category):
```
select * from job_category_rates
where category_id = $1
  and effective_date <= $today
  and (end_date is null or end_date >= $today)
order by effective_date desc
limit 1;
```

Piecework (job/product with fallback):
```
-- Gather candidates for a job as of today
select rate_id, job_id, product_id, rate, effective_date, end_date
from piece_work_rates
where job_id = $jobId
  and effective_date <= $today
  and (end_date is null or end_date >= $today)
order by effective_date desc;

-- Prefer product match else job default (product_id is null)
chosen = first where product_id = $productId
      or first where product_id is null
```

## Files Changed (implemented)
- Migration: `db/migrations/20250909_bol_piecework.sql`
- BOL UI: `components/features/products/product-bol.tsx`
  - Added `pay_type` to form and edit rows; conditional time fields.
  - Fetches `pay_type`, `piece_rate_id`, and joined `piece_work_rates` for display.
  - Insertion/update choose proper rate and populate `rate_id` or `piece_rate_id`.
  - Cost and totals updated to support mixed basis.
- Costing UI: `components/features/products/product-costing.tsx`
  - Reads `pay_type` and joins `piece_work_rates`; mixed line computations; header label “Rate”.
- Docs updated: `docs/operations/BOL_SYSTEM.md`, `docs/domains/timekeeping/labor-section.md`, `docs/plans/product-costing-plan.md` with piecework model and behavior.

## Validation & Rules
- Jobs search: min 3 characters when no category filter; 25 items per page; prevents loading hundreds of rows into the dropdown.
- UI prevents entering time when pay type is Piecework.
- DB constraints ensure a BOL line can’t be saved with an invalid pairing of rate refs.
- Overlapping rate ranges: hourly uniqueness already exists (on start date); for piecework, consider adding an exclusion constraint if needed.

## Test Plan (manual)
1. Run migration file against DB.
2. Ensure there’s at least one `piece_work_rates` row for a job (default) and optionally a product override.
3. Add a BOL line (Hourly): verify rate is populated and total = hours × qty × rate.
4. Edit line → switch to Piecework: verify time disables; rate switches; total = qty × piece rate.
5. Add a second BOL line for a product with a product‑specific piece rate and confirm override is used.
6. Confirm Costing tab totals match BOL table totals for both hourly and piece lines.

## Open Decisions / Follow‑ups
- Payroll: keep “higher of hourly vs piece” logic for job cards, or enforce chosen pay type? Current payroll code computes both and chooses higher; confirm desired behavior.
- RLS: enable for `job_categories`, `job_category_rates`, `jobs`, `billoflabour`, and `piece_work_rates` before multi‑tenant use.
- Triggers: optional trigger to sync `job_categories.current_hourly_rate` when a new rate becomes current.
- Overlap prevention on `piece_work_rates`: optional exclusion constraint by `(job_id, coalesce(product_id,-1))` and daterange.

## Next Steps (implementation)
1. Build the `/labor` → Piecework Rates manager tab (CRUD with history and filters).
2. Add minimal server-side API for exporting costing summary (optional PDF use case).
3. Add “As of date” picker to BOL and Costing for historical recalculation (optional).
4. Author RLS policies matching current app roles (if/when enabling RLS).

---

Last updated after implementing migration + UI changes on 2025‑09‑09.


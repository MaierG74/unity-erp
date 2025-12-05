# Labor Section — Source & Planning Document

This document consolidates how the Labor section of the app works today across UI, data model, and Supabase behavior. It is the single source of truth for future planning and changes.

## Scope

- Labor Management page at `/labor` with two tabs: Job Categories and Jobs.
- Labor Planning board at `/labor-planning` that pairs an order/job tree with staff swimlanes for scheduling mockups.
- Product Labor (BOL) on the product detail page.
- Underlying Supabase tables, relationships, and policies.

## UI Overview

- **Labor Management (`/labor`)**: app/labor/page.tsx:1
  - Tabs: `Job Categories`, `Jobs`, and `Piecework Rates`.
  - Components used:
    - `components/features/labor/job-categories-manager.tsx:1`
    - `components/features/labor/jobs-manager.tsx:1`
    - `components/features/labor/piecework-rates-manager.tsx:1`
- **Labor Planning (`/labor-planning`)**: app/labor-planning/page.tsx:1
  - Two-pane layout:
    - Left pane: order tree with expandable job lists and light virtualization for large queues.
    - Right pane: time-scaled swimlanes with sticky time axis and placeholder drag handles for unscheduled jobs.
  - Reusable building blocks:
    - `components/labor-planning/order-tree.tsx` — collapsible order/job tree with priority badges and drop prompts.
    - `components/labor-planning/time-axis-header.tsx` — sticky header rendering major/minor time markers.
    - `components/labor-planning/staff-lane-list.tsx` — staff rows with placeholder slots and gradient assignment bars.
    - Drag jobs from the order tree onto staff lanes to assign start time + assignee; bars can be moved between lanes or resized via handles with conflict/availability checks applied.
    - Mutation layer: `src/lib/mutations/laborPlanning.ts` wires optimistic `assignJobToStaff`, `updateJobSchedule`, and `unassignJob` calls against Supabase with overlap/window validation and undo toasts in the UI.
  - Data feed (typed): `lib/queries/laborPlanning.ts`
    - `fetchOpenOrdersWithLabor()` pulls non-closed orders with `order_details → products → billoflabour` joins to surface job identifiers, pay type, time/unit, quantity (scaled by order qty), and category metadata (hashed color fallback).
    - `fetchStaffRoster({ date? })` returns active staff with role, weekly capacity, and availability flags (`isActive`, `isCurrent`, `hasSummaryOnDate` via `time_daily_summary`, `isAvailableOnDate`).
    - `fetchLaborPlanningPayload({ date? })` composes the orders + staff + a default `unscheduledJobs` list (flattened from the order/job tree for drag-ready UI wiring) plus scheduled assignments loaded from `labor_plan_assignments` for the selected date.

- **Product Bill of Labor**: components/features/products/product-bol.tsx:1
  - Embedded on product detail: app/products/[productId]/page.tsx:358
  - Lets users add, edit, and remove labor items linked to a product.
  - When the Attach BOM feature flag is enabled (`NEXT_PUBLIC_FEATURE_ATTACH_BOM=true`), a read‑only “Effective Bill of Labor (explicit + linked)” section shows labor from linked sub‑products.

## Data Model (Supabase)

Tables involved and their key columns and relationships. Source: Supabase MCP queries and existing docs.

- **`job_categories`**
  - Columns: `category_id serial PK`, `name text unique`, `description text`, `current_hourly_rate numeric not null default 0.00`.
  - Purpose: Defines categories of labor. `current_hourly_rate` mirrors the most recent effective rate for convenience.
  - Indexes: `job_categories_pkey`, `job_categories_name_key`.

- **`job_category_rates`**
  - Columns: `rate_id serial PK`, `category_id int references job_categories`, `hourly_rate numeric not null`, `effective_date date not null`, `end_date date null`, `created_at timestamptz default now()`.
  - Indexes: `idx_job_category_rates_category_id`, `unique_category_date` (unique on `(category_id, effective_date)`).
  - Semantics: Versioned rates by date range `[effective_date .. end_date]` (end_date nullable for current/open-ended).

- **`jobs`**
  - Columns: `job_id serial PK`, `name text not null`, `description text`, `category_id int references job_categories`.
  - Purpose: Specific operations performed during manufacturing, grouped by category.

- **`billoflabour`** (Product BOL items)
  - Columns: `bol_id serial PK`, `product_id int references products`, `job_id int references jobs`, `time_required numeric`, `time_unit text default 'hours'`, `quantity int default 1 not null`, `rate_id int references job_category_rates` (legacy), `pay_type text default 'hourly'`, `piece_rate_id int references piece_work_rates`, `hourly_rate_id int references job_hourly_rates`.
  - Purpose: Associates jobs with products, tracking time, unit, quantity, and the rate version used at the time of entry/edit.

- Related tables (used by job cards/payroll features): `job_cards`, `job_card_items` (outside the Labor page scope but labor-related).

- (Implemented) **`piece_work_rates`**
  - Columns: `rate_id serial PK`, `job_id int references jobs`, `product_id int references products null`, `rate numeric not null`, `effective_date date not null`, `end_date date null`, timestamps.
  - Uniqueness: `(job_id, product_id, effective_date)`; supports job‑level default when `product_id` is null.
  - Semantics: Versioned per‑piece rate ranges effective by date.

- (Implemented) additions to **`billoflabour`**
  - `pay_type text default 'hourly' check (pay_type in ('hourly','piece'))`
  - `piece_rate_id int references piece_work_rates(rate_id)`
  - `hourly_rate_id int references job_hourly_rates(rate_id)`
  - Check (NOT VALID for legacy rows): hourly requires either `hourly_rate_id` or legacy `rate_id`; piece requires `piece_rate_id`.

- (New) **`job_hourly_rates`**
  - Columns: `rate_id serial PK`, `job_id int references jobs`, `hourly_rate numeric`, `effective_date date`, `end_date date`, `created_at timestamptz` with unique `(job_id, effective_date)`.

- (New) **`labor_plan_assignments`**
  - Columns: `assignment_id bigserial PK`, `job_instance_id text unique with assignment_date`, `order_id`, `order_detail_id`, `bol_id`, `job_id`, `staff_id`, `assignment_date date`, `start_minutes int`, `end_minutes int`, `status text check (scheduled/unscheduled)`, `pay_type text check (hourly/piece)`, `rate_id`, `hourly_rate_id`, `piece_rate_id`, timestamps.
  - Purpose: Persist the linkage between an order-specific BOL job instance and a staff assignee/time window for costing and re-scheduling. Start/end minutes are null when unscheduled; uniqueness on `(job_instance_id, assignment_date)` prevents duplicate placements per day.

## APIs

- `GET /api/products/:id/effective-bol` — effective BOL (explicit + linked). Scales sub‑product rows by `product_bom_links.scale` and resolves rates as of today (piece → product‑specific then default; hourly → job hourly).

## RLS and Policies

- RLS status (from pg_policies):
  - `job_categories`, `job_category_rates`, `jobs`, `billoflabour`: RLS disabled.
  - `job_cards`, `job_card_items`: RLS enabled with authenticated-user policies.
- Implication: The Labor Management UI writes directly to core labor tables without RLS constraints; access control is handled at the app level and Supabase anon/service keys.
## Frontend Behavior

### Job Categories Manager

- File: components/features/labor/job-categories-manager.tsx:1
- **UI Improvements (2025-10-04)**:
  - **Stats Dashboard**: Four-card summary showing total categories, average rate, highest rate, and lowest rate
  - **Enhanced Toolbar**: 
    - Prominent "Add Category" button (opens modal dialog)
    - Search bar with icon for filtering categories by name/description
    - Sort toggle buttons (Name/Rate)
  - **Single-Column Layout**: Scalable list view that works with hundreds/thousands of categories
  - **Collapsible Rate History**: Each category row expands to show rate history inline
  - **Modal Dialogs**: Add/Edit category forms in dialogs instead of inline forms
  - **Inline Rate Management**: Add rate versions directly within expanded category sections
- Features:
  - List, search, filter, sort, create, edit, delete categories.
  - Collapsible rate history per category with expand/collapse chevron icons.
  - Add Rate Version flow automatically maintains date ranges and updates `job_categories.current_hourly_rate` when the new version covers "today".
  - Visual indicators for active rates with "Active" badge.
  - Responsive design optimized for both desktop and mobile.
- Supabase interactions:
  - Read categories: `from('job_categories').select('*')`.
  - Read all rates: `from('job_category_rates').select('*').order('effective_date desc')` (filtered client-side per category).
  - Create category: insert into `job_categories`, then insert initial rate row into `job_category_rates` with today's date.
  - Update category: update fields including `current_hourly_rate`.
  - Delete category: delete all `job_category_rates` for the category, then delete the category.
  - Add rate version:
    - Determines the next `end_date` by looking for the first later `effective_date`.
    - Sets the previous version's `end_date` to the day before the new `effective_date`.
    - If new version is effective "today", updates `job_categories.current_hourly_rate`.

### Jobs Manager

- File: components/features/labor/jobs-manager.tsx:1
- **UI Improvements (2025-10-04)**:
  - **Stats Dashboard**: Three-card summary showing total jobs, average rate, and categories used
  - **Enhanced Toolbar**: 
    - Prominent "Add Job" button (opens modal dialog)
    - Search bar with icon for filtering jobs by name/description/category
    - Category filter dropdown
  - **Single-Column Layout**: Scalable list view that works with hundreds/thousands of jobs
  - **Collapsible Descriptions**: Each job row expands to show full description inline
  - **Modal Dialogs**: Add/Edit job forms in dialogs instead of inline forms at bottom
  - **No Pagination**: All jobs loaded client-side with efficient filtering
- Features:
  - List, search, filter by category, create, edit, delete jobs with category assignment.
  - Collapsible job descriptions with expand/collapse chevron icons.
  - Visual category badges and rate display per job.
  - Responsive design optimized for both desktop and mobile.
- Supabase interactions:
  - Read categories: `from('job_categories').select('*').order('name')`.
  - Read all jobs: `from('jobs').select('job_id, name, description, category_id, job_categories(...)').order('name')` (filtered client-side).
  - Insert/update/delete into `jobs`.

### Product Bill of Labor (BOL)

- File: components/features/products/product-bol.tsx:1
- Features:
  - Display BOL items with Category, Job, Time, Qty, Hourly Rate, Total Time (hrs), Total Cost; edit inline or remove.
  - Add new item with category and job pickers; supports quick job creation via modal `CreateJobModal`.
  - Client-side cost computation: hourly rate × time (converted to hours) × quantity, preferring `job_category_rates.hourly_rate` when `rate_id` is set, otherwise falling back to `job_categories.current_hourly_rate`.
- Supabase interactions:
  - Read product BOL: `from('billoflabour').select(... jobs(... job_categories(...)), job_category_rates(...))`.
  - Read job categories: `from('job_categories').select('*')`.
  - Read jobs (optionally filtered by selected category or search): `from('jobs').select(... job_categories(...))`.
  - Add/Update BOL item:
    - Looks up the current effective rate for the selected category as of today by querying `job_category_rates` with `effective_date <= today` and `(end_date is null or end_date >= today)` (ordered desc, limit 1).
    - Writes `rate_id` to `billoflabour` along with `job_id`, `time_required`, `time_unit`, `quantity`.
  - Delete BOL item: `from('billoflabour').delete().eq('bol_id', ...)`.
  - Helper conversions: minutes/seconds → hours for totals and costing.

(Implemented)
  - Pay Type selector per line: `hourly` or `piece`.
  - When `piece`, time inputs are disabled and the effective `piece_work_rates` row is used for `(job_id, product_id)` as of today; if none, fallback to the job default (no product).
  - The line stores `piece_rate_id` for auditability. The pairing check on `billoflabour` prevents invalid combinations.

### Create Job Modal

- File: components/features/labor/create-job-modal.tsx:1
- Purpose: Create a job inline during BOL entry; optionally pre-selects a category.
- Behavior: Inserts into `jobs`, invalidates queries, and returns the created record to prefill the BOL form.

### Piecework Rates Manager

- File: components/features/labor/piecework-rates-manager.tsx:1
- Features:
  - Manage per-piece rates by job, with optional product-specific overrides.
  - View versioned rate history for the selected job and scope (default vs product).
  - Add new rate versions; UI computes end_date gaps similar to category hourly rates.
- Job selection at scale:
  - Optional Category filter; when selected, jobs list can be browsed immediately.
  - Async searchable combobox for jobs with server-side pagination (25 per page) and debounce.
  - If no category is selected, the user must type at least 3 characters to search.
  - “Load more” appends the next page; “Create new job” opens the CreateJobModal and preselects the category.
  - A “Reset filters” button (beneath the filters, left-aligned) clears Category, Job, Applies To, and Product selections.

## Calculations

- Time conversion:
  - `hours` → 1×, `minutes` → `time/60`, `seconds` → `time/3600`.
- Line total: `hourly_rate × time_in_hours × quantity`.
- Totals across BOL: Sum of line totals; total hours sums `time_in_hours × quantity`.

(Planned)
- Piecework line total: `piece_rate × quantity`.
- Mixed totals: Sum hourly and piece lines together; display rate source (category hourly vs piecework) per line.

## Scheduling Utilities

- File: `src/lib/laborScheduling.ts`
  - `calculateDurationMinutes` converts job effort (time + unit + quantity or piecework) into planner bar durations, then `chooseSnapIncrement` and `buildUnscheduledBarState` provide defaults for unplaced jobs.
  - `checkLaneConstraints` enforces per-lane overlap protection, shift window limits, capacity overruns, and availability flags before placing a job.
  - Rendering helpers: `getCategoryColor` (hashed palette) and `buildAssignmentLabel` keep swimlane bar styling consistent; `clockToMinutes` / `minutesToClock` support time math for drop targets.

## Current Safeguards and Constraints

- DB-level:
  - FK constraints between `jobs` ↔ `job_categories`, `billoflabour` ↔ (`jobs`, `products`, `job_category_rates`).
  - Unique index `(category_id, effective_date)` prevents duplicate rate versions on the same start date.
  - No triggers on these tables; the UI maintains `end_date` consistency and `current_hourly_rate` updates.
  - RLS disabled on core labor tables (note: consider enabling and adding policies before multi-tenant or shared deployments).

  (Planned)
  - Add FK `billoflabour.piece_rate_id` → `piece_work_rates.rate_id` with a CHECK enforcing valid `pay_type` pairings.
  - Index `piece_work_rates(job_id, product_id, effective_date)` for fast as‑of lookup.

## Gaps and Opportunities

- Authorization:
  - Enable RLS and add role-based policies for `job_categories`, `job_category_rates`, `jobs`, and `billoflabour` to match the `job_cards` model.

- Data integrity:
  - Consider a CHECK constraint for `time_unit in ('hours','minutes','seconds')`.
  - Optional trigger to auto-update `job_categories.current_hourly_rate` whenever a new rate becomes current, removing the need for client logic.
  - Optional exclusion constraint to prevent overlapping `[effective_date, end_date]` ranges per `category_id`.

- UX/Workflow:
  - Prevent deletion of categories that are referenced by `jobs` or `job_category_rates` (currently handled in UI with a toast, but a FK or ON DELETE RESTRICT/NO ACTION is recommended).
  - Show historical rate used for a BOL line and its effective range; allow “reprice as of date” actions.
  - Add CSV import for jobs or categories.

## Piecework — Decisions and Plan (Authoritative)

- Rate key: Prefer `job_id + product_id` with fallback to job default (no product). This allows setting a single rate for a job across many related products, while supporting overrides.
- New UI tab: `Piecework Rates` at `/labor` alongside `Job Categories` and `Jobs`.
  - Features: list/search/filter, create/edit effective versions, choose “All products” (job default) or a specific product, view history.
- BOL changes: Pay Type selector, conditional fields, automatic as‑of lookup and storage of `piece_rate_id`.
- Costing: Include piece lines in product costing (qty × piece rate) alongside hourly lines.
- Future: Add an “as of date” selector to recalculate with historical rates; support bulk apply to product groups (e.g., Cupboards category).

## Quick References (Files)

- Labor page: app/labor/page.tsx:1
- Job Categories Manager: components/features/labor/job-categories-manager.tsx:1
- Jobs Manager: components/features/labor/jobs-manager.tsx:1
- Product BOL: components/features/products/product-bol.tsx:1
- Product page usage: app/products/[productId]/page.tsx:358
- Supabase client: lib/supabase.ts:1

## Appendix: Key Queries

- Fetch current effective rate (used in add/update BOL):
  - From code: components/features/products/product-bol.tsx:263 and :323
  - Logic: `select * from job_category_rates where category_id = $1 and effective_date <= today and (end_date is null or end_date >= today) order by effective_date desc limit 1`

- Join used to load a product’s BOL items:
  - components/features/products/product-bol.tsx:133

- Jobs listing with category join and pagination:
  - components/features/labor/jobs-manager.tsx:174

---

Last reviewed via Supabase MCP and code search. Keep this document updated as the schema or UI evolves.

# Streamlined Create Job Dialog

**Date**: 2026-03-24
**Status**: Reviewed
**Area**: Labor Management — Job Creation

## Problem

Creating a new job in Labor Management requires 6+ clicks across 3 screens:

1. Click "Add Job" → dialog with only Category, Name, Description
2. Click "Create Job" → navigate to job detail page
3. Click edit icon → enter edit mode
4. Set Role, Estimated Time, Time Unit → Save
5. Click "+ Add Rate" on Piecework Rates → another dialog
6. Set rate + effective date → Save

During initial software rollout, users may need to create hundreds of jobs. This flow is far too click-heavy for bulk entry.

## Solution

Expand the existing Create Job modal to include all commonly-needed fields, and add a "Create & Add Another" button for rapid-fire entry without leaving the list page.

**Target flow**: Click "Add Job" → fill all fields → click "Create & Add Another" → form resets with category preserved → repeat. One dialog, one click per job.

## Design

### Dialog Layout

- **Width**: `max-w-2xl` (wider than current `max-w-md`)
- **Responsive two-column grid**: `grid-cols-1 md:grid-cols-2` — collapses to single column on narrow screens
- Compact spacing per low-res screen guidelines (`space-y-3`, `gap-3`)

**Left column:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Category | Cascading select | Yes | Parent category dropdown |
| Subcategory | Cascading select | No | Appears when parent has children |
| Name | Text input | Yes | Auto-focused on open |

**Right column:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Estimated Time | Number input | No | Placeholder "0" pattern (empty field, not "0") |
| Time Unit | Dropdown | No | Hours / Minutes / Seconds. Default: Minutes |
| Default Piecework Rate | Number input | No | Prefix "R", suffix "/piece". Decimal (2 places) |

**Full-width row (below the grid):**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Description | Textarea (rows=3) | No | Spans both columns for comfortable editing |

### Footer Buttons

- **Cancel** (ghost) — closes dialog
- **Create Job** (primary) — creates job, closes dialog, calls `onJobCreated` + `onClose`
- **Create & Add Another** (outline) — creates job, resets form, keeps category/subcategory/time unit, clears other fields, focuses Name input. Does NOT call `onClose`. Shows toast only.

### Multi-Parent Callback Contract

This modal is mounted from three parents:
1. `jobs-rates-table.tsx` — main labor list (bulk creation)
2. `piecework-rates-manager.tsx` — rate management
3. `AddJobDialog.tsx` — product BOL flow

**"Create & Add Another" is only shown in the labor list context** (parent 1). The other two parents use the modal for single-job creation and close on success as before. This is controlled via a new `showAddAnother?: boolean` prop (default `false`).

### Data Flow on Submit

**Single mutation function** that handles both inserts. If a piecework rate is provided, both inserts happen together. If the rate insert fails after the job succeeds, the user sees a partial-success toast ("Job created, but piecework rate failed — you can add it later") rather than a generic error.

**Step 1 — Insert job:**
```sql
INSERT INTO jobs (name, description, category_id, estimated_minutes, time_unit)
VALUES ($name, $description, $category_id, $estimated_minutes, $time_unit)
RETURNING job_id
```

- `role_id` is NOT set at creation (defaults to null, can be assigned later on detail page)
- `estimated_minutes` and `time_unit` are null if not provided
- Empty string inputs → null (explicit mapping in mutation)

**Step 2 — Insert piecework rate (conditional):**
Only if the user entered a piecework rate value > 0:

```sql
INSERT INTO piece_work_rates (job_id, product_id, rate, effective_date, end_date)
VALUES ($job_id, NULL, $rate, CURRENT_DATE, NULL)
```

- `product_id = NULL` means this is the job default rate
- `effective_date = today`
- `end_date = NULL` means it's the current active rate
- This is the first rate for a brand-new job, so no date-versioning conflicts
- **Duplicate protection**: The `UNIQUE (job_id, product_id, effective_date)` constraint does NOT protect `NULL` product_id in Postgres. Since we're inserting into a newly-created job, there cannot be an existing default rate. However, if rapid double-click triggers two mutations, we guard with `isPending` check on the button (already standard pattern).

### Form Reset Behavior ("Create & Add Another")

After successful creation:
1. Show brief success toast: "Job created"
2. Clear: Name, Description, Estimated Time, Piecework Rate
3. Preserve: Category, Subcategory, Time Unit
4. Reset form state (errors, dirty flags) via `form.reset()` with preserved values
5. Focus: Name input via ref
6. Invalidate `['jobs']`, `['piece-rates']`, and `['all-piece-rates-current']` query keys so the table behind the modal updates

### Validation

- **Name**: Required, trimmed, non-empty — `z.string().trim().min(1, 'Name is required')`
- **Category**: Required
- **Estimated Time**: Optional. Empty string → null. If present, must be > 0
- **Piecework Rate**: Optional. Empty string → null. If present, must be > 0
- **Time Unit**: Defaults to "Minutes". Always stored alongside estimated_minutes (both null or both set)

### Numeric Input UX

Per established project pattern:
- `value={x || ''}` with `placeholder="0"` (not `value={x || 0}`)
- Auto-select on focus (handled by `components/ui/input.tsx` for `type="number"`)
- **No onBlur-to-zero** for these fields — they stay empty/null when not provided, unlike allocation fields where 0 is a valid default

### Tenancy Note

Labor tables (`jobs`, `piece_work_rates`) do not currently have `org_id` columns or org-scoped RLS. This is pre-existing and out of scope for this change. When labor tables get org-scoped (tracked separately), the mutation will need updating.

## What Doesn't Change

- **Job detail page**: Stays as-is. Still used for editing jobs, adding hourly rates, product-specific piecework rates, role assignment, time analysis review.
- **Database schema**: No migrations needed. All fields (`estimated_minutes`, `time_unit`) already exist on `jobs`. `piece_work_rates` table already exists.
- **Existing create-job-modal.tsx**: Gets expanded in-place (not a new component).
- **Jobs & Rates table**: No changes. Continues to show jobs grouped by category with rates inline.

## Files to Modify

| File | Change |
|------|--------|
| `components/features/labor/create-job-modal.tsx` | Expand form fields, two-column responsive layout, "Create & Add Another" mode, piecework rate insert, partial-success handling |
| `components/features/labor/jobs-rates-table.tsx` | Pass `showAddAnother={true}` to CreateJobModal |
| `components/features/labor/piecework-rates-manager.tsx` | No change needed — already passes `showAddAnother` as undefined (false) |
| `components/features/products/AddJobDialog.tsx` | No change needed — already passes `showAddAnother` as undefined (false) |

## Edge Cases

- **Category with no subcategories**: Subcategory dropdown hidden (existing behavior)
- **Piecework rate without estimated time**: Allowed — some jobs are piece-rate only with no time estimate
- **Estimated time without piecework rate**: Allowed — hourly jobs don't need piece rates
- **Rapid creation**: Query invalidation on each create ensures the list stays current. `isPending` guard prevents double-submit.
- **Duplicate job names**: Allowed by the schema (jobs are identified by `job_id`). Same as current behavior.
- **Category switch during bulk create**: Changing parent category resets subcategory (existing behavior in cascading select)
- **Partial failure**: Job created but piecework rate insert fails → distinct toast message, job still usable, rate can be added later from detail page

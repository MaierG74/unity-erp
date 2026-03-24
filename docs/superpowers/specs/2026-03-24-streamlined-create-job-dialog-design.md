# Streamlined Create Job Dialog

**Date**: 2026-03-24
**Status**: Draft
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
- **Two-column grid** layout for the fields
- Compact spacing per low-res screen guidelines (`space-y-3`, `gap-3`)

**Left column:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Category | Cascading select | Yes | Parent category dropdown |
| Subcategory | Cascading select | No | Appears when parent has children |
| Name | Text input | Yes | Auto-focused on open |
| Description | Textarea (rows=2) | No | Compact height |

**Right column:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Estimated Time | Number input | No | Placeholder "0" pattern (empty field, not "0") |
| Time Unit | Dropdown | No | Hours / Minutes / Seconds. Default: Minutes |
| Default Piecework Rate | Number input | No | Prefix "R", suffix "/piece". Decimal (2 places) |

### Footer Buttons

- **Cancel** (ghost) — closes dialog
- **Create Job** (primary) — creates job, closes dialog
- **Create & Add Another** (outline) — creates job, resets form, keeps category/subcategory selected, clears other fields, focuses Name input

### Data Flow on Submit

**Step 1 — Insert job:**
```sql
INSERT INTO jobs (name, description, category_id, estimated_minutes, time_unit)
VALUES ($name, $description, $category_id, $estimated_minutes, $time_unit)
RETURNING job_id
```

- `role_id` is NOT set at creation (defaults to null, can be assigned later on detail page)
- `estimated_minutes` and `time_unit` are null if not provided

**Step 2 — Insert piecework rate (conditional):**
Only if the user entered a piecework rate value > 0:

```sql
INSERT INTO piece_work_rates (job_id, product_id, rate, effective_date, end_date)
VALUES ($job_id, NULL, $rate, CURRENT_DATE, NULL)
```

- `product_id = NULL` means this is the job default rate
- `effective_date = today`
- `end_date = NULL` means it's the current active rate
- No date-versioning logic needed since this is the first rate for a new job

**Both inserts happen in sequence** within the same mutation function. If the piecework rate insert fails, the job still exists (acceptable — user can add rate later).

### Form Reset Behavior ("Create & Add Another")

After successful creation:
1. Show brief success toast: "Job created"
2. Clear: Name, Description, Estimated Time, Piecework Rate
3. Preserve: Category, Subcategory, Time Unit
4. Focus: Name input
5. Invalidate `['jobs']` and `['piece-rates']` query keys so the table behind the modal updates

### Validation

- **Name**: Required, non-empty after trim
- **Category**: Required
- **Estimated Time**: Optional. If provided, must be > 0
- **Piecework Rate**: Optional. If provided, must be > 0
- **Time Unit**: Defaults to "Minutes" if Estimated Time is provided

### Numeric Input UX

Per established project pattern:
- `value={x || ''}` with `placeholder="0"` (not `value={x || 0}`)
- Auto-select on focus (handled by `components/ui/input.tsx` for `type="number"`)
- `onBlur` resets empty fields back to 0

## What Doesn't Change

- **Job detail page**: Stays as-is. Still used for editing jobs, adding hourly rates, product-specific piecework rates, role assignment, time analysis review.
- **Database schema**: No migrations needed. All fields (`estimated_minutes`, `time_unit`) already exist on `jobs`. `piece_work_rates` table already exists.
- **Existing create-job-modal.tsx**: Gets expanded in-place (not a new component).
- **Jobs & Rates table**: No changes. Continues to show jobs grouped by category with rates inline.

## Files to Modify

| File | Change |
|------|--------|
| `components/features/labor/create-job-modal.tsx` | Expand form fields, add two-column layout, add "Create & Add Another", add piecework rate insert |
| No other files | The modal is already imported and used by the parent page |

## Edge Cases

- **Category with no subcategories**: Subcategory dropdown hidden (existing behavior)
- **Piecework rate without estimated time**: Allowed — some jobs are piece-rate only with no time estimate
- **Estimated time without piecework rate**: Allowed — hourly jobs don't need piece rates
- **Rapid creation**: Query invalidation on each create ensures the list stays current. No debouncing needed since Supabase handles concurrent inserts fine.
- **Duplicate job names**: Allowed by the schema (jobs are identified by `job_id`). Same as current behavior.

# Job Actions Design — Factory Floor Detail Panel

**Date:** 2026-03-01
**Status:** Approved
**Scope:** Complete Job, Pause Job, Transfer Job actions for the factory floor detail panel

---

## Context

The factory floor detail panel (`/factory-floor`) currently shows job info, time tracking, shift status, and a progress override slider. We're replacing the override slider with three job actions: Complete, Pause, and Transfer. Each action bridges both `labor_plan_assignments` and `job_cards` systems.

Team job cards (multi-staff per card) are deferred to a follow-up — this design works against the current one-staff-per-card model.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build order | Job Actions first, teams later | Lower risk, incremental delivery |
| Completion times | Auto-capture with optional edit | Pre-fill started_at/now(), allow supervisor adjustment |
| Pause tracking | Event log table | Full history, per-pause reasons, accurate duration calc |
| Pause reasons | Predefined dropdown + optional notes | Reportable categories + free-text context |
| Transfer model | Split by work status | Pre-start: reassign. Mid-work: complete original at actual qty, new card for remainder |
| DB approach | Individual RPCs | Atomic transactions, matches existing `complete_job_card` pattern |
| Completion UI | Show items with quantities | Supervisor confirms/edits completed_quantity per item |

---

## Schema Changes

### New Table: `assignment_pause_events`

```sql
CREATE TABLE assignment_pause_events (
  assignment_pause_event_id  SERIAL PRIMARY KEY,
  assignment_id              INTEGER NOT NULL REFERENCES labor_plan_assignments(assignment_id) ON DELETE CASCADE,
  org_id                     UUID NOT NULL,
  reason                     TEXT NOT NULL,  -- 'waiting_materials', 'machine_breakdown', 'break', 'quality_issue', 'other'
  notes                      TEXT,
  paused_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed_at                 TIMESTAMPTZ,    -- NULL while paused
  paused_by                  UUID NOT NULL DEFAULT auth.uid(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**RLS:** org_id scoped, authenticated users with org membership.

**Reason enum values:** `waiting_materials`, `machine_breakdown`, `break`, `quality_issue`, `other`

### View Modification: `factory_floor_status`

- Add computed column `total_paused_minutes`: sum of completed pause event durations for the assignment
- Adjust elapsed time: `elapsed = (now - started_at) - total_paused_minutes`
- Add `is_paused` boolean: whether there's an open (unresumed) pause event

### No changes to `labor_plan_assignments`

- `job_status = 'on_hold'` already exists for paused state
- `progress_override` column stays (slider UI removed, column kept)

---

## New RPCs

### 1. `pause_assignment(p_assignment_id INTEGER, p_reason TEXT, p_notes TEXT DEFAULT NULL)`

1. Verify assignment exists and caller has org access
2. Verify assignment is `in_progress` (can't pause if not started)
3. Verify no open pause event exists (can't double-pause)
4. Insert into `assignment_pause_events`
5. Update `labor_plan_assignments.job_status = 'on_hold'`

### 2. `resume_assignment(p_assignment_id INTEGER)`

1. Verify assignment exists and caller has org access
2. Verify assignment is `on_hold`
3. Set `resumed_at = now()` on the latest open pause event
4. Update `labor_plan_assignments.job_status = 'in_progress'`

### 3. `complete_assignment_with_card(p_assignment_id INTEGER, p_items JSONB, p_actual_start TIMESTAMPTZ DEFAULT NULL, p_actual_end TIMESTAMPTZ DEFAULT NULL, p_notes TEXT DEFAULT NULL)`

`p_items` format: `[{"item_id": 1, "completed_quantity": 10}, ...]`

1. Verify assignment exists and caller has org access
2. Close any open pause events (set resumed_at = now())
3. Find linked job card (via assignment's staff_id + order_id + job matching)
4. Update each job_card_item's completed_quantity and status
5. Mark job_card as completed (status, completion_date)
6. Update labor_plan_assignment:
   - job_status = 'completed'
   - completed_at = now()
   - actual_start_minutes = derived from p_actual_start or started_at
   - actual_end_minutes = derived from p_actual_end or now()
   - actual_duration_minutes = calculated
   - completion_notes = p_notes

### 4. `transfer_assignment(p_assignment_id INTEGER, p_new_staff_id INTEGER, p_notes TEXT DEFAULT NULL)`

**Case A: Pre-start (job_status in 'scheduled', 'issued')**
1. Update labor_plan_assignments.staff_id to new staff
2. Update job_card.staff_id to new staff
3. Return the job_card_id for potential reprint

**Case B: Mid-work (job_status = 'in_progress')**
1. Close any open pause events
2. Complete original assignment at actual completed quantities
3. Mark original job card items with their current completed_quantity, mark card completed
4. Create new job card for new staff with remaining quantities
5. Create new labor_plan_assignment for new staff (copies job details, remaining time estimate)
6. Return both old and new job_card_ids

---

## UI Components

### Detail Panel Changes (`floor-detail-panel.tsx`)

**Remove:** Progress override slider section.

**Add:** Three action buttons at bottom of panel:
- **Complete** (green) — opens Complete Job Dialog
- **Pause/Resume** (amber) — opens Pause Dialog or calls resume directly
- **Transfer** (blue) — opens Transfer Dialog

**Modify:**
- Elapsed time display: show `(paused: Xm)` when there are pause events
- Status badge: show "Paused" with reason when job_status = 'on_hold'

### New: Complete Job Dialog (`components/factory-floor/complete-job-dialog.tsx`)

- Auto-filled actual start time (from started_at or issued_at) — editable
- Auto-filled actual end time (now()) — editable
- Calculated actual duration and variance from estimate
- List of job_card_items with:
  - Job name, product name
  - Target quantity
  - Editable completed_quantity (pre-filled with current value or target)
  - Piece rate (if piecework)
  - Calculated earnings per item
- Optional completion notes textarea
- Total earnings summary (for piecework)
- "Complete Job" button → calls `complete_assignment_with_card` RPC

### New: Pause Job Dialog (`components/factory-floor/pause-job-dialog.tsx`)

- Reason dropdown: Waiting for materials, Machine breakdown, Break, Quality issue, Other
- Optional notes textarea
- "Pause Job" button → calls `pause_assignment` RPC
- When job is already paused, panel shows "Resume" button that calls `resume_assignment` directly (no dialog needed)

### New: Transfer Job Dialog (`components/factory-floor/transfer-job-dialog.tsx`)

- Searchable staff picker (active staff in org, excludes current assignee)
- If job in_progress with completed_quantity > 0:
  - Shows split summary:
    - "Original: [Staff] keeps [X] completed at [rate] = R[earnings]"
    - "New: [New Staff] gets remaining [Y] quantity"
- If job not yet started:
  - Simple reassignment message
- Optional transfer notes
- "Transfer Job" button → calls `transfer_assignment` RPC
- Success state: shows "Job Card #[id] ready for reprint" with option to navigate

### New: `useJobActions` Hook

```typescript
// Returns mutations for all three actions + resume
function useJobActions() {
  return {
    completeJob: useMutation(...)    // calls complete_assignment_with_card RPC
    pauseJob: useMutation(...)       // calls pause_assignment RPC
    resumeJob: useMutation(...)      // calls resume_assignment RPC
    transferJob: useMutation(...)    // calls transfer_assignment RPC
  }
}
```

All mutations invalidate: `jobs-in-factory`, `laborAssignments`, `laborPlanningPayload`

### Data Requirements

The detail panel needs additional data not currently in `factory_floor_status`:
- `job_card_id` — to link assignment to job card
- `job_card_items` — for completion dialog
- `is_paused` + `pause_reason` — for showing paused state
- `total_paused_minutes` — for accurate elapsed time

Options: extend the view or fetch on-demand when dialog opens. Recommend fetching job card items on-demand (only needed when Complete dialog opens) and adding `is_paused`/`total_paused_minutes` to the view (needed for real-time display).

---

## Progress Calculation Update

Current: `elapsed = now() - started_at`
New: `elapsed = (now() - started_at) - total_paused_minutes`

The `factory_floor_status` view will compute `total_paused_minutes` by summing completed pause durations + any currently-open pause duration.

Auto-progress: `(adjusted_elapsed / estimated_minutes) × 100`

When paused, progress freezes (since elapsed stops accruing during pauses).

---

## Out of Scope

- Team job cards (multi-staff per card) — deferred to follow-up
- Weighted piecework split — Phase 3 per existing plan
- Job card printing/reprinting UI — just surface the card ID for now
- Removing `progress_override` column from DB — keep for potential future use

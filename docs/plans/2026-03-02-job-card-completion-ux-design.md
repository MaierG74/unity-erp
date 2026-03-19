# Job Card Completion UX — Confirmation Dialog & Reopen

**Date:** 2026-03-02
**Status:** Approved

## Problem

1. "Mark Complete" on the job card detail page fires immediately with no confirmation and no quantity entry. Items stay at `completed_quantity = 0`, resulting in "Completed 0 / 50".
2. No way to reverse a mistaken completion — once marked complete, there's no undo.

## Design

### 1. Completion Confirmation Dialog

When "Mark Complete" is clicked on the detail page, show a dialog:

- **Header**: "Complete Job Card #N"
- **Item list**: Each `job_card_item` with product name, job name, quantity, and an editable `completed_quantity` input. Pre-filled to full qty if untouched (`completed_quantity = 0`), or current value if partially done.
- **Earnings summary**: Shows total piece-rate earnings based on entered quantities.
- **Confirm button**: "Complete Job Card" — updates all item quantities, then sets card status to `completed`.

No time tracking (start/end) — that's the factory floor's concern. This dialog is purely about quantities.

### 2. Reopen Button

On a completed job card, show a "Reopen" button:

- **Placement**: Next to the Completed status badge in the header area.
- **Confirmation**: `AlertDialog` — "Reopen this job card? It will return to In Progress status."
- **Behavior**:
  - `job_cards.status` → `in_progress`, clear `completion_date`
  - `job_card_items.status` → `in_progress` (keep `completed_quantity` values intact)
  - `labor_plan_assignments.job_status` → `in_progress`, clear `completed_at`
- **Access**: Anyone who can view the job card.

### Surfaces

Only the job card detail page (`app/staff/job-cards/[id]/page.tsx`) is affected. The factory floor already has `CompleteJobDialog` with quantities. The mobile scan page uses the `complete_job_card` RPC which auto-fills quantities.

## Not In Scope

- Time tracking in the detail page completion dialog (factory floor only)
- Role-based access control for reopen (keep simple for now)
- Audit trail for reopen events (future enhancement)

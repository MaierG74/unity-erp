# Labor Planning — Scheduling Guardrails & Signals

Use this guide when scheduling jobs on the `/labor-planning` board. It outlines what happens on drops, how conflicts are surfaced, and where to look for quick troubleshooting signals.

## What Happens on Drop
- The board snaps jobs to sensible increments based on estimated duration (minimum 15m scheduled block, placed on a 15-minute grid).
- Before saving, it checks lane conflicts:
  - **Overlap**: blocked with a toast naming the conflicting assignment and its time window.
  - **Off-shift/out of window**: blocked with a toast reminding you of the allowed window (07:00–19:00).
  - **Unavailable staff**: blocked if the staff member is inactive, off-shift, or not current for the date.
- Successful drops fire optimistic updates and show a success toast with an Undo action; resize/move events reuse the same checks.

## Empty or Unavailable Staff
- If the roster returns no active staff for the selected date, an alert appears above the board (“No staff available to schedule”).
- Lanes for off-shift staff show an “Off shift / unavailable” badge and an amber status dot; drops onto those lanes are rejected with an explanatory toast.
- The staff panel also shows a placeholder card when no lanes are available to accept drops.

## Logging & Troubleshooting
- Client-side telemetry records each scheduling action to help with QA and support:
  - `drop_attempt` and `drop_blocked` with reason (`overlap`, `window`, `availability`) plus job/staff/time data.
  - `assigned`, `updated`, `unassigned` on successful mutations.
  - `mutation_failed` on Supabase errors, and `missing_staff` when the roster is empty/unavailable.
- Events are stored locally at `window.__laborSchedulingEvents` in the browser. Use the console in dev to inspect recent events (`console.info` entries are emitted in non-production builds).
- To hook into these events (e.g., forward to an external logger), register a listener via `onSchedulingEvent` in `src/lib/analytics/scheduling.ts`.

## Quick Tips for Schedulers
- Queue labels reflect lifecycle and schedule separately:
  - `Pool • X remaining` means demand exists but nothing has been issued yet.
  - `Issued • qty X` means a job card already exists but is not on a lane.
  - `Scheduled • qty X` means the issued card is currently placed on a lane.
  - Unscheduling an issued card should return it to the queue as `Issued`, not `Ready`.
- The production queue now prefers the active scheduler assignment when showing staff ownership for a scheduled job card, and it shows the scheduled date/time under the status badge when available.
- Completing a job from the scheduler now completes the linked job card as well, so it should move into the production queue's `Completed` filter without requiring a manual card-page action.
- Scheduler changes now invalidate the production queue and production summary as well, so staff/time changes should appear without a manual browser refresh.
- Putting an issued card onto a lane for the first time, or moving it to a different lane before work starts, now updates the linked `job_cards.staff_id` as well, so piecework payroll follows the scheduler owner. Once work has started, the move is blocked and the card must go through the transfer flow instead.
- Scheduler completion now writes through the remainder-aware completion RPC, which stamps the job card completion actor/date and applies payroll-lock checks before changing completed piecework.
- If you see an overlap toast, try dragging the bar into one of the dashed “Open slot” placeholders or shorten the duration via the resize handles.
- Off-shift staff will not accept drops—pick a staff lane with a green “Accepting drops” indicator or adjust staffing for the date first.
- Use Undo in the success toast immediately after a drop if you placed a job on the wrong lane/time.

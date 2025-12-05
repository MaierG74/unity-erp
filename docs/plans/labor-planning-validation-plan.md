# Labor Planning Validation & Telemetry Plan

Short plan for tightening the `/labor-planning` surface with clearer client-side safeguards and lightweight logging so scheduling issues are easy to spot and debug.

## Objectives
- Block or warn on bad drops before they hit Supabase: overlapping bars, outside shift window, off-shift staff.
- Provide actionable feedback so schedulers understand why a drop failed and how to fix it.
- Capture minimal client-side telemetry for schedule moves to aid QA and incident review without adding server dependencies.

## Scope
- Labor Planning board only (`app/labor-planning`).
- Conflicts covered: overlaps, off-shift/outside window, inactive/unavailable staff.
- Data gaps covered: no staff returned/available for selected date.
- Telemetry: client hook storing events locally and emitting to listeners; no backend endpoint required.

## Implementation Notes
- Validation uses `checkLaneConstraints` with richer metadata (labels on existing assignments) so overlap errors can name the conflicting job + time window.
- Off-shift/inactive staff render as unavailable in-lane with badges; drops against them return a descriptive toast.
- Empty or fully unavailable rosters show an alert above the board; an event logs for troubleshooting.
- New hook `logSchedulingEvent` (`src/lib/analytics/scheduling.ts`) records drop attempts, blocked drops, assigns/updates/unassigns, mutation failures, and missing-staff states. Events write to a client-side buffer (`window.__laborSchedulingEvents`) and optional listeners; dev mode also logs to console.

## Acceptance Criteria
- Dropping a job onto an overlapping bar surfaces a toast naming the conflicting assignment and the time range.
- Dropping outside the shift window (07:00–19:00) surfaces a toast that states the allowed window.
- Dropping onto off-shift/inactive staff surfaces a toast and does not persist a change.
- If no staff are available for the date, the board shows a visible alert and emits a `missing_staff` telemetry event.
- Assign, move, and unassign flows emit telemetry with job/staff/time metadata; failures emit `mutation_failed` events with reason text.

## Follow-Ups (Out of Scope)
- Server-side audit logging of schedule changes (align with `operations/user-logging.md` once backend plumbing is ready).
- Date picker + multi-day support for the board.
- Capacity-aware heatmaps to replace the static open-slot placeholders.

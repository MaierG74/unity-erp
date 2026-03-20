# Labor Planning — Scheduling Guardrails & Signals

Use this guide when scheduling jobs on the `/labor-planning` board. It outlines what happens on drops, how conflicts are surfaced, and where to look for quick troubleshooting signals.

## What Happens on Drop
- The board snaps jobs to sensible increments based on estimated duration (minimum 15m scheduled block, placed on a 15-minute grid).
- Dragging a pool job onto a lane now creates a **planned** assignment only. It reserves the slot on the board, but it does not issue or print a job card yet.
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
  - `Issued`, `In Progress`, `On Hold`, and `Completed` are the shared production lifecycle labels across Queue, Schedule, and Floor.
  - Schedule placement is shown separately (for example `From schedule`, a scheduled time line, or `· scheduled`) instead of replacing the lifecycle label.
  - Unscheduling an issued card should return it to the queue as `Issued`, not `Ready`.
- Queue, Schedule, and Floor now share the same lifecycle colours and wording: `Issued` = blue, `In Progress` = amber, `On Hold` = orange, `Completed` = green.
- Scheduled bars that do not yet have a lifecycle state are treated as `Planned`, not `Issued`. They should stay off the Queue and Floor until someone explicitly issues the job from the assignment details panel.
- Clicking a scheduled bar opens an assignment details dialog that reuses those same shared lifecycle chips and labels, so the modal matches the Queue and Floor wording instead of showing a separate scheduler-only status style.
- The assignment details dialog is now the release step for planned work: use `Issue Job` there to create the card, optionally tick `Print job card after issue`, and convert the planned bar into an issued card-backed assignment.
- Job-card page actions and mobile scan completions now sync scheduler state by the exact card-backed assignment (`job_instance_id ... :card-<id>`), so completing one split-issued card no longer marks another scheduled card for the same staff/job as complete by mistake.
- The production queue now prefers the active scheduler assignment when showing staff ownership for a scheduled job card, and it shows the scheduled date/time under the status badge when available.
- The production queue status badge now prefers the scheduler lifecycle (`Issued`, `In Progress`, `On Hold`) when a card is actively scheduled. This keeps the Queue tab aligned with production execution even when the underlying `job_cards.status` still reads `pending`.
- The Unity Assistant job-card/order drill-downs follow the same effective lifecycle rule as the queue: show the scheduler/floor lifecycle first, and treat the scheduled date/time as secondary context rather than the primary status label.
- The production queue now caches the open-card list briefly, renders base job-card rows first, and fills schedule owner/time metadata immediately after. That keeps the same queue data while making Queue tab loads and search/filter changes feel noticeably quicker.
- The production queue and manufacturing assistant now pin `job_cards -> job_card_items` reads to the primary `job_card_id` relationship. This avoids blank queue/assistant results after the follow-up-card remainder link added a second FK path between the same tables.
- Completing a job from the scheduler now completes the linked job card as well, so it should move into the production queue's `Completed` filter without requiring a manual card-page action.
- Scheduler changes now invalidate the production queue and production summary as well, so staff/time changes should appear without a manual browser refresh.
- Putting an issued card onto a lane for the first time, or moving it to a different lane before work starts, now updates the linked `job_cards.staff_id` as well, so piecework payroll follows the scheduler owner. Once work has started, the move is blocked and the card must go through the transfer flow instead.
- Scheduler completion now writes through the remainder-aware completion RPC, which stamps the job card completion actor/date and applies payroll-lock checks before changing completed piecework.
- Card-backed completions are now blocked if the dialog cannot load the active job card items. This prevents an empty payload from accidentally full-completing a card without remainder decisions.
- Scheduler work-pool issuance now resolves job-card status through the original `job_card_id` link, so follow-up-card FKs no longer break pool counts or trigger stale-data warnings.
- Un-issuing a scheduled job card now targets the exact card/item encoded in the assignment key, so cancelling one split-issued sibling card does not cancel other cards for the same order/job/staff.
- The older lane-level `Issue job card` flow now rewrites the assignment key to the exact issued card/item as well, so later un-issue actions still target the same split-issued card instead of falling back to a broad order/job match.
- Planned scheduler assignments now keep the browser-local `Print job card after issue` preference on the lane details modal. When you issue the job from there, the board opens a print-ready tab immediately and the success toast still includes a `Reopen print` fallback.
- Planned pool assignments inherit their per-piece duration from the linked pool/BOL job, so issuing a smaller quantity from the lane modal shrinks the scheduled end time instead of leaving the original full-pool duration in place.
- If you see an overlap toast, try dragging the bar into one of the dashed “Open slot” placeholders or shorten the duration via the resize handles.
- Off-shift staff will not accept drops—pick a staff lane with a green “Accepting drops” indicator or adjust staffing for the date first.
- Use Undo in the success toast immediately after a drop if you placed a job on the wrong lane/time.

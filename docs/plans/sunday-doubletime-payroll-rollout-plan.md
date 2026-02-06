# Sunday + Double-Time Payroll Implementation Plan

Status: Final implementation plan (pending policy + schema sign-off)
Last updated: 2026-02-06
Owner: Unassigned

## 1) Why this plan is required

This is a live weekly payroll system. Current code paths can produce different regular/overtime/double-time totals depending on which screen or writer path is used.

Repo-confirmed issues:
- Multiple `time_daily_summary` write paths are inconsistent.
- `generateDailySummary()` insert path hardcodes `ot_minutes` to `0`.
- Manual-event and segment-edit recalc paths can write summary rows without payroll breakdown fields.
- Weekly summary fetches `dt_minutes` but still re-derives double-time from day-of-week.
- Payroll page uses `staff_hours` while most attendance logic uses `time_daily_summary`.
- Overtime threshold logic conflicts across code paths (daily 9h vs weekly 40/44h).

## 2) Decision gates (blocking)

### Gate A: Overtime policy
Choose one authoritative rule:
1. Daily threshold (recommended): first 9 hours/day regular, remainder overtime.
2. Weekly threshold: regular up to weekly cap, remainder overtime.

Default for this plan: **Daily 9-hour threshold** (matches existing timekeeping docs and server-side attendance RPC behavior).

### Gate B: Double-time policy
Confirm whether double-time applies:
1. Sundays only, or
2. Sundays + public holidays.

### Gate C: Production schema verification
Before any production rollout, verify actual DB schema and functions for:
- `time_daily_summary` minute/wage fields and constraints
- `staff_weekly_payroll.doubletime_hours`
- `staff_hours` columns relied on by payroll UI
- `add_manual_clock_event_v2` function existence and behavior

Note: these must be validated against live/staging DB state, not only repository snapshots.

## 2.1) Gate decision record (lock before Phase 0 execution)

### Gate A lock
- Status: `PENDING`
- Selected policy:
  - [ ] `A1` Daily threshold (first 9 hours/day regular, remainder overtime)
  - [ ] `A2` Weekly threshold (regular up to weekly cap, remainder overtime)
- Effective date for policy: `YYYY-MM-DD`
- Decision owner: `Name / Role`
- Rationale: `Short business rationale`
- Approved by payroll owner: `Name` on `YYYY-MM-DD`
- Approved by technical owner: `Name` on `YYYY-MM-DD`

### Gate B lock
- Status: `PENDING`
- Selected policy:
  - [ ] `B1` Sundays only are double-time
  - [ ] `B2` Sundays + public holidays are double-time
- Effective date for policy: `YYYY-MM-DD`
- Decision owner: `Name / Role`
- Rationale: `Short business rationale`
- Approved by payroll owner: `Name` on `YYYY-MM-DD`
- Approved by technical owner: `Name` on `YYYY-MM-DD`

### Gate C lock
- Status: `PENDING`
- Verification environment(s): `Staging / Production`
- Verified items:
  - [ ] `time_daily_summary` minute/wage fields + constraints confirmed
  - [ ] `staff_weekly_payroll.doubletime_hours` confirmed (or migration prepared)
  - [ ] `staff_hours` columns used by payroll UI confirmed (or legacy path retired)
  - [ ] `add_manual_clock_event_v2` confirmed (or dependency removed with replacement path)
- Gap remediation required:
  - [ ] No
  - [ ] Yes (list migrations/tasks): `...`
- Signed off by technical owner: `Name` on `YYYY-MM-DD`
- Signed off by operations owner: `Name` on `YYYY-MM-DD`

### Gate readiness summary
- Gate A: `NOT LOCKED`
- Gate B: `NOT LOCKED`
- Gate C: `NOT LOCKED`
- Phase 0 implementation start allowed: `NO` (must be `YES` only when all three gates are locked)

## 3) Canonical calculation spec (target state)

Assuming Gate A = daily 9-hour and Gate B policy is confirmed.

1. Week boundary for reporting: Friday -> Thursday.
2. Tea deduction:
- Mon-Thu: deduct 30 minutes from gross work minutes.
- Fri/Sat/Sun: no tea deduction.
3. Minute buckets:
- Sunday rows: `regular_minutes = 0`, `ot_minutes = 0`, `dt_minutes = net_work_minutes`.
- Non-Sunday rows: `regular_minutes = min(net_work_minutes, 540)`, `ot_minutes = max(net_work_minutes - 540, 0)`, `dt_minutes = 0`.
4. Reconciliation:
- `net_work_minutes = regular_minutes + ot_minutes + dt_minutes`
- `total_hours_worked = round(net_work_minutes / 60, 2)`
5. Wages:
- `wage_cents = round(((regular_minutes/60 * rate) + (ot_minutes/60 * rate * 1.5) + (dt_minutes/60 * rate * 2.0)) * 100)`

## 4) Implementation phases

### Phase 0: Safety baseline (no user-visible change)
1. Record Gate A/B decisions in this plan.
2. Verify Gate C against staging + production schema.
3. Create any missing schema objects found during Gate C (e.g., `staff_weekly_payroll.doubletime_hours` column, `add_manual_clock_event_v2` RPC). These are additive DDL changes with no behavior impact.
4. Run data quality audit on existing `time_daily_summary` rows: count NULL/zero minute-bucket fields, Sunday rows with non-zero regular/OT, reconciliation mismatches. Record results as the "known data debt" baseline.
5. Capture baseline payroll outputs for last 8-12 closed payroll weeks.
6. Add a runtime feature flag for payroll source switching (no infrastructure exists today — needs new env var or config table + helper module).

Exit:
- Decisions approved.
- Schema/function inventory confirmed; missing objects created.
- Data quality audit completed and recorded.
- Baseline report stored.

### Phase 1: Immediate correctness fixes
1. Fix `generateDailySummary()` insert bug: persist calculated `ot_minutes` (not `0`). Also add missing `total_hours_worked` to the INSERT path.
2. Ensure every summary write path persists complete fields (`regular_minutes`, `ot_minutes`, `dt_minutes`, `wage_cents`, `total_hours_worked`). The known incomplete paths are:

   | # | Write path | Location | Issue |
   |---|-----------|----------|-------|
   | 1 | `generateDailySummary()` INSERT | `attendance.ts` ~L624 | `ot_minutes` hardcoded 0; `total_hours_worked` omitted |
   | 2 | `addManualClockEvent()` UPDATE | `attendance.ts` ~L888 | Omits all payroll fields |
   | 3 | `addManualClockEvent()` INSERT | `attendance.ts` ~L903 | Omits all payroll fields |
   | 4 | `recalculateDailySummary()` | `DailyHoursDetailDialog.tsx` ~L212 | Omits all payroll fields; no Sunday awareness |

   (`generateDailySummary()` UPDATE path at ~L600 is already complete and can serve as reference.)

3. Patch segment-edit recalc path to call canonical summary recompute logic.
4. Add defensive logging for invalid summary writes.

Exit:
- New/updated summary rows always contain complete payroll fields.
- All 4 broken write paths confirmed fixed.

### Phase 2: Canonical write-path consolidation + historical backfill
1. Standardize summary recalculation through one server-side path (preferred: `process_attendance_for_date`).
2. Manual clock event flow must trigger canonical recompute after write.
3. Retire or guard duplicate client-side summary calculators.
4. If `add_manual_clock_event_v2` is required, implement/validate it in source-controlled migrations; otherwise remove dependency and use explicit recompute.
5. Backfill historical `time_daily_summary` rows in the validation window (8-12 weeks) by re-running `process_attendance_for_date` per date. This corrects rows that were created by the broken write paths (NULL payroll fields, zero OT, etc.). Compare before/after counts against the Phase 0 data quality audit.

Exit:
- Single canonical summary computation path in active use.
- Historical backfill completed; verification queries show no invalid rows in the validation window.

### Phase 3: Consumer alignment
1. Update weekly summary to consume persisted minute buckets directly (no day-of-week re-derivation for totals).
2. Update payroll page to derive hourly totals from `time_daily_summary` buckets.
3. Define `staff_hours` role explicitly:
- either legacy/manual capture only, or
- fully aligned schema + reconciliation.
4. Ensure all outputs (weekly summary, reports, payroll) agree for same staff/week.

Exit:
- All consumers show consistent regular/OT/DT totals.

### Phase 4: Dual-run validation
1. Run old and new payroll logic in parallel for minimum 2 payroll cycles.
2. Produce per-staff diff reports (hours and currency).
3. Investigate all non-zero diffs and document rationale/fix.

Exit:
- Signed parity report with no unexplained payroll differences.

### Phase 5: Controlled cutover
1. Enable canonical payroll source flag in production.
2. Monitor first live cycle with anomaly checks.
3. Keep rollback switch available throughout first cycle.

Exit:
- Cycle closes successfully with no unresolved variance incidents.

## 5) Minimum test matrix

1. Sunday-only shift.
2. Mon-Thu normal day below 9h (with tea deduction).
3. Mon-Thu day crossing 9h threshold.
4. Friday day crossing 9h threshold (no tea deduction).
5. Mixed week including Sunday.
6. Open/missing clock events.
7. Manual clock add/edit/delete flow.
8. Segment edit flow from detail dialog.
9. Boundary case at exactly 540 minutes.
10. No-event day (ensure no phantom paid minutes).
11. Wage calculation spot checks across regular/OT/DT combinations.

## 6) Operational controls and rollback

### Monitoring checks (during rollout)
1. Null/negative minute buckets.
2. Sunday rows with non-zero regular or overtime minutes.
3. `net_work_minutes` reconciliation failures.
4. Weekly totals mismatch between payroll page and weekly summary.

### Rollback plan
1. Flip payroll-source feature flag back to baseline logic.
2. Pause approvals for impacted payroll batch.
3. Re-run baseline payroll computation for affected week.
4. Issue reconciliation report and incident notes.

## 7) Deliverables

1. Code changes for all affected write paths and consumers.
2. DB migrations for required schema/function updates.
3. Dual-run validation report template + completed report for pilot cycles.
4. Rollout runbook with cutover/rollback commands.
5. Updated documentation references:
- `docs/overview/todo-index.md`
- `docs/README.md`
- timekeeping domain docs as needed

## 8) Implementation touch list

- `lib/utils/attendance.ts`
- `components/features/staff/DailyHoursDetailDialog.tsx`
- `components/features/staff/WeeklySummary.tsx`
- `app/staff/payroll/page.tsx`
- `migrations/` (new payroll/timekeeping migration files)
- `staff-schema.sql` (if used as local schema reference)
- feature flag helper/config (new)

## 9) Approvals required before production cutover

1. Payroll/business owner: Gate A and Gate B policies.
2. Technical owner: Gate C schema/function verification sign-off.
3. Operations owner: dual-run parity acceptance.
4. Final go-live approval: payroll + operations.

---

## Appendix A: Code audit reference (2026-02-05)

This appendix summarizes the line-by-line code audit performed by Claude Opus 4.6. It exists so implementers can verify the specific issues without re-reading the entire codebase. Line numbers are approximate and may drift as other changes land.

### A.1) `time_daily_summary` write paths

| # | Function | Type | File | Lines | reg_min | ot_min | dt_min | wage | total_hrs |
|---|----------|------|------|-------|---------|--------|--------|------|-----------|
| 1 | `generateDailySummary()` | UPDATE | attendance.ts | ~600-623 | OK | OK | OK | OK | OK |
| 2 | `generateDailySummary()` | INSERT | attendance.ts | ~624-649 | OK | **0 bug** | OK | OK | **missing** |
| 3 | `addManualClockEvent()` | UPDATE | attendance.ts | ~888-901 | missing | missing | missing | missing | missing |
| 4 | `addManualClockEvent()` | INSERT | attendance.ts | ~903-919 | missing | missing | missing | missing | missing |
| 5 | `process_attendance_for_date` | RPC | migration SQL ~310-336 | OK | OK | OK | OK | OK |
| 6 | `recalculateDailySummary()` | UPSERT | DailyHoursDetailDialog ~212-291 | missing | missing | missing | missing | missing |

### A.2) Overtime threshold values in codebase

| Location | Threshold | Type |
|----------|-----------|------|
| `process_attendance_for_date` RPC | 540 min (9h) | Daily |
| `generateDailySummary()` in attendance.ts | 540 min (9h) | Daily |
| `WeeklySummary.tsx` ~L302 | 44h * 60 = 2640 min | Weekly |
| `payroll/page.tsx` ~L149/177 | `staff.weekly_hours \|\| 40` | Weekly |
| CLAUDE.md / timekeeping docs | 9 hours | Daily |

### A.3) Key schema issues found

- `staff_weekly_payroll`: missing `doubletime_hours` column — payroll page writes to it at ~L220/243
- `staff_hours`: missing `overtime_hours`, `overtime_rate` columns — payroll page reads them at ~L166/167 (always undefined)
- `add_manual_clock_event_v2`: called at attendance.ts ~L687, not defined in any migration (always falls to fallback)

### A.4) Business rules cross-reference

| Rule | CLAUDE.md | time-attendance-working.md | time-attendance-plan.md | RPC (SQL) | attendance.ts | WeeklySummary.tsx | payroll/page.tsx |
|------|-----------|---------------------------|------------------------|-----------|---------------|-------------------|------------------|
| Sunday = all DT | yes | yes | yes | yes | yes | yes (re-derived) | yes |
| Tea 30min Mon-Thu | yes | yes | yes | yes | yes | no | no |
| Daily 9h OT | yes | yes | yes | yes | yes | **no (44h weekly)** | **no (40h weekly)** |
| Fri no tea | yes | yes | yes | yes | yes | n/a | n/a |
| Week Fri-Thu | — | — | — | n/a | n/a | yes | unclear |

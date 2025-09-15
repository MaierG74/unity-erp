# Time Attendance Improvement Plan

Focus: Resolve the 30-minute tea/lunch deduction logic and ensure accurate regular / OT / DT breakdowns.

---

## 1. Objectives
1. Eliminate duplicate deductions by moving the 30-minute rule to a database trigger.
2. Keep `time_clock_events` as the single source of truth; derived tables must reflect updated business logic.
3. Remove temporary client-side workaround once the trigger is live.
4. Maintain backwards compatibility during rollout (feature flag).

## 2. Business Rules (unchanged)
| Day of Week | Tea/Lunch Deduction | Regular vs OT | Double-Time |
|-------------|--------------------|---------------|-------------|
| Mon-Thu | 30 min auto-deducted | First 9 h Regular → remainder OT (1.5×) | – |
| Friday | No deduction | Same 9 h rule | – |
| Sunday | No deduction | 0 h Regular / OT | All hours DT (2×) |

## 3. Technical Tasks
### 3.1 Database
- [ ] **Trigger**: `before_insert_or_update_time_daily_summary()`
  ```sql
  -- pseudo-code
  net_work_minutes := total_work_minutes - CASE WHEN dow BETWEEN 1 AND 4 THEN 30 ELSE 0 END;
  regular_minutes  := LEAST(net_work_minutes, 9*60);
  ot_minutes       := GREATEST(net_work_minutes - regular_minutes, 0);
  dt_minutes       := CASE WHEN dow = 0 THEN net_work_minutes ELSE 0 END;
  total_hours_worked := ROUND(net_work_minutes / 60.0, 2);
  RETURN NEW;
  ```
- [ ] Grant function/trigger `SECURITY DEFINER` privileges as needed.

### 3.2 Client
- [ ] `generateDailySummary()` – remove 30-min subtraction under feature flag `USE_DB_DEDUCTION`.
- [ ] UI: surface server-calculated values for validation.

### 3.3 Testing
- [ ] Seed sample clock events for Mon, Fri, Sun.
- [ ] Verify `time_daily_summary` matches expected outputs.
- [ ] Regression test existing payroll reports.

### 3.4 Roll-Out
1. Deploy trigger to staging DB only.
2. Enable `USE_DB_DEDUCTION` in staging.
3. After validation, deploy to prod; remove flag & legacy code in following sprint.

## 4. Timeline
| Item | Owner | ETA |
|------|-------|-----|
| Trigger SQL drafted | Dev | 26 Jul 2025 |
| Staging deploy & QA | Dev + QA | 27 Jul 2025 |
| Prod deploy | DevOps | 28 Jul 2025 |
| Legacy code removal | Dev | 30 Jul 2025 |

## 5. Risks & Mitigations
- **Double deduction**: Guard with feature flag until confirmed.
- **Historical data mismatch**: Leave historical summaries untouched; re-process only if needed.
- **Negative summary after deletion**: If all clock events for a day are removed, the summary row may persist with a **-0.50 h** value (30-min deduction applied to zero minutes). This could confuse users and must be auto-cleaned.

## 6. Open Edge-Case Fix
When `total_work_minutes = 0` **and** no clock events exist for the staff/date:
1. **Option A – Auto-delete summary row** in `trigger_process_clock_event()` after segment re-processing.
2. **Option B – Update summary row to all zeros** (regular/ot/dt/total) in `before_insert_or_update_time_daily_summary`.

Preferred: **Option A** keeps table size small and avoids negative values. This was implemented on 26 Jul 2025: summary rows now reset to zero if all events are deleted, so negative (-0.50h) values will not persist after the fix.

### Post-Fix Manual Cleanup
For summary rows created before the fix, simply add and delete a dummy clock event for that staff/date and click "Process Clock Events". The negative value will be cleared and future calculations will be correct.

---
> Last updated: 26 Jul 2025

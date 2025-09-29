# Unity ERP – Master Implementation Plan

---

## 1. Attendance & Payroll Logic

| Day of Week | Tea/Lunch Deduction | Regular vs OT | Double-Time |
|-------------|---------------------|---------------|-------------|
| Monday-Thursday | **30 min** (0.5 h) automatically deducted from total work minutes | First 9 h → Regular<br>After 9 h → Overtime (1.5×) | ‑ |
| Friday | **No** deduction | Same 9 h rule | ‑ |
| Sunday | No deduction | 0 h Regular / OT | **All** hours double-time (2×) |

Formula implemented in code *(generateDailySummary)* and to be mirrored in DB trigger:

```text
net_work_minutes = total_work_minutes - (isMonThu ? 30 : 0);
regular_minutes  = min(net_work_minutes, 9*60);
ot_minutes       = max(net_work_minutes - regular_minutes, 0);
dt_minutes       = (dow = Sunday) ? net_work_minutes : 0;
total_hours_worked = round(net_work_minutes / 60, 2);
```

### Planned Trigger
- Table: `time_daily_summary`
- Event: BEFORE INSERT OR UPDATE
- Action: Re-calculate `total_hours_worked` exactly as above to guard against ad-hoc SQL.
- Skip double deduction by **removing** client-side subtraction once trigger deployed.

---

## 2. Quoting Module

Features completed:
1. Data model & Supabase tables (`quotes`, `quote_items`, `quote_attachments`). RLS enabled.
2. UI pages scaffolding: list, editor, new quote redirect.
3. Quote items table with per-item price * qty = line total.
4. Attachment upload/delete logic consolidated under QButton storage bucket.
5. Quote filtering & status workflow (In Progress → Quote Done, etc.).
6. Orders now reference quotes via FK.

Remaining polish / stretch goals:
- Bulk PDF quote export.
- Quote versioning.
- Email/send quote directly from ERP.

---

## 3. Outstanding Global Tasks

- [ ] Add DB trigger for tea deduction (see section 1).
- [ ] Convert attendance processing to Supabase functions for scalability.
- [ ] Improve payroll report PDF formatting & sort by first name.
- [ ] Investigate time_daily_summary `select('*')` 500-error; switch to column whitelist.
- [ ] Refactor login route redirects (`/auth/login`).

---

## 4. History / Important Decisions

- **2025-07-23** manual SQL overwrote tea deduction; fixed via targeted UPDATE.
- Per-staff "Process" button added for faster attendance recalculation.
- Time_clock_events designated single source of truth; manual edits only at event level.

---

> This file centralises business rules and project status so future conversations can reference a single source. Save any new high-level decisions here.

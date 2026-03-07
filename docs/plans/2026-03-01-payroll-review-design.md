# Payroll Review Page — Design Document

## Goal

Replace the broken single-staff payroll page with a weekly all-staff payroll review page that correctly aggregates hours from `time_daily_summary`, piecework from `staff_piecework_earnings`, and support deductions from `staff_support_links`. Introduce configurable work week start day and an OT threshold to handle scan-drift overtime.

## Prerequisites

### Org Settings: Work Week & OT Threshold

Add to `organizations` table:
- `week_start_day INTEGER DEFAULT 5` — day the work week starts (0=Sun … 5=Fri … 6=Sat)
- `ot_threshold_minutes INTEGER DEFAULT 30` — weekly OT below this threshold is treated as scan drift and auto-zeroed

A `useOrgSettings()` hook fetches and caches these values. A settings card on `/settings` lets admins change both.

After the hook exists, a `/batch` sweep updates all hardcoded `weekStartsOn` values across the codebase (~6 files) to use the hook.

---

## Route & Navigation

**Route:** `/payroll-review` (new page; existing `/staff/payroll` remains untouched as a safety net)

**Navigation:** Added to sidebar. The Payroll tab on `/staff` links here instead of the old page.

**TODO:** Remove old `/staff/payroll` page once the new page is verified in production.

---

## Page Layout

### Week Selector

Top of page. Prev/next arrows, "Current Week" button. Displays the week range using the org's `week_start_day` (e.g. "Fri 28 Feb – Thu 6 Mar 2026").

### Action Bar

- **"Calculate Week"** button — runs aggregation for all active staff for the selected week
- Summary stats: total staff calculated, total payroll cost, number flagged for OT review

### Staff Table

All active staff for the selected week. Columns:

| Column | Description |
|--------|-------------|
| ☐ | Checkbox for bulk selection |
| Staff | Name |
| Job | Job description |
| Reg Hours | From `time_daily_summary.regular_minutes` summed for week |
| OT Hours | From `time_daily_summary.ot_minutes` summed for week |
| DT Hours | From `time_daily_summary.dt_minutes` summed for week |
| Hourly Total | `(reg × rate) + (ot × rate × 1.5) + (dt × rate × 2.0)` |
| Piecework (gross) | From `staff_piecework_earnings` summed for week |
| Support Deduction | Support employee costs deducted from this worker's piecework |
| Piecework (net) | Gross minus deductions |
| Final Pay | `MAX(hourly_total, net_piecework)` — winning amount highlighted green |
| OT Override | Toggle: "Standard hours only" — zeroes OT, caps regular to scheduled shift |
| Status | Badge: pending (yellow), approved (green), paid (blue) |

---

## OT Override Logic

On calculate, for each staff member:
- If `total_ot_minutes < org.ot_threshold_minutes` → auto-set override ON (standard hours only). Row appears normal.
- If `total_ot_minutes >= org.ot_threshold_minutes` → override OFF, row highlighted amber for manager review.

Manager can toggle the override either way. Toggling recalculates that row's hourly total and final pay client-side.

This means: after calculating, most rows are already handled. Only the amber-highlighted rows (real OT candidates) need attention. Typical review: 5-10 out of 50 staff.

---

## Pay Comparison Display

Hourly total and net piecework shown side by side. The higher value gets a subtle green background — that's the final payment. If piecework is higher, the worker benefits from piece rates. If hourly is higher, they get the guaranteed hourly wage.

---

## Staff Detail Drill-Down

Clicking a staff row opens a side panel (Sheet) with two tabs:

### Hours Tab

Daily breakdown for the week (like the Weekly Summary view):

| Day | Date | Clock In | Clock Out | Work Hours | Regular | OT | DT |
|-----|------|----------|-----------|------------|---------|----|----|

Plus weekly totals.

### Piecework Tab

All completed job card items for this staff member in the selected week:

| Job Card | Product | Qty Completed | Rate | Override | Earned |
|----------|---------|---------------|------|----------|--------|
| #19 | Desk Panel | 60 | R0.64 | - | R38.40 |
| #22 | Chair Frame | 20 | R12.50 | - | R250.00 |
| | | | | **Total** | **R288.40** |

If this worker has support deductions:
- Support deduction line: "Support: Employee B (100%) — R2,000"
- Net piecework total

---

## Calculation Logic

When "Calculate Week" is clicked:

1. **Determine week range** from selected date + `org.week_start_day`

2. **Hours:** Query `time_daily_summary` for all staff in the date range. Sum `regular_minutes`, `ot_minutes`, `dt_minutes` per staff. Convert to hours (÷ 60).

3. **Hourly wages:** Per staff: `(reg_hours × hourly_rate) + (ot_hours × hourly_rate × 1.5) + (dt_hours × hourly_rate × 2.0)`. Rate from `staff.hourly_rate`.

4. **Piecework:** Query `staff_piecework_earnings` view for the date range. Sum `earned_amount` per staff.

5. **Support deductions:** Query active `staff_support_links`. For each primary worker with links, calculate: `SUM(support_employee_hourly_wage_total × cost_share_pct / 100)`. Net piecework = gross - deductions.

6. **OT override:** Apply threshold logic. Auto-toggle rows below threshold.

7. **Final pay:** `MAX(hourly_total_after_override, net_piecework)`.

8. **Write:** Upsert into `staff_weekly_payroll` with `status = 'pending'`.

---

## Approval Workflow

- Checkboxes per row for selection
- **"Approve Selected"** — sets status to `approved` for selected rows
- **"Mark Paid"** — only for approved rows, sets `status = 'paid'` and `payment_date = today`
- Approved/paid rows become read-only (no OT toggle, greyed appearance)
- Status badges: pending (yellow), approved (green), paid (blue)

---

## Data Sources (replacing the broken old page)

| Data | Old Page (broken) | New Page (correct) |
|------|-------------------|-------------------|
| Hours | `staff_hours` table (legacy) | `time_daily_summary` (authoritative) |
| OT threshold | Weekly 40h (wrong) | Daily 9h (pre-computed in `ot_minutes`) |
| Piecework | Ad-hoc job_card_items query | `staff_piecework_earnings` view |
| Week boundaries | Hardcoded Monday | `org.week_start_day` setting |
| Support deductions | Not supported | `staff_support_links` table |

---

## Tech Stack

- Next.js page at `app/payroll-review/page.tsx`
- TanStack Query for data fetching
- Supabase direct queries (no RPC needed — reads from views/tables, upserts to `staff_weekly_payroll`)
- `useOrgSettings()` hook for week start day and OT threshold
- shadcn/ui Sheet for drill-down panel
- sonner for toast notifications

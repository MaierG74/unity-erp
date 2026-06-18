# Staff Absence Report — Logic Correctness, Non-Working-Days Calendar & Printable Output

- **Date:** 2026-06-18
- **Status:** Design — revised after 3-lens GPT-5.5 plan review; awaiting final spec sign-off
- **Author:** Claude (orchestrator) + GPT-5.5 agents (SA labour-law research; rail/arch/adversarial plan review)
- **Driver:** Payroll clerk needs to run absenteeism reports — how many days each staff member was *genuinely, unexpectedly* absent across a few months / a year. Weekends, public holidays, and the company leave shutdown must NOT count as absence.

## 1. Why this exists (the bug)

The Absence Reports tab exists at **Hours Tracking → Reports → Absence Reports**
([`StaffReports.tsx`](../../../components/features/staff/StaffReports.tsx)), but its math is wrong
(`StaffReports.tsx` ~L796–838): `daysAbsent = (all calendar days) − (days with hours > 0)`.
So weekends count as absent (~104 phantom days/year), public holidays count as absent, and "absent"
conflates weekends, holidays, approved leave, and genuine no-shows into one meaningless number.

Verified live DB (2026-06-18): `staff` has **no** employment-type column; `weekly_hours` 40 for ~all;
`public_holidays` exists but is **empty**; 44 `current_staff`, 43 `is_active`; `time_daily_summary`
has a row **only** when clock events exist (absent day = NO row); `work_schedules` defines
mon-thu / fri / sat-sun (Sat–Sun = voluntary OT).

## 2. How this business actually works (load-bearing)

Each employee gets **15 annual leave days**, and at this company **everyone takes them as a single
December shutdown**. There is **no per-employee leave-balance counter in the system** — 15 days is a
policy, not stored data. Other companies may differ (no shutdown; staff choose dates year-round).

**Implication:** the report's real job is **unplanned absence during the operating year**. The
shutdown is company-wide approved leave and must be *excluded* like a public holiday — otherwise
December shows every employee as ~15 days "absent" (pure noise). We therefore do **not** show a
"vs 15-day allowance" number (it would be misleading); we show genuine unplanned absence, with the
policy stated as context text.

## 3. Scope

**Phase A (this spec):** correct the absence logic via a server-side RPC; introduce a **payroll-inert,
org-scoped non-working-days calendar** (public holidays + admin-entered company closures) that *only*
the absence report reads; add an additive `staff.employment_type` with a "Monthly only" filter; ship
a polished printable PDF. Works for all active staff; the monthly filter is additive and never gates.

**Phase B (future, separate spec):** real leave tracking (per-employee approved-leave records +
balances), authorised-vs-unauthorised classification, sick-leave 36-month cycle, parental leave
(post-*Van Wyk* 2025), POPIA-safe medical handling, public-holiday-during-leave extra-day rule
(BCEA s20(8)), and — coordinated with the Sunday-doubletime payroll rollout — enabling public-holiday
payroll (which is *why* Phase A keeps the payroll `public_holidays` table untouched).

## 4. Legal grounding (verified — Sources §10)

Baked into Phase A: a public holiday is **never** an absence; weekends + holidays + company closures
are **excluded from available working days**; `absence rate = lost working days / available working
days × 100`; Sunday→Monday observed rule (2026: only 9 Aug→10 Aug); no Saturday substitute; "15 days"
= BCEA 5-day-week equivalent (note 18 for 6-day weeks, future); retain attendance records (BCEA ≥3y,
SARS ≥5y) — no deletion. Deferred to Phase B: sick-leave 36-mo cycle, family-responsibility/parental
leave, earnings threshold R269,600.90 (2026-05-01) and its s9–s18(3) exclusions, POPIA medical data.

## 5. Phase A design

### 5.1 Data model

**(a) `non_working_days` — NEW, org-scoped, PAYROLL-INERT.**
The payroll trigger `update_daily_work_summary()` reads `public_holidays`; seeding *that* table would
change live payroll behaviour (worked-holiday unpaid/paid minutes) and jump ahead of the deferred
Sunday-doubletime rollout. So the absence report uses a **separate** table the payroll path never reads.

```
non_working_days(
  id          bigint generated always as identity primary key,
  org_id      uuid not null references organizations(id),
  day_date    date not null,
  kind        text not null check (kind in ('public_holiday','observed_holiday','company_closure')),
  label       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, day_date)
)
```
- **RLS:** SELECT for org members (`is_org_member(org_id)`); INSERT/UPDATE/DELETE restricted to org
  admins via the existing org-admin RLS pattern (build agent confirms exact predicate). Enable RLS;
  `get_advisors` clean.
- **Seed** SA public holidays **2025–2030** for each existing org: 12 statutory/year with Good Friday
  & Family Day Easter-computed, plus an `observed_holiday` row for each Sunday→Monday case. Idempotent
  (`on conflict (org_id, day_date) do update`). **Fixture assertions:** row for `2026-08-10`; NO rows
  for `2026-03-23` / `2026-12-28` (Saturday holidays get no substitute).
- **Company closures:** admin-entered, **may be empty** (no preset shutdown). Same table, `kind='company_closure'`.

**(b) `staff.employment_type` — NEW, additive.** `text` + CHECK in
(`monthly`,`weekly`,`hourly`,`piecework`,`casual`), nullable (default NULL). Shared TS constants
(`lib/constants/employment-types.ts`) used by the RPC filter, the staff **edit** form
([`app/staff/[id]/edit/page.tsx`](../../../app/staff/[id]/edit/page.tsx)) and the **new-staff** form.
Nothing gates on it; the report's "Monthly only" filter simply adds `employment_type='monthly'`.

### 5.2 The RPC

`SECURITY INVOKER`, `SET search_path = public, pg_temp`, schema-qualified refs, `REVOKE EXECUTE FROM
anon`; post-apply assert `pg_proc.prosecdef = false`. Operates purely in **date space** against
`time_daily_summary.date_worked` (SAST work date), so no UTC/tz drift inside the RPC.

```
staff_absence_report(
  p_start            date,
  p_end              date,                       -- require p_start <= p_end (else raise)
  p_staff_ids        int[]  default null,        -- explicit selection; may include inactive
  p_staff_scope      text   default 'active',    -- 'active'(is_active AND current_staff) | 'all' | 'inactive'
  p_employment_type  text   default null         -- additive type filter; null = all types
) returns table (
  staff_id                 int,
  name                     text,
  employment_type          text,
  working_days             int,      -- Mon–Fri in [max(p_start,hire_date),p_end] minus non_working_days
  days_present             int,      -- working day with a COMPLETE summary, total_hours_worked > 0
  days_absent              int,      -- GREATEST(working_days − days_present, 0)
  absence_rate             numeric,  -- days_absent/working_days*100; 0 when working_days = 0
  total_hours              numeric,
  public_holidays_count    int,      -- holidays excluded from THIS staff's working days (per effective period)
  closure_days_count       int,      -- company-closure working days excluded
  worked_holiday_dates     date[],   -- clocked in on a public holiday → flag for clerk (double-time)
  incomplete_timecard_dates date[],  -- open clock-in / is_complete=false → NOT absence, surfaced as exception
  absent_dates             date[],
  bradford_factor          int,      -- period spell metric, labelled "period (unclassified)"
  has_missing_hire_date    boolean   -- true → counts NULL, row flagged for data cleanup, never "absent"
)
```

**Implementation shape (one grouped scan — `EXPLAIN (ANALYZE, BUFFERS)` before ship):**
1. `staff_scope` CTE — staff filtered by scope/type/explicit-ids, carrying `org_id`, `hire_date`.
2. `calendar` CTE — `generate_series(p_start,p_end)` filtered to dow ∈ {1..5}.
3. `working_days` — `staff_scope × calendar` where `d >= hire_date`, anti-joined to `non_working_days`
   (matched on `org_id` + `day_date`); split holiday vs closure exclusions for the count columns.
4. `present` — LEFT JOIN `time_daily_summary` on `(staff_id, date_worked = d)` where
   `total_hours_worked > 0 AND is_complete` (a missing row = absent; an incomplete/zero row ≠ present).
5. `worked_holidays` — separate CTE joining summaries directly to holiday rows (incl. Sundays) so
   holiday work neither vanishes nor double-counts as a working day.
6. `incomplete` — summaries with `is_complete = false` (or open clock-in) → `incomplete_timecard_dates`.
7. `bradford` — over working-day absent rows, `workday_seq`; new spell when
   `lag(workday_seq) IS NULL OR workday_seq <> lag(workday_seq)+1`; `S`=spells, `D`=absent days, `B=S²·D`.
8. Aggregate `GROUP BY staff` (driven from `staff_scope` so zero-working-day staff still return).

**Fail-closed coverage:** for every calendar year overlapping `[p_start,p_end]`, require seeded
public-holiday coverage in `non_working_days` for the staff's org; if a year is unseeded, **raise**
(`absence report calendar not seeded for <year>`) rather than silently treating holidays as working
days. UI surfaces the error.

### 5.3 Staff scope & lifecycle

Default `p_staff_scope='active'` = `is_active = true AND current_staff = true` (resolves the 44/43
mismatch). Explicit `p_staff_ids` may include inactive staff. There is no `termination_date` column
today → for historical periods, staff with no employment-end data are reported as active for the whole
range; **flag this as a Phase-A limitation** and add `employment_end_date` in Phase B. `has_missing_hire_date`
rows are returned flagged with NULL counts (never "absent"), prompting data cleanup.

### 5.4 Framing (safety)

Absence column labelled **"Unclassified non-attendance"** with a one-line note: Phase A cannot yet
distinguish approved leave from a no-show; reconcile manually before any payroll/disciplinary action.
**No "15-day allowance" column** — show "Company policy: 15 leave days/year (this company: taken over
the December shutdown)" as context text only. Bradford labelled "period (unclassified)", kept out of
the default summary's disciplinary framing; visible as a secondary signal.

### 5.5 UI ([`StaffReports.tsx`](../../../components/features/staff/StaffReports.tsx))

- Keep the existing Staff Type (all/active/inactive) → `p_staff_scope`. Add a **separate** "Employment
  type: Monthly only / Any" control → `p_employment_type`. An **untagged-count banner** when "Monthly
  only" is chosen but few/no staff are tagged.
- Columns: Staff · Type · Working days · Present · **Unclassified non-attendance** · Absence rate ·
  Public holidays · Closure days · Bradford (secondary). Row drill-down: `absent_dates`,
  `worked_holiday_dates`, `incomplete_timecard_dates`.
- Keep CSV; replace `window.print()` with the PDF below.

### 5.6 Printable PDF

`StaffAbsencePDF.tsx` via `@react-pdf/renderer`, **dynamically imported inside the print handler**
(both the lib and the component — the current `StaffReports.tsx:41` eager import is a guardrail
violation we do not copy). Linear-calm aesthetic, Inter, tabular numerals, hairline borders, no
resting shadows. Header: company · "Absence Report" · period · scope · generated timestamp · legend
(weekends/holidays/closures excluded; Phase-A unclassified note). Per-staff summary + optional detail.
**Mockups shown and approved before coding.**

## 6. Verification

- `npm run lint` + `npx tsc --noEmit` clean for touched areas.
- **Payroll-inertness proof:** seeding `non_working_days` + running the RPC perform **zero** writes to
  `time_daily_summary`, wage, or payroll tables; `public_holidays` stays empty. Assert explicitly.
- `EXPLAIN (ANALYZE, BUFFERS)` `staff_absence_report` for 44 staff × 12 months — single grouped scan, tens of ms.
- `get_advisors` (security) clean after migration; assert RPC `prosecdef = false`.
- **Oracle test:** hand-compute one employee/month (Mon–Fri − holidays − closures) and assert RPC matches.
- **Edge tests:** single-day Friday; one-day public holiday; one-day inside a closure; hire-date = end-date
  boundary; `p_start > p_end` rejected; null hire_date flagged; incomplete timecard excluded; worked-holiday
  flagged not double-counted; period spanning an unseeded year raises; 2026 fixture (10 Aug present, 23 Mar / 28 Dec absent).
- Browser smoke (preview MCP): generate a monthly report, confirm weekends/holidays/closures excluded, flags show, PDF prints cleanly.
- **No synthetic wage/earnings rows** in the live DB (payroll runs weekly on live).

## 7. Rollback / release notes

Additive: new `non_working_days` table + rows, `staff.employment_type` column, new RPC, new PDF.
Rollback = drop RPC + column + table (or leave table — payroll never reads it). UI degrades to CSV if
the RPC is absent. Release note: "Absence Report now counts only working days (excludes weekends, SA
public holidays, and company closures), flags worked holidays and timecard exceptions, and adds a
Monthly-staff filter + printable PDF. Live payroll behaviour is unchanged."

## 8. Plan-review resolutions (3-lens GPT-5.5)

- Adversarial **REVISE** (2 P0) · Rail **APPROVE-WITH-CHANGES** · Architecture **APPROVE-WITH-CHANGES**.
- P0 leave-classification → resolved: no allowance column, "unclassified" framing, December shutdown excluded.
- P0 staff scope → resolved: `p_staff_scope` default `active AND current`, explicit-selection override, Phase-B `employment_end_date`.
- Payroll side-effect of seeding → resolved: separate payroll-inert `non_working_days`; `public_holidays` untouched.
- All other P1/P2 (worked-holiday CTEs, incomplete timecards, SAST date space, fail-closed coverage, idempotent seed + fixtures, zero-working-day rows, Bradford windowing, null hire_date, RPC verifiability, lazy PDF import, boundary validation) folded into §5–§6.

## 9. Open assumptions

- Working week = **Mon–Fri** for absence (confirmed; Saturdays = voluntary OT).
- Company closures are **admin-entered per year**, may be empty.
- "Monthly staff" = `employment_type='monthly'`, tagged via staff forms.

## 10. Sources (verified)

- BCEA 75/1997 — https://www.gov.za/sites/default/files/gcis_document/201409/a75-97.pdf
- Public Holidays Act 36/1994 — https://www.gov.za/sites/default/files/gcis_document/201409/act36of1994.pdf
- gov.za public holidays (2026) — https://www.gov.za/about-sa/public-holidays
- 2026 earnings threshold Gazette 54544 — https://www.labour.gov.za/DocumentCenter/Regulations%20and%20Notices/Notices/Basic%20Conditions%20of%20Employment/Basic%20Conditions%20of%20Employment%20Act_Determination%20Earnings%20Threshold2026.pdf
- Van Wyk parental-leave judgment [2025] ZACC 20 — https://www.concourt.org.za/index.php/judgement/617-a-werner-van-wyk-and-others-v-minister-of-employment-and-labour
- POPIA 4/2013 — https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013protectionofpersonalinforcorrect.pdf
- timeanddate — Women's Day 2026 observed Monday — https://www.timeanddate.com/holidays/south-africa/national-womens-day

(Independent cross-check: OS calendar confirmed all 2026 weekdays incl. 9 Aug = Sunday → 10 Aug observed.)

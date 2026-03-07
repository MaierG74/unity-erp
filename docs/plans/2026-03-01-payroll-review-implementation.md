# Payroll Review Page — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a weekly all-staff payroll review page with configurable work week, OT threshold, piecework comparison, support deductions, and bulk approval.

**Architecture:** Org-level settings (week_start_day, ot_threshold_minutes) stored on the organizations table and consumed via a useOrgSettings() hook. The payroll review page at /payroll-review aggregates hours from time_daily_summary, piecework from staff_piecework_earnings, and support costs from staff_support_links. A drill-down panel shows per-staff daily hours and piecework job breakdowns.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL + RLS), TanStack Query, shadcn/ui, date-fns, sonner

---

## Context for the Implementer

### Key Tables

- `organizations` — will get `week_start_day` (int 0-6, default 5=Friday) and `ot_threshold_minutes` (int, default 30)
- `time_daily_summary` — authoritative daily hours. Key columns: `staff_id`, `date_worked`, `regular_minutes`, `ot_minutes`, `dt_minutes`, `first_clock_in`, `last_clock_out`
- `staff_piecework_earnings` — SQL view. Key columns: `staff_id`, `completion_date`, `completed_quantity`, `piece_rate`, `piece_rate_override`, `earned_amount`
- `staff_support_links` — active links where `effective_until IS NULL`. Key columns: `primary_staff_id`, `support_staff_id`, `cost_share_pct`
- `staff_weekly_payroll` — upsert target. Unique on `(staff_id, week_start_date)`. Has `org_id NOT NULL`
- `staff` — `staff_id`, `first_name`, `last_name`, `hourly_rate`, `job_description`, `is_active`

### Existing Patterns

- `getOrgId(user)` in `lib/utils.ts` extracts org_id from Supabase user metadata
- `components/ui/sheet.tsx` for side panels
- `date-fns` startOfWeek/endOfWeek with `{ weekStartsOn: N }` for week boundaries
- `components/features/staff/WeeklySummary.tsx` has week navigation pattern (prev/next/current)
- Sidebar nav items in `components/layout/sidebar.tsx` lines 40-136, pattern: `{ name, href, icon }`

### Design Doc

Full design at `docs/plans/2026-03-01-payroll-review-design.md`

---

### Task 1: Add week_start_day and ot_threshold_minutes to organizations table

**Files:**
- Migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

```sql
-- Add payroll settings to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS week_start_day INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS ot_threshold_minutes INTEGER NOT NULL DEFAULT 30;

-- Add CHECK constraints
ALTER TABLE organizations
  ADD CONSTRAINT chk_week_start_day CHECK (week_start_day >= 0 AND week_start_day <= 6),
  ADD CONSTRAINT chk_ot_threshold CHECK (ot_threshold_minutes >= 0 AND ot_threshold_minutes <= 600);

-- Allow org members to read their own org row (needed for useOrgSettings hook)
CREATE POLICY orgs_select_member ON organizations
  FOR SELECT USING (public.is_org_member(id));
```

**Step 2: Verify**

Run SQL: `SELECT id, name, week_start_day, ot_threshold_minutes FROM organizations LIMIT 5;`
Expected: All orgs show `week_start_day = 5`, `ot_threshold_minutes = 30`.

Run: `mcp__supabase__get_advisors` (security) to check for RLS issues.

**Step 3: Commit**

```
feat: add week_start_day and ot_threshold_minutes to organizations
```

---

### Task 2: Create useOrgSettings() hook

**Files:**
- Create: `hooks/use-org-settings.ts`

**Step 1: Implement the hook**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';

export interface OrgSettings {
  weekStartDay: number; // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  otThresholdMinutes: number;
}

const DEFAULTS: OrgSettings = {
  weekStartDay: 5,
  otThresholdMinutes: 30,
};

export function useOrgSettings(): OrgSettings & { isLoading: boolean } {
  const { user } = useAuth();
  const orgId = getOrgId(user);

  const { data, isLoading } = useQuery({
    queryKey: ['org-settings', orgId],
    queryFn: async () => {
      if (!orgId) return DEFAULTS;
      const { data, error } = await supabase
        .from('organizations')
        .select('week_start_day, ot_threshold_minutes')
        .eq('id', orgId)
        .single();
      if (error || !data) return DEFAULTS;
      return {
        weekStartDay: data.week_start_day ?? DEFAULTS.weekStartDay,
        otThresholdMinutes: data.ot_threshold_minutes ?? DEFAULTS.otThresholdMinutes,
      };
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // 5 minutes — rarely changes
  });

  return { ...(data ?? DEFAULTS), isLoading };
}
```

**Step 2: Verify**

Add a temporary `console.log(useOrgSettings())` in any existing page and confirm it returns `{ weekStartDay: 5, otThresholdMinutes: 30 }`.

**Step 3: Commit**

```
feat: add useOrgSettings hook for work week and OT threshold
```

---

### Task 3: Add Payroll Settings card to Settings page

**Files:**
- Modify: `app/settings/page.tsx` — add a third card after the Document Templates card (~line 632)

**Step 1: Add the Payroll Settings card**

Add state for `weekStartDay` and `otThresholdMinutes`, fetch current values with `useOrgSettings()`, and render a card with:
- A `<Select>` dropdown for work week start day (Sunday through Saturday, default Friday)
- A number `<Input>` for OT threshold in minutes (default 30)
- A "Save" button that updates the `organizations` row

The save handler:

```typescript
const handleSavePayroll = async () => {
  const orgId = getOrgId(user);
  if (!orgId) return;
  const { error } = await supabase
    .from('organizations')
    .update({
      week_start_day: weekStartDay,
      ot_threshold_minutes: otThreshold,
    })
    .eq('id', orgId);
  if (error) {
    toast.error('Failed to save payroll settings');
  } else {
    toast.success('Payroll settings saved');
    queryClient.invalidateQueries({ queryKey: ['org-settings'] });
  }
};
```

Day options: `[{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, ..., { value: 6, label: 'Saturday' }]`

**Step 2: Verify**

Open `/settings` in the browser. Confirm the Payroll Settings card appears with the correct defaults (Friday, 30 min). Change to Monday, save, reload — confirm it persists.

**Step 3: Commit**

```
feat: add payroll settings (work week, OT threshold) to settings page
```

---

### Task 4: Create payroll review query functions

**Files:**
- Create: `lib/queries/payrollReview.ts`

**Step 1: Implement query functions**

```typescript
import { supabase } from '@/lib/supabase';

/** Fetch weekly hours from time_daily_summary for all staff in a date range */
export async function fetchWeeklyHours(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('time_daily_summary')
    .select('staff_id, date_worked, regular_minutes, ot_minutes, dt_minutes, first_clock_in, last_clock_out, total_hours_worked')
    .gte('date_worked', startDate)
    .lte('date_worked', endDate);
  if (error) throw error;
  return data ?? [];
}

/** Fetch piecework earnings for all staff in a date range */
export async function fetchWeeklyPiecework(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('staff_piecework_earnings')
    .select('staff_id, item_id, job_card_id, order_id, completion_date, job_id, product_id, completed_quantity, piece_rate, piece_rate_override, earned_amount')
    .gte('completion_date', startDate)
    .lte('completion_date', endDate);
  if (error) throw error;
  return data ?? [];
}

/** Fetch active support links */
export async function fetchActiveSupportLinks() {
  const { data, error } = await supabase
    .from('staff_support_links')
    .select('primary_staff_id, support_staff_id, cost_share_pct')
    .is('effective_until', null);
  if (error) throw error;
  return data ?? [];
}

/** Fetch all active staff with hourly_rate */
export async function fetchStaffForPayroll() {
  const { data, error } = await supabase
    .from('staff')
    .select('staff_id, first_name, last_name, hourly_rate, job_description, is_active, pay_type')
    .eq('is_active', true)
    .order('first_name');
  if (error) throw error;
  return data ?? [];
}

/** Fetch existing payroll records for a week */
export async function fetchPayrollRecords(weekStartDate: string) {
  const { data, error } = await supabase
    .from('staff_weekly_payroll')
    .select('*')
    .eq('week_start_date', weekStartDate);
  if (error) throw error;
  return data ?? [];
}

/** Upsert a batch of payroll records */
export async function upsertPayrollRecords(records: {
  staff_id: number;
  week_start_date: string;
  week_end_date: string;
  regular_hours: number;
  overtime_hours: number;
  doubletime_hours: number;
  hourly_wage_total: number;
  piece_work_total: number;
  final_payment: number;
  status: string;
  org_id: string;
}[]) {
  const { error } = await supabase
    .from('staff_weekly_payroll')
    .upsert(records, { onConflict: 'staff_id,week_start_date' });
  if (error) throw error;
}

/** Update status for multiple payroll records */
export async function updatePayrollStatus(payrollIds: number[], status: string, paymentDate?: string) {
  const update: Record<string, any> = { status, updated_at: new Date().toISOString() };
  if (paymentDate) update.payment_date = paymentDate;
  const { error } = await supabase
    .from('staff_weekly_payroll')
    .update(update)
    .in('payroll_id', payrollIds);
  if (error) throw error;
}
```

**Step 2: Verify**

Import and call `fetchWeeklyHours('2026-02-24', '2026-02-28')` from a test component. Confirm it returns data.

**Step 3: Commit**

```
feat: add payroll review query functions
```

---

### Task 5: Create payroll calculation utility

**Files:**
- Create: `lib/payroll-calc.ts`

**Step 1: Implement the calculation logic**

This is a pure function (no DB calls) that takes the raw data and produces the payroll review rows.

```typescript
import type { OrgSettings } from '@/hooks/use-org-settings';

export interface PayrollStaff {
  staff_id: number;
  name: string;
  job_description: string | null;
  hourly_rate: number;
  pay_type: string | null;
}

export interface PayrollRow {
  staff_id: number;
  name: string;
  job_description: string | null;
  hourly_rate: number;
  regularMinutes: number;
  otMinutes: number;
  dtMinutes: number;
  regularHours: number;
  otHours: number;
  dtHours: number;
  hourlyTotal: number;
  pieceworkGross: number;
  supportDeduction: number;
  pieceworkNet: number;
  finalPay: number;
  otOverride: boolean; // true = standard hours only (OT zeroed)
  flaggedForReview: boolean; // true = OT >= threshold, needs manager review
  payrollId: number | null; // existing record ID if already calculated
  status: 'pending' | 'approved' | 'paid' | 'new';
}

interface HoursRow {
  staff_id: number;
  regular_minutes: number;
  ot_minutes: number;
  dt_minutes: number;
  date_worked: string;
  first_clock_in: string | null;
  last_clock_out: string | null;
  total_hours_worked: number | null;
}

interface PieceworkRow {
  staff_id: number;
  earned_amount: string | number;
}

interface SupportLink {
  primary_staff_id: number;
  support_staff_id: number;
  cost_share_pct: number;
}

interface ExistingPayroll {
  payroll_id: number;
  staff_id: number;
  status: string;
  regular_hours: number;
  overtime_hours: number;
  doubletime_hours: number;
  hourly_wage_total: number;
  piece_work_total: number;
  final_payment: number;
}

export function calculatePayrollRows(
  staff: PayrollStaff[],
  hours: HoursRow[],
  piecework: PieceworkRow[],
  supportLinks: SupportLink[],
  existingPayroll: ExistingPayroll[],
  settings: OrgSettings,
): PayrollRow[] {
  // Aggregate hours per staff
  const hoursByStaff = new Map<number, { reg: number; ot: number; dt: number }>();
  for (const h of hours) {
    const existing = hoursByStaff.get(h.staff_id) ?? { reg: 0, ot: 0, dt: 0 };
    existing.reg += h.regular_minutes ?? 0;
    existing.ot += h.ot_minutes ?? 0;
    existing.dt += h.dt_minutes ?? 0;
    hoursByStaff.set(h.staff_id, existing);
  }

  // Aggregate piecework per staff
  const pieceworkByStaff = new Map<number, number>();
  for (const p of piecework) {
    const amt = typeof p.earned_amount === 'string' ? parseFloat(p.earned_amount) : p.earned_amount;
    pieceworkByStaff.set(p.staff_id, (pieceworkByStaff.get(p.staff_id) ?? 0) + amt);
  }

  // Compute support deductions per primary worker
  // Deduction = support employee's hourly_wage_total * cost_share_pct / 100
  const staffMap = new Map(staff.map((s) => [s.staff_id, s]));
  const supportDeductions = new Map<number, number>();
  for (const link of supportLinks) {
    const supportHours = hoursByStaff.get(link.support_staff_id);
    const supportStaff = staffMap.get(link.support_staff_id);
    if (!supportHours || !supportStaff) continue;
    const supportHourlyTotal =
      (supportHours.reg / 60) * supportStaff.hourly_rate +
      (supportHours.ot / 60) * supportStaff.hourly_rate * 1.5 +
      (supportHours.dt / 60) * supportStaff.hourly_rate * 2.0;
    const deduction = supportHourlyTotal * (link.cost_share_pct / 100);
    supportDeductions.set(
      link.primary_staff_id,
      (supportDeductions.get(link.primary_staff_id) ?? 0) + deduction,
    );
  }

  // Map existing payroll records
  const existingMap = new Map(existingPayroll.map((p) => [p.staff_id, p]));

  return staff.map((s) => {
    const h = hoursByStaff.get(s.staff_id) ?? { reg: 0, ot: 0, dt: 0 };
    const existing = existingMap.get(s.staff_id);
    const pieceworkGross = pieceworkByStaff.get(s.staff_id) ?? 0;
    const deduction = supportDeductions.get(s.staff_id) ?? 0;
    const pieceworkNet = Math.max(0, pieceworkGross - deduction);

    // OT override logic
    const flaggedForReview = h.ot >= settings.otThresholdMinutes;
    const otOverride = !flaggedForReview; // auto-toggle for low OT

    // Calculate hourly total (with override applied)
    const effectiveOt = otOverride ? 0 : h.ot;
    const effectiveReg = otOverride ? h.reg + h.ot : h.reg; // absorb OT into regular when overridden
    const regHours = effectiveReg / 60;
    const otHours = effectiveOt / 60;
    const dtHours = h.dt / 60;

    const hourlyTotal =
      regHours * s.hourly_rate +
      otHours * s.hourly_rate * 1.5 +
      dtHours * s.hourly_rate * 2.0;

    const finalPay = Math.max(hourlyTotal, pieceworkNet);

    return {
      staff_id: s.staff_id,
      name: `${s.first_name} ${s.last_name}`.trim(),
      job_description: s.job_description,
      hourly_rate: s.hourly_rate,
      regularMinutes: effectiveReg,
      otMinutes: effectiveOt,
      dtMinutes: h.dt,
      regularHours: Math.round(regHours * 100) / 100,
      otHours: Math.round(otHours * 100) / 100,
      dtHours: Math.round(dtHours * 100) / 100,
      hourlyTotal: Math.round(hourlyTotal * 100) / 100,
      pieceworkGross: Math.round(pieceworkGross * 100) / 100,
      supportDeduction: Math.round(deduction * 100) / 100,
      pieceworkNet: Math.round(pieceworkNet * 100) / 100,
      finalPay: Math.round(finalPay * 100) / 100,
      otOverride,
      flaggedForReview,
      payrollId: existing?.payroll_id ?? null,
      status: existing ? (existing.status as PayrollRow['status']) : 'new',
    };
  });
}

/** Recalculate a single row when OT override is toggled */
export function recalcRowWithOverride(row: PayrollRow, override: boolean): PayrollRow {
  const totalOtMinutes = row.otOverride
    ? row.regularMinutes - (row.regularMinutes - row.otMinutes) // undo current override
    : row.otMinutes;
  // Reconstruct raw minutes
  const rawReg = row.regularMinutes + row.otMinutes; // total non-DT minutes
  const rawOt = rawReg - (rawReg - totalOtMinutes); // ... this gets complex

  // Simpler: store raw reg + raw ot on initial calc, derive from those
  // For now, the page should store the raw values and recalculate from them
  return { ...row, otOverride: override };
}
```

Note: The `recalcRowWithOverride` function is a placeholder — the page component will store raw minutes per staff and recalculate client-side when the toggle changes. The full recalc logic is in `calculatePayrollRows`.

**Step 2: Verify**

This is a pure function. Can be tested by calling with mock data in the browser console or a simple test.

**Step 3: Commit**

```
feat: add payroll calculation utility with OT override logic
```

---

### Task 6: Create the Payroll Review page shell

**Files:**
- Create: `app/payroll-review/page.tsx`
- Modify: `components/layout/sidebar.tsx` — add nav item

**Step 1: Create page with week selector and calculate button**

The page should:
1. Use `useOrgSettings()` to get `weekStartDay` and `otThresholdMinutes`
2. Manage `selectedWeekStart` state using `startOfWeek(new Date(), { weekStartsOn })`
3. Show week range header: "Fri 28 Feb – Thu 6 Mar 2026"
4. Week navigation: prev/next arrows and "Current Week" button
5. "Calculate Week" button that triggers data fetching and calculation
6. Summary stats bar: total staff, total payroll cost, flagged count
7. Empty state before calculation

Use the week navigation pattern from `WeeklySummary.tsx` lines 417-446.

**Step 2: Add sidebar nav item**

In `components/layout/sidebar.tsx`, add after the Staff nav item (~line 115):

```typescript
{ name: 'Payroll Review', href: '/payroll-review', icon: DollarSign },
```

Import `DollarSign` from lucide-react.

**Step 3: Update Staff page Payroll tab**

In `app/staff/page.tsx` line 64, change the router.push target from `/staff/payroll` to `/payroll-review`.

**Step 4: Verify**

Navigate to `/payroll-review`. Confirm the page renders with the week selector showing the correct Friday-to-Thursday range. Confirm sidebar link works.

**Step 5: Commit**

```
feat: add payroll review page shell with week selector
```

---

### Task 7: Build the staff payroll table

**Files:**
- Modify: `app/payroll-review/page.tsx`

**Step 1: Implement the Calculate Week flow**

When "Calculate Week" is clicked:
1. Fetch all data in parallel: `fetchStaffForPayroll()`, `fetchWeeklyHours(start, end)`, `fetchWeeklyPiecework(start, end)`, `fetchActiveSupportLinks()`, `fetchPayrollRecords(weekStartDate)`
2. Call `calculatePayrollRows()` with all the data
3. Store the result in state as `payrollRows`

**Step 2: Render the staff table**

Table columns:
- ☐ (checkbox for bulk selection, disabled for approved/paid rows)
- Staff (name)
- Job
- Reg Hours
- OT Hours (amber text if flagged)
- DT Hours
- Hourly Total (R formatted)
- Piecework Gross (R formatted)
- Support Ded. (R formatted, only show if > 0)
- Piecework Net (R formatted)
- Final Pay (R formatted, green highlight on the winning column — hourly or piecework)
- OT Override (Switch toggle, disabled for approved/paid)
- Status (Badge: pending=yellow, approved=green, paid=blue)

Rows flagged for OT review get an amber left border or background tint.

**Step 3: Implement OT override toggle**

When the Switch is toggled:
- Recalculate that row's hours and totals client-side using the raw minutes stored per-staff
- Update the `payrollRows` state
- The row's hourly total and final pay update instantly

**Step 4: Implement bulk selection**

- "Select all" checkbox in the header (only selects pending rows)
- Track `selectedIds` in state
- "Approve Selected" and "Mark Paid" buttons appear when rows are selected

**Step 5: Verify**

Open `/payroll-review`, click Calculate Week. Confirm:
- All active staff appear with hours, piecework, and final pay
- Flagged rows are highlighted
- OT toggle works and recalculates
- Checkboxes work

**Step 6: Commit**

```
feat: build payroll review staff table with OT override
```

---

### Task 8: Implement save, approve, and mark-paid actions

**Files:**
- Modify: `app/payroll-review/page.tsx`

**Step 1: Save calculated payroll to database**

After calculation (or as part of it), upsert all rows to `staff_weekly_payroll` using `upsertPayrollRecords()`. Include `org_id` from `getOrgId(user)`.

Map from `PayrollRow` to the DB schema:
```typescript
{
  staff_id: row.staff_id,
  week_start_date: formatISO(weekStart, { representation: 'date' }),
  week_end_date: formatISO(weekEnd, { representation: 'date' }),
  regular_hours: row.regularHours,
  overtime_hours: row.otHours,
  doubletime_hours: row.dtHours,
  hourly_wage_total: row.hourlyTotal,
  piece_work_total: row.pieceworkNet,
  final_payment: row.finalPay,
  status: 'pending',
  org_id: orgId,
}
```

**Step 2: Approve Selected**

Call `updatePayrollStatus(selectedPayrollIds, 'approved')`. Refresh the data. Show toast.

**Step 3: Mark Paid**

Call `updatePayrollStatus(selectedPayrollIds, 'paid', formatISO(new Date(), { representation: 'date' }))`. Refresh. Toast.

**Step 4: Disable interactions for non-pending rows**

Approved/paid rows: disable checkbox, disable OT toggle, grey out the row slightly.

**Step 5: Verify**

Calculate, approve a few rows, mark some as paid. Reload the page, select the same week — confirm the statuses persisted.

**Step 6: Commit**

```
feat: add save, approve, and mark-paid actions to payroll review
```

---

### Task 9: Build the staff detail drill-down panel

**Files:**
- Create: `components/payroll-review/PayrollDetailPanel.tsx`
- Modify: `app/payroll-review/page.tsx` — wire up the panel

**Step 1: Create the panel component**

A Sheet (side panel) that opens when a staff row is clicked. Two tabs:

**Hours Tab:**
Query `time_daily_summary` for this staff + week. Show a table:

| Day | Date | Clock In | Clock Out | Hours | Regular | OT | DT |
|-----|------|----------|-----------|-------|---------|----|----|

Format clock times with `formatTimeToSAST()` from `lib/utils/timezone`. Show weekly totals row at bottom.

**Piecework Tab:**
Query `staff_piecework_earnings` for this staff + week. Show a table:

| Job Card | Product | Qty | Rate | Override | Earned |
|----------|---------|-----|------|----------|--------|

Show totals: gross piecework, support deduction (if any), net piecework.

For the product name, join through `job_card_items.product_id → products.name`. Or include it in the piecework earnings view if feasible.

**Step 2: Wire up to the page**

In the payroll review page:
- Add `selectedStaffId` state
- On row click (not on checkbox/toggle), set `selectedStaffId`
- Render `<PayrollDetailPanel staffId={selectedStaffId} weekStart={start} weekEnd={end} onClose={() => setSelectedStaffId(null)} />`

**Step 3: Verify**

Click a staff row. Panel opens with hours and piecework tabs. Verify data matches the summary row.

**Step 4: Commit**

```
feat: add payroll detail drill-down panel with hours and piecework tabs
```

---

### Task 10: /batch sweep — replace hardcoded weekStartsOn across codebase

**Files to update (10 occurrences across 6 files):**
- `app/orders/page.tsx:1930-1931` — change `weekStartsOn: 1` to use org setting
- `app/staff/payroll/page.tsx:33,109` — change `weekStartsOn: 1`
- `components/features/staff/WeeklySummary.tsx:159-160` — change `weekStartsOn: 5`
- `components/features/staff/StaffReports.tsx:197-198` — change `weekStartsOn: 5`
- `components/labor-planning/week-strip.tsx:41` — change `weekStartsOn: 1`

**Note:** `components/ui/calendar.tsx:52` uses `weekStartsOn={0}` (Sunday) for the calendar widget display. This is a UI convention and may be intentionally different — leave it unless the user requests otherwise.

**Approach:** Each component already renders client-side. Add `const { weekStartDay } = useOrgSettings();` and replace the hardcoded number. For the old payroll page, this is a low-priority change since it's being replaced, but keeping it consistent avoids confusion if anyone opens it.

**Step 1: Update all files**

For each file, add `import { useOrgSettings } from '@/hooks/use-org-settings';` and replace the hardcoded value.

**Step 2: Verify**

Open each affected page and confirm the week boundaries match the org setting (Friday start).

**Step 3: Commit**

```
refactor: replace hardcoded weekStartsOn with org setting across codebase
```

---

### Task 11: Tighten staff_weekly_payroll RLS policies

**Files:**
- Migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

```sql
-- Drop existing overly-permissive policies
DROP POLICY IF EXISTS "Allow authenticated users to read staff_weekly_payroll" ON staff_weekly_payroll;
DROP POLICY IF EXISTS "Allow authenticated users to insert staff_weekly_payroll" ON staff_weekly_payroll;
DROP POLICY IF EXISTS "Allow authenticated users to update staff_weekly_payroll" ON staff_weekly_payroll;
DROP POLICY IF EXISTS "Allow authenticated users to delete staff_weekly_payroll" ON staff_weekly_payroll;

-- Create org-scoped policies
CREATE POLICY "payroll_select_org" ON staff_weekly_payroll
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "payroll_insert_org" ON staff_weekly_payroll
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "payroll_update_org" ON staff_weekly_payroll
  FOR UPDATE USING (public.is_org_member(org_id));

CREATE POLICY "payroll_delete_org" ON staff_weekly_payroll
  FOR DELETE USING (public.is_org_member(org_id));
```

**Step 2: Verify**

Run `mcp__supabase__get_advisors` (security). Confirm no warnings for `staff_weekly_payroll`.

Test: fetch payroll records from the browser — confirm data still loads for the logged-in org.

**Step 3: Commit**

```
fix: tighten staff_weekly_payroll RLS to org-scoped policies
```

---

### Task 12: Browser verification and TypeScript check

**Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Confirm no new errors (pre-existing todo API errors are OK).

**Step 2: Full browser walkthrough**

1. Go to `/settings` → verify Payroll Settings card, change week start day, save
2. Go to `/payroll-review` → verify week shows correct range based on setting
3. Click "Calculate Week" → verify all staff appear with hours and piecework
4. Check flagged OT rows (amber highlight) → toggle override → verify recalculation
5. Click a staff row → verify drill-down panel with Hours and Piecework tabs
6. Select rows → Approve → verify status changes to approved
7. Select approved rows → Mark Paid → verify status changes to paid
8. Reload → verify persistence

**Step 3: Run security advisors**

```
mcp__supabase__get_advisors (security)
```

**Step 4: Commit any fixes**

---

### Task 13: TODO — Remove old payroll page (deferred)

**Files:**
- `app/staff/payroll/page.tsx` — to be deleted once new page is verified in production
- `app/staff/page.tsx` — remove the old payroll tab redirect

**This task is intentionally deferred.** Add a note to `docs/overview/todo-index.md`:

```markdown
- [ ] Remove old `/staff/payroll` page after `/payroll-review` is verified in production
```

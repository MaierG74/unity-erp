# Multi-Day Working Hours Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix job completion to correctly calculate working hours across multiple days, weekends, and pauses.

**Architecture:** Pure TypeScript function for client-side preview + Postgres helper function for authoritative server-side storage. Complete dialog gains date+time inputs. Both use the same day-by-day algorithm: iterate calendar days, sum schedule hours, subtract breaks and pauses.

**Tech Stack:** TypeScript (Node test runner), Postgres/plpgsql, React (Radix Dialog), Supabase RPC, TanStack Query.

---

### Task 1: Create `calculateWorkingMinutes` — Tests

**Files:**
- Create: `tests/working-hours.test.ts`

**Step 1: Write the test file with all key scenarios**

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';

const importModule = async () => {
  const mod = await import('../lib/working-hours.js');
  return mod;
};

interface DaySchedule {
  dayGroup: string;
  startMinutes: number;
  endMinutes: number;
  breaks: { label: string; startMinutes: number; endMinutes: number }[];
  isActive: boolean;
}

interface PauseEvent {
  pausedAt: Date;
  resumedAt: Date | null;
}

interface ShiftOverride {
  overrideDate: string;
  extendedEndMinutes: number;
}

// Standard Mon-Fri schedule: 7:00-17:00 with 30min lunch at 12:00
const STANDARD_SCHEDULES: DaySchedule[] = [
  { dayGroup: 'mon-thu', startMinutes: 420, endMinutes: 1020, breaks: [{ label: 'Lunch', startMinutes: 720, endMinutes: 750 }], isActive: true },
  { dayGroup: 'fri', startMinutes: 420, endMinutes: 840, breaks: [{ label: 'Lunch', startMinutes: 720, endMinutes: 750 }], isActive: true },
  { dayGroup: 'sat-sun', startMinutes: 420, endMinutes: 720, breaks: [], isActive: false },
];

test('same-day job: 8:00-12:00 Mon = 4h = 240 min (no breaks hit)', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T08:00:00'), // Monday
    new Date('2026-03-02T12:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 240);
  assert.equal(result.workingDays, 1);
  assert.equal(result.pauseMinutes, 0);
});

test('same-day job spanning lunch: 8:00-14:00 Mon = 5h30m = 330 min', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T08:00:00'),
    new Date('2026-03-02T14:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 330); // 360 - 30 lunch
  assert.equal(result.workingDays, 1);
});

test('full working day Mon = 570 min (10h - 30min lunch)', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T07:00:00'),
    new Date('2026-03-02T17:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 570);
});

test('Friday-to-Monday: Fri 12:00 to Mon 12:30', async () => {
  const { calculateWorkingMinutes } = await importModule();
  // Fri: 12:00-14:00 = 2h (120 min, no lunch — lunch 12:00-12:30 overlaps, so 120 - 30 = 90 min wait...)
  // Actually: Fri schedule is 7:00-14:00, lunch 12:00-12:30
  // Fri work window: 12:00-14:00 = 120 min, minus 30 min lunch overlap (12:00-12:30) = 90 min
  // Sat: inactive = 0
  // Sun: inactive = 0
  // Mon: 7:00-12:30 = 330 min, minus 0 lunch (lunch at 12:00-12:30 overlaps 12:00-12:30 = 30 min) = 300 min
  // Total: 90 + 300 = 390 min = 6h 30m
  const result = calculateWorkingMinutes(
    new Date('2026-02-27T12:00:00'), // Friday
    new Date('2026-03-02T12:30:00'), // Monday
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 390);
  assert.equal(result.workingDays, 2);
});

test('start before shift clamps to shift start', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T05:00:00'), // 5 AM, before 7 AM shift
    new Date('2026-03-02T09:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 120); // 7:00-9:00
});

test('end after shift clamps to shift end', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T15:00:00'),
    new Date('2026-03-02T19:00:00'), // 7 PM, after 5 PM shift
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 120); // 15:00-17:00
});

test('job entirely outside working hours = 0 min', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T18:00:00'),
    new Date('2026-03-02T20:00:00'),
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 0);
  assert.equal(result.workingDays, 0);
});

test('weekend-only span = 0 min', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-02-28T08:00:00'), // Saturday
    new Date('2026-03-01T16:00:00'), // Sunday
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 0);
  assert.equal(result.workingDays, 0);
});

test('pause deducted from working hours', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const pauses = [
    { pausedAt: new Date('2026-03-02T09:00:00'), resumedAt: new Date('2026-03-02T10:00:00') }, // 1h pause
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T08:00:00'),
    new Date('2026-03-02T12:00:00'),
    STANDARD_SCHEDULES, pauses, [],
  );
  assert.equal(result.totalMinutes, 180); // 240 - 60 pause
  assert.equal(result.pauseMinutes, 60);
});

test('pause spanning non-working hours only counts working overlap', async () => {
  const { calculateWorkingMinutes } = await importModule();
  // Pause from Fri 13:00 to Mon 8:00 — only Fri 13:00-14:00 is working time
  const pauses = [
    { pausedAt: new Date('2026-02-27T13:00:00'), resumedAt: new Date('2026-03-02T08:00:00') },
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-02-27T12:00:00'), // Fri 12:00
    new Date('2026-03-02T12:00:00'), // Mon 12:00
    STANDARD_SCHEDULES, pauses, [],
  );
  // Without pause: Fri 90 min + Mon 270 min (7:00-12:00 minus lunch 12:00-12:00=0... wait:
  // Mon 7:00-12:00 = 300 min, no lunch overlap (lunch at 12:00, end at 12:00 so no overlap) = 300 min
  // Fri 12:00-14:00 = 120 - 30 lunch (12:00-12:30) = 90 min
  // Total without pause: 390 min
  // Pause eats: Fri 13:00-14:00 = 60 min of Fri working, Mon 7:00-8:00 = 60 min of Mon working
  // Total with pause: 390 - 60 - 60 = 270 min
  assert.equal(result.totalMinutes, 270);
  assert.equal(result.pauseMinutes, 120);
});

test('shift override extends end time', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const overrides = [
    { overrideDate: '2026-03-02', extendedEndMinutes: 1140 }, // extend to 19:00
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T16:00:00'),
    new Date('2026-03-02T19:00:00'),
    STANDARD_SCHEDULES, [], overrides,
  );
  assert.equal(result.totalMinutes, 180); // 16:00-19:00
});

test('multi-day: Mon-Wed full days = 3 × 570 = 1710 min', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T07:00:00'), // Monday
    new Date('2026-03-04T17:00:00'), // Wednesday
    STANDARD_SCHEDULES, [], [],
  );
  assert.equal(result.totalMinutes, 1710);
  assert.equal(result.workingDays, 3);
});

test('active weekends are counted', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const schedules = [
    ...STANDARD_SCHEDULES.filter(s => s.dayGroup !== 'sat-sun'),
    { dayGroup: 'sat-sun', startMinutes: 420, endMinutes: 720, breaks: [], isActive: true }, // Sat-Sun 7:00-12:00
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-02-28T07:00:00'), // Saturday
    new Date('2026-02-28T12:00:00'),
    schedules, [], [],
  );
  assert.equal(result.totalMinutes, 300); // 5h
  assert.equal(result.workingDays, 1);
});

test('open pause (no resumedAt) treated as paused until end', async () => {
  const { calculateWorkingMinutes } = await importModule();
  const pauses = [
    { pausedAt: new Date('2026-03-02T10:00:00'), resumedAt: null },
  ];
  const result = calculateWorkingMinutes(
    new Date('2026-03-02T08:00:00'),
    new Date('2026-03-02T12:00:00'),
    STANDARD_SCHEDULES, pauses, [],
  );
  assert.equal(result.totalMinutes, 120); // 8:00-10:00 only
  assert.equal(result.pauseMinutes, 120); // 10:00-12:00
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/working-hours.test.ts`
Expected: All tests FAIL (module not found)

**Step 3: Commit**

```bash
git add tests/working-hours.test.ts
git commit -m "test: add working hours calculation test suite"
```

---

### Task 2: Implement `calculateWorkingMinutes`

**Files:**
- Create: `lib/working-hours.ts`

**Step 1: Implement the core function**

```typescript
import type { ScheduleBreak } from '@/types/work-schedule';

export interface DaySchedule {
  dayGroup: string;
  startMinutes: number;
  endMinutes: number;
  breaks: ScheduleBreak[];
  isActive: boolean;
}

export interface PauseEvent {
  pausedAt: Date;
  resumedAt: Date | null;
}

export interface ShiftOverride {
  overrideDate: string; // YYYY-MM-DD
  extendedEndMinutes: number;
}

export interface WorkingMinutesResult {
  totalMinutes: number;
  workingDays: number;
  pauseMinutes: number;
}

/** Map JS day-of-week (0=Sun) to work_schedules day_group */
function getDayGroupForDate(date: Date): string {
  const dow = date.getDay();
  if (dow >= 1 && dow <= 4) return 'mon-thu';
  if (dow === 5) return 'fri';
  return 'sat-sun';
}

/** Format a Date as YYYY-MM-DD (local) */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calculate minutes from midnight for a Date */
function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Count overlap in minutes between two ranges [aStart, aEnd) and [bStart, bEnd) */
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
}

/**
 * Calculate net working minutes between two timestamps, accounting for:
 * - Per-day work schedules (different hours for different day groups)
 * - Inactive days (weekends if configured as inactive)
 * - Scheduled breaks per day
 * - Pause events on the assignment
 * - Shift overrides (overtime extensions) per date
 */
export function calculateWorkingMinutes(
  start: Date,
  end: Date,
  schedules: DaySchedule[],
  pauses: PauseEvent[],
  overrides: ShiftOverride[],
): WorkingMinutesResult {
  if (end <= start) return { totalMinutes: 0, workingDays: 0, pauseMinutes: 0 };

  const scheduleMap = new Map<string, DaySchedule>();
  for (const s of schedules) scheduleMap.set(s.dayGroup, s);

  const overrideMap = new Map<string, number>();
  for (const o of overrides) overrideMap.set(o.overrideDate, o.extendedEndMinutes);

  // Default fallback schedule
  const fallback: DaySchedule = {
    dayGroup: 'default',
    startMinutes: 420,
    endMinutes: 1020,
    breaks: [],
    isActive: true,
  };

  let totalMinutes = 0;
  let totalPauseMinutes = 0;
  let workingDays = 0;

  // Iterate each calendar day from start date to end date
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);

  while (current <= endDay) {
    const dateKey = toDateKey(current);
    const dayGroup = getDayGroupForDate(current);
    const schedule = scheduleMap.get(dayGroup) ?? fallback;

    if (!schedule.isActive) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    const shiftStart = schedule.startMinutes;
    const shiftEnd = overrideMap.has(dateKey)
      ? overrideMap.get(dateKey)!
      : schedule.endMinutes;

    // Determine the work window for this day
    const isFirstDay = toDateKey(start) === dateKey;
    const isLastDay = toDateKey(end) === dateKey;

    let windowStart = shiftStart;
    let windowEnd = shiftEnd;

    if (isFirstDay) windowStart = Math.max(shiftStart, minutesFromMidnight(start));
    if (isLastDay) windowEnd = Math.min(shiftEnd, minutesFromMidnight(end));

    if (windowEnd <= windowStart) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    let dayMinutes = windowEnd - windowStart;

    // Subtract breaks
    for (const b of schedule.breaks) {
      dayMinutes -= overlapMinutes(windowStart, windowEnd, b.startMinutes, b.endMinutes);
    }

    // Subtract pauses that overlap this day's work window
    let dayPauseMinutes = 0;
    for (const p of pauses) {
      const pauseEnd = p.resumedAt ?? end;
      // Convert pause timestamps to minutes-from-midnight on this day
      const pauseStartDate = new Date(p.pausedAt);
      const pauseEndDate = new Date(pauseEnd);

      // Check if pause overlaps this calendar day at all
      const dayStart = new Date(current);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(current);
      dayEnd.setHours(23, 59, 59, 999);

      if (pauseEndDate < dayStart || pauseStartDate > dayEnd) continue;

      // Clamp pause to this day
      const pStartMins = (toDateKey(pauseStartDate) === dateKey)
        ? minutesFromMidnight(pauseStartDate)
        : 0;
      const pEndMins = (toDateKey(pauseEndDate) === dateKey)
        ? minutesFromMidnight(pauseEndDate)
        : 1440;

      // Overlap of pause with the work window (already break-adjusted bounds don't matter;
      // we subtract from the gross window and breaks+pauses are independent deductions)
      const pauseOverlap = overlapMinutes(windowStart, windowEnd, pStartMins, pEndMins);

      // But don't double-count pause time that falls in breaks
      let pauseInBreaks = 0;
      for (const b of schedule.breaks) {
        // Overlap of (pause ∩ work window) ∩ break
        const tripleStart = Math.max(windowStart, pStartMins, b.startMinutes);
        const tripleEnd = Math.min(windowEnd, pEndMins, b.endMinutes);
        if (tripleEnd > tripleStart) pauseInBreaks += tripleEnd - tripleStart;
      }

      dayPauseMinutes += pauseOverlap - pauseInBreaks;
    }

    dayMinutes -= dayPauseMinutes;
    dayMinutes = Math.max(0, dayMinutes);

    if (dayMinutes > 0) workingDays++;
    totalMinutes += dayMinutes;
    totalPauseMinutes += dayPauseMinutes;

    current.setDate(current.getDate() + 1);
  }

  return { totalMinutes, workingDays, pauseMinutes: totalPauseMinutes };
}
```

**Step 2: Run tests to verify they pass**

Run: `npx tsx --test tests/working-hours.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add lib/working-hours.ts
git commit -m "feat: add multi-day working hours calculation"
```

---

### Task 3: Create Postgres `calculate_working_minutes` helper

**Files:**
- Create migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with name `add_calculate_working_minutes_fn` and the following SQL:

```sql
-- Postgres equivalent of lib/working-hours.ts calculateWorkingMinutes
-- Returns net working minutes between two timestamps for an org + assignment
CREATE OR REPLACE FUNCTION calculate_working_minutes(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_org_id UUID,
  p_assignment_id INTEGER DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_current DATE;
  v_end_date DATE;
  v_dow INTEGER;
  v_day_group TEXT;
  v_shift_start INTEGER;
  v_shift_end INTEGER;
  v_is_active BOOLEAN;
  v_breaks JSONB;
  v_override_end INTEGER;
  v_window_start INTEGER;
  v_window_end INTEGER;
  v_day_minutes INTEGER;
  v_total INTEGER := 0;
  v_start_local TIMESTAMP;
  v_end_local TIMESTAMP;
  v_start_mins INTEGER;
  v_end_mins INTEGER;
  v_b JSONB;
  v_b_start INTEGER;
  v_b_end INTEGER;
  v_overlap INTEGER;
  -- Pause vars
  v_pause RECORD;
  v_p_start_mins INTEGER;
  v_p_end_mins INTEGER;
  v_pause_overlap INTEGER;
  v_pause_in_breaks INTEGER;
  v_day_pause INTEGER;
  v_tri_start INTEGER;
  v_tri_end INTEGER;
BEGIN
  IF p_end <= p_start THEN RETURN 0; END IF;

  v_start_local := p_start AT TIME ZONE 'Africa/Johannesburg';
  v_end_local := p_end AT TIME ZONE 'Africa/Johannesburg';
  v_current := v_start_local::date;
  v_end_date := v_end_local::date;

  WHILE v_current <= v_end_date LOOP
    -- Map day of week to day_group
    v_dow := EXTRACT(isodow FROM v_current)::integer; -- 1=Mon..7=Sun
    v_day_group := CASE
      WHEN v_dow BETWEEN 1 AND 4 THEN 'mon-thu'
      WHEN v_dow = 5 THEN 'fri'
      ELSE 'sat-sun'
    END;

    -- Look up schedule
    SELECT ws.start_minutes, ws.end_minutes, ws.is_active, ws.breaks
    INTO v_shift_start, v_shift_end, v_is_active, v_breaks
    FROM work_schedules ws
    WHERE ws.org_id = p_org_id AND ws.day_group = v_day_group AND ws.is_active = true
    LIMIT 1;

    -- Fallback if no schedule
    IF NOT FOUND THEN
      v_shift_start := 420;
      v_shift_end := 1020;
      v_is_active := true;
      v_breaks := '[]'::jsonb;
    END IF;

    IF NOT v_is_active THEN
      v_current := v_current + 1;
      CONTINUE;
    END IF;

    -- Check for shift override
    SELECT so.extended_end_minutes INTO v_override_end
    FROM shift_overrides so
    WHERE so.org_id = p_org_id AND so.override_date = v_current;

    IF v_override_end IS NOT NULL THEN
      v_shift_end := v_override_end;
    END IF;

    -- Determine work window
    v_window_start := v_shift_start;
    v_window_end := v_shift_end;

    -- First day: clamp start
    IF v_current = v_start_local::date THEN
      v_start_mins := EXTRACT(hour FROM v_start_local)::integer * 60
                    + EXTRACT(minute FROM v_start_local)::integer;
      v_window_start := GREATEST(v_shift_start, v_start_mins);
    END IF;

    -- Last day: clamp end
    IF v_current = v_end_local::date THEN
      v_end_mins := EXTRACT(hour FROM v_end_local)::integer * 60
                  + EXTRACT(minute FROM v_end_local)::integer;
      v_window_end := LEAST(v_shift_end, v_end_mins);
    END IF;

    IF v_window_end <= v_window_start THEN
      v_current := v_current + 1;
      CONTINUE;
    END IF;

    v_day_minutes := v_window_end - v_window_start;

    -- Subtract breaks
    FOR v_b IN SELECT * FROM jsonb_array_elements(COALESCE(v_breaks, '[]'::jsonb)) LOOP
      v_b_start := (v_b->>'startMinutes')::integer;
      v_b_end := (v_b->>'endMinutes')::integer;
      v_overlap := GREATEST(0, LEAST(v_window_end, v_b_end) - GREATEST(v_window_start, v_b_start));
      v_day_minutes := v_day_minutes - v_overlap;
    END LOOP;

    -- Subtract pauses (if assignment provided)
    v_day_pause := 0;
    IF p_assignment_id IS NOT NULL THEN
      FOR v_pause IN
        SELECT
          ape.paused_at AT TIME ZONE 'Africa/Johannesburg' AS paused_local,
          COALESCE(ape.resumed_at, p_end) AT TIME ZONE 'Africa/Johannesburg' AS resumed_local
        FROM assignment_pause_events ape
        WHERE ape.assignment_id = p_assignment_id
          AND (ape.resumed_at IS NULL OR ape.resumed_at > p_start)
          AND ape.paused_at < p_end
      LOOP
        -- Clamp pause to this day
        IF v_pause.paused_local::date = v_current THEN
          v_p_start_mins := EXTRACT(hour FROM v_pause.paused_local)::integer * 60
                          + EXTRACT(minute FROM v_pause.paused_local)::integer;
        ELSE
          v_p_start_mins := 0;
        END IF;

        IF v_pause.resumed_local::date = v_current THEN
          v_p_end_mins := EXTRACT(hour FROM v_pause.resumed_local)::integer * 60
                        + EXTRACT(minute FROM v_pause.resumed_local)::integer;
        ELSE
          v_p_end_mins := 1440;
        END IF;

        -- Overlap of pause with work window
        v_pause_overlap := GREATEST(0,
          LEAST(v_window_end, v_p_end_mins) - GREATEST(v_window_start, v_p_start_mins));

        -- Don't double-count pause time in breaks
        v_pause_in_breaks := 0;
        FOR v_b IN SELECT * FROM jsonb_array_elements(COALESCE(v_breaks, '[]'::jsonb)) LOOP
          v_b_start := (v_b->>'startMinutes')::integer;
          v_b_end := (v_b->>'endMinutes')::integer;
          v_tri_start := GREATEST(v_window_start, v_p_start_mins, v_b_start);
          v_tri_end := LEAST(v_window_end, v_p_end_mins, v_b_end);
          IF v_tri_end > v_tri_start THEN
            v_pause_in_breaks := v_pause_in_breaks + (v_tri_end - v_tri_start);
          END IF;
        END LOOP;

        v_day_pause := v_day_pause + v_pause_overlap - v_pause_in_breaks;
      END LOOP;
    END IF;

    v_day_minutes := GREATEST(0, v_day_minutes - v_day_pause);
    v_total := v_total + v_day_minutes;

    v_current := v_current + 1;
  END LOOP;

  RETURN v_total;
END;
$$;
```

**Step 2: Verify the function exists**

Run SQL: `SELECT calculate_working_minutes(now() - interval '3 days', now(), '<org_id>', NULL);`
Expected: Returns an integer > 0

**Step 3: Commit** (migration file auto-created by Supabase MCP)

---

### Task 4: Update `complete_assignment_with_card` RPC

**Files:**
- Create migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with name `use_working_minutes_in_complete_rpc`:

```sql
CREATE OR REPLACE FUNCTION public.complete_assignment_with_card(
  p_assignment_id integer,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_actual_start timestamptz DEFAULT NULL,
  p_actual_end timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id UUID;
  v_job_status TEXT;
  v_staff_id INTEGER;
  v_order_id INTEGER;
  v_job_id INTEGER;
  v_job_card_id INTEGER;
  v_started_at TIMESTAMPTZ;
  v_start_minutes INTEGER;
  v_end_minutes INTEGER;
  v_actual_start TIMESTAMPTZ;
  v_actual_end TIMESTAMPTZ;
  v_duration INTEGER;
  v_now TIMESTAMPTZ := now();
  v_item JSONB;
BEGIN
  SELECT o.org_id, lpa.job_status, lpa.staff_id, lpa.order_id, lpa.job_id,
         lpa.started_at, lpa.start_minutes
  INTO v_org_id, v_job_status, v_staff_id, v_order_id, v_job_id, v_started_at, v_start_minutes
  FROM labor_plan_assignments lpa
  JOIN orders o ON o.order_id = lpa.order_id
  WHERE lpa.assignment_id = p_assignment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Assignment % not found or has no linked order', p_assignment_id;
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  IF v_job_status NOT IN ('issued', 'in_progress', 'on_hold') THEN
    RAISE EXCEPTION 'Cannot complete assignment with status %', v_job_status;
  END IF;

  -- Close any open pause events
  UPDATE assignment_pause_events
  SET resumed_at = v_now
  WHERE assignment_id = p_assignment_id AND resumed_at IS NULL;

  -- Determine actual times
  v_actual_start := COALESCE(p_actual_start, v_started_at, v_now);
  v_actual_end := COALESCE(p_actual_end, v_now);

  -- Convert to minutes from midnight for the assignment record
  v_start_minutes := EXTRACT(hour FROM v_actual_start AT TIME ZONE 'Africa/Johannesburg') * 60
                   + EXTRACT(minute FROM v_actual_start AT TIME ZONE 'Africa/Johannesburg');
  v_end_minutes := EXTRACT(hour FROM v_actual_end AT TIME ZONE 'Africa/Johannesburg') * 60
                 + EXTRACT(minute FROM v_actual_end AT TIME ZONE 'Africa/Johannesburg');

  -- Calculate working minutes using the multi-day aware function
  v_duration := calculate_working_minutes(v_actual_start, v_actual_end, v_org_id, p_assignment_id);

  -- Update the assignment
  UPDATE labor_plan_assignments SET
    job_status = 'completed',
    completed_at = v_now,
    actual_start_minutes = v_start_minutes,
    actual_end_minutes = v_end_minutes,
    actual_duration_minutes = v_duration,
    completion_notes = p_notes,
    updated_at = v_now
  WHERE assignment_id = p_assignment_id;

  -- Find linked job card
  SELECT jk.job_card_id INTO v_job_card_id
  FROM job_cards jk
  WHERE jk.order_id = v_order_id AND jk.staff_id = v_staff_id
  ORDER BY jk.created_at DESC
  LIMIT 1;

  -- If job card exists, update items and mark complete
  IF v_job_card_id IS NOT NULL THEN
    IF jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        UPDATE job_card_items
        SET completed_quantity = (v_item->>'completed_quantity')::INTEGER,
            status = 'completed',
            completion_time = v_now
        WHERE item_id = (v_item->>'item_id')::INTEGER
          AND job_card_id = v_job_card_id;
      END LOOP;
    END IF;

    UPDATE job_card_items
    SET completed_quantity = quantity,
        status = 'completed',
        completion_time = v_now
    WHERE job_card_id = v_job_card_id
      AND status != 'completed';

    UPDATE job_cards
    SET status = 'completed',
        completion_date = v_now::date
    WHERE job_card_id = v_job_card_id;
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', p_assignment_id,
    'job_card_id', v_job_card_id,
    'completed_at', v_now,
    'actual_duration_minutes', v_duration
  );
END;
$$;
```

**Step 2: Verify**

Run SQL: `SELECT proargnames FROM pg_proc WHERE proname = 'complete_assignment_with_card';`
Expected: Shows the parameter names, confirming the function was replaced.

**Step 3: Commit** (migration file auto-created)

---

### Task 5: Update Complete Dialog — fetch all schedules and pauses

**Files:**
- Modify: `components/factory-floor/complete-job-dialog.tsx`

**Step 1: Add queries for all work schedules and pause events**

At the top of the file, add imports:
```typescript
import { calculateWorkingMinutes } from '@/lib/working-hours';
import type { DaySchedule, PauseEvent, ShiftOverride } from '@/lib/working-hours';
```

Inside the component, add two new queries:
```typescript
// Fetch ALL work schedules (all day groups)
const { data: allSchedules } = useQuery({
  queryKey: ['work-schedules', 'active'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('work_schedules')
      .select('day_group, start_minutes, end_minutes, breaks, is_active')
      .eq('is_active', true);
    if (error) throw error;
    return (data ?? []) as DaySchedule[];
  },
  enabled: open,
});

// Fetch pause events for this assignment
const { data: pauseEvents } = useQuery({
  queryKey: ['pause-events', job?.assignment_id],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('assignment_pause_events')
      .select('paused_at, resumed_at')
      .eq('assignment_id', job!.assignment_id);
    if (error) throw error;
    return (data ?? []).map((p: { paused_at: string; resumed_at: string | null }) => ({
      pausedAt: new Date(p.paused_at),
      resumedAt: p.resumed_at ? new Date(p.resumed_at) : null,
    })) as PauseEvent[];
  },
  enabled: open && !!job?.assignment_id,
});

// Fetch shift overrides for the date range
const { data: shiftOverrides } = useQuery({
  queryKey: ['shift-overrides', startDate, endDate],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('shift_overrides')
      .select('override_date, extended_end_minutes')
      .gte('override_date', startDate)
      .lte('override_date', endDate);
    if (error) throw error;
    return (data ?? []).map((o: { override_date: string; extended_end_minutes: number }) => ({
      overrideDate: o.override_date,
      extendedEndMinutes: o.extended_end_minutes,
    })) as ShiftOverride[];
  },
  enabled: open && !!startDate && !!endDate,
});
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors from this file

**Step 3: Commit**

```bash
git add components/factory-floor/complete-job-dialog.tsx
git commit -m "feat: fetch work schedules and pause events in complete dialog"
```

---

### Task 6: Update Complete Dialog — date+time inputs and new duration calc

**Files:**
- Modify: `components/factory-floor/complete-job-dialog.tsx`

This task replaces the time-only inputs with date+time inputs and swaps the old `actualDurationMinutes` memo for `calculateWorkingMinutes`.

**Step 1: Add date state and replace the duration memo**

Add state for dates alongside the existing time state:
```typescript
const [startDate, setStartDate] = useState(''); // YYYY-MM-DD
const [endDate, setEndDate] = useState('');     // YYYY-MM-DD
```

Update the `useEffect` that pre-fills times (currently lines 85-93) to also set dates:
```typescript
useEffect(() => {
  if (open && job) {
    const startTs = job.started_at ?? job.issued_at;
    const startDt = startTs ? new Date(startTs) : new Date();
    setStartDate(toDateKey(startDt));
    setActualStart(formatTimestampToInput(startTs));

    const now = new Date();
    setEndDate(toDateKey(now));
    setActualEnd(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
    setNotes('');
    setQuantities({});
  }
}, [open, job?.assignment_id]);
```

Add a helper `toDateKey`:
```typescript
function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
}
```

Replace the `actualDurationMinutes` / `endIsNextDay` memo (lines 106-128) with:
```typescript
const workResult = useMemo(() => {
  if (!actualStart || !actualEnd || !startDate || !endDate) {
    return { totalMinutes: 0, workingDays: 0, pauseMinutes: 0 };
  }
  const [sh, sm] = actualStart.split(':').map(Number);
  const [eh, em] = actualEnd.split(':').map(Number);
  const s = new Date(`${startDate}T${actualStart}:00`);
  const e = new Date(`${endDate}T${actualEnd}:00`);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) {
    return { totalMinutes: 0, workingDays: 0, pauseMinutes: 0 };
  }
  const schedules = (allSchedules ?? []).map(s => ({ ...s, breaks: s.breaks ?? [] }));
  return calculateWorkingMinutes(s, e, schedules, pauseEvents ?? [], shiftOverrides ?? []);
}, [actualStart, actualEnd, startDate, endDate, allSchedules, pauseEvents, shiftOverrides]);

const isMultiDay = startDate !== endDate;
```

Update the variance memo to use `workResult.totalMinutes`:
```typescript
const variance = useMemo(() => {
  if (!job?.estimated_minutes || workResult.totalMinutes <= 0) return null;
  return workResult.totalMinutes - job.estimated_minutes;
}, [workResult.totalMinutes, job?.estimated_minutes]);
```

Update `handleSubmit` to build full timestamps with dates:
```typescript
const handleSubmit = () => {
  if (!job) return;
  const itemsPayload = (items ?? []).map((item) => ({
    item_id: item.item_id,
    completed_quantity: quantities[item.item_id] ?? item.quantity,
  }));
  onComplete({
    items: itemsPayload,
    actualStart: actualStart && startDate ? new Date(`${startDate}T${actualStart}:00`).toISOString() : undefined,
    actualEnd: actualEnd && endDate ? new Date(`${endDate}T${actualEnd}:00`).toISOString() : undefined,
    notes: notes || undefined,
  });
};
```

Update the disabled check on the submit button:
```typescript
disabled={isPending || workResult.totalMinutes <= 0}
```

**Step 2: Update the JSX for date+time inputs**

Replace the grid (lines 176-185) with:
```tsx
<div className="grid grid-cols-2 gap-4">
  <div className="space-y-2">
    <Label>Actual Start</Label>
    <div className="flex gap-2">
      <Input
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        className="flex-1"
      />
      <Input
        type="time"
        value={actualStart}
        onChange={(e) => setActualStart(e.target.value)}
        className="w-28"
      />
    </div>
  </div>
  <div className="space-y-2">
    <Label>Actual End</Label>
    <div className="flex gap-2">
      <Input
        type="date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        className="flex-1"
      />
      <Input
        type="time"
        value={actualEnd}
        onChange={(e) => setActualEnd(e.target.value)}
        className="w-28"
      />
    </div>
  </div>
</div>
```

Replace the duration summary section (lines 188-210) with:
```tsx
<div className="flex flex-wrap gap-4 text-sm">
  <div>
    <span className="text-muted-foreground">Actual: </span>
    <span className="font-medium">
      {workResult.totalMinutes > 0 ? formatDuration(workResult.totalMinutes) : '-'}
    </span>
    {isMultiDay && workResult.workingDays > 0 && (
      <span className="text-xs text-muted-foreground ml-1">
        ({workResult.workingDays} working day{workResult.workingDays !== 1 ? 's' : ''})
      </span>
    )}
  </div>
  {workResult.pauseMinutes > 0 && (
    <div>
      <span className="text-muted-foreground">Paused: </span>
      <span className="font-medium">{formatDuration(workResult.pauseMinutes)}</span>
    </div>
  )}
  {job.estimated_minutes && (
    <div>
      <span className="text-muted-foreground">Est: </span>
      <span className="font-medium">{formatDuration(job.estimated_minutes)}</span>
    </div>
  )}
  {variance !== null && (
    <div>
      <span className="text-muted-foreground">Variance: </span>
      <span className={`font-medium ${variance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
        {variance > 0 ? '+' : ''}{formatDuration(Math.abs(variance))}
      </span>
    </div>
  )}
</div>
```

**Step 3: Remove old helpers that are no longer needed**

Remove `breakMinutesInRange` (lines 59-67), `timeInputToTimestamp` (lines 50-56). The `formatTimestampToInput` helper is still needed.

Also remove the old `shiftInfo` prop from the component — replace with the new queries. Update `CompleteJobDialogProps` to remove the `shiftInfo` field. The component no longer needs it from the parent since it fetches all schedules itself.

**Step 4: Run type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add components/factory-floor/complete-job-dialog.tsx
git commit -m "feat: multi-day working hours in complete dialog with date pickers"
```

---

### Task 7: Update parent components to stop passing `shiftInfo` to CompleteJobDialog

**Files:**
- Modify: `components/factory-floor/factory-floor-page.tsx:82-86` — remove `shiftInfo` prop from `<CompleteJobDialog>`

**Step 1: Remove the prop**

In `factory-floor-page.tsx`, change line 86 from:
```tsx
<CompleteJobDialog
  job={selectedJob}
  open={completeDialogOpen}
  onOpenChange={setCompleteDialogOpen}
  shiftInfo={shiftInfo}
```
to:
```tsx
<CompleteJobDialog
  job={selectedJob}
  open={completeDialogOpen}
  onOpenChange={setCompleteDialogOpen}
```

**Step 2: Check if `components/labor-planning/staff-lane-list.tsx` also passes shiftInfo**

Read lines around 994 of that file. If it uses the factory-floor `CompleteJobDialog`, update it too. Note: labor-planning has its own `CompleteJobDialog` at `components/labor-planning/complete-job-dialog.tsx` — that's a separate component and out of scope for this task (it would need its own update later).

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add components/factory-floor/factory-floor-page.tsx
git commit -m "refactor: remove shiftInfo prop from CompleteJobDialog"
```

---

### Task 8: Add `supabase` import to complete dialog

**Files:**
- Modify: `components/factory-floor/complete-job-dialog.tsx`

The queries in Task 5 use `supabase` directly. Ensure it's imported:

```typescript
import { supabase } from '@/lib/supabase';
```

This may already be covered if the implementer adds it during Task 5. Verify during implementation.

**Step 1: Run the app and visually test**

Open `http://localhost:3000/production?view=floor`, select a job, click Complete. Verify:
- Dates pre-fill correctly from `started_at` and current time
- Duration calculates correctly for a same-day job
- Date pickers are editable
- Changing the end date to a different day shows "(X working days)" and recalculates

**Step 2: Run type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: No errors

**Step 3: Commit if any changes needed**

---

### Task 9: Run security advisors check

**Step 1: Check for missing RLS**

Use `mcp__supabase__get_advisors` with type `security`.
The new `calculate_working_minutes` function is `STABLE` and reads `work_schedules`, `shift_overrides`, and `assignment_pause_events` — all of which should already have RLS. Verify no new warnings.

**Step 2: Verify with a test query**

Run: `SELECT calculate_working_minutes(now() - interval '5 days', now(), '<org_id>', NULL);`
Expected: Returns a reasonable integer (e.g., ~2400 for 5 working days at ~8h/day)

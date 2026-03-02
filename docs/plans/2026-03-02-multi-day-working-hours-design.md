# Multi-Day Working Hours Calculation

**Date:** 2026-03-02
**Status:** Approved
**Problem:** Job completion duration calculation assumes same-day or overnight jobs. A job started Friday at 12:00 and completed Monday at 12:30 reports 30 minutes instead of ~10.5 working hours.

## Context

- Jobs stay `in_progress` over weekends — workers leave without pausing
- Most jobs are same-day (must remain the fast path in UX)
- Different orgs have different working days/hours via `work_schedules` table
- Pause events tracked in `assignment_pause_events` but not yet subtracted from duration

## Core Algorithm

`calculateWorkingMinutes(start, end, schedules, pauses, overrides)` iterates each calendar day from start date to end date:

1. Map day-of-week to day group (`mon-thu`, `fri`, `sat-sun`)
2. Skip if `is_active = false` → 0 minutes
3. Determine work window for the day:
   - First day: `max(actualStart, shiftStart)` to `shiftEnd`
   - Last day: `shiftStart` to `min(actualEnd, shiftEnd)`
   - Middle days: full shift
   - Same day: `max(actualStart, shiftStart)` to `min(actualEnd, shiftEnd)`
4. Apply shift override if present (use `extended_end_minutes`)
5. Subtract breaks overlapping the work window
6. Subtract pauses overlapping the work window
7. Sum across all days

Returns: `{ totalMinutes, workingDays, pauseMinutes }`

### Edge Cases

- Start before shift → clamp to shift start
- End after shift → clamp to shift end (or override end)
- No schedule for day group → fallback 7:00–17:00, no breaks
- Pause still open (no `resumed_at`) → treat as paused until `end`
- Same-day job → first/last day logic collapses to single window

## Complete Dialog UX

**Date+time inputs:**
```
Actual Start                    Actual End
[Fri, 28 Feb] [12:00]         [Mon, 02 Mar] [12:30]
```

- Dates pre-filled from `started_at` and `now()`
- Dates shown as compact labels, editable on click
- When same-day, dates are muted/subtle
- Time inputs stay as `type="time"` for quick editing

**Duration summary:**
```
Actual: 10h 30m (3 working days)  Paused: 45m  Est: 25m  Variance: +10h 5m
```

## Data Flow

### Client Side

New file: `lib/working-hours.ts`
- Pure function, no side effects, testable
- Used by Complete dialog for live preview
- Could be used by detail panel for in-progress jobs (follow-up)

Complete dialog changes:
- Fetch all `work_schedules` (not just today's day group)
- Fetch `assignment_pause_events` for the assignment
- Fetch `shift_overrides` for the date range
- Pass full ISO timestamps (with dates) to RPC

### Server Side

New Postgres function: `calculate_working_minutes(p_start, p_end, p_org_id, p_assignment_id)`
- Queries `work_schedules`, `shift_overrides`, `assignment_pause_events`
- Same day-by-day algorithm
- Returns integer (net working minutes)

Updated `complete_assignment_with_card` RPC:
- Calls `calculate_working_minutes()` for authoritative duration
- Stores result in `actual_duration_minutes`

## Not In Scope

- Changing `minutes_elapsed` in the `factory_floor_status` view (stays wall-clock)
- Changing `computeShiftAwareStatus()` (inherently single-day, answers "finishes today?")
- Payroll/attendance system (separate clock-in/clock-out pipeline)
- Public holidays (future enhancement — would need a holidays table)

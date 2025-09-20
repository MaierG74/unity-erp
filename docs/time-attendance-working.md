# Time & Attendance System - Working Document

## Overview
This document details the Unity ERP time and attendance system architecture, performance issues, and optimization work. The system tracks staff clock events, processes them into work segments, and generates daily summaries.

## Core Architecture

### Database Tables (Supabase)

#### `time_clock_events`
- **Purpose**: Stores individual clock in/out events
- **Key Fields**:
  - `id` (UUID): Primary key
  - `staff_id` (integer): Foreign key to staff table
  - `event_time` (timestamptz): When the event occurred
  - `event_type` (text): 'clock_in', 'clock_out', 'break_start', 'break_end'
  - `break_type` (text): 'lunch', 'coffee', 'other' (for break events)
  - `verification_method` (text): 'manual', 'biometric', etc.
  - `notes` (text): Additional context
- **Indexes**: staff_id, event_time, date(event_time)

#### `time_segments`
- **Purpose**: Processed work/break periods from paired clock events
- **Key Fields**:
  - `id` (UUID): Primary key
  - `staff_id` (integer): Foreign key to staff table
  - `date_worked` (date): Date for the segment
  - `clock_in_event_id` (UUID): Foreign key to start event
  - `clock_out_event_id` (UUID): Foreign key to end event (null for open segments)
  - `start_time` (timestamptz): Segment start time
  - `end_time` (timestamptz): Segment end time (null for open segments)
  - `segment_type` (text): 'work' or 'break'
  - `break_type` (text): Type of break if segment_type = 'break'
  - `duration_minutes` (integer): Calculated duration
- **Business Logic**: Generated from clock events, represents actual work periods

#### `time_daily_summary`
- **Purpose**: Aggregated daily totals per staff member
- **Key Fields**:
  - `id` (UUID): Primary key
  - `staff_id` (integer): Foreign key to staff table
  - `date_worked` (date): Date for the summary
  - `first_clock_in` (timestamptz): First clock-in of the day
  - `last_clock_out` (timestamptz): Last clock-out of the day
  - `total_work_minutes` (integer): Total work time in minutes
  - `total_break_minutes` (integer): Total break time in minutes
  - `regular_hours` (decimal): Regular time hours (first 9 hours)
  - `overtime_hours` (decimal): Overtime hours (after 9 hours, 1.5x rate)
  - `double_time_hours` (decimal): Double time hours (Sunday, 2x rate)
  - `is_complete` (boolean): Whether all shifts are closed
- **Business Rules**:
  - Monday-Thursday: 30min automatic tea break deduction
  - Friday: No automatic tea break deduction
  - Sunday: All hours are double-time
  - First 9 hours: Regular time
  - After 9 hours: Overtime (1.5x)

### Key Files & Components

#### Frontend Components

##### `/components/features/staff/DailyAttendanceGrid.tsx`
- **Purpose**: Main attendance dashboard showing all staff for a selected date
- **Key Functions**:
  - `handleManualClockEvent()`: Processes manually added clock events
  - `refreshStaffAttendanceCaches()`: Re-syncs React Query caches for a single staff member after targeted edits
  - `processClockEventsData()`: Triggers segment processing and summary generation
  - `updateSingleEventSegments()`: Lightweight processing for single events
  - `OptimizedAttendanceTimeline`: Staff-specific component wrapper
- **React Query Keys**:
  - `['time_clock_events', dateStr]`: All clock events for date
  - `['time_segments', dateStr]`: All segments for date
  - `['time_daily_summary', dateStr]`: All summaries for date
  - `['time_daily_summary', dateStr, staffId]`: Staff-specific summary
- **Performance Issues**: Mass re-renders when global queries are invalidated

##### `/components/features/staff/AttendanceTimeline.tsx`
- **Purpose**: Individual staff member timeline showing events and segments
- **Key Functions**:
  - `handleAddEvent()`: Manages manual event addition with loading states
  - `handleEditSubmit()`: Edits existing clock events
  - `handleDeleteConfirm()`: Deletes clock events
- **State Management**:
  - `isProcessing`: Controls loading spinner on refresh button
  - `isAddingEvent`: Controls add event dialog
- **Props**: Receives staff data, events, segments, and callback functions

#### Backend Utilities

##### `/lib/utils/attendance.ts`
- **Purpose**: Core business logic for processing clock events
- **Key Functions**:

###### `processClockEventsIntoSegments(dateStr: string, staffId?: number)`
- **Purpose**: Converts raw clock events into work/break segments
- **Process**:
  1. Fetches clock events for date (optionally filtered by staffId)
  2. Deletes existing segments for the day/staff
  3. Groups events by staff member
  4. Pairs clock-in/out events to create work segments
  5. Handles overnight shifts and incomplete segments
- **Performance**:
  - ✅ Optimized to skip other staff when staffId provided
  - ❌ Still causes mass re-renders due to database operations

###### `generateDailySummary(dateStr: string, staffId?: number)`
- **Purpose**: Creates daily summary records from processed segments
- **Process**:
  1. Fetches all segments for date (optionally filtered by staffId)
  2. Calculates total work/break minutes
  3. Applies business rules for regular/overtime/double-time
  4. Handles tea break deductions
  5. Updates or creates daily summary record
- **Business Rules Applied**:
  - Tea break deductions (Mon-Thu: 30min, Fri: 0min)
  - Overtime calculations (9+ hours = 1.5x)
  - Sunday double-time (all hours = 2x)

###### `addManualClockEvent(staffId, eventType, dateStr, time, breakType, notes)`
- **Purpose**: Adds a single manual clock event to database
- **Process**:
  1. Validates input parameters
  2. Creates timestamp from date + time
  3. Inserts into time_clock_events table
- **Performance**: ✅ Very fast, single database insert

##### `/lib/utils/timezone.ts`
- **Purpose**: Handles South Africa Standard Time (SAST) timezone conversions
- **Key Functions**:
  - `getSASTDayBoundaries(dateStr)`: Gets start/end of day in SAST
  - `formatTimeToSAST(timestamp)`: Formats time for display
  - `createSASTTimestamp(date, time)`: Creates SAST timestamp

## Performance Issues Identified

### Issue 1: Mass Re-renders
**Problem**: Adding a single manual clock event triggers re-rendering of ALL staff AttendanceTimeline components (50+ staff members)

**Root Cause**: Global React Query invalidations
- `queryClient.invalidateQueries(['time_clock_events', dateStr])`
- `queryClient.invalidateQueries(['time_segments', dateStr])`
- These cause ALL OptimizedAttendanceTimeline components to re-render

**Evidence**: Console logs show 813 lines of processing for single event addition
```
[AttendanceTimeline] Summary for Alex Sizwe Manci: 9 hours
[AttendanceTimeline] Summary for Apohle Roto: 8.92 hours
[AttendanceTimeline] Summary for Brandon Crook: 8.8 hours
... (50+ more staff members)
```

**Attempted Solutions**:
1. ❌ Staff-specific query invalidation - still triggers global re-renders
2. ❌ Non-blocking invalidations - still causes mass re-renders
3. ✅ Ultra-lightweight approach - skip processing, manual refresh needed

### Issue 2: Processing Performance
**Problem**: Processing clock events takes 60+ seconds for single event addition

**Root Cause**: Heavy database operations in `processClockEventsIntoSegments()`
- Deletes all existing segments for staff member
- Reprocesses all clock events from scratch
- Complex pairing logic for clock-in/out events

**Impact**:
- Poor user experience (long wait times)
- Server resource usage
- Database lock contention

**Fix Implemented (20 Sep 2025)**:
1. `processClockEventsIntoSegments()` now regenerates summaries with `generateDailySummary(dateStr, staffId)` immediately after each staff member's segments are rebuilt, keeping the refresh scoped to the intended employee.
2. React and API callers no longer issue an extra `generateDailySummary` invocation, so the per-staff 🔄 button avoids the second full-day pass.
3. When a targeted refresh finds no clock events, the helper removes any lingering segments and deletes the stale summary row so the UI clears instantly.

### Issue 3: Spinner Timing
**Problem**: Loading spinner stops before processing completes

**Root Cause**: Async function chain completion timing
```
handleAddEvent() → onAddManualEvent() → processClockEventsData()
                    ↑ Spinner stops here    ↑ Heavy work continues here
```

**Solution**: Extended spinner duration to cover entire processing chain

## Current Solutions Implemented

### 1. Staff-Specific Query Architecture
```typescript
// Staff-specific queries to avoid global invalidation
const OptimizedAttendanceTimeline = ({ staffId, staffName, segments }) => {
  const { data: staffSummary } = useQuery({
    queryKey: ['time_daily_summary', dateStr, staffId], // Staff-specific key
    queryFn: async () => {
      // Fetch only this staff member's summary
    },
  });
};
```

### 2. Optimized Processing Functions
```typescript
// Skip other staff when staffId is provided
for (const staffIdStr in staffEvents) {
  const currentStaffId = parseInt(staffIdStr);

  if (staffId && currentStaffId !== staffId) {
    console.log(`Skipping staff_id: ${currentStaffId}`);
    continue; // Skip processing other staff
  }

  // Process only the target staff member
}

// After segments are rebuilt the helper immediately calls
// generateDailySummary(dateStr, currentStaffId), so callers
// no longer need to fire a second summary job.
```

### 3. Targeted Cache Refresh Helper
```typescript
const refreshStaffAttendanceCaches = async (dateStr: string, staffId: number) => {
  const { startOfDay, startOfNextDay } = getSASTDayBoundaries(dateStr);

  const [eventsRes, segmentsRes, summaryRes] = await Promise.all([
    supabase
      .from('time_clock_events')
      .select('*')
      .eq('staff_id', staffId)
      .gte('event_time', startOfDay)
      .lt('event_time', startOfNextDay)
      .order('event_time', { ascending: true }),
    supabase
      .from('time_segments')
      .select('id,staff_id,date_worked,start_time,end_time,break_type,segment_type,duration_minutes')
      .eq('date_worked', dateStr)
      .eq('staff_id', staffId)
      .order('start_time', { ascending: true }),
    supabase
      .from('time_daily_summary')
      .select('*')
      .eq('date_worked', dateStr)
      .eq('staff_id', staffId)
      .maybeSingle(),
  ]);

  const events = (eventsRes.data ?? []) as ClockEvent[];
  const segments = (segmentsRes.data ?? []) as TimeSegment[];
  const summary = (summaryRes.data ?? null) as DailySummary | null;

  queryClient.setQueryData(['time_clock_events', dateStr], (current: ClockEvent[] = []) => {
    const remaining = current.filter(event => event.staff_id !== staffId);
    return [...remaining, ...events].sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
  });

  queryClient.setQueryData(['time_segments', dateStr], (current: TimeSegment[] = []) => {
    const remaining = current.filter(segment => segment.staff_id !== staffId);
    return [...remaining, ...segments].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  });

  queryClient.setQueryData(['time_daily_summary', dateStr, staffId], summary);

  queryClient.setQueryData(['time_daily_summary_all', dateStr], (current: DailySummary[] = []) => {
    const remaining = current.filter(item => item.staff_id !== staffId);
    const merged = summary ? [...remaining, summary] : remaining;
    return merged.sort((a, b) => a.staff_id - b.staff_id);
  });
};
```

- Keeps deletions and manual additions in sync without needing a full page refresh.
- Falls back to targeted query invalidation if any fetch fails (ensures UI still updates).
- Used after per-staff processing and manual event creation so the timeline updates instantly.

### 4. Manual Event UX Improvements
```tsx
<Input
  type="time"
  lang="en-GB"
  step={60}
  className="bg-gray-700 border-gray-600 text-white"
/> // Forces 24-hour picker and minute precision
```

- Added helper text reminding users to enter 24-hour times (e.g. 07:00, 17:30).
- Prevents AM/PM mistakes when supervisors add or adjust events on behalf of staff.

### 5. Enhanced Loading States
```typescript
// Spinner shows during entire process
const handleAddEvent = async () => {
  setIsProcessing(true);
  await new Promise(resolve => setTimeout(resolve, 50)); // UI update delay

  try {
    await onAddManualEvent(staffId, eventType, eventTime, breakType);
  } finally {
    setIsProcessing(false);
  }
};
```

## React Query Strategy

### Query Keys Structure
```typescript
// Global queries (trigger mass re-renders)
['time_clock_events', dateStr]           // All events for date
['time_segments', dateStr]               // All segments for date
['time_daily_summary', dateStr]          // All summaries for date

// Staff-specific queries (targeted updates)
['time_daily_summary', dateStr, staffId] // Specific staff summary
```

### Invalidation Strategy
```typescript
// ❌ Problematic: Causes mass re-renders
queryClient.invalidateQueries({ queryKey: ['time_clock_events', dateStr] });

// ✅ Better: Only affects specific staff
queryClient.invalidateQueries({ queryKey: ['time_daily_summary', dateStr, staffId] });
```

## Business Logic Implementation

### Tea Break Deductions
```typescript
// Applied in generateDailySummary()
const dayOfWeek = new Date(dateStr).getDay();
let teaBreakDeduction = 0;

if (dayOfWeek >= 1 && dayOfWeek <= 4) { // Monday-Thursday
  teaBreakDeduction = 30; // 30 minutes
}
// Friday (5), Saturday (6), Sunday (0) = no deduction

totalWorkMinutes = Math.max(0, totalWorkMinutes - teaBreakDeduction);
```

### Overtime Calculations
```typescript
// Applied in generateDailySummary()
const totalHours = totalWorkMinutes / 60;

if (dayOfWeek === 0) { // Sunday
  doubleTimeHours = totalHours; // All hours are double-time
} else {
  regularHours = Math.min(totalHours, 9);
  overtimeHours = Math.max(0, totalHours - 9);
}
```

> Update 20 Sep 2025: When inserting a brand-new `time_daily_summary` row we now persist the computed `ot_minutes` instead of hard-coding zero, so overtime totals are correct on first insert.

### Segment Pairing Logic
```typescript
// In processClockEventsIntoSegments()
const clockOutEvents = events.filter(e => e.event_type === 'clock_out');

for (const clockOutEvent of clockOutEvents) {
  // Find most recent unprocessed clock-in before this clock-out
  const matchingClockIn = clockInEvents
    .filter(e => !processedInEvents.has(e.id) &&
                 new Date(e.event_time) < new Date(clockOutEvent.event_time))
    .sort((a, b) => new Date(b.event_time) - new Date(a.event_time))[0];

  if (matchingClockIn) {
    // Create work segment
    await createWorkSegment(matchingClockIn, clockOutEvent);
  }
}
```

## Database Triggers & Functions

### RLS (Row Level Security)
All tables have RLS enabled for security:
```sql
-- Example RLS policy
CREATE POLICY "Users can view own organization data" ON time_clock_events
  FOR SELECT USING (auth.jwt() ->> 'org_id' = org_id::text);
```

### Database Functions
- `update_updated_at_column()`: Automatically updates `updated_at` timestamps
- Custom triggers on time_clock_events for audit logging

## Debug Logging Strategy

### Console Log Categories
```typescript
// Component-level timing
[AttendanceTimeline] Starting manual event processing
[AttendanceTimeline] onAddManualEvent completed

// Function-level processing
[handleManualClockEvent] About to start processing
[updateSingleEventSegments] Step 1: Getting timezone boundaries
[processClockEventsData] Targeted processing complete

// Database operations
[DEBUG] Fetching clock events for date: 2025-08-22
[DEBUG] Found 2 total events for 2025-08-22
```

### Performance Monitoring
```typescript
// Timing logs to identify bottlenecks
console.time('processClockEventsIntoSegments');
await processClockEventsIntoSegments(dateStr, staffId);
console.timeEnd('processClockEventsIntoSegments');
```

## Known Issues & Workarounds

### Issue: Mass Re-renders
**Status**: Partially solved
**Workaround**: Ultra-lightweight processing + manual refresh
**Long-term Solution**: Database-level triggers to handle segment processing

### Issue: Timezone Complexity
**Status**: Solved
**Solution**: Centralized timezone utilities in `/lib/utils/timezone.ts`

### Issue: Stale Data
**Status**: Solved
**Solution**: Improved cleanup logic in `generateDailySummary()`

## Future Improvements

### 1. Database-Level Processing
Move segment processing to PostgreSQL functions/triggers:
```sql
CREATE OR REPLACE FUNCTION process_clock_event_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Automatically process segments when clock event is inserted/updated
  PERFORM process_staff_segments(NEW.staff_id, NEW.event_time::date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2. Real-time Updates
Implement Supabase real-time subscriptions for live updates:
```typescript
const subscription = supabase
  .channel('staff-attendance')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'time_clock_events' },
    (payload) => {
      // Update only affected staff member's data
    }
  )
  .subscribe();
```

### 3. Background Processing
Move heavy processing to background jobs:
```typescript
// Queue segment processing for background execution
await queueJob('process-segments', { staffId, dateStr });
```

### 4. Optimistic Updates
Update UI immediately, sync with server in background:
```typescript
// Show changes immediately
queryClient.setQueryData(['time_daily_summary', dateStr, staffId], newData);

// Sync with server in background
queryClient.invalidateQueries(['time_daily_summary', dateStr, staffId]);
```

## Testing Strategy

### Manual Testing Scenarios
1. **Single Event Addition**: Add clock-in → verify no mass re-renders
2. **Event Pairing**: Add clock-in + clock-out → verify work segment creation
3. **Overnight Shifts**: Clock-in at 23:00, clock-out next day → verify handling
4. **Break Events**: Add break-start + break-end → verify break segment
5. **Tea Break Deduction**: Verify Mon-Thu deduction, Fri exemption
6. **Overtime Calculation**: Work 10+ hours → verify regular/overtime split
7. **Sunday Double-time**: Work on Sunday → verify all hours are 2x

### Performance Testing
```typescript
// Measure processing time
console.time('manualEventProcessing');
await handleManualClockEvent(staffId, 'clock_in', '09:00');
console.timeEnd('manualEventProcessing');
// Target: < 2 seconds
```

### Load Testing
- Test with 50+ staff members on same date
- Verify no performance degradation
- Monitor memory usage and re-render counts

## Configuration

### Environment Variables
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Default Settings
```typescript
// In DailyAttendanceGrid.tsx
const DEFAULT_BREAK_DURATION = 0.5; // 30 minutes
const TIMEZONE = 'Africa/Johannesburg'; // SAST (UTC+2)
```

## Troubleshooting Guide

### Problem: Events not appearing after addition
**Solution**: Click refresh button (🔄) next to staff name

### Problem: Incorrect hours calculation
**Check**:
1. Tea break deduction rules (Mon-Thu only)
2. Overtime calculation (9+ hours)
3. Sunday double-time rules

### Problem: Mass re-renders in console
**Solution**: Ensure using ultra-lightweight processing approach

### Problem: Timezone issues
**Check**: All times should be in SAST (UTC+2), use timezone utilities

---

*Last Updated: 2025-08-30*
*Document maintained by: Claude Code Assistant*
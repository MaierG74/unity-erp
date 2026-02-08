import { supabase } from '@/lib/supabase';
import { getSASTDayBoundaries, createSASTTimestamp } from './timezone';

/**
 * Result type for batch attendance processing
 */
export interface ProcessAttendanceBatchResult {
  success: boolean;
  staffProcessed?: number;
  segmentsCreated?: number;
  summariesUpdated?: number;
  error?: string;
}

/**
 * Batch process attendance for a date using server-side RPC
 * This replaces the slow sequential processing with a single database call
 *
 * @param dateStr - Date in YYYY-MM-DD format
 * @param staffId - Optional staff ID to process only one staff member
 * @returns Processing result with stats
 */
export const processAttendanceBatch = async (
  dateStr: string,
  staffId?: number
): Promise<ProcessAttendanceBatchResult> => {
  try {
    const { data, error } = await supabase.rpc('process_attendance_for_date', {
      p_date_worked: dateStr,
      p_staff_id: staffId ?? null
    });

    if (error) {
      console.error('[processAttendanceBatch] RPC error:', error);
      return { success: false, error: error.message };
    }

    if (!data || !data.success) {
      return {
        success: false,
        error: data?.error || 'Unknown error from RPC'
      };
    }

    return {
      success: true,
      staffProcessed: data.staff_processed,
      segmentsCreated: data.segments_created,
      summariesUpdated: data.summaries_updated
    };
  } catch (err: any) {
    console.error('[processAttendanceBatch] Exception:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
};

/**
 * Calculate duration in minutes between two timestamps
 */
export const calculateDurationMinutes = (startTime: string, endTime: string): number => {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const durationMs = end.getTime() - start.getTime();
  return Math.round(durationMs / (1000 * 60)); // Convert ms to minutes and round
};

type DailyMinuteBreakdown = {
  regularMinutes: number;
  otMinutes: number;
  dtMinutes: number;
  totalHoursWorked: number;
};

const calculateDailyMinuteBreakdown = (dateStr: string, totalWorkMinutes: number): DailyMinuteBreakdown => {
  const dayOfWeek = new Date(dateStr).getDay(); // 0=Sunday
  let regularMinutes: number;
  let otMinutes: number;
  let dtMinutes: number;

  if (dayOfWeek === 0) {
    // Sunday only for current rollout scope
    regularMinutes = 0;
    otMinutes = 0;
    dtMinutes = totalWorkMinutes;
  } else {
    const regularThreshold = 9 * 60; // 9 hours
    regularMinutes = Math.min(totalWorkMinutes, regularThreshold);
    otMinutes = Math.max(totalWorkMinutes - regularMinutes, 0);
    dtMinutes = 0;
  }

  return {
    regularMinutes,
    otMinutes,
    dtMinutes,
    totalHoursWorked: parseFloat((totalWorkMinutes / 60).toFixed(2)),
  };
};

const calculateWageCents = (
  regularMinutes: number,
  otMinutes: number,
  dtMinutes: number,
  hourlyRate: number
): number =>
  Math.round(
    ((regularMinutes / 60) * hourlyRate + (otMinutes / 60) * hourlyRate * 1.5 + (dtMinutes / 60) * hourlyRate * 2) *
      100
  );

const fetchHourlyRate = async (staffId: number): Promise<number> => {
  const { data, error } = await supabase
    .from('staff')
    .select('hourly_rate')
    .eq('staff_id', staffId)
    .single();

  if (error || !data) {
    return 0;
  }

  const rate = Number(data.hourly_rate);
  return Number.isFinite(rate) ? rate : 0;
};

/**
 * Process clock events into time segments for a specific date
 */
export const processClockEventsIntoSegments = async (dateStr: string, staffId?: number): Promise<void> => {
  // // console.log(`[DEBUG] Starting processClockEventsIntoSegments for date: ${dateStr}, staffId: ${staffId}`);
  try {
    // Get all clock events for the date
    // // console.log(`[DEBUG] Fetching clock events for date: ${dateStr}, filtering by staffId: ${staffId}`);
    // Get SAST day boundaries
    const { startOfDay: localDateStart, startOfNextDay: localNextDayStart } = getSASTDayBoundaries(dateStr);

    // // console.log(`[DEBUG] Querying 'time_clock_events' for SAST Range: >= ${localDateStart} and < ${localNextDayStart}`);
    let clockEventsQuery = supabase
      .from('time_clock_events')
      .select('*')
      .gte('event_time', localDateStart)
      .lt('event_time', localNextDayStart)
      .order('event_time', { ascending: true });
    if (staffId) {
      clockEventsQuery = clockEventsQuery.eq('staff_id', staffId);
    }
    const { data: clockEvents, error: eventsError } = await clockEventsQuery;

    if (eventsError) {
      console.error('[DEBUG] Error fetching clock events:', eventsError);
      return;
    }

    if (!clockEvents || clockEvents.length === 0) {
      if (staffId) {
        const { error: cleanupError } = await supabase
          .from('time_segments')
          .delete()
          .eq('staff_id', staffId)
          .eq('date_worked', dateStr);

        if (cleanupError) {
          console.error(`[DEBUG] Error clearing segments for staff ${staffId} on ${dateStr}:`, cleanupError);
        } else {
          await generateDailySummary(dateStr, staffId);
        }
      }
      // // console.log(`[DEBUG] No clock events found for ${dateStr}. Exiting.`);
      return;
    }
    // // console.log(`[DEBUG] Found ${clockEvents.length} total events for ${dateStr}:`, clockEvents);

    // Group events by staff member
    const staffEvents: Record<number, any[]> = {};
    clockEvents.forEach(event => {
      if (!staffEvents[event.staff_id]) {
        staffEvents[event.staff_id] = [];
      }
      staffEvents[event.staff_id].push(event);
    });
    // console.log('[DEBUG] Grouped events by staff IDs:', Object.keys(staffEvents));

    // Process each staff member's events (or just the specified staff member)
    for (const staffIdStr in staffEvents) {
      const currentStaffId = parseInt(staffIdStr); // Ensure staffId is a number for lookups

      // If we're processing a specific staff member, skip others
      if (staffId && currentStaffId !== staffId) {
        // console.log(`[DEBUG] Skipping staff_id: ${currentStaffId} (only processing ${staffId})`);
        continue;
      }
      
      // console.log(`\n[DEBUG] Processing events for staff_id: ${currentStaffId}`);
      const events = staffEvents[currentStaffId];
      // console.log(`[DEBUG] Events for staff ${currentStaffId}:`, events);

      // Delete all existing segments for this staff member on this day.
      // console.log(`[DEBUG] Deleting existing segments for staff ${currentStaffId} on ${dateStr}...`);
      const { error: deleteError } = await supabase
        .from('time_segments')
        .delete()
        .eq('staff_id', currentStaffId) // Use numeric staffId
        .eq('date_worked', dateStr);

      if (deleteError) {
        console.error(`[DEBUG] Error deleting old segments for staff ${currentStaffId}:`, deleteError);
        continue;
      }
      // console.log(`[DEBUG] Successfully deleted old segments for staff ${currentStaffId}.`);

      const processedInEvents = new Set();
      const processedOutEvents = new Set();

      const clockInEvents = events.filter(e => e.event_type === 'clock_in');
      const clockOutEvents = events.filter(e => e.event_type === 'clock_out');
      // console.log(`[DEBUG] Staff ${staffId}: Found ${clockInEvents.length} clock-ins and ${clockOutEvents.length} clock-outs.`);
      // if(clockInEvents.length > 0) console.log('[DEBUG] Clock-in events:', clockInEvents);
      // if(clockOutEvents.length > 0) console.log('[DEBUG] Clock-out events:', clockOutEvents);
      
      // Process regular clock-in/clock-out pairs
      for (const clockOutEvent of clockOutEvents) {
        // console.log(`[DEBUG] Processing clock-out event: ${clockOutEvent.id} at ${clockOutEvent.event_time}`);
        if (processedOutEvents.has(clockOutEvent.id)) {
          // console.log(`[DEBUG] Skipping already processed clock-out event ${clockOutEvent.id}`);
          continue;
        }

        const matchingClockIn = clockInEvents
          .filter(e => {
            const isUnprocessed = !processedInEvents.has(e.id);
            const isInBeforeOut = new Date(e.event_time) < new Date(clockOutEvent.event_time);
            // // console.log(`[DEBUG] Checking clock-in ${e.id} (${e.event_time}): unprocessed=${isUnprocessed}, inBeforeOut=${isInBeforeOut}`);
            return isUnprocessed && isInBeforeOut;
          })
          .sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime())[0];

        if (matchingClockIn) {
          // console.log(`[DEBUG] Found matching clock-in ${matchingClockIn.id} (${matchingClockIn.event_time}) for clock-out ${clockOutEvent.id} (${clockOutEvent.event_time}).`);
          const durationMins = calculateDurationMinutes(matchingClockIn.event_time, clockOutEvent.event_time);
          // console.log(`[DEBUG] Creating work segment for staff ${currentStaffId} from ${matchingClockIn.event_time} to ${clockOutEvent.event_time} (${durationMins} mins)`);

          const { error: insertError } = await supabase
            .from('time_segments')
            .insert({
              staff_id: currentStaffId, // Use numeric staffId
              date_worked: dateStr,
              clock_in_event_id: matchingClockIn.id,
              clock_out_event_id: clockOutEvent.id,
              start_time: matchingClockIn.event_time,
              end_time: clockOutEvent.event_time,
              segment_type: 'work',
              break_type: null,
              duration_minutes: durationMins,
              // is_complete: true // This field belongs to daily_summary, not time_segments
            });

          if (insertError) {
            console.error('[DEBUG] Error creating work segment:', insertError);
            continue;
          }
          // console.log(`[DEBUG] Successfully created work segment for clock-in ${matchingClockIn.id} and clock-out ${clockOutEvent.id}.`);
          processedInEvents.add(matchingClockIn.id);
          processedOutEvents.add(clockOutEvent.id);
        } else {
          // console.log(`[DEBUG] No matching clock-in found for clock-out event ${clockOutEvent.id} at ${clockOutEvent.event_time}.`);

          // --- Overnight shift handling ---
          // Try to find an unmatched clock-in from the previous day
          const prevDate = new Date(dateStr);
          prevDate.setDate(prevDate.getDate() - 1);
          const prevDateStr = prevDate.toISOString().split('T')[0];

          // Query for unmatched clock-ins from the previous day
          const { data: prevClockIns, error: prevError } = await supabase
            .from('time_clock_events')
            .select('*')
            .eq('staff_id', staffId)
            .eq('event_type', 'clock_in')
            .gte('event_time', `${prevDateStr}T00:00:00.000Z`)
            .lt('event_time', `${prevDateStr}T23:59:59.999Z`);

          if (prevError) {
            console.error(`[DEBUG] Error fetching previous day's clock-ins for staff ${staffId}:`, prevError);
          } else if (prevClockIns && prevClockIns.length > 0) {
            // Find an unmatched clock-in (not already processed)
            const unmatchedPrevClockIn = prevClockIns.find(
              (e: any) => !processedInEvents.has(e.id)
            );
            if (unmatchedPrevClockIn) {
              // Split at midnight
              // SAST midnight for South Africa (UTC+2)
const [year, month, day] = dateStr.split('-').map(Number);
const midnight = new Date(`${dateStr}T00:00:00+02:00`);
              const prevEnd = new Date(midnight.getTime() - 1); // 23:59:59.999 of previous day
              const outTime = new Date(clockOutEvent.event_time);

              // Segment 1: previous day (clock-in to midnight)
              const seg1Start = unmatchedPrevClockIn.event_time;
              const seg1End = midnight.toISOString();
              const seg1Mins = calculateDurationMinutes(seg1Start, seg1End);
              const { error: seg1Error } = await supabase
                .from('time_segments')
                .insert({
                  staff_id: staffId,
                  date_worked: prevDateStr,
                  clock_in_event_id: unmatchedPrevClockIn.id,
                  clock_out_event_id: null, // No clock-out event for split
                  start_time: seg1Start,
                  end_time: seg1End,
                  segment_type: 'work',
                  break_type: null,
                  duration_minutes: seg1Mins,
                });
              if (seg1Error) {
                console.error(`[DEBUG] Error creating overnight segment for previous day:`, seg1Error);
              } else {
                // console.log(`[DEBUG] Created overnight segment for prev day: ${seg1Start} to ${seg1End} (${seg1Mins} mins)`);
              }

              // Segment 2: current day (midnight to clock-out)
              const seg2Start = seg1End;
              const seg2End = clockOutEvent.event_time;
              const seg2Mins = calculateDurationMinutes(seg2Start, seg2End);
              const { error: seg2Error } = await supabase
                .from('time_segments')
                .insert({
                  staff_id: staffId,
                  date_worked: dateStr,
                  clock_in_event_id: null, // No clock-in event for split
                  clock_out_event_id: clockOutEvent.id,
                  start_time: seg2Start,
                  end_time: seg2End,
                  segment_type: 'work',
                  break_type: null,
                  duration_minutes: seg2Mins,
                });
              if (seg2Error) {
                console.error(`[DEBUG] Error creating overnight segment for current day:`, seg2Error);
              } else {
                // console.log(`[DEBUG] Created overnight segment for current day: ${seg2Start} to ${seg2End} (${seg2Mins} mins)`);
              }
              // Mark both as processed
              processedInEvents.add(unmatchedPrevClockIn.id);
              processedOutEvents.add(clockOutEvent.id);
            }
          }
        }
      }

      // Process break segments
      const breakStartEvents = events.filter(e => e.event_type === 'break_start');
      const breakEndEvents = events.filter(e => e.event_type === 'break_end');
      // console.log(`[DEBUG] Staff ${staffId}: Found ${breakStartEvents.length} break-starts and ${breakEndEvents.length} break-ends.`);
      // if(breakStartEvents.length > 0) console.log('[DEBUG] Break-start events:', breakStartEvents);
      // if(breakEndEvents.length > 0) console.log('[DEBUG] Break-end events:', breakEndEvents);

      for (const breakEndEvent of breakEndEvents) {
        // console.log(`[DEBUG] Processing break-end event: ${breakEndEvent.id} at ${breakEndEvent.event_time}`);
        if (processedOutEvents.has(breakEndEvent.id)) {
            // console.log(`[DEBUG] Skipping already processed break-end event ${breakEndEvent.id}`);
            continue;
        }

        const matchingBreakStart = breakStartEvents
          .filter(e => !processedInEvents.has(e.id) && new Date(e.event_time) < new Date(breakEndEvent.event_time))
          .sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime())[0];

        if (matchingBreakStart) {
          // console.log(`[DEBUG] Found matching break-start ${matchingBreakStart.id} (${matchingBreakStart.event_time}) for break-end ${breakEndEvent.id} (${breakEndEvent.event_time}).`);
          const durationMins = calculateDurationMinutes(matchingBreakStart.event_time, breakEndEvent.event_time);
          // console.log(`[DEBUG] Creating break segment for staff ${currentStaffId} from ${matchingBreakStart.event_time} to ${breakEndEvent.event_time} (${durationMins} mins, type: ${matchingBreakStart.break_type})`);
          
          const { error: insertError } = await supabase
            .from('time_segments')
            .insert({
              staff_id: currentStaffId, // Use numeric staffId
              date_worked: dateStr,
              clock_in_event_id: matchingBreakStart.id,
              clock_out_event_id: breakEndEvent.id,
              start_time: matchingBreakStart.event_time,
              end_time: breakEndEvent.event_time,
              segment_type: 'break',
              break_type: matchingBreakStart.break_type,
              duration_minutes: durationMins,
              // is_complete: true // This field belongs to daily_summary, not time_segments
            });

          if (insertError) {
            console.error('[DEBUG] Error creating break segment:', insertError);
            continue;
          }
          // console.log(`[DEBUG] Successfully created break segment for break-start ${matchingBreakStart.id} and break-end ${breakEndEvent.id}.`);
          processedInEvents.add(matchingBreakStart.id);
          processedOutEvents.add(breakEndEvent.id);
        } else {
          // console.log(`[DEBUG] No matching break-start found for break-end event ${breakEndEvent.id} at ${breakEndEvent.event_time}.`);
        }
      }

      // Handle any remaining clock-ins (open shifts)
      const remainingClockIns = clockInEvents.filter(e => !processedInEvents.has(e.id));
      if (remainingClockIns.length > 0) {
        const pendingClockIn = remainingClockIns[0]; // Process one by one, simplest for now
        // console.log(`[DEBUG] Found ${remainingClockIns.length} remaining unprocessed clock-in(s). Processing open work segment for ${pendingClockIn.id} at ${pendingClockIn.event_time}.`);
        
        const { error: insertError } = await supabase
          .from('time_segments')
          .insert({
            staff_id: currentStaffId, // Use numeric staffId (BUG FIX from original where staffId was string from loop key)
            date_worked: dateStr,
            clock_in_event_id: pendingClockIn.id,
            clock_out_event_id: null,
            start_time: pendingClockIn.event_time,
            end_time: null,
            segment_type: 'work',
            break_type: null,
            duration_minutes: null,
            // is_complete: false // This field belongs to daily_summary, not time_segments
          });

        if (insertError) {
          console.error(`[DEBUG] Error creating open work segment for staff ${staffId}, clock-in ${pendingClockIn.id}:`, insertError);
        } else {
          // console.log(`[DEBUG] Successfully created open work segment for clock-in ${pendingClockIn.id}.`);
          processedInEvents.add(pendingClockIn.id); // Mark as processed to avoid reprocessing if logic is extended
        }
      }

      // Handle any remaining break-starts (open breaks)
      const remainingBreakStarts = breakStartEvents.filter(e => !processedInEvents.has(e.id));
      if (remainingBreakStarts.length > 0) {
        const pendingBreakStart = remainingBreakStarts[0];
        // console.log(`[DEBUG] Found ${remainingBreakStarts.length} remaining unprocessed break-start(s). Processing open break segment for ${pendingBreakStart.id} at ${pendingBreakStart.event_time}.`);

        const { error: insertError } = await supabase
          .from('time_segments')
          .insert({
            staff_id: currentStaffId, // Use numeric staffId
            date_worked: dateStr,
            clock_in_event_id: pendingBreakStart.id,
            clock_out_event_id: null,
            start_time: pendingBreakStart.event_time,
            end_time: null,
            segment_type: 'break',
            break_type: pendingBreakStart.break_type || 'unspecified',
            duration_minutes: null,
            // is_complete: false // This field belongs to daily_summary, not time_segments
          });
        
        if (insertError) {
          console.error(`[DEBUG] Error creating open break segment for staff ${staffId}, break-start ${pendingBreakStart.id}:`, insertError);
        } else {
          // console.log(`[DEBUG] Successfully created open break segment for break-start ${pendingBreakStart.id}.`);
          processedInEvents.add(pendingBreakStart.id);
        }
      }
      // console.log(`[DEBUG] Finished processing for staff_id: ${currentStaffId}`);

      // Regenerate the daily summary only for the staff member we just processed
      await generateDailySummary(dateStr, currentStaffId);
    }

    // console.log(`[DEBUG] All staff processed for ${dateStr}.`);
    
  } catch (error) {
    console.error('[DEBUG] Critical error in processClockEventsIntoSegments:', error);
  }
  // console.log(`[DEBUG] Exiting processClockEventsIntoSegments for date: ${dateStr}`);
};

/**
 * Process all existing clock events for all dates
 * This is useful for fixing data issues or when segments are missing
 */
export const processAllClockEvents = async (): Promise<void> => {
  try {
    // Get all unique dates with clock events
    const { data: dateData, error: dateError } = await supabase
      .from('time_clock_events')
      .select('event_time')
      .order('event_time', { ascending: true });
    
    if (dateError) {
      console.error('Error fetching dates:', dateError);
      return;
    }
    
    if (!dateData || dateData.length === 0) {
      console.log('No clock events found');
      return;
    }
    
    // Extract unique dates
    const uniqueDates = new Set<string>();
    dateData.forEach(item => {
      const date = new Date(item.event_time).toISOString().split('T')[0];
      uniqueDates.add(date);
    });
    
    console.log(`Found ${uniqueDates.size} unique dates with clock events`);
    
    // Process each date
    for (const dateStr of uniqueDates) {
      console.log(`Processing clock events for date: ${dateStr}`);
      await processClockEventsIntoSegments(dateStr);
    }
    
    console.log('Finished processing all clock events');
  } catch (error) {
    console.error('Error processing all clock events:', error);
  }
};

/**
 * Generate daily summary from time segments for a specific date
 * This aggregates all segments into a daily summary record
 */
export const generateDailySummary = async (dateStr: string, staffId?: number): Promise<void> => {
  // console.log(`[DEBUG] Starting generateDailySummary for date: ${dateStr}, staffId: ${staffId}`);
  try {
    // Fetch segments for the date (filtered by staff if provided)
    let segmentsQuery = supabase
      .from('time_segments')
      .select('*')
      .eq('date_worked', dateStr);
      
    if (staffId) {
      segmentsQuery = segmentsQuery.eq('staff_id', staffId);
      // console.log(`[DEBUG] Filtering segments by staffId: ${staffId}`);
    }
    
    const { data: segments, error: segmentsError } = await segmentsQuery;
      
    if (segmentsError) {
      console.error('Error fetching time segments:', segmentsError);
      return;
    }
    
    if (!segments || segments.length === 0) {
      // If we're processing a specific staff member and they have no segments,
      // we should delete any existing stale daily summary record
      if (staffId) {
        // console.log(`[DEBUG] No segments found for staff ${staffId}, deleting any existing daily summary`);
        const { error: deleteError } = await supabase
          .from('time_daily_summary')
          .delete()
          .eq('staff_id', staffId)
          .eq('date_worked', dateStr);
          
        if (deleteError) {
          console.error('Error deleting stale daily summary:', deleteError);
        } else {
          // console.log(`[DEBUG] Deleted stale daily summary for staff ${staffId} on ${dateStr}`);
        }
      }
      return;
    }
    
    // Group segments by staff
    const staffSegments: Record<number, any[]> = {};
    segments.forEach(segment => {
      if (!staffSegments[segment.staff_id]) staffSegments[segment.staff_id] = [];
      staffSegments[segment.staff_id].push(segment);
    });
    
    // Generate summary for each staff
    for (const [staffIdStr, staffSegmentList] of Object.entries(staffSegments)) {
      const staffId = parseInt(staffIdStr);
      
      // Filter segments by type
      const workSegments = staffSegmentList.filter(s => s.segment_type === 'work');
      const breakSegments = staffSegmentList.filter(s => s.segment_type === 'break');
      
      // Calculate totals
      const totalWorkMinutes = workSegments.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
      const totalBreakMinutes = breakSegments.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
      
      // Calculate break type minutes
      const lunchBreakMinutes = breakSegments
        .filter(s => s.break_type === 'lunch')
        .reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
        
      const otherBreakMinutes = totalBreakMinutes - lunchBreakMinutes;
      
      // Find first clock-in and last clock-out
      let firstClockIn = null;
      let lastClockOut = null;
      
      if (workSegments.length > 0) {
        // Sort segments by start time
        const sortedByStart = [...workSegments].sort(
          (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        );
        
        // Sort segments by end time (descending)
        const sortedByEnd = [...workSegments]
          .filter(s => s.end_time) // Filter out segments with no end time
          .sort((a, b) => {
            // Handle null end_time (still clocked in)
            if (!a.end_time) return 1;
            if (!b.end_time) return -1;
            return new Date(b.end_time).getTime() - new Date(a.end_time).getTime();
          });
        
        firstClockIn = sortedByStart[0]?.start_time;
        lastClockOut = sortedByEnd[0]?.end_time;
      }
      
      // Check if there's an existing summary for this staff and date
      // Use limit(1) to ensure we only get one row even if there are duplicates
      const { data: existingSummaries, error: summaryError } = await supabase
        .from('time_daily_summary')
        .select('id')
        .eq('staff_id', staffId)
        .eq('date_worked', dateStr)
        .limit(1);
        
      const existingSummary = existingSummaries && existingSummaries.length > 0 ? existingSummaries[0] : null;
        
      if (summaryError) {
        console.error(`Error checking existing summary for staff ${staffId}:`, summaryError);
        continue;
      }
      
      // Determine if the day is complete (has both clock in and out)
      const isComplete = !!lastClockOut;

      const { regularMinutes, otMinutes, dtMinutes, totalHoursWorked } = calculateDailyMinuteBreakdown(
        dateStr,
        totalWorkMinutes
      );
      const rate = await fetchHourlyRate(staffId);
      const wageCents = calculateWageCents(regularMinutes, otMinutes, dtMinutes, rate);
      
      // Create or update the summary
      if (existingSummary) {
        // Update existing summary
        const { error: updateError } = await supabase
          .from('time_daily_summary')
          .update({
            first_clock_in: firstClockIn,
            last_clock_out: lastClockOut,
            total_work_minutes: totalWorkMinutes,
            total_break_minutes: totalBreakMinutes,
            lunch_break_minutes: lunchBreakMinutes,
            other_breaks_minutes: otherBreakMinutes,
            regular_minutes: regularMinutes,
            dt_minutes: dtMinutes,
            ot_minutes: otMinutes,
            wage_cents: wageCents,
            is_complete: isComplete,
            updated_at: new Date().toISOString(),
            total_hours_worked: totalHoursWorked
          })
          .eq('id', existingSummary.id);
          
        if (updateError) {
          console.error(`Error updating summary for staff ${staffId}:`, updateError);
        }
      } else {
        // Create new summary
        const { error: insertError } = await supabase
          .from('time_daily_summary')
          .insert({
            staff_id: staffId,
            date_worked: dateStr,
            first_clock_in: firstClockIn,
            last_clock_out: lastClockOut,
            total_work_minutes: totalWorkMinutes,
            total_break_minutes: totalBreakMinutes,
            lunch_break_minutes: lunchBreakMinutes,
            other_breaks_minutes: otherBreakMinutes,
            regular_minutes: regularMinutes,
            dt_minutes: dtMinutes,
            ot_minutes: otMinutes,
            wage_cents: wageCents,
            is_complete: isComplete,
            total_hours_worked: totalHoursWorked,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
          
        if (insertError) {
          console.error(`Error creating summary for staff ${staffId}:`, insertError);
        }
      }
    }
    
    console.log(`Successfully generated daily summaries for ${dateStr}`);
  } catch (error) {
    console.error('Error in generateDailySummary:', error);
  }
};

/**
 * Add a manual clock event for a staff member
 */
export const addManualClockEvent = async (
  staffId: number,
  eventType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
  dateStr: string,
  timeStr: string,
  breakType?: 'lunch' | 'morning' | 'afternoon' | null,
  notes?: string
): Promise<{ success: boolean; error?: any }> => {
  try {
    // Step 1: Insert the clock event directly
    const eventTime = new Date(createSASTTimestamp(dateStr, timeStr));
    const notesValue = notes || 'Manually added by administrator';
    
    console.log(`Adding manual event: ${eventType} at ${dateStr}T${timeStr} for staff ${staffId}`);
    
    // Generate a UUID for the event
    const eventId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    
    // Use direct SQL query to insert the event without triggering the trigger
    // This avoids the "more than one row returned by a subquery" error
    // Attempt to insert via RPC, fallback to direct insert
    let eventInserted = false;
    const { data: insertedEvent, error: rpcError } = await supabase.rpc(
      'add_manual_clock_event_v2',
      {
        p_staff_id: staffId,
        p_event_time: eventTime.toISOString(),
        p_event_type: eventType,
        p_break_type: breakType || null,
        p_notes: notesValue
      }
    );
    if (!rpcError) {
      eventInserted = true;
    } else {
      console.log('RPC failed, trying direct insert:', rpcError);
      const { data: directInsert, error: directError } = await supabase
        .from('time_clock_events')
        .insert({
          id: eventId,
          staff_id: staffId,
          event_time: eventTime.toISOString(),
          event_type: eventType,
          break_type: breakType || null,
          verification_method: 'manual',
          notes: notesValue,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select();
      if (directError) {
        console.error('Direct insert also failed:', directError);
        return { success: false, error: directError };
      }
      eventInserted = true;
    }
    if (!eventInserted) {
      console.error('Error inserting clock event via RPC:', rpcError);
      return { success: false, error: rpcError };
    }
    
    // Step 2: Process segments manually
    // Only create segments for clock_out and break_end events
    // Get the newly inserted event ID
    let newEventId: string | undefined;
    
    // Query to get the most recently inserted event for this staff member and time
    const { data: recentEvents } = await supabase
      .from('time_clock_events')
      .select('id')
      .eq('staff_id', staffId)
      .eq('event_time', eventTime.toISOString())
      .eq('event_type', eventType)
      .eq('verification_method', 'manual')
      .order('created_at', { ascending: false })
      .limit(1);
      
    if (recentEvents && recentEvents.length > 0) {
      newEventId = recentEvents[0].id;
    }
    
    if (eventType === 'clock_out' || eventType === 'break_end') {
      try {
        // Find the matching clock_in or break_start event
        const matchingEventType = eventType === 'clock_out' ? 'clock_in' : 'break_start';
        
        const { data: matchingEvents } = await supabase
          .from('time_clock_events')
          .select('*')
          .eq('staff_id', staffId)
          .eq('event_time::date', dateStr)
          .eq('event_type', matchingEventType)
          .order('event_time', { ascending: false });
        
        // Find events that aren't already paired in segments
        const { data: existingSegments } = await supabase
          .from('time_segments')
          .select('clock_in_event_id')
          .eq('staff_id', staffId)
          .eq('date_worked', dateStr);
        
        // Create a set of already processed event IDs
        const processedEventIds = new Set();
        if (existingSegments && existingSegments.length > 0) {
          existingSegments.forEach(segment => {
            if (segment.clock_in_event_id) {
              processedEventIds.add(segment.clock_in_event_id);
            }
          });
        }
        
        // Find the most recent unpaired matching event
        const unpaired = matchingEvents?.filter(event => !processedEventIds.has(event.id)) || [];
        
        if (unpaired.length > 0) {
          const matchingEvent = unpaired[0];
          const segmentType = eventType === 'clock_out' ? 'work' : 'break';
          const insertedEventId = newEventId || eventId;
          
          // Calculate duration
          const durationMins = calculateDurationMinutes(
            matchingEvent.event_time,
            eventTime.toISOString() // eventTime is from: const eventTime = new Date(`${dateStr}T${timeStr}`);
          );

          // Determine clock_in_event_id and clock_out_event_id based on eventType
          let cin_id: string | null = null;
          let cout_id: string | null = null;
          let s_time: string | null = null;
          let e_time: string | null = null;

          if (eventType === 'clock_out' || eventType === 'break_end') {
            cin_id = matchingEvent.id;
            cout_id = insertedEventId;
            s_time = matchingEvent.event_time;
            e_time = eventTime.toISOString();
          } else { // clock_in or break_start
            cin_id = insertedEventId;
            cout_id = matchingEvent.id;
            s_time = eventTime.toISOString();
            e_time = matchingEvent.event_time;
          }
          
          // Determine break_type for the segment
          let segmentBreakType: string | null = null;
          if (segmentType === 'break') {
            if (eventType === 'break_end') {
              segmentBreakType = matchingEvent.break_type || null;
            } else { // break_start
              segmentBreakType = breakType || null; // breakType is a parameter of addManualClockEvent
            }
          }

          // Create the segment
          // console.log(`[DEBUG] addManualClockEvent: Creating ${segmentType} segment: ${s_time} to ${e_time}`);
          await supabase
            .from('time_segments')
            .insert({
              staff_id: staffId,
              date_worked: dateStr,
              clock_in_event_id: cin_id,
              clock_out_event_id: cout_id,
              start_time: s_time,
              end_time: e_time,
              segment_type: segmentType, 
              break_type: segmentBreakType,
              duration_minutes: durationMins
              // No is_complete here, as it's not in time_segments table
            });
        }
      } catch (segmentError) {
        console.error('Error creating segment:', segmentError);
        // Continue despite segment error
      }
    }
    
    // Step 3: Update the daily summary
    try {
      // Get all segments for this staff and date
      const { data: segments } = await supabase
        .from('time_segments')
        .select('*')
        .eq('staff_id', staffId)
        .eq('date_worked', dateStr);
      
      // Get all clock events for this staff and date
      const { data: clockEvents } = await supabase
        .from('time_clock_events')
        .select('*')
        .eq('staff_id', staffId)
        .eq('event_time::date', dateStr);
      
      if (segments && clockEvents) {
        // Calculate summary data
        const workSegments = segments.filter(s => s.segment_type === 'work');
        const breakSegments = segments.filter(s => s.segment_type === 'break');
        
        const totalWorkMinutes = workSegments.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
        const totalBreakMinutes = breakSegments.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
        
        const lunchBreakMinutes = breakSegments
          .filter(s => s.break_type === 'lunch')
          .reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
        
        const otherBreakMinutes = totalBreakMinutes - lunchBreakMinutes;
        
        // Get first clock-in and last clock-out
        const clockInEvents = clockEvents.filter(e => e.event_type === 'clock_in');
        const clockOutEvents = clockEvents.filter(e => e.event_type === 'clock_out');
        
        // Sort by time
        clockInEvents.sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
        clockOutEvents.sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
        
        const firstClockIn = clockInEvents.length > 0 ? clockInEvents[0].event_time : null;
        const lastClockOut = clockOutEvents.length > 0 ? clockOutEvents[0].event_time : null;
        const { regularMinutes, otMinutes, dtMinutes, totalHoursWorked } = calculateDailyMinuteBreakdown(
          dateStr,
          totalWorkMinutes
        );
        const rate = await fetchHourlyRate(staffId);
        const wageCents = calculateWageCents(regularMinutes, otMinutes, dtMinutes, rate);
        
        // Check if a summary exists
        const { data: existingSummaries } = await supabase
          .from('time_daily_summary')
          .select('id')
          .eq('staff_id', staffId)
          .eq('date_worked', dateStr);
        
        if (existingSummaries && existingSummaries.length > 0) {
          // Update existing summary
          await supabase
            .from('time_daily_summary')
            .update({
              first_clock_in: firstClockIn,
              last_clock_out: lastClockOut,
              total_work_minutes: totalWorkMinutes,
              total_break_minutes: totalBreakMinutes,
              lunch_break_minutes: lunchBreakMinutes,
              other_breaks_minutes: otherBreakMinutes,
              regular_minutes: regularMinutes,
              ot_minutes: otMinutes,
              dt_minutes: dtMinutes,
              wage_cents: wageCents,
              total_hours_worked: totalHoursWorked,
              is_complete: !!lastClockOut,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingSummaries[0].id);
        } else {
          // Create new summary
          await supabase
            .from('time_daily_summary')
            .insert({
              staff_id: staffId,
              date_worked: dateStr,
              first_clock_in: firstClockIn,
              last_clock_out: lastClockOut,
              total_work_minutes: totalWorkMinutes,
              total_break_minutes: totalBreakMinutes,
              lunch_break_minutes: lunchBreakMinutes,
              other_breaks_minutes: otherBreakMinutes,
              regular_minutes: regularMinutes,
              ot_minutes: otMinutes,
              dt_minutes: dtMinutes,
              wage_cents: wageCents,
              total_hours_worked: totalHoursWorked,
              is_complete: !!lastClockOut,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
        }
      }
    } catch (summaryError) {
      console.error('Error updating daily summary:', summaryError);
      // Continue despite summary error
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error in addManualClockEvent:', error);
    return { success: false, error };
  }
};

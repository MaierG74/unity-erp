-- Migration: Batch process attendance for improved performance
-- Replaces ~400 sequential DB calls with a single RPC call

CREATE OR REPLACE FUNCTION process_attendance_for_date(
  p_date_worked DATE,
  p_staff_id INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sast_start TIMESTAMPTZ;
  v_sast_end TIMESTAMPTZ;
  v_staff_processed INTEGER := 0;
  v_segments_created INTEGER := 0;
  v_summaries_updated INTEGER := 0;
  v_day_of_week INTEGER;
BEGIN
  -- 1. Calculate SAST day boundaries (UTC+2)
  v_sast_start := (p_date_worked::TEXT || 'T00:00:00+02:00')::TIMESTAMPTZ;
  v_sast_end := ((p_date_worked + INTERVAL '1 day')::DATE::TEXT || 'T00:00:00+02:00')::TIMESTAMPTZ;
  v_day_of_week := EXTRACT(DOW FROM p_date_worked); -- 0 = Sunday

  -- 2. Delete existing segments for the date (and optional staff filter)
  DELETE FROM time_segments
  WHERE date_worked = p_date_worked
    AND (p_staff_id IS NULL OR staff_id = p_staff_id);

  -- 3. Delete existing summaries for the date (and optional staff filter)
  DELETE FROM time_daily_summary
  WHERE date_worked = p_date_worked
    AND (p_staff_id IS NULL OR staff_id = p_staff_id);

  -- 4. Create segments by pairing events
  -- Use a single CTE chain to:
  --   a) Get all events for the date
  --   b) Pair clock_in/clock_out into work segments
  --   c) Pair break_start/break_end into break segments
  --   d) Handle open shifts (clock_in without clock_out)
  --   e) Handle open breaks (break_start without break_end)
  WITH
  -- Get all events for the date range
  day_events AS (
    SELECT
      id,
      staff_id,
      event_time,
      event_type,
      break_type,
      ROW_NUMBER() OVER (PARTITION BY staff_id, event_type ORDER BY event_time) as event_seq
    FROM time_clock_events
    WHERE event_time >= v_sast_start
      AND event_time < v_sast_end
      AND (p_staff_id IS NULL OR staff_id = p_staff_id)
  ),

  -- Pair clock_in with clock_out events
  -- Match each clock_out to the most recent unpaired clock_in before it
  work_pairs AS (
    SELECT
      cin.staff_id,
      cin.id as clock_in_id,
      cout.id as clock_out_id,
      cin.event_time as start_time,
      cout.event_time as end_time,
      EXTRACT(EPOCH FROM (cout.event_time - cin.event_time)) / 60 as duration_minutes
    FROM day_events cin
    INNER JOIN day_events cout
      ON cin.staff_id = cout.staff_id
      AND cin.event_type = 'clock_in'
      AND cout.event_type = 'clock_out'
      AND cin.event_seq = cout.event_seq  -- Match by sequence number within staff
  ),

  -- Pair break_start with break_end events
  break_pairs AS (
    SELECT
      bs.staff_id,
      bs.id as break_start_id,
      be.id as break_end_id,
      bs.event_time as start_time,
      be.event_time as end_time,
      bs.break_type,
      EXTRACT(EPOCH FROM (be.event_time - bs.event_time)) / 60 as duration_minutes
    FROM day_events bs
    INNER JOIN day_events be
      ON bs.staff_id = be.staff_id
      AND bs.event_type = 'break_start'
      AND be.event_type = 'break_end'
      AND bs.event_seq = be.event_seq  -- Match by sequence number within staff
  ),

  -- Find unpaired clock_ins (open shifts)
  open_shifts AS (
    SELECT
      e.staff_id,
      e.id as clock_in_id,
      e.event_time as start_time
    FROM day_events e
    WHERE e.event_type = 'clock_in'
      AND NOT EXISTS (
        SELECT 1 FROM work_pairs wp WHERE wp.clock_in_id = e.id
      )
  ),

  -- Find unpaired break_starts (open breaks)
  open_breaks AS (
    SELECT
      e.staff_id,
      e.id as break_start_id,
      e.event_time as start_time,
      e.break_type
    FROM day_events e
    WHERE e.event_type = 'break_start'
      AND NOT EXISTS (
        SELECT 1 FROM break_pairs bp WHERE bp.break_start_id = e.id
      )
  ),

  -- Insert work segments
  inserted_work AS (
    INSERT INTO time_segments (
      id, staff_id, date_worked, clock_in_event_id, clock_out_event_id,
      start_time, end_time, segment_type, break_type, duration_minutes,
      created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      staff_id,
      p_date_worked,
      clock_in_id,
      clock_out_id,
      start_time,
      end_time,
      'work',
      NULL,
      ROUND(duration_minutes)::INTEGER,
      NOW(),
      NOW()
    FROM work_pairs
    RETURNING id
  ),

  -- Insert break segments
  inserted_breaks AS (
    INSERT INTO time_segments (
      id, staff_id, date_worked, clock_in_event_id, clock_out_event_id,
      start_time, end_time, segment_type, break_type, duration_minutes,
      created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      staff_id,
      p_date_worked,
      break_start_id,
      break_end_id,
      start_time,
      end_time,
      'break',
      break_type,
      ROUND(duration_minutes)::INTEGER,
      NOW(),
      NOW()
    FROM break_pairs
    RETURNING id
  ),

  -- Insert open shift segments (clock_in without clock_out)
  inserted_open_shifts AS (
    INSERT INTO time_segments (
      id, staff_id, date_worked, clock_in_event_id, clock_out_event_id,
      start_time, end_time, segment_type, break_type, duration_minutes,
      created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      staff_id,
      p_date_worked,
      clock_in_id,
      NULL,
      start_time,
      NULL,
      'work',
      NULL,
      NULL,
      NOW(),
      NOW()
    FROM open_shifts
    RETURNING id
  ),

  -- Insert open break segments (break_start without break_end)
  inserted_open_breaks AS (
    INSERT INTO time_segments (
      id, staff_id, date_worked, clock_in_event_id, clock_out_event_id,
      start_time, end_time, segment_type, break_type, duration_minutes,
      created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      staff_id,
      p_date_worked,
      break_start_id,
      NULL,
      start_time,
      NULL,
      'break',
      break_type,
      NULL,
      NOW(),
      NOW()
    FROM open_breaks
    RETURNING id
  ),

  -- Count total segments created
  segment_counts AS (
    SELECT
      (SELECT COUNT(*) FROM inserted_work) +
      (SELECT COUNT(*) FROM inserted_breaks) +
      (SELECT COUNT(*) FROM inserted_open_shifts) +
      (SELECT COUNT(*) FROM inserted_open_breaks) as total
  )
  SELECT total INTO v_segments_created FROM segment_counts;

  -- 5. Generate daily summaries from the newly created segments
  WITH
  -- Aggregate segment data per staff
  segment_aggregates AS (
    SELECT
      s.staff_id,
      MIN(CASE WHEN s.segment_type = 'work' THEN s.start_time END) as first_clock_in,
      MAX(CASE WHEN s.segment_type = 'work' AND s.end_time IS NOT NULL THEN s.end_time END) as last_clock_out,
      COALESCE(SUM(CASE WHEN s.segment_type = 'work' THEN s.duration_minutes ELSE 0 END), 0)::INTEGER as total_work_minutes,
      COALESCE(SUM(CASE WHEN s.segment_type = 'break' THEN s.duration_minutes ELSE 0 END), 0)::INTEGER as total_break_minutes,
      COALESCE(SUM(CASE WHEN s.segment_type = 'break' AND s.break_type = 'lunch' THEN s.duration_minutes ELSE 0 END), 0)::INTEGER as lunch_break_minutes,
      BOOL_AND(s.end_time IS NOT NULL OR s.segment_type = 'break') as is_complete
    FROM time_segments s
    WHERE s.date_worked = p_date_worked
      AND (p_staff_id IS NULL OR s.staff_id = p_staff_id)
    GROUP BY s.staff_id
  ),

  -- Get staff hourly rates
  staff_rates AS (
    SELECT staff_id, COALESCE(hourly_rate, 0)::NUMERIC as hourly_rate
    FROM staff
  ),

  -- Compute payroll values
  computed_summaries AS (
    SELECT
      sa.staff_id,
      sa.first_clock_in,
      sa.last_clock_out,
      sa.total_work_minutes,
      sa.total_break_minutes,
      sa.lunch_break_minutes,
      (sa.total_break_minutes - sa.lunch_break_minutes)::INTEGER as other_breaks_minutes,
      COALESCE(sa.is_complete, false) as is_complete,
      -- Apply tea break deduction for Mon-Thu (day_of_week 1-4)
      CASE
        WHEN v_day_of_week BETWEEN 1 AND 4
        THEN GREATEST(sa.total_work_minutes - 30, 0)
        ELSE sa.total_work_minutes
      END::INTEGER as net_work_minutes,
      COALESCE(sr.hourly_rate, 0) as hourly_rate
    FROM segment_aggregates sa
    LEFT JOIN staff_rates sr ON sr.staff_id = sa.staff_id
  ),

  -- Calculate regular/OT/DT minutes
  payroll_calcs AS (
    SELECT
      cs.*,
      -- Regular minutes: first 9 hours (540 min), 0 on Sunday
      CASE
        WHEN v_day_of_week = 0 THEN 0
        ELSE LEAST(cs.net_work_minutes, 540)
      END::INTEGER as regular_minutes,
      -- OT minutes: after 9 hours, 0 on Sunday
      CASE
        WHEN v_day_of_week = 0 THEN 0
        ELSE GREATEST(cs.net_work_minutes - 540, 0)
      END::INTEGER as ot_minutes,
      -- DT minutes: all work on Sunday
      CASE
        WHEN v_day_of_week = 0 THEN cs.net_work_minutes
        ELSE 0
      END::INTEGER as dt_minutes
    FROM computed_summaries cs
  ),

  -- Calculate wage cents
  final_summaries AS (
    SELECT
      pc.*,
      -- wage_cents = (regular_hrs * rate) + (ot_hrs * rate * 1.5) + (dt_hrs * rate * 2)
      ROUND(
        (pc.regular_minutes / 60.0 * pc.hourly_rate) +
        (pc.ot_minutes / 60.0 * pc.hourly_rate * 1.5) +
        (pc.dt_minutes / 60.0 * pc.hourly_rate * 2)
      )::BIGINT * 100 as wage_cents,
      ROUND(pc.net_work_minutes / 60.0, 2) as total_hours_worked
    FROM payroll_calcs pc
  ),

  -- Insert all summaries
  inserted_summaries AS (
    INSERT INTO time_daily_summary (
      id, staff_id, date_worked, first_clock_in, last_clock_out,
      total_work_minutes, total_break_minutes, lunch_break_minutes, other_breaks_minutes,
      is_complete, regular_minutes, ot_minutes, dt_minutes, wage_cents,
      total_hours_worked, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      staff_id,
      p_date_worked,
      first_clock_in,
      last_clock_out,
      total_work_minutes,
      total_break_minutes,
      lunch_break_minutes,
      other_breaks_minutes,
      is_complete,
      regular_minutes,
      ot_minutes,
      dt_minutes,
      wage_cents,
      total_hours_worked,
      NOW(),
      NOW()
    FROM final_summaries
    RETURNING id
  )
  SELECT COUNT(*) INTO v_summaries_updated FROM inserted_summaries;

  -- Count distinct staff processed
  SELECT COUNT(DISTINCT staff_id) INTO v_staff_processed
  FROM time_segments
  WHERE date_worked = p_date_worked
    AND (p_staff_id IS NULL OR staff_id = p_staff_id);

  -- Return success with stats
  RETURN jsonb_build_object(
    'success', true,
    'date_worked', p_date_worked,
    'staff_processed', v_staff_processed,
    'segments_created', v_segments_created,
    'summaries_updated', v_summaries_updated,
    'single_staff', p_staff_id IS NOT NULL
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'error_detail', SQLSTATE,
    'date_worked', p_date_worked
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION process_attendance_for_date(DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION process_attendance_for_date(DATE, INTEGER) TO service_role;

COMMENT ON FUNCTION process_attendance_for_date IS
'Batch processes clock events into segments and generates daily summaries for a given date.
Optionally filter to a single staff member with p_staff_id.
Returns JSONB with processing stats: {success, staff_processed, segments_created, summaries_updated}.
Business rules applied:
- Mon-Thu: 30-min tea break deduction
- Regular time: first 9 hours (540 minutes)
- Overtime: hours after 9, paid at 1.5x
- Sunday: all hours are double-time at 2x';

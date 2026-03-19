# Job Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the progress override slider in the factory floor detail panel with three job actions: Complete Job, Pause Job, and Transfer Job.

**Architecture:** Four new Postgres RPCs handle the business logic atomically (pause, resume, complete, transfer). A new `assignment_pause_events` table tracks pause history with reasons. The `factory_floor_status` view is updated to include pause-aware elapsed time and paused state. Three new dialog components + a `useJobActions` hook provide the UI. The existing detail panel is modified to show the action buttons instead of the slider.

**Tech Stack:** Supabase (Postgres RPCs, migrations), React, TanStack Query, shadcn/ui dialogs, Tailwind CSS

**Design doc:** `docs/plans/2026-03-01-job-actions-design.md`

---

## Task 1: Create `assignment_pause_events` Table

**Files:**
- Create migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with name `create_assignment_pause_events` and this SQL:

```sql
CREATE TABLE assignment_pause_events (
  assignment_pause_event_id  SERIAL PRIMARY KEY,
  assignment_id              INTEGER NOT NULL REFERENCES labor_plan_assignments(assignment_id) ON DELETE CASCADE,
  org_id                     UUID NOT NULL,
  reason                     TEXT NOT NULL CHECK (reason IN ('waiting_materials', 'machine_breakdown', 'break', 'quality_issue', 'other')),
  notes                      TEXT,
  paused_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed_at                 TIMESTAMPTZ,
  paused_by                  UUID NOT NULL DEFAULT auth.uid(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by assignment
CREATE INDEX idx_pause_events_assignment ON assignment_pause_events(assignment_id);

-- RLS
ALTER TABLE assignment_pause_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pause events in their org"
  ON assignment_pause_events FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert pause events in their org"
  ON assignment_pause_events FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can update pause events in their org"
  ON assignment_pause_events FOR UPDATE
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
```

**Step 2: Verify with security advisor**

Run `mcp__supabase__get_advisors` with type `security` to check for missing RLS.

**Step 3: Test with a query**

Run `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'assignment_pause_events'
ORDER BY ordinal_position;
```

Expected: 9 columns matching the definition above.

---

## Task 2: Create `pause_assignment` and `resume_assignment` RPCs

**Files:**
- Create migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with name `pause_resume_assignment_rpcs` and this SQL:

```sql
-- Pause an assignment: sets job_status to 'on_hold', creates pause event
CREATE OR REPLACE FUNCTION pause_assignment(
  p_assignment_id INTEGER,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_org_id UUID;
  v_job_status TEXT;
  v_open_pause_exists BOOLEAN;
BEGIN
  -- Get assignment and resolve org_id
  SELECT o.org_id, lpa.job_status
  INTO v_org_id, v_job_status
  FROM labor_plan_assignments lpa
  JOIN orders o ON o.order_id = lpa.order_id
  WHERE lpa.assignment_id = p_assignment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Assignment % not found or has no linked order', p_assignment_id;
  END IF;

  -- Verify org membership
  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  -- Must be in_progress to pause
  IF v_job_status != 'in_progress' THEN
    RAISE EXCEPTION 'Cannot pause assignment with status %', v_job_status;
  END IF;

  -- Check no open pause event exists
  SELECT EXISTS(
    SELECT 1 FROM assignment_pause_events
    WHERE assignment_id = p_assignment_id AND resumed_at IS NULL
  ) INTO v_open_pause_exists;

  IF v_open_pause_exists THEN
    RAISE EXCEPTION 'Assignment % is already paused', p_assignment_id;
  END IF;

  -- Validate reason
  IF p_reason NOT IN ('waiting_materials', 'machine_breakdown', 'break', 'quality_issue', 'other') THEN
    RAISE EXCEPTION 'Invalid pause reason: %', p_reason;
  END IF;

  -- Insert pause event
  INSERT INTO assignment_pause_events (assignment_id, org_id, reason, notes)
  VALUES (p_assignment_id, v_org_id, p_reason, p_notes);

  -- Update assignment status
  UPDATE labor_plan_assignments
  SET job_status = 'on_hold', updated_at = now()
  WHERE assignment_id = p_assignment_id;
END;
$$;

-- Resume an assignment: closes open pause event, sets job_status back to 'in_progress'
CREATE OR REPLACE FUNCTION resume_assignment(p_assignment_id INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_org_id UUID;
  v_job_status TEXT;
BEGIN
  -- Get assignment and resolve org_id
  SELECT o.org_id, lpa.job_status
  INTO v_org_id, v_job_status
  FROM labor_plan_assignments lpa
  JOIN orders o ON o.order_id = lpa.order_id
  WHERE lpa.assignment_id = p_assignment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Assignment % not found or has no linked order', p_assignment_id;
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  IF v_job_status != 'on_hold' THEN
    RAISE EXCEPTION 'Cannot resume assignment with status %', v_job_status;
  END IF;

  -- Close the open pause event
  UPDATE assignment_pause_events
  SET resumed_at = now()
  WHERE assignment_id = p_assignment_id AND resumed_at IS NULL;

  -- Resume assignment
  UPDATE labor_plan_assignments
  SET job_status = 'in_progress', updated_at = now()
  WHERE assignment_id = p_assignment_id;
END;
$$;

-- Permissions
REVOKE EXECUTE ON FUNCTION pause_assignment(INTEGER, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION pause_assignment(INTEGER, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION resume_assignment(INTEGER) FROM anon, public;
GRANT EXECUTE ON FUNCTION resume_assignment(INTEGER) TO authenticated;
```

**Step 2: Test pause RPC**

Run `mcp__supabase__execute_sql`:
```sql
SELECT proname, pronargs FROM pg_proc WHERE proname IN ('pause_assignment', 'resume_assignment');
```
Expected: both functions exist.

---

## Task 3: Create `complete_assignment_with_card` RPC

**Files:**
- Create migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with name `complete_assignment_with_card_rpc` and this SQL:

```sql
-- Completes an assignment AND its linked job card items atomically
-- p_items: [{"item_id": 1, "completed_quantity": 10}, ...]
CREATE OR REPLACE FUNCTION complete_assignment_with_card(
  p_assignment_id INTEGER,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_actual_start TIMESTAMPTZ DEFAULT NULL,
  p_actual_end TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
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
  v_now TIMESTAMPTZ := now();
  v_item JSONB;
BEGIN
  -- Get assignment details
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

  -- Update the assignment
  UPDATE labor_plan_assignments SET
    job_status = 'completed',
    completed_at = v_now,
    actual_start_minutes = v_start_minutes,
    actual_end_minutes = v_end_minutes,
    actual_duration_minutes = v_end_minutes - v_start_minutes,
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
    -- Update items with provided quantities
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

    -- Any remaining untouched items: set completed_quantity = quantity
    UPDATE job_card_items
    SET completed_quantity = quantity,
        status = 'completed',
        completion_time = v_now
    WHERE job_card_id = v_job_card_id
      AND status != 'completed';

    -- Mark job card as completed
    UPDATE job_cards
    SET status = 'completed',
        completion_date = v_now::date
    WHERE job_card_id = v_job_card_id;
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', p_assignment_id,
    'job_card_id', v_job_card_id,
    'completed_at', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_assignment_with_card(INTEGER, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION complete_assignment_with_card(INTEGER, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
```

**Step 2: Verify function exists**

```sql
SELECT proname FROM pg_proc WHERE proname = 'complete_assignment_with_card';
```

---

## Task 4: Create `transfer_assignment` RPC

**Files:**
- Create migration via Supabase MCP `apply_migration`

**Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with name `transfer_assignment_rpc` and this SQL:

```sql
-- Transfers a job assignment to a different staff member.
-- Pre-start: simple reassign.
-- Mid-work: complete original at actual qty, create new card for remainder.
CREATE OR REPLACE FUNCTION transfer_assignment(
  p_assignment_id INTEGER,
  p_new_staff_id INTEGER,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_org_id UUID;
  v_job_status TEXT;
  v_old_staff_id INTEGER;
  v_order_id INTEGER;
  v_job_id INTEGER;
  v_order_detail_id INTEGER;
  v_bol_id INTEGER;
  v_job_instance_id TEXT;
  v_assignment_date DATE;
  v_start_minutes INTEGER;
  v_end_minutes INTEGER;
  v_pay_type TEXT;
  v_hourly_rate_id INTEGER;
  v_piece_rate_id INTEGER;
  v_job_card_id INTEGER;
  v_new_job_card_id INTEGER;
  v_new_assignment_id INTEGER;
  v_now TIMESTAMPTZ := now();
  v_item RECORD;
  v_has_progress BOOLEAN := false;
BEGIN
  -- Get assignment details
  SELECT o.org_id, lpa.job_status, lpa.staff_id, lpa.order_id, lpa.job_id,
         lpa.order_detail_id, lpa.bol_id, lpa.job_instance_id,
         lpa.assignment_date, lpa.start_minutes, lpa.end_minutes,
         lpa.pay_type, lpa.hourly_rate_id, lpa.piece_rate_id
  INTO v_org_id, v_job_status, v_old_staff_id, v_order_id, v_job_id,
       v_order_detail_id, v_bol_id, v_job_instance_id,
       v_assignment_date, v_start_minutes, v_end_minutes,
       v_pay_type, v_hourly_rate_id, v_piece_rate_id
  FROM labor_plan_assignments lpa
  JOIN orders o ON o.order_id = lpa.order_id
  WHERE lpa.assignment_id = p_assignment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Assignment % not found or has no linked order', p_assignment_id;
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  IF v_job_status NOT IN ('scheduled', 'issued', 'in_progress', 'on_hold') THEN
    RAISE EXCEPTION 'Cannot transfer assignment with status %', v_job_status;
  END IF;

  IF v_old_staff_id = p_new_staff_id THEN
    RAISE EXCEPTION 'Cannot transfer to the same staff member';
  END IF;

  -- Close any open pause events
  UPDATE assignment_pause_events
  SET resumed_at = v_now
  WHERE assignment_id = p_assignment_id AND resumed_at IS NULL;

  -- Find linked job card
  SELECT jk.job_card_id INTO v_job_card_id
  FROM job_cards jk
  WHERE jk.order_id = v_order_id AND jk.staff_id = v_old_staff_id
  ORDER BY jk.created_at DESC
  LIMIT 1;

  -- Check if any items have progress
  IF v_job_card_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM job_card_items
      WHERE job_card_id = v_job_card_id AND completed_quantity > 0
    ) INTO v_has_progress;
  END IF;

  -- CASE A: Pre-start (no progress made)
  IF v_job_status IN ('scheduled', 'issued') OR NOT v_has_progress THEN
    -- Simple reassign
    UPDATE labor_plan_assignments
    SET staff_id = p_new_staff_id, updated_at = v_now,
        completion_notes = COALESCE(p_notes, '') || ' [Transferred from staff ' || v_old_staff_id || ']'
    WHERE assignment_id = p_assignment_id;

    -- Update job card if exists
    IF v_job_card_id IS NOT NULL THEN
      UPDATE job_cards
      SET staff_id = p_new_staff_id, updated_at = v_now
      WHERE job_card_id = v_job_card_id;
    END IF;

    RETURN jsonb_build_object(
      'type', 'reassigned',
      'assignment_id', p_assignment_id,
      'job_card_id', v_job_card_id,
      'old_staff_id', v_old_staff_id,
      'new_staff_id', p_new_staff_id
    );

  -- CASE B: Mid-work (has progress)
  ELSE
    -- Complete original assignment at current progress
    UPDATE labor_plan_assignments SET
      job_status = 'completed',
      completed_at = v_now,
      completion_notes = COALESCE(p_notes, '') || ' [Transferred remainder to staff ' || p_new_staff_id || ']',
      updated_at = v_now
    WHERE assignment_id = p_assignment_id;

    -- Complete original job card at current quantities
    IF v_job_card_id IS NOT NULL THEN
      UPDATE job_card_items
      SET status = 'completed', completion_time = v_now
      WHERE job_card_id = v_job_card_id;

      UPDATE job_cards
      SET status = 'completed', completion_date = v_now::date
      WHERE job_card_id = v_job_card_id;
    END IF;

    -- Create new job card for new staff with remaining quantities
    INSERT INTO job_cards (order_id, staff_id, issue_date, status, notes, created_at, updated_at)
    VALUES (v_order_id, p_new_staff_id, CURRENT_DATE, 'pending',
            'Transferred from staff ' || v_old_staff_id || '. ' || COALESCE(p_notes, ''),
            v_now, v_now)
    RETURNING job_card_id INTO v_new_job_card_id;

    -- Copy items with remaining quantities
    FOR v_item IN
      SELECT job_id, product_id, quantity, completed_quantity, piece_rate
      FROM job_card_items
      WHERE job_card_id = v_job_card_id
    LOOP
      IF v_item.quantity - v_item.completed_quantity > 0 THEN
        INSERT INTO job_card_items (job_card_id, job_id, product_id, quantity, completed_quantity, piece_rate, status, created_at, updated_at)
        VALUES (v_new_job_card_id, v_item.job_id, v_item.product_id,
                v_item.quantity - v_item.completed_quantity, 0,
                v_item.piece_rate, 'pending', v_now, v_now);
      END IF;
    END LOOP;

    -- Create new assignment for new staff
    INSERT INTO labor_plan_assignments (
      job_instance_id, order_id, order_detail_id, bol_id, job_id,
      staff_id, assignment_date, start_minutes, end_minutes,
      status, pay_type, hourly_rate_id, piece_rate_id,
      job_status, issued_at, created_at, updated_at,
      completion_notes
    ) VALUES (
      v_job_instance_id || ':transfer', v_order_id, v_order_detail_id, v_bol_id, v_job_id,
      p_new_staff_id, CURRENT_DATE, v_start_minutes, v_end_minutes,
      'scheduled', v_pay_type, v_hourly_rate_id, v_piece_rate_id,
      'issued', v_now, v_now, v_now,
      'Transferred from staff ' || v_old_staff_id
    )
    RETURNING assignment_id INTO v_new_assignment_id;

    RETURN jsonb_build_object(
      'type', 'split',
      'old_assignment_id', p_assignment_id,
      'new_assignment_id', v_new_assignment_id,
      'old_job_card_id', v_job_card_id,
      'new_job_card_id', v_new_job_card_id,
      'old_staff_id', v_old_staff_id,
      'new_staff_id', p_new_staff_id
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION transfer_assignment(INTEGER, INTEGER, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION transfer_assignment(INTEGER, INTEGER, TEXT) TO authenticated;
```

**Step 2: Verify function exists**

```sql
SELECT proname FROM pg_proc WHERE proname = 'transfer_assignment';
```

---

## Task 5: Update `factory_floor_status` View

**Files:**
- Create migration via Supabase MCP `apply_migration`

The view needs to:
1. Include `on_hold` status (currently only shows `issued`, `in_progress`)
2. Add `is_paused` boolean
3. Add `total_paused_minutes` for accurate elapsed time
4. Add `pause_reason` for current pause (if paused)
5. Add `job_card_id` for linking to completion flow

**Step 1: Apply the migration**

Use `mcp__supabase__apply_migration` with name `factory_floor_status_pause_aware` and this SQL:

```sql
DROP VIEW IF EXISTS factory_floor_status;
CREATE VIEW factory_floor_status AS
WITH pause_stats AS (
  SELECT
    assignment_id,
    -- Total completed pause duration in minutes
    COALESCE(SUM(
      EXTRACT(epoch FROM (COALESCE(resumed_at, now()) - paused_at)) / 60
    ), 0)::integer AS total_paused_minutes,
    -- Is currently paused?
    bool_or(resumed_at IS NULL) AS is_paused,
    -- Current pause reason (if paused)
    (SELECT reason FROM assignment_pause_events ape2
     WHERE ape2.assignment_id = assignment_pause_events.assignment_id
       AND ape2.resumed_at IS NULL
     ORDER BY paused_at DESC LIMIT 1
    ) AS pause_reason
  FROM assignment_pause_events
  GROUP BY assignment_id
)
SELECT
  lpa.assignment_id,
  lpa.job_instance_id,
  lpa.order_id,
  COALESCE(o.order_number, o.order_id::text) AS order_number,
  lpa.order_detail_id,
  lpa.bol_id,
  lpa.job_id,
  j.name AS job_name,
  j.category_id,
  jc.name AS category_name,
  fs.section_id,
  fs.name AS section_name,
  fs.color AS section_color,
  fs.display_order AS section_order,
  fs.grid_span AS section_grid_span,
  lpa.staff_id,
  concat(s.first_name, ' ', s.last_name) AS staff_name,
  s.job_description AS staff_role,
  lpa.assignment_date,
  lpa.start_minutes,
  lpa.end_minutes,
  lpa.job_status,
  lpa.issued_at,
  lpa.started_at,
  lpa.completed_at,
  COALESCE(jci.quantity, od.quantity) AS quantity,
  COALESCE(
    CASE bol.time_unit
      WHEN 'hours' THEN bol.time_required * 60
      WHEN 'seconds' THEN bol.time_required / 60
      ELSE bol.time_required
    END,
    CASE j.time_unit
      WHEN 'hours' THEN j.estimated_minutes * 60
      WHEN 'seconds' THEN j.estimated_minutes / 60
      ELSE j.estimated_minutes
    END
  ) AS unit_minutes,
  COALESCE(
    CASE bol.time_unit
      WHEN 'hours' THEN bol.time_required * 60
      WHEN 'seconds' THEN bol.time_required / 60
      ELSE bol.time_required
    END * COALESCE(jci.quantity, od.quantity, 1),
    CASE j.time_unit
      WHEN 'hours' THEN j.estimated_minutes * 60
      WHEN 'seconds' THEN j.estimated_minutes / 60
      ELSE j.estimated_minutes
    END * COALESCE(jci.quantity, od.quantity, 1),
    (lpa.end_minutes - lpa.start_minutes)::numeric
  ) AS estimated_minutes,
  -- Pause-aware elapsed time: subtract paused duration
  GREATEST(0, (CASE
    WHEN lpa.job_status IN ('in_progress', 'on_hold') AND lpa.started_at IS NOT NULL
      THEN (EXTRACT(epoch FROM (now() - lpa.started_at)) / 60)::integer - COALESCE(ps.total_paused_minutes, 0)
    WHEN lpa.job_status = 'issued' AND lpa.issued_at IS NOT NULL
      THEN (EXTRACT(epoch FROM (now() - lpa.issued_at)) / 60)::integer
    ELSE 0
  END)) AS minutes_elapsed,
  -- Auto-progress using pause-aware elapsed
  (CASE
    WHEN COALESCE(
      CASE bol.time_unit
        WHEN 'hours' THEN bol.time_required * 60
        WHEN 'seconds' THEN bol.time_required / 60
        ELSE bol.time_required
      END * COALESCE(jci.quantity, od.quantity, 1),
      CASE j.time_unit
        WHEN 'hours' THEN j.estimated_minutes * 60
        WHEN 'seconds' THEN j.estimated_minutes / 60
        ELSE j.estimated_minutes
      END * COALESCE(jci.quantity, od.quantity, 1),
      (lpa.end_minutes - lpa.start_minutes)::numeric
    ) > 0 THEN
      LEAST(100, ROUND(
        GREATEST(0, (CASE
          WHEN lpa.job_status IN ('in_progress', 'on_hold') AND lpa.started_at IS NOT NULL
            THEN (EXTRACT(epoch FROM (now() - lpa.started_at)) / 60) - COALESCE(ps.total_paused_minutes, 0)
          WHEN lpa.job_status = 'issued' AND lpa.issued_at IS NOT NULL
            THEN (EXTRACT(epoch FROM (now() - lpa.issued_at)) / 60)
          ELSE 0
        END)) /
        COALESCE(
          CASE bol.time_unit
            WHEN 'hours' THEN bol.time_required * 60
            WHEN 'seconds' THEN bol.time_required / 60
            ELSE bol.time_required
          END * COALESCE(jci.quantity, od.quantity, 1),
          CASE j.time_unit
            WHEN 'hours' THEN j.estimated_minutes * 60
            WHEN 'seconds' THEN j.estimated_minutes / 60
            ELSE j.estimated_minutes
          END * COALESCE(jci.quantity, od.quantity, 1),
          (lpa.end_minutes - lpa.start_minutes)::numeric
        ) * 100
      ))
    ELSE 0
  END)::integer AS auto_progress,
  lpa.progress_override,
  p.name AS product_name,
  p.internal_code AS product_code,
  -- New pause-aware columns
  COALESCE(ps.total_paused_minutes, 0) AS total_paused_minutes,
  COALESCE(ps.is_paused, false) AS is_paused,
  ps.pause_reason,
  -- Job card ID for completion flow
  jk.job_card_id
FROM labor_plan_assignments lpa
LEFT JOIN jobs j ON lpa.job_id = j.job_id
LEFT JOIN job_categories jc ON j.category_id = jc.category_id
LEFT JOIN factory_sections fs ON jc.category_id = fs.category_id AND fs.is_active = true
LEFT JOIN staff s ON lpa.staff_id = s.staff_id
LEFT JOIN orders o ON lpa.order_id = o.order_id
LEFT JOIN order_details od ON lpa.order_detail_id = od.order_detail_id
LEFT JOIN products p ON od.product_id = p.product_id
LEFT JOIN billoflabour bol ON lpa.bol_id = bol.bol_id
LEFT JOIN job_cards jk ON jk.order_id = lpa.order_id AND jk.staff_id = lpa.staff_id
LEFT JOIN job_card_items jci ON jci.job_card_id = jk.job_card_id AND jci.job_id = lpa.job_id
LEFT JOIN pause_stats ps ON ps.assignment_id = lpa.assignment_id
WHERE lpa.job_status IN ('issued', 'in_progress', 'on_hold')
ORDER BY fs.display_order, s.first_name;
```

**Step 2: Verify view works**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'factory_floor_status'
ORDER BY ordinal_position;
```

Expected: includes `total_paused_minutes`, `is_paused`, `pause_reason`, `job_card_id`.

---

## Task 6: Update TypeScript Types

**Files:**
- Modify: `components/factory-floor/types.ts`

**Step 1: Add new fields to `FloorStaffJob`**

Add these fields to the `FloorStaffJob` interface after line 42 (`progress_override`):

```typescript
  total_paused_minutes: number;
  is_paused: boolean;
  pause_reason: string | null;
  job_card_id: number | null;
```

**Step 2: Update `job_status` union type**

Change line 33 from:
```typescript
  job_status: 'issued' | 'in_progress';
```
to:
```typescript
  job_status: 'issued' | 'in_progress' | 'on_hold';
```

**Step 3: Update `statusDotClass` to handle `on_hold`**

Change line 66-69 from:
```typescript
export const statusDotClass: Record<FloorStaffJob['job_status'], string> = {
  'in_progress': 'bg-emerald-400',
  'issued': 'bg-blue-400',
};
```
to:
```typescript
export const statusDotClass: Record<FloorStaffJob['job_status'], string> = {
  'in_progress': 'bg-emerald-400',
  'issued': 'bg-blue-400',
  'on_hold': 'bg-amber-400',
};
```

**Step 4: Add pause reason labels constant**

Add after `statusBadgeConfig`:

```typescript
export const PAUSE_REASONS = [
  { value: 'waiting_materials', label: 'Waiting for Materials' },
  { value: 'machine_breakdown', label: 'Machine Breakdown' },
  { value: 'break', label: 'Break' },
  { value: 'quality_issue', label: 'Quality Issue' },
  { value: 'other', label: 'Other' },
] as const;

export type PauseReason = typeof PAUSE_REASONS[number]['value'];
```

**Step 5: Run type check**

```bash
npx tsc --noEmit
```

Fix any type errors that arise from the new `on_hold` status — other components may need updating.

**Step 6: Commit**

```bash
git add components/factory-floor/types.ts
git commit -m "feat: add pause and job card types to FloorStaffJob"
```

---

## Task 7: Create `useJobActions` Hook

**Files:**
- Create: `hooks/use-job-actions.ts`

**Step 1: Create the hook**

```typescript
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PauseReason } from '@/components/factory-floor/types';

interface CompleteParams {
  assignmentId: number;
  items: { item_id: number; completed_quantity: number }[];
  actualStart?: string;  // ISO timestamp
  actualEnd?: string;    // ISO timestamp
  notes?: string;
}

interface PauseParams {
  assignmentId: number;
  reason: PauseReason;
  notes?: string;
}

interface TransferParams {
  assignmentId: number;
  newStaffId: number;
  notes?: string;
}

const INVALIDATE_KEYS = [
  ['factory-floor'],
  ['laborAssignments'],
  ['laborPlanningPayload'],
  ['jobs-in-factory'],
];

export function useJobActions() {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    for (const key of INVALIDATE_KEYS) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const completeJob = useMutation({
    mutationFn: async ({ assignmentId, items, actualStart, actualEnd, notes }: CompleteParams) => {
      const { data, error } = await supabase.rpc('complete_assignment_with_card', {
        p_assignment_id: assignmentId,
        p_items: items,
        p_actual_start: actualStart ?? null,
        p_actual_end: actualEnd ?? null,
        p_notes: notes ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidateAll,
  });

  const pauseJob = useMutation({
    mutationFn: async ({ assignmentId, reason, notes }: PauseParams) => {
      const { error } = await supabase.rpc('pause_assignment', {
        p_assignment_id: assignmentId,
        p_reason: reason,
        p_notes: notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const resumeJob = useMutation({
    mutationFn: async (assignmentId: number) => {
      const { error } = await supabase.rpc('resume_assignment', {
        p_assignment_id: assignmentId,
      });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const transferJob = useMutation({
    mutationFn: async ({ assignmentId, newStaffId, notes }: TransferParams) => {
      const { data, error } = await supabase.rpc('transfer_assignment', {
        p_assignment_id: assignmentId,
        p_new_staff_id: newStaffId,
        p_notes: notes ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidateAll,
  });

  return {
    completeJob,
    pauseJob,
    resumeJob,
    transferJob,
  };
}
```

**Step 2: Run type check**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add hooks/use-job-actions.ts
git commit -m "feat: add useJobActions hook for complete/pause/resume/transfer"
```

---

## Task 8: Create Pause Job Dialog

**Files:**
- Create: `components/factory-floor/pause-job-dialog.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAUSE_REASONS, type PauseReason } from './types';
import type { FloorStaffJob } from './types';

interface PauseJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPause: (reason: PauseReason, notes?: string) => void;
  isPending: boolean;
}

export function PauseJobDialog({ job, open, onOpenChange, onPause, isPending }: PauseJobDialogProps) {
  const [reason, setReason] = useState<PauseReason | ''>('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!reason) return;
    onPause(reason, notes || undefined);
    setReason('');
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pause Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Pausing <span className="font-medium text-foreground">{job?.job_name}</span> for{' '}
            <span className="font-medium text-foreground">{job?.staff_name}</span>.
            The clock will stop until the job is resumed.
          </p>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as PauseReason)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {PAUSE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional details..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason || isPending}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isPending ? 'Pausing...' : 'Pause Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Run type check**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add components/factory-floor/pause-job-dialog.tsx
git commit -m "feat: add pause job dialog with reason dropdown"
```

---

## Task 9: Create Complete Job Dialog

**Files:**
- Create: `components/factory-floor/complete-job-dialog.tsx`

This dialog needs to fetch job card items when opened. It shows auto-filled actual times (editable), item quantities, and calculates earnings for piecework.

**Step 1: Add a query function for job card items**

Add to `lib/queries/factoryFloor.ts`:

```typescript
export interface JobCardItemForCompletion {
  item_id: number;
  job_id: number | null;
  job_name: string | null;
  product_id: number | null;
  product_name: string | null;
  quantity: number;
  completed_quantity: number;
  piece_rate: number | null;
  status: string;
}

export async function fetchJobCardItems(jobCardId: number): Promise<JobCardItemForCompletion[]> {
  const { data, error } = await supabase
    .from('job_card_items')
    .select(`
      item_id,
      job_id,
      jobs:job_id (name),
      product_id,
      products:product_id (name),
      quantity,
      completed_quantity,
      piece_rate,
      status
    `)
    .eq('job_card_id', jobCardId)
    .order('item_id');

  if (error) throw error;

  return (data ?? []).map((item: any) => ({
    item_id: item.item_id,
    job_id: item.job_id,
    job_name: item.jobs?.name ?? null,
    product_id: item.product_id,
    product_name: item.products?.name ?? null,
    quantity: item.quantity,
    completed_quantity: item.completed_quantity,
    piece_rate: item.piece_rate,
    status: item.status,
  }));
}
```

**Step 2: Create the dialog component**

Create `components/factory-floor/complete-job-dialog.tsx`:

```tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { FloorStaffJob } from './types';
import { fetchJobCardItems } from '@/lib/queries/factoryFloor';

interface CompleteJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (params: {
    items: { item_id: number; completed_quantity: number }[];
    actualStart?: string;
    actualEnd?: string;
    notes?: string;
  }) => void;
  isPending: boolean;
}

function formatTimestampToInput(ts: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return '';
  }
}

function timeInputToTimestamp(timeStr: string, refDate?: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const base = refDate ? new Date(refDate) : new Date();
  base.setHours(h, m, 0, 0);
  return base.toISOString();
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function CompleteJobDialog({ job, open, onOpenChange, onComplete, isPending }: CompleteJobDialogProps) {
  const [actualStart, setActualStart] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  // Fetch job card items when dialog opens
  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ['job-card-items', job?.job_card_id],
    queryFn: () => fetchJobCardItems(job!.job_card_id!),
    enabled: open && !!job?.job_card_id,
  });

  // Pre-fill times when dialog opens
  useEffect(() => {
    if (open && job) {
      setActualStart(formatTimestampToInput(job.started_at ?? job.issued_at));
      const now = new Date();
      setActualEnd(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
      setNotes('');
      setQuantities({});
    }
  }, [open, job?.assignment_id]);

  // Initialize quantities from fetched items
  useEffect(() => {
    if (items && Object.keys(quantities).length === 0) {
      const initial: Record<number, number> = {};
      for (const item of items) {
        initial[item.item_id] = item.completed_quantity > 0 ? item.completed_quantity : item.quantity;
      }
      setQuantities(initial);
    }
  }, [items]);

  const actualDurationMinutes = useMemo(() => {
    if (!actualStart || !actualEnd) return 0;
    const [sh, sm] = actualStart.split(':').map(Number);
    const [eh, em] = actualEnd.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }, [actualStart, actualEnd]);

  const variance = useMemo(() => {
    if (!job?.estimated_minutes || actualDurationMinutes <= 0) return null;
    return actualDurationMinutes - job.estimated_minutes;
  }, [actualDurationMinutes, job?.estimated_minutes]);

  const totalEarnings = useMemo(() => {
    if (!items) return 0;
    return items.reduce((sum, item) => {
      const qty = quantities[item.item_id] ?? item.quantity;
      return sum + qty * (item.piece_rate ?? 0);
    }, 0);
  }, [items, quantities]);

  const handleSubmit = () => {
    if (!job) return;
    const itemsPayload = (items ?? []).map((item) => ({
      item_id: item.item_id,
      completed_quantity: quantities[item.item_id] ?? item.quantity,
    }));
    onComplete({
      items: itemsPayload,
      actualStart: actualStart ? timeInputToTimestamp(actualStart, job.assignment_date ?? undefined) : undefined,
      actualEnd: actualEnd ? timeInputToTimestamp(actualEnd, job.assignment_date ?? undefined) : undefined,
      notes: notes || undefined,
    });
  };

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <p className="text-sm text-muted-foreground">
            Completing <span className="font-medium text-foreground">{job.job_name}</span> for{' '}
            <span className="font-medium text-foreground">{job.staff_name}</span>.
          </p>

          {/* Actual times */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Actual Start</Label>
              <Input type="time" value={actualStart} onChange={(e) => setActualStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Actual End</Label>
              <Input type="time" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} />
            </div>
          </div>

          {/* Duration summary */}
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Actual: </span>
              <span className="font-medium">{formatDuration(actualDurationMinutes)}</span>
            </div>
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

          {/* Job card items */}
          {itemsLoading ? (
            <p className="text-sm text-muted-foreground">Loading items...</p>
          ) : items && items.length > 0 ? (
            <div className="space-y-3">
              <Label>Items</Label>
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.item_id} className="flex items-center gap-3 p-3 rounded-md border bg-card">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.job_name ?? item.product_name ?? 'Item'}</div>
                      {item.product_name && item.job_name && (
                        <div className="text-xs text-muted-foreground truncate">{item.product_name}</div>
                      )}
                      {item.piece_rate != null && item.piece_rate > 0 && (
                        <div className="text-xs text-muted-foreground">
                          R{item.piece_rate}/pc = R{((quantities[item.item_id] ?? item.quantity) * item.piece_rate).toFixed(2)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={quantities[item.item_id] ?? item.quantity}
                        onChange={(e) => setQuantities((prev) => ({
                          ...prev,
                          [item.item_id]: Math.min(item.quantity, Math.max(0, parseInt(e.target.value) || 0)),
                        }))}
                        className="w-20 text-center"
                      />
                      <span className="text-sm text-muted-foreground">/ {item.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>
              {totalEarnings > 0 && (
                <div className="text-sm font-medium text-right">
                  Total Earnings: R{totalEarnings.toFixed(2)}
                </div>
              )}
            </div>
          ) : !job.job_card_id ? (
            <p className="text-sm text-muted-foreground italic">No linked job card found. Assignment will be marked complete.</p>
          ) : null}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Completion notes..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || actualDurationMinutes <= 0}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isPending ? 'Completing...' : 'Complete Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Run type check**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add lib/queries/factoryFloor.ts components/factory-floor/complete-job-dialog.tsx
git commit -m "feat: add complete job dialog with item quantities and time capture"
```

---

## Task 10: Create Transfer Job Dialog

**Files:**
- Create: `components/factory-floor/transfer-job-dialog.tsx`

**Step 1: Add staff list query**

Add to `lib/queries/factoryFloor.ts`:

```typescript
export interface StaffOption {
  staff_id: number;
  name: string;
}

export async function fetchActiveStaff(): Promise<StaffOption[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('staff_id, first_name, last_name')
    .eq('is_active', true)
    .order('first_name');

  if (error) throw error;
  return (data ?? []).map((s: any) => ({
    staff_id: s.staff_id,
    name: `${s.first_name} ${s.last_name}`,
  }));
}
```

**Step 2: Create the dialog component**

Create `components/factory-floor/transfer-job-dialog.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { FloorStaffJob } from './types';
import { fetchActiveStaff } from '@/lib/queries/factoryFloor';

interface TransferJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransfer: (newStaffId: number, notes?: string) => void;
  isPending: boolean;
}

export function TransferJobDialog({ job, open, onOpenChange, onTransfer, isPending }: TransferJobDialogProps) {
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');

  const { data: allStaff, isLoading } = useQuery({
    queryKey: ['active-staff'],
    queryFn: fetchActiveStaff,
    enabled: open,
  });

  const filteredStaff = useMemo(() => {
    if (!allStaff) return [];
    return allStaff
      .filter((s) => s.staff_id !== job?.staff_id)
      .filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));
  }, [allStaff, job?.staff_id, search]);

  const selectedStaff = allStaff?.find((s) => s.staff_id === selectedStaffId);
  const isInProgress = job?.job_status === 'in_progress';

  const handleSubmit = () => {
    if (!selectedStaffId) return;
    onTransfer(selectedStaffId, notes || undefined);
    setSelectedStaffId(null);
    setSearch('');
    setNotes('');
  };

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transfer Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Transfer <span className="font-medium text-foreground">{job.job_name}</span> from{' '}
            <span className="font-medium text-foreground">{job.staff_name}</span> to another staff member.
          </p>

          {isInProgress && (
            <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-sm">
              <p className="font-medium text-amber-400">Work in progress</p>
              <p className="text-muted-foreground mt-1">
                This job has started. The current worker&apos;s completed quantities will be finalized
                and a new job card will be created for the remaining work.
              </p>
            </div>
          )}

          {/* Staff search */}
          <div className="space-y-2">
            <Label>Assign to</Label>
            <Input
              placeholder="Search staff..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading staff...</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-1">
                {filteredStaff.length === 0 && (
                  <p className="text-sm text-muted-foreground p-2">No matching staff found.</p>
                )}
                {filteredStaff.map((s) => (
                  <button
                    key={s.staff_id}
                    type="button"
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      selectedStaffId === s.staff_id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedStaffId(s.staff_id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedStaff && (
            <div className="p-3 rounded-md border bg-card text-sm">
              <p>
                <span className="text-muted-foreground">From:</span>{' '}
                <span className="font-medium">{job.staff_name}</span>
              </p>
              <p>
                <span className="text-muted-foreground">To:</span>{' '}
                <span className="font-medium">{selectedStaff.name}</span>
              </p>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for transfer..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedStaffId || isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isPending ? 'Transferring...' : 'Transfer Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Run type check**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add lib/queries/factoryFloor.ts components/factory-floor/transfer-job-dialog.tsx
git commit -m "feat: add transfer job dialog with staff search and split warning"
```

---

## Task 11: Update Detail Panel — Replace Slider with Actions

**Files:**
- Modify: `components/factory-floor/floor-detail-panel.tsx`

**Step 1: Update the imports**

Replace the existing imports to add the new icons and remove slider:

Remove:
```typescript
import { Slider } from '@/components/ui/slider';
```
Remove `RotateCcw` from lucide imports.

Add:
```typescript
import { ExternalLink, CheckCircle, Pause, Play, ArrowRightLeft } from 'lucide-react';
```

**Step 2: Update the props interface**

Change `FloorDetailPanelProps` to:

```typescript
interface FloorDetailPanelProps {
  job: FloorStaffJob | null;
  onClose: () => void;
  onComplete: (job: FloorStaffJob) => void;
  onPause: (job: FloorStaffJob) => void;
  onResume: (assignmentId: number) => void;
  onTransfer: (job: FloorStaffJob) => void;
  isUpdating: boolean;
  shiftInfo?: ShiftInfoWithNow;
}
```

**Step 3: Update the component body**

Replace the component function. Key changes:
- Remove `overrideValue` state and slider logic
- Remove `onUpdateProgress` usage
- Replace the Progress section's slider with action buttons
- Show pause info when `is_paused` is true
- Update the elapsed time display to show paused time
- Add `on_hold` status handling in status badge

The full replacement for the component (from line 39 to line 225):

```tsx
export function FloorDetailPanel({
  job,
  onClose,
  onComplete,
  onPause,
  onResume,
  onTransfer,
  isUpdating,
  shiftInfo,
}: FloorDetailPanelProps) {
  const open = job !== null;

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  if (!job) return null;

  const displayProgress = getDisplayProgress(job);
  const status = getProgressStatus(job);
  const badge = statusBadgeConfig[status];
  const isPaused = job.is_paused;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-[400px] sm:w-[440px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${statusDotClass[job.job_status]}`} />
            {job.staff_name}
            {isPaused && (
              <Badge className="bg-amber-600 hover:bg-amber-600 text-white text-xs ml-auto">
                Paused
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Job info */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Current Job
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Job</span>
                <span className="font-medium">{job.job_name ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Section</span>
                <span className="font-medium">{job.section_name ?? 'Unassigned'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Product</span>
                <span className="font-medium truncate ml-4">{job.product_name ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order</span>
                <span className="font-mono font-medium">{job.order_number ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quantity</span>
                <span className="font-medium">{job.quantity ?? '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge className={isPaused ? 'bg-amber-600 hover:bg-amber-600 text-white' : badge.className}>
                  {isPaused ? `Paused — ${job.pause_reason?.replace('_', ' ') ?? ''}` :
                   job.job_status === 'in_progress' ? 'In Progress' :
                   job.job_status === 'on_hold' ? 'On Hold' : 'Issued'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Time info */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Time
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {job.job_status === 'in_progress' || job.job_status === 'on_hold' ? 'Started' : 'Issued'}
                </span>
                <span className="font-medium">
                  {formatTimeToSAST(job.job_status === 'issued' ? job.issued_at : job.started_at)}
                </span>
              </div>
              {job.unit_minutes != null && job.quantity != null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Unit Duration</span>
                  <span className="font-medium">{formatDuration(job.unit_minutes)} x {job.quantity}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Duration</span>
                <span className="font-medium">{formatDuration(job.estimated_minutes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Elapsed</span>
                <span className="font-medium">
                  {formatDuration(job.minutes_elapsed)}
                  {job.total_paused_minutes > 0 && (
                    <span className="text-amber-400 ml-1">(paused: {formatDuration(job.total_paused_minutes)})</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Shift info */}
          {shiftInfo && <ShiftSection job={job} shiftInfo={shiftInfo} />}

          {/* Progress */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                Progress
              </h4>
              <Badge className={badge.className}>
                {badge.label}
              </Badge>
            </div>
            <ProgressBar job={job} className="py-1" />
          </div>

          {/* Job Actions */}
          <div className="space-y-2 pt-2 border-t">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Actions
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => onComplete(job)}
                disabled={isUpdating}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Complete
              </Button>
              {isPaused ? (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => onResume(job.assignment_id)}
                  disabled={isUpdating}
                >
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Resume
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={() => onPause(job)}
                  disabled={isUpdating || job.job_status !== 'in_progress'}
                >
                  <Pause className="h-3.5 w-3.5 mr-1" />
                  Pause
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onTransfer(job)}
                disabled={isUpdating}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                Transfer
              </Button>
            </div>
          </div>

          {/* View Order */}
          <div className="space-y-2 pt-2 border-t">
            {job.order_id && (
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href={`/orders/${job.order_id}`} target="_blank">
                  <ExternalLink className="h-3.5 w-3.5 mr-2" />
                  View Order
                </Link>
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Step 4: Run type check**

```bash
npx tsc --noEmit
```

Fix any errors — the parent page component will also need updating (Task 12).

**Step 5: Commit**

```bash
git add components/factory-floor/floor-detail-panel.tsx
git commit -m "feat: replace progress slider with complete/pause/transfer actions"
```

---

## Task 12: Wire Everything Up in the Factory Floor Page

**Files:**
- Modify: The factory floor page component (likely `components/factory-floor/factory-floor-page.tsx` or `app/factory-floor/page.tsx`)

**Step 1: Find and read the page component**

The page component that renders `FloorDetailPanel` and manages selected job state. Search for `FloorDetailPanel` usage:

```bash
grep -r "FloorDetailPanel" --include="*.tsx" -l
```

**Step 2: Add imports and dialog state**

Add imports for the three new dialogs and `useJobActions`:

```typescript
import { useJobActions } from '@/hooks/use-job-actions';
import { CompleteJobDialog } from '@/components/factory-floor/complete-job-dialog';
import { PauseJobDialog } from '@/components/factory-floor/pause-job-dialog';
import { TransferJobDialog } from '@/components/factory-floor/transfer-job-dialog';
```

Add state for which dialog is open:

```typescript
const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
const [transferDialogOpen, setTransferDialogOpen] = useState(false);
const { completeJob, pauseJob, resumeJob, transferJob } = useJobActions();
```

**Step 3: Update FloorDetailPanel props**

Replace the old `onUpdateProgress` and `isUpdating` props:

```tsx
<FloorDetailPanel
  job={selectedJob}
  onClose={() => setSelectedJob(null)}
  onComplete={(job) => setCompleteDialogOpen(true)}
  onPause={(job) => setPauseDialogOpen(true)}
  onResume={(assignmentId) => {
    resumeJob.mutate(assignmentId, {
      onSuccess: () => setSelectedJob(null),
    });
  }}
  onTransfer={(job) => setTransferDialogOpen(true)}
  isUpdating={completeJob.isPending || pauseJob.isPending || resumeJob.isPending || transferJob.isPending}
  shiftInfo={shiftInfo}
/>
```

**Step 4: Add dialog components**

Render the three dialogs alongside the detail panel:

```tsx
<CompleteJobDialog
  job={selectedJob}
  open={completeDialogOpen}
  onOpenChange={setCompleteDialogOpen}
  onComplete={({ items, actualStart, actualEnd, notes }) => {
    if (!selectedJob) return;
    completeJob.mutate({
      assignmentId: selectedJob.assignment_id,
      items,
      actualStart,
      actualEnd,
      notes,
    }, {
      onSuccess: () => {
        setCompleteDialogOpen(false);
        setSelectedJob(null);
      },
    });
  }}
  isPending={completeJob.isPending}
/>

<PauseJobDialog
  job={selectedJob}
  open={pauseDialogOpen}
  onOpenChange={setPauseDialogOpen}
  onPause={(reason, notes) => {
    if (!selectedJob) return;
    pauseJob.mutate({
      assignmentId: selectedJob.assignment_id,
      reason,
      notes,
    }, {
      onSuccess: () => {
        setPauseDialogOpen(false);
        setSelectedJob(null);
      },
    });
  }}
  isPending={pauseJob.isPending}
/>

<TransferJobDialog
  job={selectedJob}
  open={transferDialogOpen}
  onOpenChange={setTransferDialogOpen}
  onTransfer={(newStaffId, notes) => {
    if (!selectedJob) return;
    transferJob.mutate({
      assignmentId: selectedJob.assignment_id,
      newStaffId,
      notes,
    }, {
      onSuccess: () => {
        setTransferDialogOpen(false);
        setSelectedJob(null);
      },
    });
  }}
  isPending={transferJob.isPending}
/>
```

**Step 5: Remove old updateProgress wiring**

Remove the `updateProgress` and `isUpdatingProgress` usage from `useFactoryFloor()` if they're no longer needed by other parts of the page. The `useFactoryFloor` hook can keep the progress mutation for now (it's harmless), but the detail panel no longer calls it.

**Step 6: Run type check + lint**

```bash
npx tsc --noEmit && npm run lint
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire up job action dialogs in factory floor page"
```

---

## Task 13: Add Realtime Subscription for Pause Events

**Files:**
- Modify: `hooks/use-factory-floor.ts`

**Step 1: Add subscription for `assignment_pause_events`**

In the existing realtime subscription (lines 16-29), add a second listener for the pause events table. Since the view already joins pause data, invalidating on pause event changes will refresh the view correctly:

```typescript
const channel = supabase
  .channel('factory-floor-sync')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'labor_plan_assignments' },
    () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  )
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'assignment_pause_events' },
    () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  )
  .subscribe();
```

**Step 2: Run type check**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add hooks/use-factory-floor.ts
git commit -m "feat: subscribe to pause events for realtime factory floor updates"
```

---

## Task 14: Verify in Browser

**Step 1: Take a screenshot of the factory floor page**

Navigate to `http://localhost:3000/factory-floor` and take a screenshot to verify the page renders without errors.

**Step 2: Check console for errors**

Use `mcp__chrome-devtools__list_console_messages` to check for runtime errors.

**Step 3: Click a staff card and verify the detail panel**

Click a staff card to open the detail panel. Verify:
- The progress override slider is gone
- Three action buttons (Complete, Pause, Transfer) are visible
- The Pause button is disabled if the job is not `in_progress`

**Step 4: Test the Pause flow**

Click Pause on an in-progress job:
- Pause dialog should open with reason dropdown
- Select a reason, click Pause
- Panel should now show "Paused" badge and Resume button

**Step 5: Test the Resume flow**

Click Resume on a paused job. Verify it returns to `in_progress`.

**Step 6: Test the Complete flow**

Click Complete on a job:
- Dialog should show actual start/end times (pre-filled)
- Items with quantities should be displayed
- Click Complete and verify the job disappears from the floor

**Step 7: Run security advisor**

Run `mcp__supabase__get_advisors` with type `security` to verify no RLS issues.

---

## Task 15: Final Verification

**Step 1: Run type check and lint**

```bash
npx tsc --noEmit && npm run lint
```

Fix any issues.

**Step 2: Run `/simplify`**

Since we've modified more than 3 files, run the simplify skill as per CLAUDE.md requirements.

**Step 3: Final commit if needed**

Commit any fixes from the above steps.

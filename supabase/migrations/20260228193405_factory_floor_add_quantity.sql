-- Add quantity, unit_minutes, and fix estimated duration in factory_floor_status view
-- Quantity sourced from job_card_items (primary) or order_details (fallback)
-- Both BOL and job time_unit are respected (hours/seconds/minutes)
-- unit_minutes = per-unit time converted to minutes
-- estimated_minutes = unit_minutes × quantity (total)
-- Scheduled slot fallback is already total time, not multiplied
DROP VIEW IF EXISTS factory_floor_status;
CREATE VIEW factory_floor_status AS
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
  -- Per-unit time in minutes (for display), converting from source time_unit
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
  -- Total estimated time = per-unit (in minutes) × quantity, or scheduled slot as fallback
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
  (CASE
    WHEN lpa.job_status = 'in_progress' AND lpa.started_at IS NOT NULL
      THEN (EXTRACT(epoch FROM (now() - lpa.started_at)) / 60)::integer
    WHEN lpa.job_status = 'issued' AND lpa.issued_at IS NOT NULL
      THEN (EXTRACT(epoch FROM (now() - lpa.issued_at)) / 60)::integer
    ELSE 0
  END) AS minutes_elapsed,
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
        (CASE
          WHEN lpa.job_status = 'in_progress' AND lpa.started_at IS NOT NULL
            THEN (EXTRACT(epoch FROM (now() - lpa.started_at)) / 60)
          WHEN lpa.job_status = 'issued' AND lpa.issued_at IS NOT NULL
            THEN (EXTRACT(epoch FROM (now() - lpa.issued_at)) / 60)
          ELSE 0
        END) /
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
  p.internal_code AS product_code
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
WHERE lpa.job_status IN ('issued', 'in_progress')
ORDER BY fs.display_order, s.first_name;

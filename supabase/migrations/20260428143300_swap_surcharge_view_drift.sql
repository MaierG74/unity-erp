-- Extend order_details-backed factory views with the new surcharge column.
-- Columns are appended to preserve existing view column order for consumers.

CREATE OR REPLACE VIEW public.factory_floor_status AS
WITH pause_stats AS (
  SELECT
    ape.assignment_id,
    COALESCE(
      SUM(EXTRACT(epoch FROM (COALESCE(ape.resumed_at, now()) - ape.paused_at)) / 60),
      0
    )::integer AS total_paused_minutes,
    bool_or(ape.resumed_at IS NULL) AS is_paused,
    (
      SELECT ape2.reason
      FROM public.assignment_pause_events ape2
      WHERE ape2.assignment_id = ape.assignment_id
        AND ape2.resumed_at IS NULL
      ORDER BY ape2.paused_at DESC
      LIMIT 1
    ) AS pause_reason
  FROM public.assignment_pause_events ape
  GROUP BY ape.assignment_id
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
  GREATEST(
    0,
    CASE
      WHEN lpa.job_status IN ('in_progress', 'on_hold') AND lpa.started_at IS NOT NULL
        THEN (EXTRACT(epoch FROM (now() - lpa.started_at)) / 60)::integer - COALESCE(ps.total_paused_minutes, 0)
      ELSE 0
    END
  ) AS minutes_elapsed,
  (
    CASE
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
        LEAST(
          100,
          ROUND(
            GREATEST(
              0,
              CASE
                WHEN lpa.job_status IN ('in_progress', 'on_hold') AND lpa.started_at IS NOT NULL
                  THEN (EXTRACT(epoch FROM (now() - lpa.started_at)) / 60) - COALESCE(ps.total_paused_minutes, 0)
                ELSE 0
              END
            ) /
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
          )
        )
      ELSE 0
    END
  )::integer AS auto_progress,
  lpa.progress_override,
  p.name AS product_name,
  p.internal_code AS product_code,
  COALESCE(ps.total_paused_minutes, 0) AS total_paused_minutes,
  COALESCE(ps.is_paused, false) AS is_paused,
  ps.pause_reason,
  jk.job_card_id,
  lpa.pay_type,
  od.surcharge_total AS order_detail_surcharge_total
FROM public.labor_plan_assignments lpa
LEFT JOIN public.jobs j ON lpa.job_id = j.job_id
LEFT JOIN public.job_categories jc ON j.category_id = jc.category_id
LEFT JOIN public.factory_sections fs
  ON COALESCE(jc.parent_category_id, jc.category_id) = fs.category_id
 AND fs.is_active = true
LEFT JOIN public.staff s ON lpa.staff_id = s.staff_id
LEFT JOIN public.orders o ON lpa.order_id = o.order_id
LEFT JOIN public.order_details od ON lpa.order_detail_id = od.order_detail_id
LEFT JOIN public.products p ON od.product_id = p.product_id
LEFT JOIN public.billoflabour bol ON lpa.bol_id = bol.bol_id
LEFT JOIN LATERAL (
  SELECT jc2.job_card_id
  FROM public.job_cards jc2
  WHERE jc2.job_card_id = public.extract_job_card_id_from_instance(lpa.job_instance_id)
     OR (
       public.extract_job_card_id_from_instance(lpa.job_instance_id) IS NULL
       AND jc2.order_id = lpa.order_id
       AND jc2.staff_id = lpa.staff_id
     )
  ORDER BY
    CASE
      WHEN jc2.job_card_id = public.extract_job_card_id_from_instance(lpa.job_instance_id) THEN 0
      ELSE 1
    END,
    jc2.job_card_id DESC
  LIMIT 1
) jk ON true
LEFT JOIN public.job_card_items jci
  ON jci.job_card_id = jk.job_card_id
 AND jci.job_id = lpa.job_id
LEFT JOIN pause_stats ps ON ps.assignment_id = lpa.assignment_id
WHERE lpa.job_status IN ('issued', 'in_progress', 'on_hold')
ORDER BY fs.display_order, s.first_name;

CREATE OR REPLACE VIEW public.jobs_in_factory AS
SELECT
  lpa.assignment_id,
  lpa.job_instance_id,
  lpa.order_id,
  COALESCE(o.order_number, o.order_id::text) AS order_number,
  lpa.job_id,
  j.name AS job_name,
  lpa.staff_id,
  concat(s.first_name, ' ', s.last_name) AS staff_name,
  lpa.assignment_date,
  lpa.start_minutes,
  lpa.end_minutes,
  lpa.job_status,
  lpa.issued_at,
  lpa.started_at,
  lpa.completed_at,
  lpa.actual_start_minutes,
  lpa.actual_end_minutes,
  lpa.actual_duration_minutes,
  CASE
    WHEN lpa.job_status = 'issued' THEN EXTRACT(epoch FROM (now() - lpa.issued_at)) / 60
    WHEN lpa.job_status = 'in_progress' THEN EXTRACT(epoch FROM (now() - lpa.started_at)) / 60
    ELSE NULL::numeric
  END::integer AS minutes_elapsed,
  p.name AS product_name,
  p.internal_code AS product_code,
  od.surcharge_total AS order_detail_surcharge_total
FROM public.labor_plan_assignments lpa
LEFT JOIN public.jobs j ON lpa.job_id = j.job_id
LEFT JOIN public.staff s ON lpa.staff_id = s.staff_id
LEFT JOIN public.orders o ON lpa.order_id = o.order_id
LEFT JOIN public.order_details od ON lpa.order_detail_id = od.order_detail_id
LEFT JOIN public.products p ON od.product_id = p.product_id
WHERE lpa.job_status IN ('issued', 'in_progress')
ORDER BY
  CASE lpa.job_status
    WHEN 'in_progress' THEN 1
    WHEN 'issued' THEN 2
    ELSE NULL::integer
  END,
  lpa.issued_at;

COMMENT ON VIEW public.jobs_in_factory IS 'Shows all jobs currently issued or in progress on the factory floor';

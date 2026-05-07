CREATE OR REPLACE FUNCTION public.resolve_job_card_drawing(
  p_order_detail_id BIGINT,
  p_bol_id INTEGER,
  p_product_id INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
BEGIN
  -- Tier 1: order-line override
  IF p_order_detail_id IS NOT NULL AND p_bol_id IS NOT NULL THEN
    SELECT drawing_url INTO v_url
    FROM order_detail_drawings
    WHERE order_detail_id = p_order_detail_id
      AND bol_id = p_bol_id;

    IF v_url IS NOT NULL THEN
      RETURN v_url;
    END IF;
  END IF;

  -- Tier 2 + 3: BOL upload, then product configurator (gated by use_product_drawing)
  IF p_bol_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN bl.drawing_url IS NOT NULL THEN bl.drawing_url
        WHEN bl.use_product_drawing AND p_product_id IS NOT NULL THEN p.configurator_drawing_url
        ELSE NULL
      END
    INTO v_url
    FROM billoflabour bl
    LEFT JOIN products p ON p.product_id = COALESCE(p_product_id, bl.product_id)
    WHERE bl.bol_id = p_bol_id;

    RETURN v_url;
  END IF;

  IF p_product_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN bl.drawing_url IS NOT NULL THEN bl.drawing_url
        WHEN bl.use_product_drawing THEN p.configurator_drawing_url
        ELSE NULL
      END
    INTO v_url
    FROM billoflabour bl
    JOIN products p ON p.product_id = bl.product_id
    WHERE bl.product_id = p_product_id
      AND (
        bl.drawing_url IS NOT NULL
        OR (bl.use_product_drawing AND p.configurator_drawing_url IS NOT NULL)
      )
    ORDER BY
      CASE
        WHEN bl.drawing_url IS NOT NULL THEN 0
        ELSE 1
      END,
      bl.bol_id
    LIMIT 1;
  END IF;

  RETURN v_url;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_job_card_drawing(BIGINT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_job_card_drawing(BIGINT, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

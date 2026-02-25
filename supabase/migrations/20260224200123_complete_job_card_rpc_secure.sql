-- Secure version: adds org membership check via parent order, drops SECURITY DEFINER.
-- Fixes P0 from Codex review: original RPC was callable cross-org.

CREATE OR REPLACE FUNCTION complete_job_card(p_job_card_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_now timestamptz := now();
  v_order_org_id uuid;
  v_card_exists boolean;
BEGIN
  -- Check job card exists and resolve org_id from parent order (if linked)
  SELECT true, o.org_id INTO v_card_exists, v_order_org_id
  FROM job_cards jc
  LEFT JOIN orders o ON o.order_id = jc.order_id
  WHERE jc.job_card_id = p_job_card_id;

  IF NOT COALESCE(v_card_exists, false) THEN
    RAISE EXCEPTION 'Job card % not found', p_job_card_id;
  END IF;

  -- If job card has a linked order, verify org membership
  IF v_order_org_id IS NOT NULL AND NOT is_org_member(v_order_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  -- Mark the job card as completed
  UPDATE job_cards
  SET status = 'completed',
      completion_date = v_now::date
  WHERE job_card_id = p_job_card_id;

  -- Untouched items: set completed_quantity = quantity
  UPDATE job_card_items
  SET completed_quantity = quantity,
      status = 'completed',
      completion_time = v_now
  WHERE job_card_id = p_job_card_id
    AND completed_quantity = 0;

  -- Partial items: mark completed, keep their entered qty
  UPDATE job_card_items
  SET status = 'completed',
      completion_time = v_now
  WHERE job_card_id = p_job_card_id
    AND completed_quantity > 0
    AND status != 'completed';
END;
$$;

-- Revoke from anon/public, only authenticated users can call
REVOKE EXECUTE ON FUNCTION complete_job_card(integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION complete_job_card(integer) TO authenticated;

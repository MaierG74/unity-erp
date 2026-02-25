-- Atomic job card completion RPC
-- Called from app/scan/jc/[id]/page.tsx when staff marks a job card complete.
-- Original version (superseded by 20260224200123_complete_job_card_rpc_secure.sql).

CREATE OR REPLACE FUNCTION complete_job_card(p_job_card_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE job_cards
  SET status = 'completed',
      completion_date = v_now::date
  WHERE job_card_id = p_job_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job card % not found', p_job_card_id;
  END IF;

  UPDATE job_card_items
  SET completed_quantity = quantity,
      status = 'completed',
      completion_time = v_now
  WHERE job_card_id = p_job_card_id
    AND completed_quantity = 0;

  UPDATE job_card_items
  SET status = 'completed',
      completion_time = v_now
  WHERE job_card_id = p_job_card_id
    AND completed_quantity > 0
    AND status != 'completed';
END;
$$;

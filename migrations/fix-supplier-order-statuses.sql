-- Fix Supplier Order Statuses
-- This script corrects supplier_orders that have incorrect status based on their received quantities
-- Created: 2025-11-10

-- ============================================================================
-- PART 1: Fix orders with wrong status based on received quantities
-- ============================================================================

DO $$
DECLARE
  v_partial_status_id integer;
  v_fully_received_status_id integer;
  v_open_status_id integer;
  v_approved_status_id integer;
  v_updated_count integer := 0;
BEGIN
  -- Get status IDs
  SELECT status_id INTO v_partial_status_id
  FROM supplier_order_statuses
  WHERE status_name = 'Partially Received';

  SELECT status_id INTO v_fully_received_status_id
  FROM supplier_order_statuses
  WHERE status_name = 'Fully Received';

  SELECT status_id INTO v_open_status_id
  FROM supplier_order_statuses
  WHERE status_name = 'Open';

  SELECT status_id INTO v_approved_status_id
  FROM supplier_order_statuses
  WHERE status_name = 'Approved';

  RAISE NOTICE 'Status IDs - Partially Received: %, Fully Received: %, Open: %, Approved: %',
    v_partial_status_id, v_fully_received_status_id, v_open_status_id, v_approved_status_id;

  -- Update orders that are partially received but have wrong status
  -- (includes orders marked as Completed, Approved, Open, etc. that should be Partially Received)
  UPDATE supplier_orders
  SET status_id = v_partial_status_id
  WHERE status_id NOT IN (v_partial_status_id, v_fully_received_status_id)
    AND total_received > 0
    AND total_received < order_quantity;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % orders to Partially Received status', v_updated_count;

  -- Update orders that are fully received but marked as something else
  UPDATE supplier_orders
  SET status_id = v_fully_received_status_id
  WHERE status_id != v_fully_received_status_id
    AND total_received >= order_quantity;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % orders to Fully Received status', v_updated_count;

  -- Note: We don't auto-update orders with 0 received back to Open/Approved
  -- as they may have been intentionally set to other statuses

END $$;

-- ============================================================================
-- PART 2: Show summary of what was fixed
-- ============================================================================

SELECT
  'Summary of Supplier Order Status Fixes' as report_section,
  COUNT(*) as total_orders,
  SUM(CASE WHEN sos.status_name = 'Partially Received'
           AND so.total_received > 0
           AND so.total_received < so.order_quantity
      THEN 1 ELSE 0 END) as correct_partial,
  SUM(CASE WHEN sos.status_name = 'Fully Received'
           AND so.total_received >= so.order_quantity
      THEN 1 ELSE 0 END) as correct_fully_received,
  SUM(CASE WHEN sos.status_name NOT IN ('Partially Received', 'Fully Received', 'Cancelled', 'Completed')
           AND so.total_received > 0
           AND so.total_received < so.order_quantity
      THEN 1 ELSE 0 END) as still_needs_fixing
FROM supplier_orders so
LEFT JOIN supplier_order_statuses sos ON so.status_id = sos.status_id
WHERE so.total_received IS NOT NULL;

-- ============================================================================
-- PART 3: Show specific orders that were affected
-- ============================================================================

SELECT
  so.order_id,
  po.q_number,
  sc.component_id,
  c.internal_code as component_code,
  so.order_quantity,
  so.total_received,
  (so.order_quantity - COALESCE(so.total_received, 0)) as still_owing,
  sos.status_name as current_status,
  CASE
    WHEN so.total_received = 0 THEN 'Open/Approved'
    WHEN so.total_received < so.order_quantity THEN 'Partially Received'
    WHEN so.total_received >= so.order_quantity THEN 'Fully Received'
  END as correct_status
FROM supplier_orders so
LEFT JOIN purchase_orders po ON so.purchase_order_id = po.purchase_order_id
LEFT JOIN supplier_order_statuses sos ON so.status_id = sos.status_id
LEFT JOIN suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
LEFT JOIN components c ON sc.component_id = c.component_id
WHERE so.total_received > 0
  AND so.total_received < so.order_quantity
ORDER BY so.order_id;

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================
-- Run this query to verify all statuses are now correct:
--
-- SELECT
--   so.order_id,
--   so.order_quantity,
--   so.total_received,
--   sos.status_name,
--   CASE
--     WHEN so.total_received >= so.order_quantity THEN 'Should be: Fully Received'
--     WHEN so.total_received > 0 THEN 'Should be: Partially Received'
--     ELSE 'OK (not yet received)'
--   END as expected_status
-- FROM supplier_orders so
-- LEFT JOIN supplier_order_statuses sos ON so.status_id = sos.status_id
-- WHERE
--   (so.total_received >= so.order_quantity AND sos.status_name != 'Fully Received')
--   OR
--   (so.total_received > 0 AND so.total_received < so.order_quantity
--    AND sos.status_name NOT IN ('Partially Received', 'Completed'));

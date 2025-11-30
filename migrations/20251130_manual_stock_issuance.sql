-- Migration: Add manual stock issuance support
-- Date: 2025-11-30
-- Purpose: Enable stock issuances without requiring an order in Unity (for phased rollout)

-- Add new columns to stock_issuances table for manual issuances
ALTER TABLE stock_issuances 
ADD COLUMN IF NOT EXISTS external_reference TEXT,
ADD COLUMN IF NOT EXISTS issue_category TEXT;

-- Add comment for documentation
COMMENT ON COLUMN stock_issuances.external_reference IS 'External reference for manual issuances (legacy PO#, job#, customer name)';
COMMENT ON COLUMN stock_issuances.issue_category IS 'Category of manual issuance (production, customer_order, samples, wastage, rework, other)';

-- Create RPC function for manual stock issuance (no order required)
CREATE OR REPLACE FUNCTION process_manual_stock_issuance(
  p_component_id INTEGER,
  p_quantity NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_external_reference TEXT DEFAULT NULL,
  p_issue_category TEXT DEFAULT 'production',
  p_staff_id INTEGER DEFAULT NULL,
  p_issuance_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  issuance_id INTEGER,
  transaction_id INTEGER,
  quantity_on_hand NUMERIC,
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_issuance_id INTEGER;
  v_transaction_id INTEGER;
  v_current_quantity NUMERIC;
  v_new_quantity NUMERIC;
  v_inventory_id INTEGER;
  v_transaction_type_id INTEGER;
  v_user_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();

  -- Validate quantity
  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT 
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::NUMERIC,
      FALSE,
      'Quantity must be greater than zero'::TEXT;
    RETURN;
  END IF;

  -- Validate external reference is provided
  IF p_external_reference IS NULL OR TRIM(p_external_reference) = '' THEN
    RETURN QUERY SELECT 
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::NUMERIC,
      FALSE,
      'External reference is required for manual issuances'::TEXT;
    RETURN;
  END IF;

  -- Get current inventory
  SELECT inventory_id, quantity_on_hand 
  INTO v_inventory_id, v_current_quantity
  FROM inventory 
  WHERE component_id = p_component_id;

  IF v_inventory_id IS NULL THEN
    RETURN QUERY SELECT 
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::NUMERIC,
      FALSE,
      'Component not found in inventory'::TEXT;
    RETURN;
  END IF;

  -- Check if sufficient stock available
  IF v_current_quantity < p_quantity THEN
    RETURN QUERY SELECT 
      NULL::INTEGER,
      NULL::INTEGER,
      v_current_quantity,
      FALSE,
      format('Insufficient stock. Available: %s, Requested: %s', v_current_quantity, p_quantity)::TEXT;
    RETURN;
  END IF;

  -- Get transaction type ID for ISSUE
  SELECT transaction_type_id INTO v_transaction_type_id
  FROM transaction_types
  WHERE type_name = 'ISSUE'
  LIMIT 1;

  IF v_transaction_type_id IS NULL THEN
    -- Create the ISSUE type if it doesn't exist
    INSERT INTO transaction_types (type_name) VALUES ('ISSUE')
    RETURNING transaction_type_id INTO v_transaction_type_id;
  END IF;

  -- Calculate new quantity
  v_new_quantity := v_current_quantity - p_quantity;

  -- Create stock issuance record (without order_id)
  INSERT INTO stock_issuances (
    component_id,
    order_id,
    quantity_issued,
    issuance_date,
    notes,
    created_by,
    staff_id,
    external_reference,
    issue_category
  ) VALUES (
    p_component_id,
    NULL,  -- No order_id for manual issuance
    p_quantity,
    p_issuance_date,
    p_notes,
    v_user_id::TEXT,
    p_staff_id,
    p_external_reference,
    p_issue_category
  )
  RETURNING stock_issuances.issuance_id INTO v_issuance_id;

  -- Create inventory transaction
  INSERT INTO inventory_transactions (
    component_id,
    transaction_type_id,
    quantity,
    transaction_date,
    reason,
    created_by
  ) VALUES (
    p_component_id,
    v_transaction_type_id,
    -p_quantity,  -- Negative for issuance
    p_issuance_date,
    COALESCE(p_notes, 'Manual issuance: ' || p_external_reference),
    v_user_id
  )
  RETURNING inventory_transactions.transaction_id INTO v_transaction_id;

  -- Update inventory
  UPDATE inventory
  SET 
    quantity_on_hand = v_new_quantity,
    updated_at = NOW()
  WHERE inventory_id = v_inventory_id;

  -- Return success
  RETURN QUERY SELECT 
    v_issuance_id,
    v_transaction_id,
    v_new_quantity,
    TRUE,
    'Stock issued successfully'::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 
    NULL::INTEGER,
    NULL::INTEGER,
    NULL::NUMERIC,
    FALSE,
    SQLERRM::TEXT;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_manual_stock_issuance(INTEGER, NUMERIC, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ) TO authenticated;

-- Create index for querying manual issuances
CREATE INDEX IF NOT EXISTS idx_stock_issuances_manual 
ON stock_issuances (issuance_date DESC) 
WHERE order_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_issuances_external_ref
ON stock_issuances (external_reference)
WHERE external_reference IS NOT NULL;

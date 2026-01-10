-- Migration: Manual stock issuance with picking list workflow
-- Date: 2025-12-08
-- Purpose: Enable manual stock issuance with optional picking list (pending issue) workflow

-- ============================================================================
-- PART 1: Create pending_stock_issuances table for picking list workflow
-- ============================================================================
CREATE TABLE IF NOT EXISTS pending_stock_issuances (
  pending_id SERIAL PRIMARY KEY,
  external_reference TEXT NOT NULL,
  issue_category TEXT DEFAULT 'production',
  staff_id INTEGER REFERENCES staff(staff_id),
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'issued', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  issued_at TIMESTAMPTZ,
  issued_by UUID REFERENCES auth.users(id)
);

-- Pending issuance line items
CREATE TABLE IF NOT EXISTS pending_stock_issuance_items (
  item_id SERIAL PRIMARY KEY,
  pending_id INTEGER NOT NULL REFERENCES pending_stock_issuances(pending_id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES components(component_id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pending_issuances_status ON pending_stock_issuances(status);
CREATE INDEX IF NOT EXISTS idx_pending_issuances_external_ref ON pending_stock_issuances(external_reference);
CREATE INDEX IF NOT EXISTS idx_pending_issuance_items_pending ON pending_stock_issuance_items(pending_id);

-- RLS policies
ALTER TABLE pending_stock_issuances ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_stock_issuance_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to manage pending issuances"
  ON pending_stock_issuances FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated users to manage pending issuance items"
  ON pending_stock_issuance_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- PART 2: Function to create inventory record for a component (user-initiated)
-- ============================================================================
CREATE OR REPLACE FUNCTION create_inventory_for_component(
  p_component_id INTEGER,
  p_initial_quantity NUMERIC DEFAULT 0
)
RETURNS TABLE (
  inventory_id INTEGER,
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inventory_id INTEGER;
  v_exists BOOLEAN;
BEGIN
  -- Check if component exists
  SELECT EXISTS(SELECT 1 FROM components WHERE component_id = p_component_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN QUERY SELECT NULL::INTEGER, FALSE, 'Component does not exist'::TEXT;
    RETURN;
  END IF;

  -- Check if inventory record already exists
  SELECT i.inventory_id INTO v_inventory_id FROM inventory i WHERE i.component_id = p_component_id;
  IF v_inventory_id IS NOT NULL THEN
    RETURN QUERY SELECT v_inventory_id, TRUE, 'Inventory record already exists'::TEXT;
    RETURN;
  END IF;

  -- Create inventory record
  INSERT INTO inventory (component_id, quantity_on_hand, created_at, updated_at)
  VALUES (p_component_id, p_initial_quantity, NOW(), NOW())
  RETURNING inventory.inventory_id INTO v_inventory_id;

  RETURN QUERY SELECT v_inventory_id, TRUE, 'Inventory record created successfully'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION create_inventory_for_component(INTEGER, NUMERIC) TO authenticated;

-- ============================================================================
-- PART 3: Function to create a pending issuance (picking list)
-- ============================================================================
CREATE OR REPLACE FUNCTION create_pending_stock_issuance(
  p_components JSONB,  -- Array of {component_id, quantity}
  p_external_reference TEXT,
  p_issue_category TEXT DEFAULT 'production',
  p_staff_id INTEGER DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  pending_id INTEGER,
  success BOOLEAN,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending_id INTEGER;
  v_user_id UUID;
  v_item JSONB;
BEGIN
  v_user_id := auth.uid();

  -- Validate external reference
  IF p_external_reference IS NULL OR TRIM(p_external_reference) = '' THEN
    RETURN QUERY SELECT NULL::INTEGER, FALSE, 'External reference is required'::TEXT;
    RETURN;
  END IF;

  -- Validate components array
  IF p_components IS NULL OR jsonb_array_length(p_components) = 0 THEN
    RETURN QUERY SELECT NULL::INTEGER, FALSE, 'At least one component is required'::TEXT;
    RETURN;
  END IF;

  -- Create pending issuance header
  INSERT INTO pending_stock_issuances (
    external_reference, issue_category, staff_id, notes, created_by
  ) VALUES (
    p_external_reference, p_issue_category, p_staff_id, p_notes, v_user_id
  )
  RETURNING pending_stock_issuances.pending_id INTO v_pending_id;

  -- Insert line items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_components)
  LOOP
    INSERT INTO pending_stock_issuance_items (pending_id, component_id, quantity)
    VALUES (
      v_pending_id,
      (v_item->>'component_id')::INTEGER,
      (v_item->>'quantity')::NUMERIC
    );
  END LOOP;

  RETURN QUERY SELECT v_pending_id, TRUE, 'Picking list created successfully'::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::INTEGER, FALSE, SQLERRM::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION create_pending_stock_issuance(JSONB, TEXT, TEXT, INTEGER, TEXT) TO authenticated;

-- ============================================================================
-- PART 4: Function to complete a pending issuance (issue stock)
-- ============================================================================
CREATE OR REPLACE FUNCTION complete_pending_stock_issuance(
  p_pending_id INTEGER
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  items_issued INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_pending RECORD;
  v_item RECORD;
  v_inventory_id INTEGER;
  v_current_qty NUMERIC;
  v_new_qty NUMERIC;
  v_transaction_type_id INTEGER;
  v_items_count INTEGER := 0;
  v_missing_inventory TEXT[];
BEGIN
  v_user_id := auth.uid();

  -- Get pending issuance
  SELECT * INTO v_pending FROM pending_stock_issuances WHERE pending_id = p_pending_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Pending issuance not found'::TEXT, 0;
    RETURN;
  END IF;

  IF v_pending.status != 'pending' THEN
    RETURN QUERY SELECT FALSE, format('Issuance already %s', v_pending.status)::TEXT, 0;
    RETURN;
  END IF;

  -- Check all components have inventory records
  SELECT ARRAY_AGG(c.internal_code)
  INTO v_missing_inventory
  FROM pending_stock_issuance_items psi
  JOIN components c ON c.component_id = psi.component_id
  LEFT JOIN inventory i ON i.component_id = psi.component_id
  WHERE psi.pending_id = p_pending_id AND i.inventory_id IS NULL;

  IF v_missing_inventory IS NOT NULL AND array_length(v_missing_inventory, 1) > 0 THEN
    RETURN QUERY SELECT FALSE,
      format('Missing inventory records for: %s. Please create inventory records first.', array_to_string(v_missing_inventory, ', '))::TEXT,
      0;
    RETURN;
  END IF;

  -- Get ISSUE transaction type
  SELECT transaction_type_id INTO v_transaction_type_id
  FROM transaction_types WHERE type_name = 'ISSUE' LIMIT 1;

  IF v_transaction_type_id IS NULL THEN
    INSERT INTO transaction_types (type_name) VALUES ('ISSUE')
    RETURNING transaction_type_id INTO v_transaction_type_id;
  END IF;

  -- Process each item
  FOR v_item IN
    SELECT psi.*, c.internal_code
    FROM pending_stock_issuance_items psi
    JOIN components c ON c.component_id = psi.component_id
    WHERE psi.pending_id = p_pending_id
  LOOP
    -- Get inventory
    SELECT i.inventory_id, i.quantity_on_hand
    INTO v_inventory_id, v_current_qty
    FROM inventory i WHERE i.component_id = v_item.component_id;

    v_new_qty := COALESCE(v_current_qty, 0) - v_item.quantity;

    -- Create stock issuance record
    INSERT INTO stock_issuances (
      component_id, order_id, quantity_issued, issuance_date, notes,
      created_by, staff_id, external_reference, issue_category
    ) VALUES (
      v_item.component_id, NULL, v_item.quantity, NOW(),
      v_pending.notes, v_user_id::TEXT, v_pending.staff_id,
      v_pending.external_reference, v_pending.issue_category
    );

    -- Create inventory transaction
    INSERT INTO inventory_transactions (
      component_id, transaction_type_id, quantity, transaction_date, reason, created_by
    ) VALUES (
      v_item.component_id, v_transaction_type_id, -v_item.quantity, NOW(),
      COALESCE(v_pending.notes, 'Manual issuance: ' || v_pending.external_reference), v_user_id
    );

    -- Update inventory
    UPDATE inventory SET quantity_on_hand = v_new_qty, updated_at = NOW()
    WHERE inventory_id = v_inventory_id;

    v_items_count := v_items_count + 1;
  END LOOP;

  -- Mark pending issuance as issued
  UPDATE pending_stock_issuances
  SET status = 'issued', issued_at = NOW(), issued_by = v_user_id
  WHERE pending_id = p_pending_id;

  RETURN QUERY SELECT TRUE, 'Stock issued successfully'::TEXT, v_items_count;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT, 0;
END;
$$;

GRANT EXECUTE ON FUNCTION complete_pending_stock_issuance(INTEGER) TO authenticated;

-- ============================================================================
-- PART 5: Update direct issuance function (NO auto-create inventory)
-- ============================================================================
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
  v_component_exists BOOLEAN;
  v_internal_code TEXT;
BEGIN
  v_user_id := auth.uid();

  -- Validate quantity
  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT NULL::INTEGER, NULL::INTEGER, NULL::NUMERIC, FALSE,
      'Quantity must be greater than zero'::TEXT;
    RETURN;
  END IF;

  -- Validate external reference
  IF p_external_reference IS NULL OR TRIM(p_external_reference) = '' THEN
    RETURN QUERY SELECT NULL::INTEGER, NULL::INTEGER, NULL::NUMERIC, FALSE,
      'External reference is required for manual issuances'::TEXT;
    RETURN;
  END IF;

  -- Check if component exists
  SELECT c.internal_code INTO v_internal_code FROM components c WHERE c.component_id = p_component_id;
  IF v_internal_code IS NULL THEN
    RETURN QUERY SELECT NULL::INTEGER, NULL::INTEGER, NULL::NUMERIC, FALSE,
      'Component does not exist'::TEXT;
    RETURN;
  END IF;

  -- Get inventory record (do NOT auto-create)
  SELECT i.inventory_id, i.quantity_on_hand
  INTO v_inventory_id, v_current_quantity
  FROM inventory i WHERE i.component_id = p_component_id;

  IF v_inventory_id IS NULL THEN
    RETURN QUERY SELECT NULL::INTEGER, NULL::INTEGER, NULL::NUMERIC, FALSE,
      format('NO_INVENTORY:%s', v_internal_code)::TEXT;
    RETURN;
  END IF;

  -- Get ISSUE transaction type
  SELECT transaction_type_id INTO v_transaction_type_id
  FROM transaction_types WHERE type_name = 'ISSUE' LIMIT 1;

  IF v_transaction_type_id IS NULL THEN
    INSERT INTO transaction_types (type_name) VALUES ('ISSUE')
    RETURNING transaction_type_id INTO v_transaction_type_id;
  END IF;

  -- Calculate new quantity (allow negative)
  v_new_quantity := v_current_quantity - p_quantity;

  -- Create stock issuance record
  INSERT INTO stock_issuances (
    component_id, order_id, quantity_issued, issuance_date, notes,
    created_by, staff_id, external_reference, issue_category
  ) VALUES (
    p_component_id, NULL, p_quantity, p_issuance_date, p_notes,
    v_user_id::TEXT, p_staff_id, p_external_reference, p_issue_category
  )
  RETURNING stock_issuances.issuance_id INTO v_issuance_id;

  -- Create inventory transaction
  INSERT INTO inventory_transactions (
    component_id, transaction_type_id, quantity, transaction_date, reason, created_by
  ) VALUES (
    p_component_id, v_transaction_type_id, -p_quantity, p_issuance_date,
    COALESCE(p_notes, 'Manual issuance: ' || p_external_reference), v_user_id
  )
  RETURNING inventory_transactions.transaction_id INTO v_transaction_id;

  -- Update inventory
  UPDATE inventory SET quantity_on_hand = v_new_quantity, updated_at = NOW()
  WHERE inventory_id = v_inventory_id;

  -- Return success
  IF v_new_quantity < 0 THEN
    RETURN QUERY SELECT v_issuance_id, v_transaction_id, v_new_quantity, TRUE,
      format('Stock issued (negative inventory: %s)', v_new_quantity)::TEXT;
  ELSE
    RETURN QUERY SELECT v_issuance_id, v_transaction_id, v_new_quantity, TRUE,
      'Stock issued successfully'::TEXT;
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::INTEGER, NULL::INTEGER, NULL::NUMERIC, FALSE, SQLERRM::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION process_manual_stock_issuance(INTEGER, NUMERIC, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ) TO authenticated;

-- ============================================================================
-- PART 6: Function to cancel a pending issuance
-- ============================================================================
CREATE OR REPLACE FUNCTION cancel_pending_stock_issuance(p_pending_id INTEGER)
RETURNS TABLE (success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE pending_stock_issuances
  SET status = 'cancelled'
  WHERE pending_id = p_pending_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Pending issuance not found or already processed'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'Pending issuance cancelled'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_pending_stock_issuance(INTEGER) TO authenticated;

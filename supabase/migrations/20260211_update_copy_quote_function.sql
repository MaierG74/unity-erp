-- Update copy_quote function to accept optional customer_id parameter
-- This allows changing the customer when copying a quote

-- Drop the old function first
DROP FUNCTION IF EXISTS copy_quote(UUID, TEXT);

-- Create the updated function with new_customer_id parameter
CREATE OR REPLACE FUNCTION copy_quote(
  source_quote_id UUID,
  new_quote_number TEXT,
  new_customer_id INTEGER DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  new_quote_id UUID;
  item_mapping JSONB := '{}';
  cluster_mapping JSONB := '{}';
  new_item_id UUID;
  new_cluster_id UUID;
  source_rec RECORD;
  target_customer_id INTEGER;
BEGIN
  -- Get the source quote's customer_id as fallback
  SELECT customer_id INTO target_customer_id FROM quotes WHERE id = source_quote_id;

  IF target_customer_id IS NULL THEN
    RAISE EXCEPTION 'Source quote not found';
  END IF;

  -- Use new_customer_id if provided, otherwise use source customer_id
  IF new_customer_id IS NOT NULL THEN
    target_customer_id := new_customer_id;
  END IF;

  -- 1. Copy the quote with the target customer_id
  INSERT INTO quotes (quote_number, customer_id, status, grand_total, subtotal, vat_rate, vat_amount, notes, terms_conditions, valid_until)
  SELECT new_quote_number, target_customer_id, 'draft', grand_total, subtotal, vat_rate, vat_amount, notes, terms_conditions, valid_until
  FROM quotes WHERE id = source_quote_id
  RETURNING id INTO new_quote_id;

  IF new_quote_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create new quote';
  END IF;

  -- 2. Copy quote items and build mapping
  FOR source_rec IN SELECT * FROM quote_items WHERE quote_id = source_quote_id LOOP
    INSERT INTO quote_items (quote_id, description, qty, unit_price, total, bullet_points, internal_notes, selected_options)
    VALUES (new_quote_id, source_rec.description, source_rec.qty, source_rec.unit_price, source_rec.total, source_rec.bullet_points, source_rec.internal_notes, source_rec.selected_options)
    RETURNING id INTO new_item_id;

    item_mapping := item_mapping || jsonb_build_object(source_rec.id::text, new_item_id::text);
  END LOOP;

  -- 3. Copy clusters and build mapping
  FOR source_rec IN
    SELECT qic.* FROM quote_item_clusters qic
    JOIN quote_items qi ON qi.id = qic.quote_item_id
    WHERE qi.quote_id = source_quote_id
  LOOP
    new_item_id := (item_mapping->>source_rec.quote_item_id::text)::uuid;

    INSERT INTO quote_item_clusters (quote_item_id, name, notes, position, markup_percent)
    VALUES (new_item_id, source_rec.name, source_rec.notes, source_rec.position, source_rec.markup_percent)
    RETURNING id INTO new_cluster_id;

    cluster_mapping := cluster_mapping || jsonb_build_object(source_rec.id::text, new_cluster_id::text);
  END LOOP;

  -- 4. Copy cluster lines
  INSERT INTO quote_cluster_lines (cluster_id, line_type, component_id, supplier_component_id, description, qty, unit_cost, unit_price, include_in_markup, labor_type, hours, rate, sort_order, cutlist_slot)
  SELECT
    (cluster_mapping->>qcl.cluster_id::text)::uuid,
    qcl.line_type, qcl.component_id, qcl.supplier_component_id, qcl.description, qcl.qty, qcl.unit_cost, qcl.unit_price, qcl.include_in_markup, qcl.labor_type, qcl.hours, qcl.rate, qcl.sort_order, qcl.cutlist_slot
  FROM quote_cluster_lines qcl
  JOIN quote_item_clusters qic ON qic.id = qcl.cluster_id
  JOIN quote_items qi ON qi.id = qic.quote_item_id
  WHERE qi.quote_id = source_quote_id;

  -- 5. Copy attachments
  INSERT INTO quote_attachments (quote_id, quote_item_id, scope, file_url, mime_type, original_name, display_in_quote)
  SELECT
    new_quote_id,
    CASE WHEN qa.quote_item_id IS NOT NULL THEN (item_mapping->>qa.quote_item_id::text)::uuid ELSE NULL END,
    qa.scope, qa.file_url, qa.mime_type, qa.original_name, qa.display_in_quote
  FROM quote_attachments qa
  WHERE qa.quote_id = source_quote_id;

  RETURN new_quote_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION copy_quote(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION copy_quote(UUID, TEXT, INTEGER) TO service_role;

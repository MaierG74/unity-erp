-- Phase 1A (3/5): integrity triggers — order_type immutability, order_details cross-table
-- invariant, and cross-org consistency guards on the new child tables.
-- Locking rule (round-2 MAJOR #1): take FOR SHARE on a parent when reading a non-key business
-- column the check depends on (org_id, order_type, status). Lock order: orders -> notes/receipts -> details.

-- ===== orders.order_type immutability after dependent rows exist =====
CREATE OR REPLACE FUNCTION public.enforce_order_type_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_type IS DISTINCT FROM OLD.order_type THEN
    IF EXISTS (SELECT 1 FROM public.order_details   WHERE order_id = OLD.order_id)
    OR EXISTS (SELECT 1 FROM public.job_cards        WHERE order_id = OLD.order_id)
    OR EXISTS (SELECT 1 FROM public.product_inventory_transactions WHERE order_id = OLD.order_id)
    OR EXISTS (SELECT 1 FROM public.order_delivery_notes WHERE order_id = OLD.order_id)
    OR EXISTS (SELECT 1 FROM public.stock_receipts   WHERE order_id = OLD.order_id) THEN
      RAISE EXCEPTION 'order_type is immutable once the order has details, job cards, delivery notes, stock receipts, or inventory transactions';
    END IF;
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_orders_order_type_immutable ON public.orders;
CREATE TRIGGER trg_orders_order_type_immutable
  BEFORE UPDATE OF order_type ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_type_immutable();

-- ===== order_details: delivered_qty/received_qty must match parent order_type =====
CREATE OR REPLACE FUNCTION public.enforce_order_detail_counter_type()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text;
BEGIN
  IF NEW.delivered_qty = 0 AND NEW.received_qty = 0 THEN
    RETURN NEW;
  END IF;
  SELECT order_type INTO v_type FROM public.orders WHERE order_id = NEW.order_id FOR SHARE;
  IF NEW.delivered_qty > 0 AND v_type <> 'customer' THEN
    RAISE EXCEPTION 'delivered_qty > 0 requires a customer order (detail %)', NEW.order_detail_id;
  END IF;
  IF NEW.received_qty > 0 AND v_type <> 'internal' THEN
    RAISE EXCEPTION 'received_qty > 0 requires an internal order (detail %)', NEW.order_detail_id;
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_order_details_counter_type ON public.order_details;
CREATE TRIGGER trg_order_details_counter_type
  BEFORE UPDATE OF delivered_qty, received_qty ON public.order_details
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_detail_counter_type();

-- ===== cross-org consistency: order_delivery_notes (parent orders, customer) =====
CREATE OR REPLACE FUNCTION public.xorg_order_delivery_notes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_org uuid; v_type text;
BEGIN
  SELECT org_id, order_type INTO v_org, v_type FROM public.orders WHERE order_id = NEW.order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Parent order % does not exist', NEW.order_id; END IF;
  IF v_org <> NEW.org_id THEN RAISE EXCEPTION 'org_id mismatch: order_delivery_notes vs order %', NEW.order_id; END IF;
  IF v_type <> 'customer' THEN RAISE EXCEPTION 'Order % is not a customer order', NEW.order_id; END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_xorg_order_delivery_notes ON public.order_delivery_notes;
CREATE TRIGGER trg_xorg_order_delivery_notes
  BEFORE INSERT OR UPDATE ON public.order_delivery_notes
  FOR EACH ROW EXECUTE FUNCTION public.xorg_order_delivery_notes();

-- ===== cross-org consistency: order_delivery_note_items =====
CREATE OR REPLACE FUNCTION public.xorg_order_delivery_note_items()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_note_org uuid; v_note_order integer; v_detail_order integer;
BEGIN
  SELECT org_id, order_id INTO v_note_org, v_note_order
  FROM public.order_delivery_notes WHERE order_delivery_note_id = NEW.order_delivery_note_id FOR SHARE;
  IF v_note_org IS NULL THEN RAISE EXCEPTION 'Parent delivery note % does not exist', NEW.order_delivery_note_id; END IF;
  IF v_note_org <> NEW.org_id THEN RAISE EXCEPTION 'org_id mismatch: note item vs note %', NEW.order_delivery_note_id; END IF;
  SELECT order_id INTO v_detail_order FROM public.order_details WHERE order_detail_id = NEW.order_detail_id FOR KEY SHARE;
  IF v_detail_order IS NULL OR v_detail_order <> v_note_order THEN
    RAISE EXCEPTION 'order_detail % does not belong to the note''s order %', NEW.order_detail_id, v_note_order;
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_xorg_order_delivery_note_items ON public.order_delivery_note_items;
CREATE TRIGGER trg_xorg_order_delivery_note_items
  BEFORE INSERT OR UPDATE ON public.order_delivery_note_items
  FOR EACH ROW EXECUTE FUNCTION public.xorg_order_delivery_note_items();

-- ===== cross-org consistency: stock_receipts (parent orders, internal) =====
CREATE OR REPLACE FUNCTION public.xorg_stock_receipts()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_org uuid; v_type text;
BEGIN
  SELECT org_id, order_type INTO v_org, v_type FROM public.orders WHERE order_id = NEW.order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Parent order % does not exist', NEW.order_id; END IF;
  IF v_org <> NEW.org_id THEN RAISE EXCEPTION 'org_id mismatch: stock_receipts vs order %', NEW.order_id; END IF;
  IF v_type <> 'internal' THEN RAISE EXCEPTION 'Order % is not an internal order', NEW.order_id; END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_xorg_stock_receipts ON public.stock_receipts;
CREATE TRIGGER trg_xorg_stock_receipts
  BEFORE INSERT OR UPDATE ON public.stock_receipts
  FOR EACH ROW EXECUTE FUNCTION public.xorg_stock_receipts();

-- ===== cross-org consistency: stock_receipt_items =====
CREATE OR REPLACE FUNCTION public.xorg_stock_receipt_items()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rec_org uuid; v_rec_order integer; v_detail_order integer; v_detail_product integer;
BEGIN
  SELECT org_id, order_id INTO v_rec_org, v_rec_order
  FROM public.stock_receipts WHERE stock_receipt_id = NEW.stock_receipt_id FOR SHARE;
  IF v_rec_org IS NULL THEN RAISE EXCEPTION 'Parent stock receipt % does not exist', NEW.stock_receipt_id; END IF;
  IF v_rec_org <> NEW.org_id THEN RAISE EXCEPTION 'org_id mismatch: receipt item vs receipt %', NEW.stock_receipt_id; END IF;
  SELECT order_id, product_id INTO v_detail_order, v_detail_product
  FROM public.order_details WHERE order_detail_id = NEW.order_detail_id FOR KEY SHARE;
  IF v_detail_order IS NULL OR v_detail_order <> v_rec_order THEN
    RAISE EXCEPTION 'order_detail % does not belong to the receipt''s order %', NEW.order_detail_id, v_rec_order;
  END IF;
  IF v_detail_product IS NOT NULL AND NEW.product_id <> v_detail_product THEN
    RAISE EXCEPTION 'receipt item product % does not match order_detail product %', NEW.product_id, v_detail_product;
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_xorg_stock_receipt_items ON public.stock_receipt_items;
CREATE TRIGGER trg_xorg_stock_receipt_items
  BEFORE INSERT OR UPDATE ON public.stock_receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.xorg_stock_receipt_items();

-- ===== cross-org consistency: stock_adjustments / product_sections vs products =====
CREATE OR REPLACE FUNCTION public.xorg_matches_product_org()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.products WHERE product_id = NEW.product_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Parent product % does not exist', NEW.product_id; END IF;
  IF v_org <> NEW.org_id THEN RAISE EXCEPTION 'org_id mismatch: % vs product %', TG_TABLE_NAME, NEW.product_id; END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_xorg_stock_adjustments ON public.stock_adjustments;
CREATE TRIGGER trg_xorg_stock_adjustments
  BEFORE INSERT OR UPDATE ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.xorg_matches_product_org();
DROP TRIGGER IF EXISTS trg_xorg_product_sections ON public.product_sections;
CREATE TRIGGER trg_xorg_product_sections
  BEFORE INSERT OR UPDATE ON public.product_sections
  FOR EACH ROW EXECUTE FUNCTION public.xorg_matches_product_org();

-- ===== cross-org consistency: order_detail_required_sections vs order_details =====
CREATE OR REPLACE FUNCTION public.xorg_order_detail_required_sections()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.order_details WHERE order_detail_id = NEW.order_detail_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Parent order_detail % does not exist', NEW.order_detail_id; END IF;
  IF v_org <> NEW.org_id THEN RAISE EXCEPTION 'org_id mismatch: order_detail_required_sections vs detail %', NEW.order_detail_id; END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_xorg_odrs ON public.order_detail_required_sections;
CREATE TRIGGER trg_xorg_odrs
  BEFORE INSERT OR UPDATE ON public.order_detail_required_sections
  FOR EACH ROW EXECUTE FUNCTION public.xorg_order_detail_required_sections();

-- ===== cross-org consistency: order_status_events vs orders =====
CREATE OR REPLACE FUNCTION public.xorg_order_status_events()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.orders WHERE order_id = NEW.order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Parent order % does not exist', NEW.order_id; END IF;
  IF v_org <> NEW.org_id THEN RAISE EXCEPTION 'org_id mismatch: order_status_events vs order %', NEW.order_id; END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_xorg_order_status_events ON public.order_status_events;
CREATE TRIGGER trg_xorg_order_status_events
  BEFORE INSERT OR UPDATE ON public.order_status_events
  FOR EACH ROW EXECUTE FUNCTION public.xorg_order_status_events();

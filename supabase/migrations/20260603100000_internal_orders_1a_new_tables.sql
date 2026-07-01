-- Phase 1A (1/5): Internal Orders & Order Completion — new tables
--
-- Additive only. Zero behaviour change to existing flows.
-- SECTION MODEL DECISION (deviation from signed-off spec, 2026-06-03):
--   The spec built section routing on `manufacturing_sections` / `order_manufacturing_sections`.
--   Live verification showed those tables are EMPTY with zero code/view/function references
--   (a dead design). The real, operator-facing section model is `factory_sections` (6 lanes,
--   routed from job_categories). All section_id FKs in this feature therefore target
--   public.factory_sections(section_id). See docs deviations log.

-- =====================================================================
-- product_sections — per-org override of a product's section route
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.product_sections (
  product_section_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id              uuid    NOT NULL REFERENCES public.organizations(id),
  product_id          integer NOT NULL REFERENCES public.products(product_id) ON DELETE CASCADE,
  section_id          integer NOT NULL REFERENCES public.factory_sections(section_id),
  sequence_order      integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_sections_org_product_section_uq UNIQUE (org_id, product_id, section_id),
  CONSTRAINT product_sections_org_product_seq_uq     UNIQUE (org_id, product_id, sequence_order)
);
CREATE INDEX IF NOT EXISTS product_sections_org_product_idx
  ON public.product_sections (org_id, product_id);

-- =====================================================================
-- order_detail_required_sections — per-order_detail snapshot of the route.
-- This is the authority read by mark_order_details_ready (NOT product_sections).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.order_detail_required_sections (
  order_detail_section_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id                  uuid    NOT NULL REFERENCES public.organizations(id),
  order_detail_id         integer NOT NULL REFERENCES public.order_details(order_detail_id) ON DELETE CASCADE,
  section_id              integer NOT NULL REFERENCES public.factory_sections(section_id),
  sequence_order          integer NOT NULL,
  source                  text    NOT NULL CHECK (source IN ('product_sections','bol_derived','default_route','fallback')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT odrs_detail_section_uq UNIQUE (order_detail_id, section_id),
  CONSTRAINT odrs_detail_seq_uq     UNIQUE (order_detail_id, sequence_order)
);
CREATE INDEX IF NOT EXISTS odrs_org_detail_idx
  ON public.order_detail_required_sections (org_id, order_detail_id);

-- =====================================================================
-- order_status_events — append-only log of order status changes (powers reopen + audit)
-- Single-writer: the BEFORE UPDATE OF status_id trigger on orders (Phase 2) is the only writer.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.order_status_events (
  order_status_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid    NOT NULL REFERENCES public.organizations(id),
  order_id        integer NOT NULL REFERENCES public.orders(order_id) ON DELETE CASCADE,
  from_status_id  integer REFERENCES public.order_statuses(status_id),
  to_status_id    integer NOT NULL REFERENCES public.order_statuses(status_id),
  changed_by      uuid    REFERENCES auth.users(id),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  reason          text,
  trigger_source  text    NOT NULL CHECK (trigger_source IN ('user','auto_ready','auto_completed','reopen','system'))
);
CREATE INDEX IF NOT EXISTS order_status_events_org_order_idx
  ON public.order_status_events (org_id, order_id, changed_at DESC);

-- =====================================================================
-- order_delivery_notes — customer-facing delivery notes (Unity-generated or Pastel-recorded)
-- Named order_delivery_notes to avoid collision with supplier-side DeliveryNote* types.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.order_delivery_notes (
  order_delivery_note_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id            uuid    NOT NULL REFERENCES public.organizations(id),
  order_id          integer NOT NULL REFERENCES public.orders(order_id),
  note_number       text,
  source            text    NOT NULL CHECK (source IN ('unity','pastel')),
  external_reference text,
  delivery_date     date    NOT NULL,
  status            text    NOT NULL CHECK (status IN ('draft','printed','signed','cancelled')),
  signed_by         text,
  signed_at         timestamptz,
  notes             text,
  created_by        uuid    NOT NULL REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_delivery_notes_source_fields_chk CHECK (
       (source = 'unity'  AND note_number IS NOT NULL AND external_reference IS NULL)
    OR (source = 'pastel' AND external_reference IS NOT NULL AND note_number IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS order_delivery_notes_org_number_uq
  ON public.order_delivery_notes (org_id, note_number) WHERE note_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_delivery_notes_org_order_idx
  ON public.order_delivery_notes (org_id, order_id);
CREATE INDEX IF NOT EXISTS order_delivery_notes_org_status_date_idx
  ON public.order_delivery_notes (org_id, status, delivery_date DESC);

-- =====================================================================
-- order_delivery_note_items
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.order_delivery_note_items (
  order_delivery_note_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id                 uuid    NOT NULL REFERENCES public.organizations(id),
  order_delivery_note_id bigint  NOT NULL REFERENCES public.order_delivery_notes(order_delivery_note_id) ON DELETE CASCADE,
  order_detail_id        integer NOT NULL REFERENCES public.order_details(order_detail_id),
  quantity               integer NOT NULL CHECK (quantity > 0),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS odni_org_note_idx   ON public.order_delivery_note_items (org_id, order_delivery_note_id);
CREATE INDEX IF NOT EXISTS odni_org_detail_idx ON public.order_delivery_note_items (org_id, order_detail_id);

-- =====================================================================
-- stock_receipts — internal-order finished-goods receipts (auto-draft + manual)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stock_receipts (
  stock_receipt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid    NOT NULL REFERENCES public.organizations(id),
  order_id        integer NOT NULL REFERENCES public.orders(order_id),
  receipt_number  text    NOT NULL,
  status          text    NOT NULL CHECK (status IN ('draft','confirmed','cancelled')),
  received_at     timestamptz,
  received_by     uuid    REFERENCES auth.users(id),
  notes           text,
  created_by      uuid    REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_receipts_org_number_uq UNIQUE (org_id, receipt_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_draft_stock_receipt_per_order
  ON public.stock_receipts (org_id, order_id) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS stock_receipts_org_order_idx
  ON public.stock_receipts (org_id, order_id);
CREATE INDEX IF NOT EXISTS stock_receipts_org_status_date_idx
  ON public.stock_receipts (org_id, status, received_at DESC);

-- =====================================================================
-- stock_receipt_items
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stock_receipt_items (
  stock_receipt_item_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid    NOT NULL REFERENCES public.organizations(id),
  stock_receipt_id bigint NOT NULL REFERENCES public.stock_receipts(stock_receipt_id) ON DELETE CASCADE,
  order_detail_id integer NOT NULL REFERENCES public.order_details(order_detail_id),
  product_id      integer NOT NULL REFERENCES public.products(product_id),
  quantity        integer NOT NULL CHECK (quantity > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_receipt_items_receipt_detail_uq UNIQUE (stock_receipt_id, order_detail_id)
);
CREATE INDEX IF NOT EXISTS sri_org_receipt_idx ON public.stock_receipt_items (org_id, stock_receipt_id);
CREATE INDEX IF NOT EXISTS sri_org_detail_idx  ON public.stock_receipt_items (org_id, order_detail_id);
CREATE INDEX IF NOT EXISTS sri_org_product_idx ON public.stock_receipt_items (org_id, product_id);

-- =====================================================================
-- stock_adjustments — raw QOH lever (not tied to an order)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  stock_adjustment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid    NOT NULL REFERENCES public.organizations(id),
  product_id      integer NOT NULL REFERENCES public.products(product_id),
  quantity_delta  numeric(12,3) NOT NULL CHECK (quantity_delta <> 0),
  reason          text    NOT NULL CHECK (length(trim(reason)) > 0),
  reverses_adjustment_id bigint REFERENCES public.stock_adjustments(stock_adjustment_id),
  adjusted_by     uuid    NOT NULL REFERENCES auth.users(id),
  adjusted_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_adjustments_org_product_idx ON public.stock_adjustments (org_id, product_id, adjusted_at DESC);
CREATE INDEX IF NOT EXISTS stock_adjustments_org_date_idx    ON public.stock_adjustments (org_id, adjusted_at DESC);

-- =====================================================================
-- RLS — standard org-scoped pattern (single FOR ALL policy per table)
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'product_sections','order_detail_required_sections','order_status_events',
    'order_delivery_notes','order_delivery_note_items','stock_receipts',
    'stock_receipt_items','stock_adjustments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_org_rls', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id))',
      t||'_org_rls', t);
  END LOOP;
END$$;

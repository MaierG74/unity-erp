ALTER TABLE billoflabour
  ADD COLUMN drawing_url TEXT,
  ADD COLUMN use_product_drawing BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE billoflabour
  ADD CONSTRAINT billoflabour_drawing_source_exclusive
  CHECK (NOT (drawing_url IS NOT NULL AND use_product_drawing = true));

ALTER TABLE products
  ADD COLUMN configurator_drawing_url TEXT;

CREATE TABLE order_detail_drawings (
  id BIGSERIAL PRIMARY KEY,
  order_detail_id BIGINT NOT NULL REFERENCES order_details(order_detail_id) ON DELETE CASCADE,
  bol_id INTEGER NOT NULL REFERENCES billoflabour(bol_id) ON DELETE CASCADE,
  drawing_url TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES organizations(id),
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_detail_id, bol_id)
);

CREATE INDEX idx_order_detail_drawings_lookup
  ON order_detail_drawings(order_detail_id, bol_id);

ALTER TABLE order_detail_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_detail_drawings_select
  ON order_detail_drawings
  FOR SELECT
  TO authenticated
  USING (is_org_member(org_id));

CREATE POLICY order_detail_drawings_insert
  ON order_detail_drawings
  FOR INSERT
  TO authenticated
  WITH CHECK (is_org_member(org_id));

CREATE POLICY order_detail_drawings_update
  ON order_detail_drawings
  FOR UPDATE
  TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY order_detail_drawings_delete
  ON order_detail_drawings
  FOR DELETE
  TO authenticated
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON order_detail_drawings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE order_detail_drawings_id_seq TO authenticated;

ALTER TABLE job_card_items
  ADD COLUMN drawing_url TEXT;

NOTIFY pgrst, 'reload schema';

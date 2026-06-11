-- Classification of products into sellable (customer-facing) vs
-- internal_subcomponent (manufacturing-only building block, e.g. drawer box).
-- Text + CHECK (house style — matches products.make_strategy), not an enum.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_kind text NOT NULL DEFAULT 'sellable';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_product_kind_chk'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_product_kind_chk
      CHECK (product_kind IN ('sellable', 'internal_subcomponent'));
  END IF;
END $$;

-- Picker queries filter org + kind together.
CREATE INDEX IF NOT EXISTS idx_products_org_kind
  ON public.products (org_id, product_kind);

COMMENT ON COLUMN public.products.product_kind IS
  'sellable = appears in quote/order pickers; internal_subcomponent = manufacturing building block, hidden from sales surfaces. Orthogonal to make_strategy (phantom/MTO/MTS, currently dormant).';

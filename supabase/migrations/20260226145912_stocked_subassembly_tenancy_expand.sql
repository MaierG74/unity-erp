-- Expand phase: org scoping for stocked sub-assembly tables
-- Scope: public.product_bom_links, public.billoflabour

BEGIN;

ALTER TABLE public.product_bom_links
  ADD COLUMN IF NOT EXISTS org_id uuid;

ALTER TABLE public.billoflabour
  ADD COLUMN IF NOT EXISTS org_id uuid;

-- Backfill from parent product org.
UPDATE public.product_bom_links l
SET org_id = p.org_id
FROM public.products p
WHERE p.product_id = l.product_id
  AND l.org_id IS NULL;

-- Backfill from labour product org.
UPDATE public.billoflabour b
SET org_id = p.org_id
FROM public.products p
WHERE p.product_id = b.product_id
  AND b.org_id IS NULL;

-- Guard against bad historical rows before continuing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_bom_links WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot continue: product_bom_links has NULL org_id rows after backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM public.billoflabour WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot continue: billoflabour has NULL org_id rows after backfill';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_product_bom_links_org_id ON public.product_bom_links(org_id);
CREATE INDEX IF NOT EXISTS idx_billoflabour_org_id ON public.billoflabour(org_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_bom_links_org_id_fkey'
      AND conrelid = 'public.product_bom_links'::regclass
  ) THEN
    ALTER TABLE public.product_bom_links
      ADD CONSTRAINT product_bom_links_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billoflabour_org_id_fkey'
      AND conrelid = 'public.billoflabour'::regclass
  ) THEN
    ALTER TABLE public.billoflabour
      ADD CONSTRAINT billoflabour_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) NOT VALID;
  END IF;
END
$$;

-- Keep product_bom_links org consistency anchored to products table.
CREATE OR REPLACE FUNCTION public.set_product_bom_links_org_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent_org uuid;
  v_sub_org uuid;
BEGIN
  SELECT p.org_id INTO v_parent_org
  FROM public.products p
  WHERE p.product_id = NEW.product_id;

  IF v_parent_org IS NULL THEN
    RAISE EXCEPTION 'product_bom_links: parent product % not found or missing org', NEW.product_id;
  END IF;

  SELECT p.org_id INTO v_sub_org
  FROM public.products p
  WHERE p.product_id = NEW.sub_product_id;

  IF v_sub_org IS NULL THEN
    RAISE EXCEPTION 'product_bom_links: sub product % not found or missing org', NEW.sub_product_id;
  END IF;

  IF v_parent_org IS DISTINCT FROM v_sub_org THEN
    RAISE EXCEPTION 'product_bom_links: parent and sub product belong to different organizations';
  END IF;

  NEW.org_id := v_parent_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_product_bom_links_org_id ON public.product_bom_links;

CREATE TRIGGER trg_set_product_bom_links_org_id
BEFORE INSERT OR UPDATE ON public.product_bom_links
FOR EACH ROW
EXECUTE FUNCTION public.set_product_bom_links_org_id();

-- Keep billoflabour org consistency anchored to products table.
CREATE OR REPLACE FUNCTION public.set_billoflabour_org_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_org uuid;
BEGIN
  SELECT p.org_id INTO v_product_org
  FROM public.products p
  WHERE p.product_id = NEW.product_id;

  IF v_product_org IS NULL THEN
    RAISE EXCEPTION 'billoflabour: product % not found or missing org', NEW.product_id;
  END IF;

  NEW.org_id := v_product_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_billoflabour_org_id ON public.billoflabour;

CREATE TRIGGER trg_set_billoflabour_org_id
BEFORE INSERT OR UPDATE ON public.billoflabour
FOR EACH ROW
EXECUTE FUNCTION public.set_billoflabour_org_id();

COMMIT;

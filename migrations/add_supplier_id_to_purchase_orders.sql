ALTER TABLE public.purchase_orders ADD COLUMN supplier_id integer REFERENCES public.suppliers(supplier_id);

-- Component reservations table: earmark on-hand components for specific orders
CREATE TABLE IF NOT EXISTS public.component_reservations (
  id            BIGSERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES public.orders(order_id) ON DELETE CASCADE,
  component_id  INTEGER NOT NULL REFERENCES public.components(component_id) ON DELETE CASCADE,
  qty_reserved  NUMERIC NOT NULL DEFAULT 0 CHECK (qty_reserved > 0),
  reserved_by   UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id),
  UNIQUE(order_id, component_id)
);

ALTER TABLE public.component_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view component reservations in their org"
  ON public.component_reservations FOR SELECT
  USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage component reservations in their org"
  ON public.component_reservations FOR ALL
  USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

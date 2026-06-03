-- Phase 1A (5/5): close the three pre-existing ERROR-level RLS gaps.
-- jobs is NOT read-only (labor module edits it directly) — explicit read+write policies
-- preserve today's effective access (TO authenticated). A future ticket can scope writes
-- to a labor_admin permission. manufacturing_sections / order_manufacturing_sections are the
-- dead/empty tables the spec was built on; RLS enabled here only to clear the advisor.

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jobs_select ON public.jobs;
CREATE POLICY jobs_select ON public.jobs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS jobs_insert ON public.jobs;
CREATE POLICY jobs_insert ON public.jobs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS jobs_update ON public.jobs;
CREATE POLICY jobs_update ON public.jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS jobs_delete ON public.jobs;
CREATE POLICY jobs_delete ON public.jobs FOR DELETE TO authenticated USING (true);

ALTER TABLE public.manufacturing_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manufacturing_sections_select ON public.manufacturing_sections;
CREATE POLICY manufacturing_sections_select ON public.manufacturing_sections
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.order_manufacturing_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oms_org_rls ON public.order_manufacturing_sections;
CREATE POLICY oms_org_rls ON public.order_manufacturing_sections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.order_id = order_manufacturing_sections.order_id AND public.is_org_member(o.org_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.order_id = order_manufacturing_sections.order_id AND public.is_org_member(o.org_id)));

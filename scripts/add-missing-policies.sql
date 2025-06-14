-- Enable RLS on tables if not already enabled
ALTER TABLE public.components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.component_categories ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users to have all access to components
CREATE POLICY "authenticated_users_all_access"
ON public.components
FOR ALL
TO authenticated
USING (auth.role() = 'authenticated'::text)
WITH CHECK (auth.role() = 'authenticated'::text);

-- Policy for authenticated users to have all access to component_categories
CREATE POLICY "authenticated_users_all_access"
ON public.component_categories
FOR ALL
TO authenticated
USING (auth.role() = 'authenticated'::text)
WITH CHECK (auth.role() = 'authenticated'::text);

-- Policy for authenticated users to have all access to unitsofmeasure
CREATE POLICY "authenticated_users_all_access"
ON public.unitsofmeasure
FOR ALL
TO authenticated
USING (auth.role() = 'authenticated'::text)
WITH CHECK (auth.role() = 'authenticated'::text); 
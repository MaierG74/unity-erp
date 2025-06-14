-- Add supplier_component_id column to billofmaterials table
ALTER TABLE public.billofmaterials 
ADD COLUMN IF NOT EXISTS supplier_component_id INTEGER REFERENCES public.suppliercomponents(supplier_component_id) NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.billofmaterials.supplier_component_id IS 'References the specific supplier component entry, including pricing information'; 
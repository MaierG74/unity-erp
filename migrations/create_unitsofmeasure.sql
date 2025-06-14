CREATE TABLE public.unitsofmeasure (
  unit_id serial NOT NULL,
  name text NOT NULL,
  symbol text NULL,
  CONSTRAINT unitsofmeasure_pkey PRIMARY KEY (unit_id),
  CONSTRAINT unitsofmeasure_name_key UNIQUE (name)
) TABLESPACE pg_default;

-- Insert some common units
INSERT INTO public.unitsofmeasure (name, symbol) VALUES
  ('Piece', 'pc'),
  ('Kilogram', 'kg'),
  ('Meter', 'm'),
  ('Liter', 'L'),
  ('Box', 'box'),
  ('Roll', 'roll'),
  ('Sheet', 'sht'),
  ('Pack', 'pk');

-- Add foreign key constraint to components table
ALTER TABLE public.components
  ADD CONSTRAINT components_unit_id_fkey 
  FOREIGN KEY (unit_id) 
  REFERENCES public.unitsofmeasure(unit_id); 
-- Add quote linkage to orders (safe, idempotent)
DO $$ BEGIN
  -- Ensure quotes table with UUID id exists before adding FK
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'quotes' AND column_name = 'id'
  ) THEN
    -- Add quote_id column if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'quote_id'
    ) THEN
      ALTER TABLE public.orders ADD COLUMN quote_id uuid NULL;
    END IF;

    -- Add FK constraint if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public' AND tc.table_name = 'orders' 
        AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'quote_id'
    ) THEN
      ALTER TABLE public.orders
        ADD CONSTRAINT orders_quote_id_fkey FOREIGN KEY (quote_id)
        REFERENCES public.quotes(id) ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
  END IF;
END $$;



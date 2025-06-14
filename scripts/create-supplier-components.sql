-- Create the supplier_components table if it doesn't exist
CREATE TABLE IF NOT EXISTS supplier_components (
  supplier_component_id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(supplier_id),
  component_id INTEGER NOT NULL REFERENCES components(component_id),
  cost DECIMAL(10,2),
  lead_time_days INTEGER,
  is_preferred BOOLEAN DEFAULT false,
  notes TEXT,
  UNIQUE(supplier_id, component_id)
);

-- Grant necessary permissions
GRANT ALL PRIVILEGES ON TABLE supplier_components TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE supplier_components_supplier_component_id_seq TO authenticated;

-- Create a function to add this table via RPC
CREATE OR REPLACE FUNCTION create_supplier_components_table()
RETURNS void AS $$
BEGIN
    -- Check if the table already exists
    IF NOT EXISTS (
        SELECT FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = 'supplier_components'
    ) THEN
        -- Create the table
        EXECUTE '
        CREATE TABLE supplier_components (
          supplier_component_id SERIAL PRIMARY KEY,
          supplier_id INTEGER NOT NULL REFERENCES suppliers(supplier_id),
          component_id INTEGER NOT NULL REFERENCES components(component_id),
          cost DECIMAL(10,2),
          lead_time_days INTEGER,
          is_preferred BOOLEAN DEFAULT false,
          notes TEXT,
          UNIQUE(supplier_id, component_id)
        );
        
        GRANT ALL PRIVILEGES ON TABLE supplier_components TO authenticated;
        GRANT USAGE, SELECT ON SEQUENCE supplier_components_supplier_component_id_seq TO authenticated;
        ';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to the authenticated user role
GRANT EXECUTE ON FUNCTION create_supplier_components_table() TO authenticated; 
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function checkSuppliers() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  
  console.log('Checking for suppliers for GTYPIST component...');
  
  // First get the component_id for GTYPIST
  const { data: components, error: compError } = await supabase
    .from('components')
    .select('component_id, internal_code, description')
    .eq('internal_code', 'GTYPIST');
    
  if (compError) {
    console.error('Error fetching component:', compError);
    return;
  }
  
  if (!components || components.length === 0) {
    console.log('GTYPIST component not found');
    return;
  }
  
  const componentId = components[0].component_id;
  console.log('Found GTYPIST with component_id:', componentId);
  
  // Now check for supplier components
  const { data: supplierComponents, error: scError } = await supabase
    .from('suppliercomponents')
    .select('*')
    .eq('component_id', componentId);
    
  if (scError) {
    console.error('Error fetching supplier components:', scError);
    return;
  }
  
  console.log(`Found ${supplierComponents?.length || 0} supplier components for GTYPIST:`, supplierComponents);
  
  // Check each supplier
  if (supplierComponents && supplierComponents.length > 0) {
    for (const sc of supplierComponents) {
      const { data: supplier, error: suppError } = await supabase
        .from('suppliers')
        .select('*')
        .eq('supplier_id', sc.supplier_id)
        .single();
        
      if (suppError) {
        console.error(`Error fetching supplier ${sc.supplier_id}:`, suppError);
      } else {
        console.log(`Supplier ${sc.supplier_id}:`, supplier);
      }
    }
  }
}

checkSuppliers().catch(console.error);

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function addSuppliers() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  
  console.log('Adding suppliers for GTYPIST component...');
  
  // Check if suppliers exist
  const { data: suppliersData, error: suppliersError } = await supabase
    .from('suppliers')
    .select('*');
    
  if (suppliersError) {
    console.error('Error fetching suppliers:', suppliersError);
    return;
  }
  
  // If no suppliers exist, create some
  if (!suppliersData || suppliersData.length === 0) {
    console.log('No suppliers found. Creating suppliers...');
    
    const suppliers = [
      { name: 'Acme Supplies', contact_info: 'contact@acmesupplies.com' },
      { name: 'Best Components', contact_info: 'sales@bestcomponents.com' },
      { name: 'Quality Parts Ltd', contact_info: 'info@qualityparts.com' }
    ];
    
    for (const supplier of suppliers) {
      const { data, error } = await supabase
        .from('suppliers')
        .insert(supplier)
        .select();
        
      if (error) {
        console.error(`Error creating supplier ${supplier.name}:`, error);
      } else {
        console.log(`Created supplier: ${supplier.name} with ID: ${data[0].supplier_id}`);
      }
    }
    
    // Refetch suppliers
    const { data: updatedSuppliers } = await supabase
      .from('suppliers')
      .select('*');
      
    if (updatedSuppliers) {
      suppliersData = updatedSuppliers;
    }
  }
  
  console.log(`Found ${suppliersData.length} suppliers`);
  
  // Get the GTYPIST component
  const { data: components, error: compError } = await supabase
    .from('components')
    .select('component_id, internal_code, description')
    .eq('internal_code', 'GTYPIST');
    
  if (compError) {
    console.error('Error fetching GTYPIST component:', compError);
    return;
  }
  
  if (!components || components.length === 0) {
    console.log('GTYPIST component not found');
    return;
  }
  
  const componentId = components[0].component_id;
  console.log(`Found GTYPIST with component_id: ${componentId}`);
  
  // Check if supplier components already exist
  const { data: existingSupplierComponents } = await supabase
    .from('suppliercomponents')
    .select('*')
    .eq('component_id', componentId);
    
  if (existingSupplierComponents && existingSupplierComponents.length > 0) {
    console.log(`${existingSupplierComponents.length} supplier components already exist for GTYPIST`);
    
    // List them for reference
    for (const sc of existingSupplierComponents) {
      const supplier = suppliersData.find(s => s.supplier_id === sc.supplier_id);
      console.log(`- ${supplier?.name || 'Unknown'}: $${sc.price}`);
    }
    
    return;
  }
  
  // Add supplier components for GTYPIST
  for (let i = 0; i < Math.min(suppliersData.length, 3); i++) {
    const supplier = suppliersData[i];
    
    // Create a supplier component with different prices
    const supplierComponent = {
      component_id: componentId,
      supplier_id: supplier.supplier_id,
      supplier_code: `SUP-GTYPIST-${i+1}`,
      price: 100.00 + (i * 10), // Different prices: 100, 110, 120
      lead_time: 5 + i, // Different lead times
      min_order_quantity: 1,
      description: `${supplier.name}'s version of GTYPIST`
    };
    
    const { data, error } = await supabase
      .from('suppliercomponents')
      .insert(supplierComponent)
      .select();
      
    if (error) {
      console.error(`Error creating supplier component for ${supplier.name}:`, error);
    } else {
      console.log(`Created supplier component for ${supplier.name} with ID: ${data[0].supplier_component_id}`);
    }
  }
  
  // Verify the supplier components were created
  const { data: finalCheck } = await supabase
    .from('suppliercomponents')
    .select(`
      supplier_component_id,
      component_id,
      supplier_id,
      price,
      supplier:suppliers(name)
    `)
    .eq('component_id', componentId);
    
  console.log(`Final check - ${finalCheck?.length || 0} supplier components for GTYPIST:`, finalCheck);
}

addSuppliers().catch(console.error); 
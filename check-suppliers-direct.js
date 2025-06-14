require('dotenv').config({path: '.env.local'});
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkSuppliers() {
  try {
    console.log('Checking for GTYPIST component...');
    const { data: component, error } = await supabase
      .from('components')
      .select('component_id, internal_code')
      .eq('internal_code', 'GTYPIST')
      .single();
      
    if (error) {
      console.error('Error fetching component:', error);
      return;
    }
    
    console.log('Found component:', component);
    
    console.log('Checking for supplier components with raw query...');
    const { data: supplierComponents, error: scError } = await supabase
      .from('suppliercomponents')
      .select(`
        supplier_component_id,
        component_id,
        supplier_id,
        price,
        supplier:suppliers(name)
      `)
      .eq('component_id', component.component_id);
      
    if (scError) {
      console.error('Error fetching supplier components:', scError);
      return;
    }
    
    console.log(`Found ${supplierComponents?.length || 0} supplier components:`, supplierComponents);

    // Try the alternative query format used in the form
    console.log('Trying alternative query format...');
    const { data: altData, error: altError } = await supabase
      .from('suppliercomponents')
      .select(`
        supplier_component_id,
        component_id,
        supplier_id,
        price,
        suppliers (name)
      `)
      .eq('component_id', component.component_id);
      
    if (altError) {
      console.error('Alternative query also failed:', altError);
    } else {
      console.log(`Found ${altData?.length || 0} supplier components with alternative query:`, altData);
    }

    // Try a simple query without joins
    console.log('Trying simple query without joins...');
    const { data: basicData, error: basicError } = await supabase
      .from('suppliercomponents')
      .select('*')
      .eq('component_id', component.component_id);
      
    if (basicError) {
      console.error('Basic query failed:', basicError);
    } else {
      console.log(`Found ${basicData?.length || 0} supplier components with basic query:`, basicData);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

checkSuppliers(); 
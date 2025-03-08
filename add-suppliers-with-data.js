require('dotenv').config({path: '.env.local'});
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function addSuppliersAndComponents() {
  try {
    // Find the GTYPIST component
    console.log('Finding GTYPIST component...');
    const { data: component, error: componentError } = await supabase
      .from('components')
      .select('component_id, internal_code')
      .eq('internal_code', 'GTYPIST')
      .single();
      
    if (componentError) {
      console.error('Error finding component:', componentError);
      return;
    }
    
    console.log('Found component:', component);
    
    // Check if suppliers exist
    console.log('Checking if suppliers exist...');
    const { data: existingSuppliers, error: suppliersError } = await supabase
      .from('suppliers')
      .select('supplier_id, name')
      .order('supplier_id');
      
    if (suppliersError) {
      console.error('Error checking suppliers:', suppliersError);
      return;
    }
    
    let suppliers = existingSuppliers || [];
    console.log('Found existing suppliers:', suppliers);
    
    // If no suppliers exist, create some
    if (suppliers.length === 0) {
      console.log('No suppliers found. Creating suppliers...');
      
      const suppliersToAdd = [
        { name: 'Acme Supplies', contact_info: 'contact@acme-supplies.com' },
        { name: 'TechParts Inc', contact_info: 'sales@techparts.com' },
        { name: 'Global Components', contact_info: 'info@globalcomponents.com' }
      ];
      
      const { data: addedSuppliers, error: addSuppliersError } = await supabase
        .from('suppliers')
        .insert(suppliersToAdd)
        .select();
        
      if (addSuppliersError) {
        console.error('Error adding suppliers:', addSuppliersError);
        return;
      }
      
      console.log('Successfully added suppliers:', addedSuppliers);
      suppliers = addedSuppliers;
    }
    
    // Check for existing supplier components to avoid duplicates
    console.log('Checking for existing supplier components...');
    const { data: existingComponents, error: existingError } = await supabase
      .from('suppliercomponents')
      .select('*')
      .eq('component_id', component.component_id);
      
    if (existingError) {
      console.error('Error checking existing components:', existingError);
      return;
    }
    
    if (existingComponents && existingComponents.length > 0) {
      console.log('Supplier components already exist:', existingComponents);
      return;
    }
    
    // Add supplier components for GTYPIST
    console.log('Adding supplier components for GTYPIST...');
    const supplierComponentsToAdd = suppliers.map((supplier, index) => ({
      component_id: component.component_id,
      supplier_id: supplier.supplier_id,
      supplier_code: `SUP-${supplier.supplier_id}-${component.internal_code}`,
      price: 100 + (index * 10), // Different prices for each supplier
      lead_time: 7 + (index * 2), // Different lead times
      min_order_quantity: 5,
      description: `${component.internal_code} from ${supplier.name}`
    }));
    
    console.log('Supplier components to add:', supplierComponentsToAdd);
    
    const { data: addedComponents, error: addError } = await supabase
      .from('suppliercomponents')
      .insert(supplierComponentsToAdd)
      .select();
      
    if (addError) {
      console.error('Error adding supplier components:', addError);
      return;
    }
    
    console.log('Successfully added supplier components:', addedComponents);
    
    // Verify the components were added
    console.log('Verifying added components...');
    const { data: verification, error: verificationError } = await supabase
      .from('suppliercomponents')
      .select(`
        supplier_component_id,
        component_id,
        supplier_id,
        price,
        supplier:suppliers(name)
      `)
      .eq('component_id', component.component_id);
      
    if (verificationError) {
      console.error('Error verifying components:', verificationError);
      return;
    }
    
    console.log(`Verification found ${verification?.length || 0} supplier components:`, verification);
    
  } catch (err) {
    console.error('Error:', err);
  }
}

addSuppliersAndComponents(); 
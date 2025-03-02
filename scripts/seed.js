// Seed script to populate the database with sample data
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

// Create a Supabase client with the service role key for admin access
// This bypasses RLS policies
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function seedDatabase() {
  console.log('Starting database seeding...');

  try {
    // 1. Add component categories
    console.log('Adding component categories...');
    const categories = [
      { categoryname: 'Electronics' },
      { categoryname: 'Mechanical' },
      { categoryname: 'Fasteners' },
      { categoryname: 'Raw Materials' },
      { categoryname: 'Packaging' }
    ];

    const { data: categoriesData, error: categoriesError } = await supabase
      .from('component_categories')
      .upsert(categories, { onConflict: 'categoryname' })
      .select();

    if (categoriesError) {
      throw new Error(`Error adding categories: ${categoriesError.message}`);
    }
    console.log(`Added ${categoriesData.length} categories`);

    // 2. Add units of measure
    console.log('Adding units of measure...');
    const units = [
      { unit_code: 'EA', unit_name: 'Each' },
      { unit_code: 'KG', unit_name: 'Kilogram' },
      { unit_code: 'M', unit_name: 'Meter' },
      { unit_code: 'L', unit_name: 'Liter' },
      { unit_code: 'PK', unit_name: 'Pack' }
    ];

    const { data: unitsData, error: unitsError } = await supabase
      .from('unitsofmeasure')
      .upsert(units, { onConflict: 'unit_code' })
      .select();

    if (unitsError) {
      throw new Error(`Error adding units: ${unitsError.message}`);
    }
    console.log(`Added ${unitsData.length} units`);

    // 3. Add suppliers
    console.log('Adding suppliers...');
    const suppliers = [
      { name: 'Acme Electronics', contact_info: 'contact@acme.com' },
      { name: 'Global Parts Inc.', contact_info: 'sales@globalparts.com' },
      { name: 'FastFix Supplies', contact_info: 'info@fastfix.com' },
      { name: 'Raw Materials Co.', contact_info: 'orders@rawmaterials.com' },
      { name: 'PackRight Solutions', contact_info: 'service@packright.com' }
    ];

    const { data: suppliersData, error: suppliersError } = await supabase
      .from('suppliers')
      .upsert(suppliers, { onConflict: 'name' })
      .select();

    if (suppliersError) {
      throw new Error(`Error adding suppliers: ${suppliersError.message}`);
    }
    console.log(`Added ${suppliersData.length} suppliers`);

    // 4. Add components
    console.log('Adding components...');
    const components = [
      {
        internal_code: 'E001',
        description: 'Microcontroller Board',
        unit_id: unitsData.find(u => u.unit_code === 'EA').unit_id,
        category_id: categoriesData.find(c => c.categoryname === 'Electronics').cat_id,
        image_url: null
      },
      {
        internal_code: 'E002',
        description: 'LED Display Module',
        unit_id: unitsData.find(u => u.unit_code === 'EA').unit_id,
        category_id: categoriesData.find(c => c.categoryname === 'Electronics').cat_id,
        image_url: null
      },
      {
        internal_code: 'M001',
        description: 'Aluminum Enclosure',
        unit_id: unitsData.find(u => u.unit_code === 'EA').unit_id,
        category_id: categoriesData.find(c => c.categoryname === 'Mechanical').cat_id,
        image_url: null
      },
      {
        internal_code: 'F001',
        description: 'M3 Screws',
        unit_id: unitsData.find(u => u.unit_code === 'PK').unit_id,
        category_id: categoriesData.find(c => c.categoryname === 'Fasteners').cat_id,
        image_url: null
      },
      {
        internal_code: 'R001',
        description: 'Copper Wire',
        unit_id: unitsData.find(u => u.unit_code === 'M').unit_id,
        category_id: categoriesData.find(c => c.categoryname === 'Raw Materials').cat_id,
        image_url: null
      },
      {
        internal_code: 'P001',
        description: 'Cardboard Box',
        unit_id: unitsData.find(u => u.unit_code === 'EA').unit_id,
        category_id: categoriesData.find(c => c.categoryname === 'Packaging').cat_id,
        image_url: null
      }
    ];

    const { data: componentsData, error: componentsError } = await supabase
      .from('components')
      .upsert(components, { onConflict: 'internal_code' })
      .select();

    if (componentsError) {
      throw new Error(`Error adding components: ${componentsError.message}`);
    }
    console.log(`Added ${componentsData.length} components`);

    // 5. Add inventory items
    console.log('Adding inventory items...');
    const inventory = componentsData.map(component => ({
      component_id: component.component_id,
      quantity_on_hand: Math.floor(Math.random() * 100),
      location: `Shelf ${String.fromCharCode(65 + Math.floor(Math.random() * 6))}-${Math.floor(Math.random() * 10) + 1}`,
      reorder_level: Math.floor(Math.random() * 20) + 5
    }));

    const { data: inventoryData, error: inventoryError } = await supabase
      .from('inventory')
      .upsert(inventory, { onConflict: 'component_id' })
      .select();

    if (inventoryError) {
      throw new Error(`Error adding inventory: ${inventoryError.message}`);
    }
    console.log(`Added ${inventoryData.length} inventory items`);

    // 6. Add supplier components
    console.log('Adding supplier components...');
    const supplierComponents = [];

    // For each component, add 1-3 supplier options
    componentsData.forEach(component => {
      const numSuppliers = Math.floor(Math.random() * 3) + 1;
      const shuffledSuppliers = [...suppliersData].sort(() => 0.5 - Math.random());
      
      for (let i = 0; i < numSuppliers && i < shuffledSuppliers.length; i++) {
        supplierComponents.push({
          component_id: component.component_id,
          supplier_id: shuffledSuppliers[i].supplier_id,
          supplier_code: `SUP-${shuffledSuppliers[i].name.substring(0, 3).toUpperCase()}-${component.internal_code}`,
          price: parseFloat((Math.random() * 100 + 10).toFixed(2)),
          lead_time: Math.floor(Math.random() * 14) + 1,
          min_order_quantity: Math.floor(Math.random() * 10) + 1
        });
      }
    });

    const { data: supplierComponentsData, error: supplierComponentsError } = await supabase
      .from('suppliercomponents')
      .upsert(supplierComponents)
      .select();

    if (supplierComponentsError) {
      throw new Error(`Error adding supplier components: ${supplierComponentsError.message}`);
    }
    console.log(`Added ${supplierComponentsData.length} supplier components`);

    // 7. Add inventory transactions
    console.log('Adding inventory transactions...');
    const transactions = [];

    // For each inventory item, add 0-5 transactions
    inventoryData.forEach(item => {
      const numTransactions = Math.floor(Math.random() * 6);
      
      for (let i = 0; i < numTransactions; i++) {
        const isIncoming = Math.random() > 0.5;
        const quantity = Math.floor(Math.random() * 20) + 1;
        
        // Create transaction date within the last 30 days
        const date = new Date();
        date.setDate(date.getDate() - Math.floor(Math.random() * 30));
        
        transactions.push({
          component_id: item.component_id,
          quantity: isIncoming ? quantity : -quantity,
          transaction_type: isIncoming ? 'IN' : 'OUT',
          transaction_date: date.toISOString(),
          order_id: null
        });
      }
    });

    const { data: transactionsData, error: transactionsError } = await supabase
      .from('inventory_transactions')
      .upsert(transactions)
      .select();

    if (transactionsError) {
      throw new Error(`Error adding transactions: ${transactionsError.message}`);
    }
    console.log(`Added ${transactionsData.length} inventory transactions`);

    console.log('Database seeding completed successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase(); 
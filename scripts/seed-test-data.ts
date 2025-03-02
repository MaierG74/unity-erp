import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join } from 'path';

// Load environment variables from .env.local
dotenv.config({ path: join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  console.error('Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

// Create a Supabase client with the service role key for admin access
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seedDatabase() {
  console.log('Starting database seeding...');
  console.log('Using service role key:', supabaseServiceKey!.slice(0, 10) + '...');

  try {
    // 1. Add component categories
    console.log('Adding component categories...');
    const categories = [
      { categoryname: 'Electronics' },
      { categoryname: 'Mechanical' },
      { categoryname: 'Fasteners' },
      { categoryname: 'Raw Materials' }
    ];

    const { data: categoriesData, error: categoriesError } = await supabase
      .from('component_categories')
      .upsert(categories, { onConflict: 'categoryname' })
      .select();

    if (categoriesError) throw new Error(`Error adding categories: ${categoriesError.message}`);
    console.log(`Added ${categoriesData.length} categories`);

    // 2. Add units of measure
    console.log('Adding units of measure...');
    const units = [
      { unit_code: 'EA', unit_name: 'Each' },
      { unit_code: 'KG', unit_name: 'Kilogram' },
      { unit_code: 'M', unit_name: 'Meter' },
      { unit_code: 'L', unit_name: 'Liter' }
    ];

    const { data: unitsData, error: unitsError } = await supabase
      .from('unitsofmeasure')
      .upsert(units, { onConflict: 'unit_code' })
      .select();

    if (unitsError) throw new Error(`Error adding units: ${unitsError.message}`);
    console.log(`Added ${unitsData.length} units`);

    // 3. Add components
    console.log('Adding components...');
    const components = [
      {
        internal_code: 'RES-100',
        description: '100Ω Resistor',
        unit_id: unitsData[0].unit_id, // EA
        category_id: categoriesData[0].cat_id // Electronics
      },
      {
        internal_code: 'CAP-10UF',
        description: '10µF Capacitor',
        unit_id: unitsData[0].unit_id,
        category_id: categoriesData[0].cat_id
      },
      {
        internal_code: 'SCREW-M3',
        description: 'M3x10mm Screw',
        unit_id: unitsData[0].unit_id,
        category_id: categoriesData[2].cat_id // Fasteners
      }
    ];

    const { data: componentsData, error: componentsError } = await supabase
      .from('components')
      .upsert(components, { onConflict: 'internal_code' })
      .select();

    if (componentsError) throw new Error(`Error adding components: ${componentsError.message}`);
    console.log(`Added ${componentsData.length} components`);

    // 4. Add inventory
    console.log('Adding inventory...');
    const inventory = componentsData.map(component => ({
      component_id: component.component_id,
      quantity_on_hand: Math.floor(Math.random() * 100),
      location: `BIN-${Math.floor(Math.random() * 100)}`,
      reorder_level: 10
    }));

    const { data: inventoryData, error: inventoryError } = await supabase
      .from('inventory')
      .upsert(inventory)
      .select();

    if (inventoryError) throw new Error(`Error adding inventory: ${inventoryError.message}`);
    console.log(`Added ${inventoryData.length} inventory records`);

    console.log('Database seeding completed successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase(); 
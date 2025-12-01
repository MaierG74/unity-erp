import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { supabase as publicSupabase } from '@/lib/supabase';

// POST - Import a single component from Airtable-style data
export async function POST(request: NextRequest) {
  try {
    const clientResult = await getRouteClient(request);
    if ('error' in clientResult) {
      return NextResponse.json({ error: clientResult.error }, { status: clientResult.status || 401 });
    }
    const { supabase } = clientResult;
    const body = await request.json();
    
    const {
      description,
      internal_code,
      supplier_id,
      supplier_code,
      price,
      category_id,
      unit_id,
      image_url,
      lead_time,
      min_order_quantity,
    } = body;

    // Validate required fields
    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }
    if (!supplier_id || !supplier_code) {
      return NextResponse.json({ error: 'Supplier and supplier code are required' }, { status: 400 });
    }

    // Check if supplier component already exists with this supplier_code for this supplier
    const { data: existingSupplierComponent } = await supabase
      .from('suppliercomponents')
      .select('supplier_component_id, component_id, components(internal_code, description)')
      .eq('supplier_id', supplier_id)
      .eq('supplier_code', supplier_code)
      .single();

    if (existingSupplierComponent) {
      return NextResponse.json({
        error: 'Duplicate',
        message: `Supplier code "${supplier_code}" already exists for this supplier`,
        existing: existingSupplierComponent
      }, { status: 409 });
    }

    // Generate internal code if not provided
    let finalInternalCode = internal_code;
    if (!finalInternalCode) {
      // Get the highest COMP-######## number
      const { data: lastComponent } = await supabase
        .from('components')
        .select('internal_code')
        .like('internal_code', 'COMP-%')
        .order('internal_code', { ascending: false })
        .limit(1)
        .single();

      let nextNum = 1;
      if (lastComponent?.internal_code) {
        const match = lastComponent.internal_code.match(/COMP-(\d+)/);
        if (match) {
          nextNum = parseInt(match[1], 10) + 1;
        }
      }
      finalInternalCode = `COMP-${String(nextNum).padStart(8, '0')}`;
    }

    // Check if internal code already exists
    const { data: existingComponent } = await supabase
      .from('components')
      .select('component_id, internal_code, description')
      .eq('internal_code', finalInternalCode)
      .single();

    let componentId: number;
    let isNewComponent = false;

    if (existingComponent) {
      // Use existing component - just add supplier link
      componentId = existingComponent.component_id;
    } else {
      // Create new component
      const { data: newComponent, error: componentError } = await supabase
        .from('components')
        .insert({
          internal_code: finalInternalCode,
          description,
          category_id: category_id || null,
          unit_id: unit_id || null,
          image_url: image_url || null,
        })
        .select('component_id')
        .single();

      if (componentError) {
        return NextResponse.json({ error: 'Failed to create component', details: componentError }, { status: 500 });
      }
      componentId = newComponent.component_id;
      isNewComponent = true;
    }

    // Create supplier component
    const { data: supplierComponent, error: scError } = await supabase
      .from('suppliercomponents')
      .insert({
        component_id: componentId,
        supplier_id,
        supplier_code,
        price: price || 0,
        lead_time: lead_time || null,
        min_order_quantity: min_order_quantity || null,
        description: description, // Supplier-specific description
      })
      .select('supplier_component_id')
      .single();

    if (scError) {
      // If we just created a component and supplier component fails, we should ideally rollback
      // For simplicity in this temp import, we'll just report the error
      return NextResponse.json({ error: 'Failed to create supplier component', details: scError }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      component_id: componentId,
      internal_code: finalInternalCode,
      supplier_component_id: supplierComponent.supplier_component_id,
      is_new_component: isNewComponent,
      message: isNewComponent 
        ? `Created new component ${finalInternalCode} with supplier link`
        : `Added supplier link to existing component ${finalInternalCode}`
    });

  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: 'Import failed', details: String(error) }, { status: 500 });
  }
}

// GET - Fetch lookup data for the import form
export async function GET(request: NextRequest) {
  try {
    // Use authenticated client if available
    const clientResult = await getRouteClient(request);
    const supabaseClient = 'error' in clientResult ? publicSupabase : clientResult.supabase;

    const [suppliersRes, categoriesRes, unitsRes] = await Promise.all([
      supabaseClient.from('suppliers').select('supplier_id, name').order('name'),
      supabaseClient.from('component_categories').select('cat_id, categoryname').order('categoryname'),
      supabaseClient.from('unitsofmeasure').select('unit_id, unit_name, unit_code').order('unit_name'),
    ]);

    // Log any errors
    if (suppliersRes.error) console.error('Suppliers error:', suppliersRes.error);
    if (categoriesRes.error) console.error('Categories error:', categoriesRes.error);
    if (unitsRes.error) console.error('Units error:', unitsRes.error);

    return NextResponse.json({
      suppliers: suppliersRes.data || [],
      categories: categoriesRes.data || [],
      units: unitsRes.data || [],
    });

  } catch (error) {
    console.error('Fetch lookup data error:', error);
    return NextResponse.json({ error: 'Failed to fetch lookup data' }, { status: 500 });
  }
}

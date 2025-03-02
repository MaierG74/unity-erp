import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Test inventory data
    const { data: inventoryData, error: inventoryError } = await supabase
      .from('inventory')
      .select('*')
      .limit(10);
    
    if (inventoryError) {
      console.error('Inventory query failed:', inventoryError);
      return NextResponse.json(
        { 
          status: 'error', 
          message: 'Inventory query failed', 
          error: inventoryError.message,
          details: inventoryError
        }, 
        { status: 500 }
      );
    }
    
    // Test components data
    const { data: componentsData, error: componentsError } = await supabase
      .from('components')
      .select('*')
      .limit(10);
    
    if (componentsError) {
      console.error('Components query failed:', componentsError);
      return NextResponse.json(
        { 
          status: 'error', 
          message: 'Components query failed', 
          error: componentsError.message,
          details: componentsError
        }, 
        { status: 500 }
      );
    }
    
    // Test categories data
    const { data: categoriesData, error: categoriesError } = await supabase
      .from('component_categories')
      .select('*')
      .limit(10);
    
    if (categoriesError) {
      console.error('Categories query failed:', categoriesError);
      return NextResponse.json(
        { 
          status: 'error', 
          message: 'Categories query failed', 
          error: categoriesError.message,
          details: categoriesError
        }, 
        { status: 500 }
      );
    }
    
    // Test adding a category
    const testCategory = { categoryname: 'Test Category ' + new Date().toISOString() };
    const { data: addedCategory, error: addCategoryError } = await supabase
      .from('component_categories')
      .upsert(testCategory)
      .select();
    
    let addCategoryResult = 'Not attempted';
    if (addCategoryError) {
      addCategoryResult = `Error: ${addCategoryError.message}`;
      console.error('Add category failed:', addCategoryError);
    } else if (addedCategory) {
      addCategoryResult = `Success: Added category with ID ${addedCategory[0]?.cat_id || 'unknown'}`;
    }
    
    // Get Supabase connection info
    let connectionInfo = 'Not available';
    try {
      const { data: connectionData, error: connectionError } = await supabase
        .from('_supabase_connection_info')
        .select('*')
        .limit(1);
      
      if (connectionError) {
        connectionInfo = `Error: ${connectionError.message}`;
      } else if (connectionData) {
        connectionInfo = 'Connected';
      }
    } catch (e) {
      connectionInfo = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
    }
    
    return NextResponse.json({ 
      status: 'ok', 
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      connectionInfo,
      addCategoryResult,
      inventory: {
        count: inventoryData.length,
        data: inventoryData
      },
      components: {
        count: componentsData.length,
        data: componentsData
      },
      categories: {
        count: categoriesData.length,
        data: categoriesData
      }
    });
  } catch (error) {
    console.error('Debug check failed:', error);
    return NextResponse.json(
      { 
        status: 'error', 
        message: 'Server error', 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }, 
      { status: 500 }
    );
  }
} 
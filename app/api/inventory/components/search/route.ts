import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Search Unity components by code or description
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }

    const searchTerm = `%${query.trim()}%`;

    // Search by internal_code or description
    const { data, error } = await supabase
      .from('components')
      .select(`
        component_id,
        internal_code,
        description,
        category:component_categories(categoryname)
      `)
      .or(`internal_code.ilike.${searchTerm},description.ilike.${searchTerm}`)
      .order('internal_code')
      .limit(20);

    if (error) {
      console.error('Component search error:', error);
      return NextResponse.json({ error: 'Search failed', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ results: data || [] });

  } catch (error) {
    console.error('Component search error:', error);
    return NextResponse.json({ error: 'Search failed', details: String(error) }, { status: 500 });
  }
}

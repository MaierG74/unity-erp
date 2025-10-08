import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;



export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchParam = url.searchParams.get('search')?.trim() ?? '';
  const idsParam = url.searchParams.get('ids');
  const limitParam = url.searchParams.get('limit');

  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = Number(limitParam);
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  const supabase = supabaseAdmin;
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase admin client is not available' }, { status: 503 });
  }
  let query = supabase
    .from('components')
    .select('component_id, internal_code, description')
    .order('description', { ascending: true });

  if (idsParam) {
    const ids = idsParam
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (ids.length === 0) {
      return NextResponse.json({ components: [] });
    }

    query = query.in('component_id', ids);
  } else {
    const sanitizedSearch = searchParam.replace(/[\%_]/g, '').trim();
    if (sanitizedSearch.length > 0) {
      query = query.or(
        `internal_code.ilike.%${sanitizedSearch}%,description.ilike.%${sanitizedSearch}%`
      );
    }
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[components] fetch error', error);
    return NextResponse.json({ error: 'Failed to load components' }, { status: 500 });
  }

  return NextResponse.json({ components: data ?? [] });
}

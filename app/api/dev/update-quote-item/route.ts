import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id, updates } = await req.json();
    if (!id || typeof updates !== 'object') {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('quote_items')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json(data, { status: 200 });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}

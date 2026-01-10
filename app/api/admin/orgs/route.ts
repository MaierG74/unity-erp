import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ organizations: data ?? [] });
}


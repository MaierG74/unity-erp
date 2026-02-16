import { NextRequest, NextResponse } from 'next/server';

import { requirePlatformAdmin } from '@/lib/api/platform';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const admin = await requirePlatformAdmin(req);
  if ('error' in admin) return admin.error;

  const { data, error } = await supabaseAdmin
    .from('module_catalog')
    .select('module_key, module_name, description, dependency_keys, is_core, updated_at')
    .order('module_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ modules: data ?? [] });
}


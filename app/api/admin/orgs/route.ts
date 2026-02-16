import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api/admin';
import { isUserPlatformAdmin } from '@/lib/api/platform';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  let actorUserId = ctx.user.id;

  let platformAdmin = false;
  try {
    platformAdmin = await isUserPlatformAdmin(ctx.user.id);
  } catch (_err) {
    platformAdmin = false;
  }

  if (!platformAdmin) {
    const admin = await requireAdmin(req);
    if ('error' in admin) return admin.error;
    actorUserId = admin.user.id;
  }

  if (platformAdmin) {
    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select('id, name, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ organizations: data ?? [] });
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from('organization_members')
    .select('org_id, is_active, banned_until')
    .eq('user_id', actorUserId)
    .eq('is_active', true);

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  const nowMs = Date.now();
  const orgIds = (memberships ?? [])
    .filter((row) => !row.banned_until || new Date(row.banned_until).getTime() > nowMs)
    .map((row) => row.org_id);

  if (orgIds.length === 0) {
    return NextResponse.json({ organizations: [] });
  }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, created_at')
    .in('id', orgIds)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ organizations: data ?? [] });
}

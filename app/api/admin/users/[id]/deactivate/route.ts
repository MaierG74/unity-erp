import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, recordAdminAudit } from '@/lib/api/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

type DeactivatePayload = {
  is_active?: boolean;
  org_id?: string;
  banned_until?: string | null;
};

function parseBannedUntil(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  const { id: userId } = await params;
  if (!userId) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  let body: DeactivatePayload;
  try {
    body = (await req.json()) as DeactivatePayload;
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body?.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active is required and must be a boolean' }, { status: 400 });
  }

  const orgId = (body?.org_id ?? '').trim();
  if (!orgId) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 });
  }

  const bannedUntil = parseBannedUntil(body?.banned_until);

  const authUpdate: Record<string, any> = {};
  if (!body.is_active && bannedUntil) {
    authUpdate.banned_until = bannedUntil;
  }
  if (body.is_active) {
    authUpdate.banned_until = null;
  }

  if (Object.keys(authUpdate).length > 0) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, authUpdate);
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }
  }

  const { error: memberError } = await supabaseAdmin
    .from('organization_members')
    .upsert(
      { user_id: userId, org_id: orgId, is_active: body.is_active, banned_until: bannedUntil },
      { onConflict: 'user_id,org_id' }
    );

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  await recordAdminAudit({
    actorUserId: admin.user.id,
    action: 'admin_user_active_toggle',
    targetUserId: userId,
    metadata: { is_active: body.is_active, org_id: orgId, banned_until: bannedUntil },
  });

  return NextResponse.json(
    { user_id: userId, org_id: orgId, is_active: body.is_active, banned_until: bannedUntil },
    { status: 200 }
  );
}

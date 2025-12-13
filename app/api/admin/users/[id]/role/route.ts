import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, recordAdminAudit } from '@/lib/api/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

const ALLOWED_ROLES = new Set(['owner', 'admin', 'manager', 'staff']);

type RolePayload = {
  role?: string;
  org_id?: string;
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  const userId = params?.id;
  if (!userId) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  let body: RolePayload;
  try {
    body = (await req.json()) as RolePayload;
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const role = (body?.role ?? '').trim();
  const orgId = (body?.org_id ?? '').trim();

  if (!role || !orgId) {
    return NextResponse.json({ error: 'role and org_id are required' }, { status: 400 });
  }

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    app_metadata: { role, org_id: orgId },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: memberError } = await supabaseAdmin
    .from('organization_members')
    .upsert({ user_id: userId, org_id: orgId, role, is_active: true }, { onConflict: 'user_id,org_id' });

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  await recordAdminAudit({
    actorUserId: admin.user.id,
    action: 'admin_user_role_update',
    targetUserId: userId,
    metadata: { role, org_id: orgId },
  });

  return NextResponse.json({ user_id: userId, role, org_id: orgId }, { status: 200 });
}

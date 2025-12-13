import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, recordAdminAudit } from '@/lib/api/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

type PasswordPayload = {
  new_password?: string;
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  const userId = params?.id;
  if (!userId) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  let body: PasswordPayload;
  try {
    body = (await req.json()) as PasswordPayload;
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const newPassword = (body?.new_password ?? '').trim();
  if (!newPassword) {
    return NextResponse.json({ error: 'new_password is required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordAdminAudit({
    actorUserId: admin.user.id,
    action: 'admin_user_password_reset',
    targetUserId: userId,
  });

  return NextResponse.json({ user_id: userId, new_password: newPassword }, { status: 200 });
}

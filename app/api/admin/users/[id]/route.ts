import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, recordAdminAudit } from '@/lib/api/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  const userId = params?.id;
  if (!userId) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  // Prevent self-deletion
  if (userId === admin.user.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  try {
    // Delete from organization_members first (foreign key constraint)
    const { error: memberError } = await supabaseAdmin
      .from('organization_members')
      .delete()
      .eq('user_id', userId);

    if (memberError) {
      console.error('[admin/users/delete] Failed to delete organization_members:', memberError);
      // Continue anyway - the auth user delete is the main goal
    }

    // Delete the user from Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }

    await recordAdminAudit({
      actorUserId: admin.user.id,
      action: 'admin_user_delete',
      targetUserId: userId,
      metadata: { deleted_at: new Date().toISOString() },
    });

    return NextResponse.json({ success: true, user_id: userId }, { status: 200 });
  } catch (err: any) {
    console.error('[admin/users/delete] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to delete user' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, recordAdminAudit } from '@/lib/api/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  const { id: userId } = await params;
  if (!userId) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  // Prevent self-deletion
  if (userId === admin.user.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  try {
    // Clean up public schema rows that reference auth.users (foreign key constraints)
    // These must be deleted before deleting the auth user.
    const cleanupTables = [
      { table: 'organization_members', column: 'user_id' },
      { table: 'profiles', column: 'id' },
      { table: 'cutlist_material_defaults', column: 'user_id' },
    ];

    for (const { table, column } of cleanupTables) {
      const { error } = await supabaseAdmin
        .from(table)
        .delete()
        .eq(column, userId);

      if (error) {
        console.error(`[admin/users/delete] Failed to delete from ${table}:`, error);
      }
    }

    // Nullify user references in audit log and other tables (rather than deleting rows)
    const nullifyTables = [
      { table: 'admin_audit_log', column: 'actor_user_id' },
      { table: 'admin_audit_log', column: 'target_user_id' },
      { table: 'inventory_transactions', column: 'user_id' },
      { table: 'purchase_orders', column: 'created_by' },
      { table: 'purchase_orders', column: 'approved_by' },
      { table: 'purchase_order_emails', column: 'sent_by' },
      { table: 'quote_email_log', column: 'sent_by' },
      { table: 'stock_issuances', column: 'created_by' },
      { table: 'job_time_history', column: 'created_by' },
      { table: 'supplier_order_returns', column: 'user_id' },
    ];

    for (const { table, column } of nullifyTables) {
      const { error } = await supabaseAdmin
        .from(table)
        .update({ [column]: null })
        .eq(column, userId);

      if (error) {
        console.error(`[admin/users/delete] Failed to nullify ${table}.${column}:`, error);
      }
    }

    // Also unlink staff record if any
    const { error: staffError } = await supabaseAdmin
      .from('staff')
      .update({ user_id: null })
      .eq('user_id', userId);

    if (staffError) {
      console.error('[admin/users/delete] Failed to unlink staff:', staffError);
    }

    // Delete the user from Supabase Auth (handles auth schema tables internally)
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      console.error('[admin/users/delete] Auth deleteUser error:', authError);
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }

    await recordAdminAudit({
      actorUserId: admin.user.id,
      action: 'admin_user_delete',
      metadata: { deleted_user_id: userId, deleted_at: new Date().toISOString() },
    });

    return NextResponse.json({ success: true, user_id: userId }, { status: 200 });
  } catch (err: any) {
    console.error('[admin/users/delete] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to delete user' }, { status: 500 });
  }
}

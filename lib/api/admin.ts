import { NextRequest, NextResponse } from 'next/server';

import { getRouteClient } from '@/lib/supabase-route';
import { supabaseAdmin } from '@/lib/supabase-admin';

type AdminCheck =
  | { error: NextResponse }
  | {
      user: any;
      accessToken: string;
    };

function isAdminRole(role: unknown): boolean {
  if (typeof role !== 'string') return false;
  return role === 'owner' || role === 'admin';
}

function isAdminUser(user: any): boolean {
  const role = user?.app_metadata?.role ?? user?.user_metadata?.role ?? (user?.role as unknown);
  return isAdminRole(role);
}

export async function requireAdmin(req: NextRequest): Promise<AdminCheck> {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return {
      error: NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 }),
    };
  }

  if (!isAdminUser(ctx.user)) {
    // Fallback: check org membership role (works even if JWT claims are stale).
    try {
      const { data, error } = await ctx.supabase
        .from('organization_members')
        .select('role')
        .eq('user_id', ctx.user.id)
        .limit(1)
        .maybeSingle();

      if (!error && isAdminRole(data?.role)) {
        return { user: ctx.user, accessToken: ctx.accessToken };
      }
    } catch (_err) {
      // ignore
    }

    return {
      error: NextResponse.json({ error: 'Admin role required' }, { status: 403 }),
    };
  }

  return { user: ctx.user, accessToken: ctx.accessToken };
}

type AuditPayload = {
  actorUserId: string;
  action: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordAdminAudit(payload: AuditPayload) {
  try {
    await supabaseAdmin.from('admin_audit_log').insert({
      actor_user_id: payload.actorUserId,
      action: payload.action,
      target_user_id: payload.targetUserId ?? null,
      metadata: payload.metadata ?? null,
    });
  } catch (error) {
    console.error('[admin_audit] failed to record audit event', error);
  }
}

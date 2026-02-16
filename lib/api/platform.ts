import { NextRequest, NextResponse } from 'next/server';

import { getRouteClient, type RouteClientResult } from '@/lib/supabase-route';
import { supabaseAdmin } from '@/lib/supabase-admin';

type PlatformAdminCheck =
  | { error: NextResponse }
  | {
      ctx: RouteClientResult;
    };

function isRelationMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code ?? '';
  const message = (error as { message?: string }).message ?? '';
  return code === '42P01' || /relation .* does not exist/i.test(message);
}

export async function isUserPlatformAdmin(userId: string): Promise<boolean> {
  const { data: row, error: tableError } = await supabaseAdmin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (tableError) {
    throw tableError;
  }

  return Boolean(row);
}

export async function requirePlatformAdmin(req: NextRequest): Promise<PlatformAdminCheck> {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return {
      error: NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 }),
    };
  }

  try {
    const isPlatform = await isUserPlatformAdmin(ctx.user.id);
    if (!isPlatform) {
      return {
        error: NextResponse.json({ error: 'Platform admin role required' }, { status: 403 }),
      };
    }
  } catch (error) {
    if (isRelationMissing(error)) {
      return {
        error: NextResponse.json(
          { error: 'Platform entitlement tables are not available. Run migrations first.' },
          { status: 503 }
        ),
      };
    }

    return {
      error: NextResponse.json({ error: 'Failed to verify platform admin access' }, { status: 500 }),
    };
  }

  return { ctx };
}

type PlatformAuditPayload = {
  actorUserId: string;
  action: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordPlatformAudit(payload: PlatformAuditPayload) {
  try {
    await supabaseAdmin.from('admin_audit_log').insert({
      actor_user_id: payload.actorUserId,
      action: payload.action,
      target_user_id: payload.targetUserId ?? null,
      metadata: payload.metadata ?? null,
    });
  } catch (error) {
    console.error('[platform_audit] failed to record audit event', error);
  }
}

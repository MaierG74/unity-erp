import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api/admin';
import { resolveUserOrgContext } from '@/lib/api/org-context';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRouteClient } from '@/lib/supabase-route';

function parseComponentId(value: unknown) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('component_id must be a positive integer');
  }
  return parsed;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const orgContext = await resolveUserOrgContext(req, {
    supabase: ctx.supabase,
    userId: admin.user.id,
    jwtOrgId:
      admin.user?.app_metadata?.org_id ??
      admin.user?.user_metadata?.org_id ??
      null,
  });

  if (!orgContext.orgId) {
    return NextResponse.json(
      {
        error: orgContext.error ?? 'Organization context is required',
        reason: orgContext.errorCode ?? 'missing_org_context',
      },
      { status: 400 }
    );
  }

  if (orgContext.role !== 'owner' && orgContext.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required for the selected organization' },
      { status: 403 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (_error) {
    body = {};
  }

  let componentId: number | null;
  try {
    componentId = parseComponentId(body.component_id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid component_id' },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabaseAdmin.rpc(
      'recompute_inventory_average_cost_from_history',
      {
        p_org_id: orgContext.orgId,
        p_component_id: componentId,
      }
    );

    if (error) {
      console.error('[inventory][recompute-wac] RPC failed', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      updated: Number(data ?? 0),
      org_id: orgContext.orgId,
    });
  } catch (error) {
    console.error('[inventory][recompute-wac] Unexpected error', error);
    return NextResponse.json(
      { error: 'Failed to recompute inventory average cost' },
      { status: 500 }
    );
  }
}

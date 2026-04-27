import { NextRequest, NextResponse } from 'next/server';

import { resolveUserOrgContext } from '@/lib/api/org-context';
import { getRouteClient } from '@/lib/supabase-route';

const ACTIVITY_CODES = ['cut_pieces', 'edge_bundles'] as const;
const ADMIN_ROLES = new Set(['owner', 'admin']);

type ActivityCode = (typeof ACTIVITY_CODES)[number];

function isActivityCode(value: unknown): value is ActivityCode {
  return typeof value === 'string' && ACTIVITY_CODES.includes(value as ActivityCode);
}

function parseNullableRoleId(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function getContext(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return { error: NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 }) };
  }

  const orgContext = await resolveUserOrgContext(req, {
    supabase: ctx.supabase,
    userId: ctx.user.id,
    jwtOrgId: ctx.user.app_metadata?.org_id ?? ctx.user.user_metadata?.org_id ?? null,
  });

  if (!orgContext.orgId || !orgContext.isMember) {
    return { error: NextResponse.json({ error: 'Organization context is required' }, { status: 403 }) };
  }

  return { ctx, orgContext };
}

function isOrgAdmin(role: string | null) {
  return role !== null && ADMIN_ROLES.has(role);
}

export async function GET(req: NextRequest) {
  const resolved = await getContext(req);
  if ('error' in resolved) return resolved.error;

  const { ctx, orgContext } = resolved;

  const [activitiesResult, rolesResult] = await Promise.all([
    ctx.supabase
      .from('piecework_activities')
      .select('id, org_id, code, label, default_rate, unit_label, target_role_id, is_active, created_at, updated_at')
      .eq('org_id', orgContext.orgId)
      .order('code', { ascending: true }),
    ctx.supabase
      .from('labor_roles')
      .select('role_id, name, color')
      .order('name', { ascending: true }),
  ]);

  if (activitiesResult.error) {
    return NextResponse.json(
      { error: 'Failed to fetch piecework activities', details: activitiesResult.error.message },
      { status: 500 }
    );
  }

  if (rolesResult.error) {
    return NextResponse.json(
      { error: 'Failed to fetch labor roles', details: rolesResult.error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    activities: activitiesResult.data ?? [],
    roles: rolesResult.data ?? [],
    codes: ACTIVITY_CODES,
    canWrite: isOrgAdmin(orgContext.role),
  });
}

export async function POST(req: NextRequest) {
  const resolved = await getContext(req);
  if ('error' in resolved) return resolved.error;

  const { ctx, orgContext } = resolved;
  if (!isOrgAdmin(orgContext.role)) {
    return NextResponse.json({ error: 'Only organization admins can manage piecework activities' }, { status: 403 });
  }

  const body = await req.json();
  const roleId = parseNullableRoleId(body.target_role_id);
  const rate = Number(body.default_rate);

  if (!isActivityCode(body.code)) {
    return NextResponse.json({ error: 'Unknown piecework activity code' }, { status: 400 });
  }

  if (!body.label || typeof body.label !== 'string' || !body.unit_label || typeof body.unit_label !== 'string') {
    return NextResponse.json({ error: 'Label and unit label are required' }, { status: 400 });
  }

  if (!Number.isFinite(rate) || rate < 0) {
    return NextResponse.json({ error: 'Default rate must be a non-negative number' }, { status: 400 });
  }

  if (roleId === undefined) {
    return NextResponse.json({ error: 'Target role must be empty or a valid role id' }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from('piecework_activities')
    .insert({
      org_id: orgContext.orgId,
      code: body.code,
      label: body.label.trim(),
      default_rate: rate,
      unit_label: body.unit_label.trim(),
      target_role_id: roleId,
      is_active: body.is_active !== false,
    })
    .select('id, org_id, code, label, default_rate, unit_label, target_role_id, is_active, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to create piecework activity', details: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity: data }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const resolved = await getContext(req);
  if ('error' in resolved) return resolved.error;

  const { ctx, orgContext } = resolved;
  if (!isOrgAdmin(orgContext.role)) {
    return NextResponse.json({ error: 'Only organization admins can manage piecework activities' }, { status: 403 });
  }

  const body = await req.json();
  const roleId = parseNullableRoleId(body.target_role_id);
  const rate = Number(body.default_rate);

  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'Activity id is required' }, { status: 400 });
  }

  if (!body.label || typeof body.label !== 'string' || !body.unit_label || typeof body.unit_label !== 'string') {
    return NextResponse.json({ error: 'Label and unit label are required' }, { status: 400 });
  }

  if (!Number.isFinite(rate) || rate < 0) {
    return NextResponse.json({ error: 'Default rate must be a non-negative number' }, { status: 400 });
  }

  if (roleId === undefined) {
    return NextResponse.json({ error: 'Target role must be empty or a valid role id' }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from('piecework_activities')
    .update({
      label: body.label.trim(),
      default_rate: rate,
      unit_label: body.unit_label.trim(),
      target_role_id: roleId,
      is_active: body.is_active !== false,
    })
    .eq('id', body.id)
    .eq('org_id', orgContext.orgId)
    .select('id, org_id, code, label, default_rate, unit_label, target_role_id, is_active, created_at, updated_at')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Failed to update piecework activity', details: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity: data });
}

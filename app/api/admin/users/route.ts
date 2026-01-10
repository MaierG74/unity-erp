import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, recordAdminAudit } from '@/lib/api/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

const ALLOWED_ROLES = new Set(['owner', 'admin', 'manager', 'staff']);

type CreateUserPayload = {
  login: string;
  password: string;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  org_id: string;
  avatar_url?: string | null;
};

function normalizeLogin(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  let body: CreateUserPayload;
  try {
    body = (await req.json()) as CreateUserPayload;
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const login = normalizeLogin(body?.login ?? '');
  const password = body?.password ?? '';
  const displayName = (body?.display_name ?? '').trim();
  const firstName = (body?.first_name ?? '').trim();
  const lastName = (body?.last_name ?? '').trim();
  const role = (body?.role ?? '').trim();
  const orgId = (body?.org_id ?? '').trim();
  const avatarUrl = body?.avatar_url ?? null;

  if (!login || !password || !role || !orgId) {
    return NextResponse.json({ error: 'login, password, role, and org_id are required' }, { status: 400 });
  }

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const email = `${login}@qbutton.co.za`;
  const safeDisplayName = displayName || [firstName, lastName].filter(Boolean).join(' ').trim() || login;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: safeDisplayName, first_name: firstName || null, last_name: lastName || null, avatar_url: avatarUrl, login },
    app_metadata: { role, org_id: orgId },
  });

  if (error || !data?.user) {
    const message = error?.message ?? 'Failed to create user';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const userId = data.user.id;

  const [{ error: profileError }, { error: memberError }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .upsert(
        {
          id: userId,
          username: safeDisplayName,
          display_name: safeDisplayName,
          first_name: firstName || null,
          last_name: lastName || null,
          login,
          avatar_url: avatarUrl,
        },
        { onConflict: 'id' }
      ),
    supabaseAdmin
      .from('organization_members')
      .upsert({ user_id: userId, org_id: orgId, role, is_active: true }, { onConflict: 'user_id,org_id' }),
  ]);

  if (profileError || memberError) {
    return NextResponse.json(
      { error: profileError?.message ?? memberError?.message ?? 'Failed to persist profile' },
      { status: 500 }
    );
  }

  await recordAdminAudit({
    actorUserId: admin.user.id,
    action: 'admin_user_create',
    targetUserId: userId,
    metadata: { login, role, org_id: orgId },
  });

  return NextResponse.json(
    {
      user_id: userId,
      login,
      email,
      password, // shown once to the admin per requirements
    },
    { status: 201 }
  );
}

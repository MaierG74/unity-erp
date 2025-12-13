import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin, recordAdminAudit } from '@/lib/api/admin';
import { supabaseAdmin } from '@/lib/supabase-admin';

type UpdateProfilePayload = {
  display_name?: string | null;
  login?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
};

function normalizeLogin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase();
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin(req);
  if ('error' in admin) return admin.error;

  const userId = params?.id;
  if (!userId) {
    return NextResponse.json({ error: 'User id is required' }, { status: 400 });
  }

  let body: UpdateProfilePayload;
  try {
    body = (await req.json()) as UpdateProfilePayload;
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const displayName = (body?.display_name ?? '').trim();
  const login = normalizeLogin(body?.login);
  const firstName = (body?.first_name ?? '').trim();
  const lastName = (body?.last_name ?? '').trim();
  const avatarProvided = Object.prototype.hasOwnProperty.call(body ?? {}, 'avatar_url');
  const avatarUrl = avatarProvided ? body?.avatar_url ?? null : undefined;

  if (!displayName && !login && !firstName && !lastName && avatarUrl === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const email = login ? `${login}@qbutton.co.za` : undefined;

  const userMetadata: Record<string, any> = {};
  const resolvedDisplayName =
    displayName || (firstName || lastName ? `${firstName} ${lastName}`.trim() : undefined);
  if (resolvedDisplayName) userMetadata.display_name = resolvedDisplayName;
  if (login) userMetadata.login = login;
  if (avatarUrl !== undefined) userMetadata.avatar_url = avatarUrl;
  if (firstName) userMetadata.first_name = firstName;
  if (lastName) userMetadata.last_name = lastName;

  const authUpdate: Record<string, any> = {};
  if (email) authUpdate.email = email;
  if (Object.keys(userMetadata).length > 0) authUpdate.user_metadata = userMetadata;
  if (email) authUpdate.email_confirm = true;

  if (Object.keys(authUpdate).length > 0) {
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, authUpdate);
    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 500 });
    }
  }

  const profileUpdates: Record<string, any> = {};
  if (resolvedDisplayName) {
    profileUpdates.display_name = resolvedDisplayName;
    profileUpdates.username = resolvedDisplayName;
  }
  if (login) {
    profileUpdates.login = login;
  }
  if (firstName) {
    profileUpdates.first_name = firstName;
  }
  if (lastName) {
    profileUpdates.last_name = lastName;
  }
  if (avatarUrl !== undefined) {
    profileUpdates.avatar_url = avatarUrl;
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(profileUpdates)
      .eq('id', userId);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  await recordAdminAudit({
    actorUserId: admin.user.id,
    action: 'admin_user_profile_update',
    targetUserId: userId,
    metadata: { display_name: displayName || undefined, login: login || undefined, avatar_url: avatarUrl ?? null },
  });

  return NextResponse.json(
    {
      user_id: userId,
      display_name: displayName || null,
      first_name: firstName || null,
      last_name: lastName || null,
      login: login || null,
      email: email ?? null,
      avatar_url: avatarUrl ?? null,
    },
    { status: 200 }
  );
}

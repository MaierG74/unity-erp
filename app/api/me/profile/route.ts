import { NextRequest, NextResponse } from 'next/server';

import { getRouteClient } from '@/lib/supabase-route';

type UpdatePayload = {
  display_name?: string | null;
  avatar_url?: string | null;
};

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const { data, error } = await ctx.supabase
    .from('profiles')
    .select('id, username, display_name, first_name, last_name, login, avatar_url')
    .eq('id', ctx.user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    profile: data ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  let body: UpdatePayload;
  try {
    body = (await req.json()) as UpdatePayload;
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const displayName = (body?.display_name ?? '').trim();
  const firstName = (body?.first_name ?? '').trim();
  const lastName = (body?.last_name ?? '').trim();
  const avatarProvided = Object.prototype.hasOwnProperty.call(body ?? {}, 'avatar_url');
  const avatarUrl = avatarProvided ? body?.avatar_url ?? null : undefined;

  const updates: Record<string, any> = {};
  if (displayName) {
    updates.display_name = displayName;
    updates.username = displayName;
  }
  if (firstName) {
    updates.first_name = firstName;
  }
  if (lastName) {
    updates.last_name = lastName;
  }
  if (avatarUrl !== undefined) {
    updates.avatar_url = avatarUrl;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from('profiles')
    .update(updates)
    .eq('id', ctx.user.id)
    .select('id, username, display_name, first_name, last_name, login, avatar_url')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}

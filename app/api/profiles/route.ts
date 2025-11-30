import { NextRequest, NextResponse } from 'next/server';

import { getRouteClient } from '@/lib/supabase-route';
import { supabaseAdmin } from '@/lib/supabase-admin';

type AdminUser = {
  id: string;
  email?: string | null;
  raw_user_meta_data?: Record<string, any> | null;
  user_metadata?: Record<string, any> | null;
};

const PAGE_SIZE = 1000;

async function listAllUsers() {
  const users: AdminUser[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;

    const pageUsers = data?.users ?? [];
    users.push(
      ...pageUsers.map(user => ({
        id: user.id,
        email: user.email,
        raw_user_meta_data: user.raw_user_meta_data as Record<string, any> | null,
        user_metadata: user.user_metadata as Record<string, any> | null,
      }))
    );

    if (!data || pageUsers.length < PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return users;
}

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const [{ data: profileRows, error: profileError }, users] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, username, avatar_url')
        .limit(2000),
      listAllUsers(),
    ]);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const userMap = new Map(users.map(user => [user.id, user]));

    const entries = (profileRows ?? []).map(row => {
      const user = userMap.get(row.id) ?? null;
      const metadata = user?.user_metadata ?? user?.raw_user_meta_data ?? {};
      const nameFromMetadata = metadata?.full_name || metadata?.name || metadata?.display_name;

      return {
        id: row.id,
        username: row.username,
        avatar_url: row.avatar_url,
        email: user?.email ?? null,
        metadata,
        display_name: row.username || nameFromMetadata || user?.email || row.id,
      };
    });

    // Include users with no profile row yet so we can still assign tasks.
    for (const user of users) {
      if (entries.some(entry => entry.id === user.id)) continue;
      const metadata = user.user_metadata ?? user.raw_user_meta_data ?? {};
      const nameFromMetadata = metadata?.full_name || metadata?.name || metadata?.display_name;

      entries.push({
        id: user.id,
        username: null,
        avatar_url: null,
        email: user.email ?? null,
        metadata,
        display_name: nameFromMetadata || user.email || user.id,
      });
    }

    // Sort alphabetically by display name for consistency.
    entries.sort((a, b) => a.display_name.localeCompare(b.display_name));

    return NextResponse.json({ profiles: entries });
  } catch (error) {
    console.error('[profiles][GET] Failed to load profile directory', error);
    return NextResponse.json({ error: 'Failed to load profiles' }, { status: 500 });
  }
}

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
    const [{ data: profileRows, error: profileError }, users, { data: memberRows, error: memberError }] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('id, username, display_name, first_name, last_name, login, avatar_url')
        .limit(2000),
      listAllUsers(),
      supabaseAdmin
        .from('organization_members')
        .select('user_id, org_id, role, is_active, banned_until')
        .limit(5000),
    ]);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const membershipMap = new Map<string, any[]>();
    for (const m of memberRows ?? []) {
      const list = membershipMap.get(m.user_id) ?? [];
      list.push(m);
      membershipMap.set(m.user_id, list);
    }

    const userMap = new Map(users.map(user => [user.id, user]));

    const entries = (profileRows ?? []).map(row => {
      const user = userMap.get(row.id) ?? null;
      const metadata = user?.user_metadata ?? user?.raw_user_meta_data ?? {};
      const nameFromMetadata = metadata?.full_name || metadata?.name || metadata?.display_name;
      const login = row.login ?? metadata?.login ?? null;
      const displayName = row.display_name || row.username || nameFromMetadata || login || user?.email || row.id;
      const memberships = membershipMap.get(row.id) ?? [];
      const primaryMembership = memberships[0] ?? null;

      return {
        id: row.id,
        username: displayName,
        display_name: displayName,
        first_name: row.first_name ?? metadata?.first_name ?? null,
        last_name: row.last_name ?? metadata?.last_name ?? null,
        login,
        avatar_url: row.avatar_url,
        email: user?.email ?? null,
        metadata,
        raw_display_name: row.display_name ?? null,
        memberships,
        primary_org_id: primaryMembership?.org_id ?? null,
        primary_role: primaryMembership?.role ?? null,
        is_active: primaryMembership?.is_active ?? null,
        banned_until: primaryMembership?.banned_until ?? null,
      };
    });

    // Include users with no profile row yet so we can still assign tasks.
    for (const user of users) {
      if (entries.some(entry => entry.id === user.id)) continue;
      const metadata = user.user_metadata ?? user.raw_user_meta_data ?? {};
      const nameFromMetadata = metadata?.full_name || metadata?.name || metadata?.display_name;
      const memberships = membershipMap.get(user.id) ?? [];
      const primaryMembership = memberships[0] ?? null;

      entries.push({
        id: user.id,
        username: nameFromMetadata || user.email || user.id,
        display_name: nameFromMetadata || user.email || user.id,
        first_name: metadata?.first_name ?? null,
        last_name: metadata?.last_name ?? null,
        login: metadata?.login ?? null,
        avatar_url: null,
        email: user.email ?? null,
        metadata,
        raw_display_name: null,
        memberships,
        primary_org_id: primaryMembership?.org_id ?? null,
        primary_role: primaryMembership?.role ?? null,
        is_active: primaryMembership?.is_active ?? null,
        banned_until: primaryMembership?.banned_until ?? null,
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

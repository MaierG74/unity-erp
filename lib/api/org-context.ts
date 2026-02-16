import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OrgMembershipRow = {
  org_id: string;
  role: string | null;
  is_active: boolean | null;
  banned_until: string | null;
  inserted_at: string | null;
};

type ResolveContextArgs = {
  supabase: SupabaseClient;
  userId: string;
  jwtOrgId?: unknown;
  preferredOrgId?: string | null;
};

export type OrgContextResolution = {
  orgId: string | null;
  source: 'preferred' | 'query' | 'header' | 'jwt' | 'membership' | 'none';
  role: string | null;
  isMember: boolean;
  error?: string;
  errorCode?: 'requested_org_not_active' | 'membership_query_failed' | 'no_active_membership';
};

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

function isMembershipActive(row: Pick<OrgMembershipRow, 'is_active' | 'banned_until'>): boolean {
  if (!row.is_active) return false;
  if (!row.banned_until) return true;
  return new Date(row.banned_until).getTime() > Date.now();
}

async function fetchMembership(
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<OrgMembershipRow | null> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, role, is_active, banned_until, inserted_at')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as OrgMembershipRow | null) ?? null;
}

async function pickFirstActiveMembership(
  supabase: SupabaseClient,
  userId: string
): Promise<OrgMembershipRow | null> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, role, is_active, banned_until, inserted_at')
    .eq('user_id', userId)
    .order('inserted_at', { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as OrgMembershipRow[];
  return rows.find((row) => isMembershipActive(row)) ?? null;
}

export async function resolveUserOrgContext(
  req: NextRequest,
  args: ResolveContextArgs
): Promise<OrgContextResolution> {
  const preferredOrgId = normalizeUuid(args.preferredOrgId);
  const queryOrgId = normalizeUuid(req.nextUrl.searchParams.get('org_id'));
  const headerOrgId = normalizeUuid(req.headers.get('x-org-id'));
  const jwtOrgId = normalizeUuid(args.jwtOrgId);

  const candidate: { orgId: string | null; source: OrgContextResolution['source']; explicit: boolean } =
    preferredOrgId
      ? { orgId: preferredOrgId, source: 'preferred', explicit: true }
      : queryOrgId
        ? { orgId: queryOrgId, source: 'query', explicit: true }
        : headerOrgId
          ? { orgId: headerOrgId, source: 'header', explicit: true }
          : jwtOrgId
            ? { orgId: jwtOrgId, source: 'jwt', explicit: false }
            : { orgId: null, source: 'none', explicit: false };

  if (candidate.orgId) {
    try {
      const membership = await fetchMembership(args.supabase, args.userId, candidate.orgId);
      if (membership && isMembershipActive(membership)) {
        return {
          orgId: membership.org_id,
          source: candidate.source,
          role: membership.role ?? null,
          isMember: true,
        };
      }

      if (candidate.explicit) {
        return {
          orgId: null,
          source: candidate.source,
          role: null,
          isMember: false,
          error: 'Requested organization is not active for this user',
          errorCode: 'requested_org_not_active',
        };
      }
    } catch (error) {
      return {
        orgId: null,
        source: candidate.source,
        role: null,
        isMember: false,
        error: error instanceof Error ? error.message : 'Failed to resolve organization membership',
        errorCode: 'membership_query_failed',
      };
    }
  }

  try {
    const firstMembership = await pickFirstActiveMembership(args.supabase, args.userId);
    if (!firstMembership) {
      return {
        orgId: null,
        source: 'none',
        role: null,
        isMember: false,
        error: 'No active organization membership found',
        errorCode: 'no_active_membership',
      };
    }

    return {
      orgId: firstMembership.org_id,
      source: 'membership',
      role: firstMembership.role ?? null,
      isMember: true,
    };
  } catch (error) {
    return {
      orgId: null,
      source: 'none',
      role: null,
      isMember: false,
      error: error instanceof Error ? error.message : 'Failed to resolve organization context',
      errorCode: 'membership_query_failed',
    };
  }
}

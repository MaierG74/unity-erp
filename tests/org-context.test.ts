import assert from 'node:assert/strict';
import test from 'node:test';

import { NextRequest } from 'next/server';

import { resolveUserOrgContext } from '@/lib/api/org-context';

type MembershipRow = {
  user_id: string;
  org_id: string;
  role: string | null;
  is_active: boolean | null;
  banned_until: string | null;
  inserted_at: string | null;
};

function makeRequest(url = 'http://localhost/api/test') {
  return new NextRequest(url);
}

function makeSupabaseStub(rows: MembershipRow[]) {
  return {
    from: (table: string) => {
      assert.equal(table, 'organization_members');

      return {
        select: (_columns: string) => ({
          eq: (column: string, value: string) => {
            const filters = [{ column, value }];

            const withFilter = (nextColumn: string, nextValue: string) => {
              filters.push({ column: nextColumn, value: nextValue });

              return {
                limit: (_n: number) => ({
                  maybeSingle: async () => {
                    const match = rows.find((row) =>
                      filters.every((filter) => String((row as Record<string, unknown>)[filter.column]) === filter.value)
                    );
                    return { data: match ?? null, error: null };
                  },
                }),
              };
            };

            return {
              eq: withFilter,
              order: (_orderColumn: string, _options: { ascending: boolean }) => ({
                limit: async (_n: number) => ({
                  data: rows
                    .filter((row) =>
                      filters.every((filter) => String((row as Record<string, unknown>)[filter.column]) === filter.value)
                    )
                    .sort((a, b) => String(a.inserted_at ?? '').localeCompare(String(b.inserted_at ?? ''))),
                  error: null,
                }),
              }),
            };
          },
        }),
      };
    },
  };
}

test('resolveUserOrgContext accepts memberships whose ban has expired', async () => {
  const req = makeRequest();
  const orgId = '11111111-1111-4111-8111-111111111111';
  const supabase = makeSupabaseStub([
    {
      user_id: 'user-1',
      org_id: orgId,
      role: 'manager',
      is_active: true,
      banned_until: '2026-03-20T00:00:00.000Z',
      inserted_at: '2026-01-01T00:00:00.000Z',
    },
  ]);

  const result = await resolveUserOrgContext(req, {
    supabase: supabase as any,
    userId: 'user-1',
    preferredOrgId: orgId,
  });

  assert.equal(result.orgId, orgId);
  assert.equal(result.isMember, true);
  assert.equal(result.errorCode, undefined);
});

test('resolveUserOrgContext rejects memberships whose ban is still active', async () => {
  const req = makeRequest();
  const orgId = '22222222-2222-4222-8222-222222222222';
  const supabase = makeSupabaseStub([
    {
      user_id: 'user-2',
      org_id: orgId,
      role: 'staff',
      is_active: true,
      banned_until: '2026-04-20T00:00:00.000Z',
      inserted_at: '2026-01-01T00:00:00.000Z',
    },
  ]);

  const result = await resolveUserOrgContext(req, {
    supabase: supabase as any,
    userId: 'user-2',
    preferredOrgId: orgId,
  });

  assert.equal(result.orgId, null);
  assert.equal(result.isMember, false);
  assert.equal(result.errorCode, 'requested_org_not_active');
});

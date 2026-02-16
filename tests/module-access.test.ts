import assert from 'node:assert/strict';
import test from 'node:test';

import { NextRequest } from 'next/server';

import {
  clearModuleAccessCache,
  evaluateModuleAccess,
  requireModuleAccess,
} from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';

function makeRequest(url = 'http://localhost/api/me/module-access') {
  return new NextRequest(url, {
    headers: {
      Authorization: 'Bearer test-token',
    },
  });
}

function makeSupabaseStub(options: { moduleExists?: boolean; hasAccess?: boolean }) {
  let rpcCalls = 0;

  const supabase = {
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, _value: string) => ({
          limit: (_n: number) => ({
            maybeSingle: async () => {
              if (table !== 'module_catalog') {
                return { data: null, error: null };
              }
              return {
                data: options.moduleExists === false ? null : { module_key: MODULE_KEYS.FURNITURE_CONFIGURATOR },
                error: null,
              };
            },
          }),
        }),
      }),
    }),
    rpc: async (_fn: string, _args: Record<string, unknown>) => {
      rpcCalls += 1;
      return {
        data: Boolean(options.hasAccess),
        error: null,
      };
    },
  };

  return { supabase, getRpcCalls: () => rpcCalls };
}

test('evaluateModuleAccess allows platform admin bypass without calling entitlement RPC', async () => {
  clearModuleAccessCache();
  const req = makeRequest();
  const { supabase, getRpcCalls } = makeSupabaseStub({ moduleExists: true, hasAccess: false });

  const result = await evaluateModuleAccess(
    req,
    MODULE_KEYS.FURNITURE_CONFIGURATOR,
    {},
    {
      getRouteClientFn: async () =>
        ({
          supabase,
          user: { id: 'user-1', app_metadata: {}, user_metadata: {} } as any,
          accessToken: 'test',
        }) as any,
      isUserPlatformAdminFn: async () => true,
      resolveUserOrgContextFn: async () =>
        ({
          orgId: 'org-1',
          source: 'membership',
          role: 'owner',
          isMember: true,
        }) as any,
    }
  );

  assert.ok(!('error' in result));
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'platform_admin_bypass');
  assert.equal(getRpcCalls(), 0);
});

test('evaluateModuleAccess denies user when entitlement RPC returns false', async () => {
  clearModuleAccessCache();
  const req = makeRequest();
  const { supabase } = makeSupabaseStub({ moduleExists: true, hasAccess: false });

  const result = await evaluateModuleAccess(
    req,
    MODULE_KEYS.FURNITURE_CONFIGURATOR,
    {},
    {
      getRouteClientFn: async () =>
        ({
          supabase,
          user: { id: 'user-2', app_metadata: {}, user_metadata: {} } as any,
          accessToken: 'test',
        }) as any,
      isUserPlatformAdminFn: async () => false,
      resolveUserOrgContextFn: async () =>
        ({
          orgId: 'org-2',
          source: 'membership',
          role: 'manager',
          isMember: true,
        }) as any,
    }
  );

  assert.ok(!('error' in result));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'not_entitled');
});

test('evaluateModuleAccess surfaces org context resolution failures', async () => {
  clearModuleAccessCache();
  const req = makeRequest();
  const { supabase } = makeSupabaseStub({ moduleExists: true, hasAccess: false });

  const result = await evaluateModuleAccess(
    req,
    MODULE_KEYS.FURNITURE_CONFIGURATOR,
    {},
    {
      getRouteClientFn: async () =>
        ({
          supabase,
          user: { id: 'user-3', app_metadata: {}, user_metadata: {} } as any,
          accessToken: 'test',
        }) as any,
      isUserPlatformAdminFn: async () => false,
      resolveUserOrgContextFn: async () =>
        ({
          orgId: null,
          source: 'none',
          role: null,
          isMember: false,
          error: 'membership query failed',
          errorCode: 'membership_query_failed',
        }) as any,
    }
  );

  assert.ok(!('error' in result));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'org_context_unavailable');
});

test('evaluateModuleAccess returns 404 when module key is missing from catalog', async () => {
  clearModuleAccessCache();
  const req = makeRequest();
  const { supabase } = makeSupabaseStub({ moduleExists: false, hasAccess: false });

  const result = await evaluateModuleAccess(
    req,
    MODULE_KEYS.FURNITURE_CONFIGURATOR,
    {},
    {
      getRouteClientFn: async () =>
        ({
          supabase,
          user: { id: 'user-4', app_metadata: {}, user_metadata: {} } as any,
          accessToken: 'test',
        }) as any,
      isUserPlatformAdminFn: async () => false,
      resolveUserOrgContextFn: async () =>
        ({
          orgId: 'org-4',
          source: 'membership',
          role: 'manager',
          isMember: true,
        }) as any,
    }
  );

  assert.ok('error' in result);
  assert.equal(result.error.status, 404);
});

test('requireModuleAccess returns 403 payload when module is disabled', async () => {
  clearModuleAccessCache();
  const req = makeRequest();
  const { supabase } = makeSupabaseStub({ moduleExists: true, hasAccess: false });

  const result = await requireModuleAccess(
    req,
    MODULE_KEYS.FURNITURE_CONFIGURATOR,
    {},
    {
      getRouteClientFn: async () =>
        ({
          supabase,
          user: { id: 'user-5', app_metadata: {}, user_metadata: {} } as any,
          accessToken: 'test',
        }) as any,
      isUserPlatformAdminFn: async () => false,
      resolveUserOrgContextFn: async () =>
        ({
          orgId: 'org-5',
          source: 'membership',
          role: 'staff',
          isMember: true,
        }) as any,
    }
  );

  assert.ok('error' in result);
  assert.equal(result.error.status, 403);
  const body = await result.error.json();
  assert.equal(body.reason, 'not_entitled');
});

test('evaluateModuleAccess caches entitlement checks for repeated requests', async () => {
  clearModuleAccessCache();
  const req = makeRequest();
  const { supabase, getRpcCalls } = makeSupabaseStub({ moduleExists: true, hasAccess: true });

  const deps = {
    getRouteClientFn: async () =>
      ({
        supabase,
        user: { id: 'cache-user', app_metadata: {}, user_metadata: {} } as any,
        accessToken: 'test',
      }) as any,
    isUserPlatformAdminFn: async () => false,
    resolveUserOrgContextFn: async () =>
      ({
        orgId: 'cache-org',
        source: 'membership',
        role: 'manager',
        isMember: true,
      }) as any,
  };

  const first = await evaluateModuleAccess(
    req,
    MODULE_KEYS.FURNITURE_CONFIGURATOR,
    { cacheKeyOverride: 'cache-test-key' },
    deps as any
  );
  const second = await evaluateModuleAccess(
    req,
    MODULE_KEYS.FURNITURE_CONFIGURATOR,
    { cacheKeyOverride: 'cache-test-key' },
    deps as any
  );

  assert.ok(!('error' in first));
  assert.ok(!('error' in second));
  assert.equal(getRpcCalls(), 1);
});

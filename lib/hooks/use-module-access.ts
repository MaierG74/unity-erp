'use client';

import { useQuery } from '@tanstack/react-query';

import { authorizedFetch } from '@/lib/client/auth-fetch';
import { isKnownModuleKey, type ModuleKey } from '@/lib/modules/keys';

type ModuleAccessPayload = {
  allowed: boolean;
  reason: string | null;
  is_platform_admin: boolean;
  org_id: string | null;
  error: string | null;
};

export function useModuleAccess(moduleKey: ModuleKey | string) {
  const normalizedModule = moduleKey.trim().toLowerCase();

  return useQuery({
    queryKey: ['module-access', normalizedModule],
    queryFn: async (): Promise<ModuleAccessPayload> => {
      if (!normalizedModule || !isKnownModuleKey(normalizedModule)) {
        return {
          allowed: false,
          reason: 'invalid_module_key',
          is_platform_admin: false,
          org_id: null,
          error: 'Invalid module key',
        };
      }

      try {
        const res = await authorizedFetch(`/api/me/module-access?module=${normalizedModule}`, {
          method: 'GET',
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

        if (!res.ok) {
          if (res.status === 403) {
            return {
              allowed: false,
              reason: (json?.reason as string | null) ?? 'not_entitled',
              is_platform_admin: Boolean(json?.is_platform_admin),
              org_id: (json?.org_id as string | null) ?? null,
              error: null,
            };
          }
          return {
            allowed: false,
            reason: null,
            is_platform_admin: false,
            org_id: null,
            error: (json?.error as string | null) ?? `Access check failed (${res.status})`,
          };
        }

        return {
          allowed: Boolean(json?.allowed),
          reason: (json?.reason as string | null) ?? null,
          is_platform_admin: Boolean(json?.is_platform_admin),
          org_id: (json?.org_id as string | null) ?? null,
          error: null,
        };
      } catch (err) {
        return {
          allowed: false,
          reason: null,
          is_platform_admin: false,
          org_id: null,
          error: err instanceof Error ? err.message : 'Access check failed',
        };
      }
    },
    staleTime: 60_000,
  });
}

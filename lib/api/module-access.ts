import { NextRequest, NextResponse } from 'next/server';

import { resolveUserOrgContext } from '@/lib/api/org-context';
import { isUserPlatformAdmin } from '@/lib/api/platform';
import { getRouteClient, type RouteClientResult } from '@/lib/supabase-route';
import { isKnownModuleKey, type ModuleKey } from '@/lib/modules/keys';

type ModuleAccessDeps = {
  getRouteClientFn: typeof getRouteClient;
  isUserPlatformAdminFn: typeof isUserPlatformAdmin;
  resolveUserOrgContextFn: typeof resolveUserOrgContext;
};

const defaultDeps: ModuleAccessDeps = {
  getRouteClientFn: getRouteClient,
  isUserPlatformAdminFn: isUserPlatformAdmin,
  resolveUserOrgContextFn: resolveUserOrgContext,
};

function isRelationMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code ?? '';
  const message = (error as { message?: string }).message ?? '';
  return code === '42P01' || /relation .* does not exist/i.test(message);
}

function isFunctionMissing(error: unknown, fnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code ?? '';
  const message = (error as { message?: string }).message ?? '';
  return code === '42883' || new RegExp(`function .*${fnName}.* does not exist`, 'i').test(message);
}

type EvaluateOptions = {
  preferredOrgId?: string | null;
  allowPlatformBypass?: boolean;
  bypassCache?: boolean;
  cacheKeyOverride?: string;
};

export type ModuleAccessEvaluation = {
  ctx: RouteClientResult;
  moduleKey: ModuleKey;
  orgId: string | null;
  isPlatformAdmin: boolean;
  allowed: boolean;
  reason:
    | 'enabled'
    | 'platform_admin_bypass'
    | 'org_context_unavailable'
    | 'org_not_member'
    | 'missing_org_context'
    | 'not_entitled'
    | 'invalid_org_context';
};

export type ModuleAccessResult = { error: NextResponse } | ModuleAccessEvaluation;

type CachedModuleAccess = Omit<ModuleAccessEvaluation, 'ctx'>;

const MODULE_ACCESS_CACHE_TTL_MS = 30_000;
const moduleAccessCache = new Map<string, { expiresAt: number; value: CachedModuleAccess }>();

export function clearModuleAccessCache() {
  moduleAccessCache.clear();
}

function readCache(cacheKey: string): CachedModuleAccess | null {
  const now = Date.now();
  const entry = moduleAccessCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    moduleAccessCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function writeCache(cacheKey: string, value: CachedModuleAccess) {
  const now = Date.now();
  moduleAccessCache.set(cacheKey, {
    expiresAt: now + MODULE_ACCESS_CACHE_TTL_MS,
    value,
  });

  // Keep memory bounded for long-lived processes.
  if (moduleAccessCache.size > 1500) {
    for (const [key, entry] of moduleAccessCache.entries()) {
      if (entry.expiresAt <= now) {
        moduleAccessCache.delete(key);
      }
    }
  }
}

export async function evaluateModuleAccess(
  req: NextRequest,
  moduleKey: string,
  options: EvaluateOptions = {},
  deps: ModuleAccessDeps = defaultDeps
): Promise<ModuleAccessResult> {
  const normalizedModuleKey = moduleKey.trim().toLowerCase();
  if (!normalizedModuleKey || !isKnownModuleKey(normalizedModuleKey)) {
    return {
      error: NextResponse.json({ error: 'Unknown module key' }, { status: 400 }),
    };
  }

  const ctx = await deps.getRouteClientFn(req);
  if ('error' in ctx) {
    return {
      error: NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 }),
    };
  }

  const { data: moduleRow, error: moduleLookupError } = await ctx.supabase
    .from('module_catalog')
    .select('module_key')
    .eq('module_key', normalizedModuleKey)
    .limit(1)
    .maybeSingle();

  if (moduleLookupError) {
    if (isRelationMissing(moduleLookupError)) {
      return {
        error: NextResponse.json(
          { error: 'Module entitlement tables are not available. Run migrations first.' },
          { status: 503 }
        ),
      };
    }
    return {
      error: NextResponse.json({ error: 'Failed to resolve module catalog' }, { status: 500 }),
    };
  }

  if (!moduleRow) {
    return {
      error: NextResponse.json({ error: `Module "${normalizedModuleKey}" is not configured` }, { status: 404 }),
    };
  }

  let isPlatformAdmin = false;
  try {
    isPlatformAdmin = await deps.isUserPlatformAdminFn(ctx.user.id);
  } catch (error) {
    if (isRelationMissing(error) || isFunctionMissing(error, 'is_platform_admin')) {
      return {
        error: NextResponse.json(
          { error: 'Platform entitlement tables are not available. Run migrations first.' },
          { status: 503 }
        ),
      };
    }
    return {
      error: NextResponse.json({ error: 'Failed to evaluate platform access' }, { status: 500 }),
    };
  }

  const orgContext = await deps.resolveUserOrgContextFn(req, {
    supabase: ctx.supabase,
    userId: ctx.user.id,
    jwtOrgId: ctx.user.app_metadata?.org_id ?? ctx.user.user_metadata?.org_id ?? null,
    preferredOrgId: options.preferredOrgId ?? null,
  });

  if (orgContext.errorCode === 'membership_query_failed') {
    return {
      ctx,
      moduleKey: normalizedModuleKey,
      orgId: null,
      isPlatformAdmin,
      allowed: false,
      reason: 'org_context_unavailable',
    };
  }

  if (orgContext.errorCode === 'requested_org_not_active') {
    return {
      ctx,
      moduleKey: normalizedModuleKey,
      orgId: null,
      isPlatformAdmin,
      allowed: false,
      reason: 'org_not_member',
    };
  }

  if (orgContext.error && orgContext.source !== 'none') {
    return {
      ctx,
      moduleKey: normalizedModuleKey,
      orgId: null,
      isPlatformAdmin,
      allowed: false,
      reason: 'invalid_org_context',
    };
  }

  const canUseCache = !options.bypassCache;
  const cacheOrgKey = orgContext.orgId ?? 'none';
  const cacheKey =
    options.cacheKeyOverride ??
    `${ctx.user.id}|${normalizedModuleKey}|${cacheOrgKey}|${isPlatformAdmin ? 'platform' : 'member'}|${
      options.allowPlatformBypass === false ? 'strict' : 'bypass'
    }`;

  if (canUseCache) {
    const cached = readCache(cacheKey);
    if (cached) {
      return { ...cached, ctx };
    }
  }

  if (isPlatformAdmin && options.allowPlatformBypass !== false) {
    const value: CachedModuleAccess = {
      moduleKey: normalizedModuleKey,
      orgId: orgContext.orgId,
      isPlatformAdmin: true,
      allowed: true,
      reason: 'platform_admin_bypass',
    };
    if (canUseCache) writeCache(cacheKey, value);
    return { ...value, ctx };
  }

  if (!orgContext.orgId) {
    const value: CachedModuleAccess = {
      moduleKey: normalizedModuleKey,
      orgId: null,
      isPlatformAdmin,
      allowed: false,
      reason: 'missing_org_context',
    };
    if (canUseCache) writeCache(cacheKey, value);
    return { ...value, ctx };
  }

  const { data, error } = await ctx.supabase.rpc('has_module_access', {
    p_module_key: normalizedModuleKey,
    p_org_id: orgContext.orgId,
  });

  if (error) {
    if (isRelationMissing(error) || isFunctionMissing(error, 'has_module_access')) {
      return {
        error: NextResponse.json(
          { error: 'Module entitlement function is unavailable. Run migrations first.' },
          { status: 503 }
        ),
      };
    }

    return {
      error: NextResponse.json({ error: 'Failed to evaluate module access' }, { status: 500 }),
    };
  }

  const allowed = Boolean(data);
  const value: CachedModuleAccess = {
    moduleKey: normalizedModuleKey,
    orgId: orgContext.orgId,
    isPlatformAdmin,
    allowed,
    reason: allowed ? 'enabled' : 'not_entitled',
  };
  if (canUseCache) writeCache(cacheKey, value);
  return { ...value, ctx };
}

type RequireOptions = EvaluateOptions & {
  forbiddenMessage?: string;
};

export async function requireModuleAccess(
  req: NextRequest,
  moduleKey: string,
  options: RequireOptions = {},
  deps: ModuleAccessDeps = defaultDeps
): Promise<ModuleAccessResult> {
  const evaluation = await evaluateModuleAccess(req, moduleKey, options, deps);
  if ('error' in evaluation) return evaluation;

  if (evaluation.allowed) {
    return evaluation;
  }

  return {
    error: NextResponse.json(
      {
        error:
          options.forbiddenMessage ??
          `Module "${evaluation.moduleKey}" is not enabled for your organization`,
        reason: evaluation.reason,
        module_key: evaluation.moduleKey,
        org_id: evaluation.orgId,
      },
      { status: 403 }
    ),
  };
}

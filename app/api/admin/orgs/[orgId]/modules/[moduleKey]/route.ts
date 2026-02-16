import { NextRequest, NextResponse } from 'next/server';

import { recordPlatformAudit, requirePlatformAdmin } from '@/lib/api/platform';
import { isKnownModuleKey } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BILLING_MODELS = new Set([
  'manual',
  'subscription',
  'paid_in_full',
  'trial',
  'yearly_license',
]);

const ENTITLEMENT_STATUSES = new Set(['active', 'grace', 'past_due', 'canceled', 'inactive']);

type UpdateEntitlementPayload = {
  enabled?: boolean;
  billing_model?: string | null;
  status?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  notes?: string | null;
  source?: string | null;
};

type ModuleCatalogRow = {
  module_key: string;
  module_name: string;
  dependency_keys: string[] | null;
};

function parseDateOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; moduleKey: string }> }
) {
  const admin = await requirePlatformAdmin(req);
  if ('error' in admin) return admin.error;

  const { orgId, moduleKey } = await params;

  if (!orgId || !UUID_REGEX.test(orgId.trim())) {
    return NextResponse.json({ error: 'Invalid orgId' }, { status: 400 });
  }
  if (!moduleKey || !isKnownModuleKey(moduleKey.trim().toLowerCase())) {
    return NextResponse.json({ error: 'Invalid moduleKey' }, { status: 400 });
  }

  let body: UpdateEntitlementPayload;
  try {
    body = (await req.json()) as UpdateEntitlementPayload;
  } catch (_err) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const normalizedModuleKey = moduleKey.trim().toLowerCase();

  const [{ data: moduleRow, error: moduleError }, { data: orgRow, error: orgError }, { data: current, error: currentError }] =
    await Promise.all([
      supabaseAdmin
        .from('module_catalog')
        .select('module_key, module_name, dependency_keys')
        .eq('module_key', normalizedModuleKey)
        .maybeSingle(),
      supabaseAdmin.from('organizations').select('id').eq('id', orgId).maybeSingle(),
      supabaseAdmin
        .from('organization_module_entitlements')
        .select('enabled, billing_model, status, starts_at, ends_at, notes')
        .eq('org_id', orgId)
        .eq('module_key', normalizedModuleKey)
        .maybeSingle(),
    ]);

  if (moduleError) {
    return NextResponse.json({ error: moduleError.message }, { status: 500 });
  }
  if (!moduleRow) {
    return NextResponse.json({ error: `Unknown module "${normalizedModuleKey}"` }, { status: 404 });
  }
  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 500 });
  }
  if (!orgRow) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  if (currentError) {
    return NextResponse.json({ error: currentError.message }, { status: 500 });
  }
  const moduleCatalogRow = moduleRow as ModuleCatalogRow;

  const enabled =
    typeof body.enabled === 'boolean' ? body.enabled : (current?.enabled ?? false);
  const billingModel = (body.billing_model ?? current?.billing_model ?? 'manual').trim();
  const status = (body.status ?? current?.status ?? 'active').trim();
  const startsAt = parseDateOrNull(body.starts_at ?? current?.starts_at ?? null);
  const endsAt = parseDateOrNull(body.ends_at ?? current?.ends_at ?? null);
  const notes = body.notes == null ? (current?.notes ?? null) : body.notes.trim() || null;
  const source = (body.source ?? 'platform-admin').trim() || 'platform-admin';

  if (!BILLING_MODELS.has(billingModel)) {
    return NextResponse.json({ error: 'Invalid billing_model' }, { status: 400 });
  }

  if (!ENTITLEMENT_STATUSES.has(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return NextResponse.json({ error: 'ends_at must be after starts_at' }, { status: 400 });
  }

  // Dependency enforcement:
  // - enabling a module requires its dependencies to be enabled first
  // - disabling a module is blocked while any enabled module depends on it
  const dependencies = (moduleCatalogRow.dependency_keys ?? []).filter(Boolean);
  if (enabled && dependencies.length > 0) {
    const { data: dependencyEntitlements, error: dependencyError } = await supabaseAdmin
      .from('organization_module_entitlements')
      .select('module_key, enabled, status')
      .eq('org_id', orgId)
      .in('module_key', dependencies);

    if (dependencyError) {
      return NextResponse.json({ error: dependencyError.message }, { status: 500 });
    }

    const enabledDependencies = new Set(
      (dependencyEntitlements ?? [])
        .filter((row) => row.enabled && (row.status === 'active' || row.status === 'grace'))
        .map((row) => row.module_key)
    );

    const missingDependencies = dependencies.filter((key) => !enabledDependencies.has(key));
    if (missingDependencies.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot enable "${normalizedModuleKey}" until dependencies are enabled`,
          module_key: normalizedModuleKey,
          missing_dependencies: missingDependencies,
        },
        { status: 409 }
      );
    }
  }

  if (!enabled) {
    const { data: dependentCatalogRows, error: dependentCatalogError } = await supabaseAdmin
      .from('module_catalog')
      .select('module_key, module_name, dependency_keys')
      .contains('dependency_keys', [normalizedModuleKey]);

    if (dependentCatalogError) {
      return NextResponse.json({ error: dependentCatalogError.message }, { status: 500 });
    }

    const dependentRows = (dependentCatalogRows ?? []) as ModuleCatalogRow[];
    const dependentKeys = dependentRows.map((row) => row.module_key);
    if (dependentKeys.length > 0) {
      const { data: dependentEntitlements, error: dependentEntitlementsError } = await supabaseAdmin
        .from('organization_module_entitlements')
        .select('module_key, enabled, status')
        .eq('org_id', orgId)
        .in('module_key', dependentKeys);

      if (dependentEntitlementsError) {
        return NextResponse.json({ error: dependentEntitlementsError.message }, { status: 500 });
      }

      const activeDependents = (dependentEntitlements ?? [])
        .filter((row) => row.enabled && (row.status === 'active' || row.status === 'grace'))
        .map((row) => {
          const dep = dependentRows.find((item) => item.module_key === row.module_key);
          return {
            module_key: row.module_key,
            module_name: dep?.module_name ?? row.module_key,
          };
        });

      if (activeDependents.length > 0) {
        return NextResponse.json(
          {
            error: `Cannot disable "${normalizedModuleKey}" while dependent modules are enabled`,
            module_key: normalizedModuleKey,
            dependent_modules: activeDependents,
          },
          { status: 409 }
        );
      }
    }
  }

  const payload = {
    org_id: orgId,
    module_key: normalizedModuleKey,
    enabled,
    billing_model: billingModel,
    status,
    starts_at: startsAt,
    ends_at: endsAt,
    notes,
    source,
    updated_by: admin.ctx.user.id,
  };

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('organization_module_entitlements')
    .upsert(payload, { onConflict: 'org_id,module_key' })
    .select(
      'org_id, module_key, enabled, billing_model, status, starts_at, ends_at, notes, source, updated_by, updated_at'
    )
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await recordPlatformAudit({
    actorUserId: admin.ctx.user.id,
    action: 'platform_module_entitlement_update',
    metadata: {
      org_id: orgId,
      module_key: normalizedModuleKey,
      module_name: moduleCatalogRow.module_name,
      enabled,
      billing_model: billingModel,
      status,
      starts_at: startsAt,
      ends_at: endsAt,
    },
  });

  return NextResponse.json({ success: true, entitlement: updated }, { status: 200 });
}

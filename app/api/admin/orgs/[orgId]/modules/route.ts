import { NextRequest, NextResponse } from 'next/server';

import { requirePlatformAdmin } from '@/lib/api/platform';
import { supabaseAdmin } from '@/lib/supabase-admin';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

type ModuleCatalogRow = {
  module_key: string;
  module_name: string;
  description: string | null;
  dependency_keys: string[] | null;
  is_core: boolean;
};

type EntitlementRow = {
  module_key: string;
  enabled: boolean;
  billing_model: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  source: string | null;
  notes: string | null;
  updated_at: string | null;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const admin = await requirePlatformAdmin(req);
  if ('error' in admin) return admin.error;

  const { orgId } = await params;
  if (!orgId || !isValidUuid(orgId)) {
    return NextResponse.json({ error: 'Invalid orgId' }, { status: 400 });
  }

  const [{ data: org, error: orgError }, { data: modules, error: modulesError }, { data: entitlements, error: entitlementsError }] =
    await Promise.all([
      supabaseAdmin.from('organizations').select('id, name').eq('id', orgId).maybeSingle(),
      supabaseAdmin
        .from('module_catalog')
        .select('module_key, module_name, description, dependency_keys, is_core')
        .order('module_name', { ascending: true }),
      supabaseAdmin
        .from('organization_module_entitlements')
        .select('module_key, enabled, billing_model, status, starts_at, ends_at, source, notes, updated_at')
        .eq('org_id', orgId),
    ]);

  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 500 });
  }
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  if (modulesError) {
    return NextResponse.json({ error: modulesError.message }, { status: 500 });
  }
  if (entitlementsError) {
    return NextResponse.json({ error: entitlementsError.message }, { status: 500 });
  }

  const entitlementByKey = new Map<string, EntitlementRow>(
    ((entitlements ?? []) as EntitlementRow[]).map((row) => [row.module_key, row])
  );

  const rows = ((modules ?? []) as ModuleCatalogRow[]).map((module) => {
    const entitlement = entitlementByKey.get(module.module_key);
    return {
      module_key: module.module_key,
      module_name: module.module_name,
      description: module.description,
      dependency_keys: module.dependency_keys ?? [],
      is_core: module.is_core,
      enabled: entitlement?.enabled ?? false,
      billing_model: entitlement?.billing_model ?? 'manual',
      status: entitlement?.status ?? 'inactive',
      starts_at: entitlement?.starts_at ?? null,
      ends_at: entitlement?.ends_at ?? null,
      source: entitlement?.source ?? null,
      notes: entitlement?.notes ?? null,
      updated_at: entitlement?.updated_at ?? null,
    };
  });

  return NextResponse.json({
    organization: org,
    org_id: orgId,
    entitlements: rows,
  });
}


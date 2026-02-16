import { NextRequest, NextResponse } from 'next/server';

import { evaluateModuleAccess } from '@/lib/api/module-access';
import { isKnownModuleKey } from '@/lib/modules/keys';

export async function GET(req: NextRequest) {
  const moduleKey = (req.nextUrl.searchParams.get('module') ?? '').trim().toLowerCase();
  if (!moduleKey || !isKnownModuleKey(moduleKey)) {
    return NextResponse.json({ error: 'Valid "module" query parameter is required' }, { status: 400 });
  }

  const preferredOrgId = (req.nextUrl.searchParams.get('org_id') ?? '').trim() || null;
  const result = await evaluateModuleAccess(req, moduleKey, { preferredOrgId });
  if ('error' in result) {
    return result.error;
  }

  return NextResponse.json({
    module_key: result.moduleKey,
    org_id: result.orgId,
    allowed: result.allowed,
    reason: result.reason,
    is_platform_admin: result.isPlatformAdmin,
  });
}

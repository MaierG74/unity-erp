import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function requireQuotesAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.QUOTING_PROPOSALS, {
    forbiddenMessage: 'Quoting module access is disabled for your organization',
  });

  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for quotes access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId };
}

export async function requireQuoteItemAccess(request: NextRequest, quoteItemId: string) {
  const auth = await requireQuotesAccess(request);
  if ('error' in auth) {
    return auth;
  }

  const { data: quoteItem, error } = await supabaseAdmin
    .from('quote_items')
    .select('id, quote_id, org_id')
    .eq('id', quoteItemId)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load quote item for cutlist access', error);
    return {
      error: NextResponse.json(
        { error: 'Failed to verify quote item access', details: error.message },
        { status: 500 }
      ),
    };
  }

  if (!quoteItem) {
    return {
      error: NextResponse.json({ error: 'Quote item not found' }, { status: 404 }),
    };
  }

  return {
    orgId: auth.orgId,
    quoteItemId: quoteItem.id as string,
    quoteId: quoteItem.quote_id as string,
  };
}

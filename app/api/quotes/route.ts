import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isQuoteStatus } from '@/lib/quotes/status';

async function requireQuotesAccess(request: NextRequest) {
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

// GET /api/quotes - list recent quotes
export async function GET(request: NextRequest) {
  const auth = await requireQuotesAccess(request);
  if ('error' in auth) return auth.error;

  try {
    const { data, error } = await supabaseAdmin
      .from('quotes')
      .select('id, quote_number, status, created_at, grand_total, customer_id, customer:customers(id, name)')
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to list quotes', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ quotes: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Unexpected error', details: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/quotes - create a new quote (server-side using service role to bypass RLS)
export async function POST(req: NextRequest) {
  const auth = await requireQuotesAccess(req);
  if ('error' in auth) return auth.error;

  try {
    const body = await req.json();
    const { quote_number, customer_id, contact_id, status = 'draft' } = body ?? {};

    if (!quote_number || !customer_id) {
      return NextResponse.json(
        { error: 'quote_number and customer_id are required' },
        { status: 400 }
      );
    }

    if (!isQuoteStatus(status)) {
      return NextResponse.json(
        { error: 'Invalid quote status' },
        { status: 400 }
      );
    }

    const insert: Record<string, unknown> = {
      quote_number,
      customer_id,
      status,
      org_id: auth.orgId,
    };
    if (contact_id) insert.contact_id = contact_id;

    const { data: newQuote, error } = await supabaseAdmin
      .from('quotes')
      .insert([insert])
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to create quote', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ quote: newQuote }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Unexpected error', details: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

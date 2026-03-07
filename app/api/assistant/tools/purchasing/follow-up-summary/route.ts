import { NextRequest, NextResponse } from 'next/server';

import { getSupplierOrdersFollowUpSummary } from '@/lib/assistant/purchasing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const summary = await getSupplierOrdersFollowUpSummary(ctx.supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][purchasing][follow-up-summary] Failed to load follow-up summary', error);
    return NextResponse.json({ error: 'Failed to load supplier follow-up summary' }, { status: 500 });
  }
}

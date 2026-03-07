import { NextRequest, NextResponse } from 'next/server';

import { getLateSupplierOrdersSummary } from '@/lib/assistant/purchasing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const summary = await getLateSupplierOrdersSummary(ctx.supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][purchasing][late-summary] Failed to load late supplier order summary', error);
    return NextResponse.json({ error: 'Failed to load late supplier order summary' }, { status: 500 });
  }
}

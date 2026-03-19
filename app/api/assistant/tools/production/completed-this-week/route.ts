import { NextRequest, NextResponse } from 'next/server';

import { getOrdersCompletedThisWeekSummary } from '@/lib/assistant/manufacturing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const summary = await getOrdersCompletedThisWeekSummary(ctx.supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][production][completed-this-week] Failed to load completed-this-week summary', error);
    return NextResponse.json({ error: 'Failed to load completed-this-week summary' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

import { getUnassignedProductionWorkSummary } from '@/lib/assistant/manufacturing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const summary = await getUnassignedProductionWorkSummary(ctx.supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][production][unassigned-work] Failed to load unassigned production work summary', error);
    return NextResponse.json({ error: 'Failed to load unassigned production work summary' }, { status: 500 });
  }
}

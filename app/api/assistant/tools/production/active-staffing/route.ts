import { NextRequest, NextResponse } from 'next/server';

import { getProductionStaffingSummary } from '@/lib/assistant/manufacturing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const summary = await getProductionStaffingSummary(ctx.supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][production][active-staffing] Failed to load production staffing summary', error);
    return NextResponse.json({ error: 'Failed to load production staffing summary' }, { status: 500 });
  }
}

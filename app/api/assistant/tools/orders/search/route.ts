import { NextRequest, NextResponse } from 'next/server';

import {
  detectOrderSearchMode,
  getOrderSearchSummary,
} from '@/lib/assistant/operational';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const query = req.nextUrl.searchParams.get('q')?.trim();
  if (!query) {
    return NextResponse.json({ error: 'q is required' }, { status: 400 });
  }

  try {
    const modeParam = req.nextUrl.searchParams.get('mode')?.trim().toLowerCase();
    const mode =
      modeParam === 'starts_with' || modeParam === 'contains'
        ? modeParam
        : detectOrderSearchMode(query);
    const summary = await getOrderSearchSummary(ctx.supabase, query, mode);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][orders][search] Failed to load order search summary', error);
    return NextResponse.json({ error: 'Failed to load order search summary' }, { status: 500 });
  }
}

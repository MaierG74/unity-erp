import { NextRequest, NextResponse } from 'next/server';

import {
  getOrdersLast7DaysSummary,
  resolveOpenOrdersCustomer,
} from '@/lib/assistant/operational';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const customerRef = req.nextUrl.searchParams.get('customer')?.trim();
    if (customerRef) {
      const resolvedCustomer = await resolveOpenOrdersCustomer(ctx.supabase, customerRef);
      if (resolvedCustomer.kind === 'ambiguous') {
        return NextResponse.json(
          { error: `Multiple customers match "${customerRef}".`, candidates: resolvedCustomer.candidates },
          { status: 409 }
        );
      }

      if (resolvedCustomer.kind === 'not_found') {
        return NextResponse.json(
          { error: `No customer matches "${customerRef}".` },
          { status: 404 }
        );
      }

      const summary = await getOrdersLast7DaysSummary(
        ctx.supabase,
        resolvedCustomer.customer_name
      );
      return NextResponse.json(summary);
    }

    const summary = await getOrdersLast7DaysSummary(ctx.supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][orders][last-seven-days] Failed to load recent orders summary', error);
    return NextResponse.json({ error: 'Failed to load recent orders summary' }, { status: 500 });
  }
}

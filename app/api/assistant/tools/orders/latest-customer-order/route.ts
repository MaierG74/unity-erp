import { NextRequest, NextResponse } from 'next/server';

import {
  getLastCustomerOrderSummary,
  resolveOpenOrdersCustomer,
} from '@/lib/assistant/operational';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const customerRef = req.nextUrl.searchParams.get('customer')?.trim();
  if (!customerRef) {
    return NextResponse.json({ error: 'customer is required' }, { status: 400 });
  }

  try {
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

    const summary = await getLastCustomerOrderSummary(
      ctx.supabase,
      resolvedCustomer.customer_name
    );
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][orders][latest-customer-order] Failed to load latest customer order', error);
    return NextResponse.json({ error: 'Failed to load latest customer order' }, { status: 500 });
  }
}

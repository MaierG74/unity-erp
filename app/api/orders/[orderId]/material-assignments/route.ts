import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { validateAssignments } from '@/lib/orders/material-assignment-types';
import { markCuttingPlanStale } from '@/lib/orders/cutting-plan-utils';

type RouteParams = { orderId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await getRouteClient(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { orderId } = await context.params;
  const orderIdNum = Number(orderId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('orders')
    .select('material_assignments')
    .eq('order_id', orderIdNum)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data?.material_assignments ?? null);
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await getRouteClient(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { orderId } = await context.params;
  const orderIdNum = Number(orderId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const validationError = validateAssignments(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from('orders')
    .update({ material_assignments: body })
    .eq('order_id', orderIdNum);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mark cutting plan stale so purchasing doesn't use outdated overrides.
  // If this fails, roll back is not possible (assignment already saved), but
  // we must NOT return 200 — the client needs to know stale-marking failed.
  try {
    await markCuttingPlanStale(orderIdNum, auth.supabase);
  } catch (staleErr) {
    return NextResponse.json(
      { error: 'Assignments saved but failed to mark cutting plan stale. Please re-generate the plan.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

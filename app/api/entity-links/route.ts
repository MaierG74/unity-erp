import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRouteClient } from '@/lib/supabase-route';

const DEFAULT_LIMIT = 20;

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.trim() ?? '';
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : DEFAULT_LIMIT;

  try {
    const likeTerm = `%${search}%`;

    const ordersPromise = supabaseAdmin
      .from('orders')
      .select(
        `order_id, order_number, created_at, delivery_date, customer:customers(name), status:order_statuses(status_name)`
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (search) {
      ordersPromise.or(`order_number.ilike.${likeTerm},customer.name.ilike.${likeTerm}`);
    }

    const supplierOrdersPromise = supabaseAdmin
      .from('supplier_orders')
      .select(
        `order_id, order_date, supplier:suppliers(name), status:supplier_order_statuses(status_name)`
      )
      .order('order_date', { ascending: false })
      .limit(limit);

    if (search) {
      supplierOrdersPromise.or(`order_id::text.ilike.${likeTerm},supplier.name.ilike.${likeTerm}`);
    }

    const quotesPromise = supabaseAdmin
      .from('quotes')
      .select(`id, quote_number, created_at, status, customer:customers(name)`) // rely on quoting module tables
      .order('created_at', { ascending: false })
      .limit(limit);

    if (search) {
      quotesPromise.or(`quote_number.ilike.${likeTerm},customer.name.ilike.${likeTerm}`);
    }

    const [{ data: orders, error: ordersError }, { data: supplierOrders, error: supplierError }, { data: quotes, error: quotesError }] =
      await Promise.all([ordersPromise, supplierOrdersPromise, quotesPromise]);

    if (ordersError) throw ordersError;
    if (supplierError) throw supplierError;
    if (quotesError) throw quotesError;

    const mappedOrders = (orders ?? []).map(order => ({
      type: 'order' as const,
      id: String(order.order_id),
      path: `/orders/${order.order_id}`,
      label: order.order_number || `Order #${order.order_id}`,
      meta: {
        customer: order.customer?.name ?? null,
        status: order.status?.status_name ?? order.status ?? null,
        createdAt: order.created_at ?? null,
        deliveryDate: order.delivery_date ?? null,
      },
    }));

    const mappedSupplierOrders = (supplierOrders ?? []).map(po => ({
      type: 'supplier_order' as const,
      id: String(po.order_id),
      path: `/purchasing/purchase-orders/${po.order_id}`,
      label: `Supplier Order #${po.order_id}`,
      meta: {
        supplier: po.supplier?.name ?? null,
        status: po.status?.status_name ?? po.status ?? null,
        orderDate: po.order_date ?? null,
      },
    }));

    const mappedQuotes = (quotes ?? []).map(quote => ({
      type: 'quote' as const,
      id: quote.id,
      path: `/quotes/${quote.id}`,
      label: quote.quote_number || 'Quote',
      meta: {
        customer: quote.customer?.name ?? null,
        status: quote.status ?? null,
        createdAt: quote.created_at ?? null,
      },
    }));

    return NextResponse.json({ orders: mappedOrders, supplierOrders: mappedSupplierOrders, quotes: mappedQuotes });
  } catch (error) {
    console.error('[entity-links][GET] Failed to load entity links', error);
    return NextResponse.json({ error: 'Failed to load entity links' }, { status: 500 });
  }
}

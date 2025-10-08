import { NextRequest, NextResponse } from 'next/server';

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

    // Build orders query
    let ordersQuery = ctx.supabase
      .from('orders')
      .select('order_id, order_number, created_at, delivery_date, customer_id, customers(name), order_statuses(status_name)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (search) {
      ordersQuery = ordersQuery.or(`order_number.ilike.${likeTerm}`);
    }

    // Build supplier orders query - get supplier through suppliercomponents relationship
    const supplierOrdersQuery = ctx.supabase
      .from('supplier_orders')
      .select('order_id, order_date, supplier_component_id, suppliercomponents(supplier_id, suppliers(name)), supplier_order_statuses(status_name)')
      .order('order_date', { ascending: false })
      .limit(limit);

    // Build quotes query
    let quotesQuery = ctx.supabase
      .from('quotes')
      .select('id, quote_number, created_at, status, customer_id, customers(name)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (search) {
      quotesQuery = quotesQuery.or(`quote_number.ilike.${likeTerm}`);
    }

    const [{ data: orders, error: ordersError }, { data: supplierOrders, error: supplierError }, { data: quotes, error: quotesError }] =
      await Promise.all([ordersQuery, supplierOrdersQuery, quotesQuery]);

    if (ordersError) {
      console.error('[entity-links][GET] Orders query failed:', ordersError);
      throw ordersError;
    }
    if (supplierError) {
      console.error('[entity-links][GET] Supplier orders query failed:', supplierError);
      throw supplierError;
    }
    if (quotesError) {
      console.error('[entity-links][GET] Quotes query failed:', quotesError);
      throw quotesError;
    }

    const mappedOrders = (orders ?? []).map((order: any) => ({
      type: 'order' as const,
      id: String(order.order_id),
      path: `/orders/${order.order_id}`,
      label: order.order_number || `Order #${order.order_id}`,
      meta: {
        customer: order.customers?.name ?? null,
        status: order.order_statuses?.status_name ?? null,
        createdAt: order.created_at ?? null,
        deliveryDate: order.delivery_date ?? null,
      },
    }));

    const mappedSupplierOrders = (supplierOrders ?? []).map((po: any) => ({
      type: 'supplier_order' as const,
      id: String(po.order_id),
      path: `/purchasing/purchase-orders/${po.order_id}`,
      label: `Supplier Order #${po.order_id}`,
      meta: {
        supplier: po.suppliercomponents?.suppliers?.name ?? null,
        status: po.supplier_order_statuses?.status_name ?? null,
        orderDate: po.order_date ?? null,
      },
    }));

    const mappedQuotes = (quotes ?? []).map((quote: any) => ({
      type: 'quote' as const,
      id: quote.id,
      path: `/quotes/${quote.id}`,
      label: quote.quote_number || 'Quote',
      meta: {
        customer: quote.customers?.name ?? null,
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

import { NextRequest, NextResponse } from 'next/server';

import { getRouteClient } from '@/lib/supabase-route';

const DEFAULT_LIMIT = 20;

type QueryResult<T> = { data: T[] | null; error: { message?: string } | null };

type OrderRow = {
  order_id: number;
  order_number: string | null;
  created_at: string | null;
  delivery_date: string | null;
  customer_id: number | null;
  customers?: { name?: string | null } | Array<{ name?: string | null }> | null;
  order_statuses?: { status_name?: string | null } | Array<{ status_name?: string | null }> | null;
};

type QuoteRow = {
  id: string;
  quote_number: string | null;
  created_at: string | null;
  status: string | null;
  customer_id: number | null;
  customers?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type SupplierOrderRow = {
  order_id: number;
  order_date: string | null;
  order_quantity: number | string | null;
  total_received: number | string | null;
  purchase_order_id: number | null;
  purchase_order?:
    | {
        purchase_order_id?: number | null;
        q_number?: string | null;
        supplier?: { name?: string | null } | Array<{ name?: string | null }> | null;
      }
    | Array<{
        purchase_order_id?: number | null;
        q_number?: string | null;
        supplier?: { name?: string | null } | Array<{ name?: string | null }> | null;
      }>
    | null;
  suppliercomponents?:
    | {
        supplier_code?: string | null;
        component?:
          | { internal_code?: string | null; description?: string | null }
          | Array<{ internal_code?: string | null; description?: string | null }>
          | null;
      }
    | Array<{
        supplier_code?: string | null;
        component?:
          | { internal_code?: string | null; description?: string | null }
          | Array<{ internal_code?: string | null; description?: string | null }>
          | null;
      }>
    | null;
  supplier_order_statuses?:
    | { status_name?: string | null }
    | Array<{ status_name?: string | null }>
    | null;
};

type CustomerRow = {
  id: number;
  name: string | null;
  email: string | null;
  telephone: string | null;
};

type ProductRow = {
  product_id: number;
  name: string | null;
  internal_code?: string | null;
  description?: string | null;
};

function emptyResult<T>(): Promise<QueryResult<T>> {
  return Promise.resolve({ data: [], error: null });
}

function extractSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizeText(value: string | number | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function compareDateDesc(a: string | null | undefined, b: string | null | undefined): number {
  const aValue = a ? Date.parse(a) : Number.NaN;
  const bValue = b ? Date.parse(b) : Number.NaN;

  if (Number.isFinite(aValue) && Number.isFinite(bValue)) {
    return bValue - aValue;
  }

  if (Number.isFinite(aValue)) {
    return -1;
  }

  if (Number.isFinite(bValue)) {
    return 1;
  }

  return 0;
}

function getMatchScore(search: string, candidates: Array<string | number | null | undefined>): number {
  const needle = normalizeText(search);
  if (!needle) {
    return 0;
  }

  let bestScore = 0;

  for (const candidate of candidates) {
    const value = normalizeText(candidate);
    if (!value) {
      continue;
    }

    if (value === needle) {
      bestScore = Math.max(bestScore, 600);
      continue;
    }

    if (value.startsWith(needle)) {
      bestScore = Math.max(bestScore, 450);
    }

    const tokenMatch = value
      .split(/[\s\-_/]+/)
      .some(token => token.startsWith(needle));
    if (tokenMatch) {
      bestScore = Math.max(bestScore, 300);
    }

    if (value.includes(needle)) {
      bestScore = Math.max(bestScore, 150);
    }
  }

  return bestScore;
}

function sortBySearch<T>(
  rows: T[],
  search: string,
  getCandidates: (row: T) => Array<string | number | null | undefined>,
  getDate?: (row: T) => string | null | undefined,
) {
  return [...rows].sort((a, b) => {
    const scoreDiff = getMatchScore(search, getCandidates(b)) - getMatchScore(search, getCandidates(a));
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    if (getDate) {
      const dateDiff = compareDateDesc(getDate(a), getDate(b));
      if (dateDiff !== 0) {
        return dateDiff;
      }
    }

    const aLabel = normalizeText(getCandidates(a)[0]);
    const bLabel = normalizeText(getCandidates(b)[0]);
    return aLabel.localeCompare(bLabel);
  });
}

function assertNoError(name: string, error: { message?: string } | null) {
  if (error) {
    console.error(`[entity-links][GET] ${name} query failed:`, error);
    throw new Error(error.message ?? `${name} query failed`);
  }
}

function buildOrderQuery(supabase: any, limit: number) {
  return supabase
    .from('orders')
    .select('order_id, order_number, created_at, delivery_date, customer_id, customers(name), order_statuses(status_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
}

function buildQuoteQuery(supabase: any, limit: number) {
  return supabase
    .from('quotes')
    .select('id, quote_number, created_at, status, customer_id, customers(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
}

function buildSupplierOrderQuery(supabase: any, limit: number) {
  return supabase
    .from('supplier_orders')
    .select(`
      order_id,
      order_date,
      order_quantity,
      total_received,
      purchase_order_id,
      purchase_order:purchase_orders(
        purchase_order_id,
        q_number,
        supplier:suppliers(name)
      ),
      suppliercomponents(
        supplier_code,
        component:components(internal_code, description)
      ),
      supplier_order_statuses(status_name)
    `)
    .order('order_date', { ascending: false })
    .limit(limit);
}

function buildProductLabel(product: ProductRow) {
  const name = product.name?.trim();
  const code = product.internal_code?.trim();

  if (name && code && code.toLowerCase() !== name.toLowerCase()) {
    return `${name} (${code})`;
  }

  if (name) {
    return name;
  }

  if (code) {
    return code;
  }

  return `Product #${product.product_id}`;
}

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const url = new URL(req.url);
  const search = url.searchParams.get('q')?.trim() ?? '';
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : DEFAULT_LIMIT;
  const likeTerm = `%${search}%`;
  const numericSearch = /^\d+$/.test(search) ? Number(search) : null;
  const shouldSearchCatalog = search.length > 0;

  try {
    const [
      customerSearchResult,
      supplierSearchResult,
      productNameSearchResult,
      productCodeSearchResult,
      purchaseOrderNumberSearchResult,
    ] = await Promise.all([
      search
        ? ctx.supabase
            .from('customers')
            .select('id, name, email, telephone')
            .ilike('name', likeTerm)
            .order('name', { ascending: true })
            .limit(limit)
        : emptyResult<CustomerRow>(),
      search
        ? ctx.supabase
            .from('suppliers')
            .select('supplier_id, name')
            .ilike('name', likeTerm)
            .order('name', { ascending: true })
            .limit(limit)
        : emptyResult<{ supplier_id: number; name: string | null }>(),
      shouldSearchCatalog
        ? ctx.supabase
            .from('products')
            .select('product_id, name, internal_code, description')
            .ilike('name', likeTerm)
            .order('name', { ascending: true })
            .limit(limit)
        : emptyResult<ProductRow>(),
      shouldSearchCatalog
        ? ctx.supabase
            .from('products')
            .select('product_id, name, internal_code, description')
            .ilike('internal_code', likeTerm)
            .order('name', { ascending: true })
            .limit(limit)
        : emptyResult<ProductRow>(),
      search
        ? ctx.supabase
            .from('purchase_orders')
            .select('purchase_order_id, q_number, supplier_id, supplier:suppliers(name)')
            .ilike('q_number', likeTerm)
            .order('purchase_order_id', { ascending: false })
            .limit(limit)
        : emptyResult<{
            purchase_order_id: number;
            q_number: string | null;
            supplier_id: number | null;
            supplier?: { name?: string | null } | Array<{ name?: string | null }> | null;
          }>(),
    ]);

    assertNoError('Customers', customerSearchResult.error);
    assertNoError('Suppliers', supplierSearchResult.error);
    assertNoError('Products by name', productNameSearchResult.error);
    assertNoError('Products by code', productCodeSearchResult.error);
    assertNoError('Purchase orders by number', purchaseOrderNumberSearchResult.error);

    const matchedCustomerIds = uniqueBy(customerSearchResult.data ?? [], row => String(row.id)).map(row => row.id);
    const matchedSupplierIds = uniqueBy(supplierSearchResult.data ?? [], row => String(row.supplier_id)).map(
      row => row.supplier_id,
    );

    const purchaseOrdersBySupplierResult =
      matchedSupplierIds.length > 0
        ? await ctx.supabase
            .from('purchase_orders')
            .select('purchase_order_id, q_number, supplier_id, supplier:suppliers(name)')
            .in('supplier_id', matchedSupplierIds)
            .order('purchase_order_id', { ascending: false })
            .limit(limit)
        : await emptyResult<{
            purchase_order_id: number;
            q_number: string | null;
            supplier_id: number | null;
            supplier?: { name?: string | null } | Array<{ name?: string | null }> | null;
          }>();

    assertNoError('Purchase orders by supplier', purchaseOrdersBySupplierResult.error);

    const matchedPurchaseOrderIds = uniqueBy(
      [...(purchaseOrderNumberSearchResult.data ?? []), ...(purchaseOrdersBySupplierResult.data ?? [])],
      row => String(row.purchase_order_id),
    ).map(row => row.purchase_order_id);

    const [
      ordersByNumberResult,
      ordersByCustomerResult,
      recentOrdersResult,
      quotesByNumberResult,
      quotesByCustomerResult,
      recentQuotesResult,
      supplierOrdersByLineIdResult,
      supplierOrdersByPurchaseOrderResult,
      recentSupplierOrdersResult,
    ] = await Promise.all([
      search
        ? buildOrderQuery(ctx.supabase, limit).ilike('order_number', likeTerm)
        : emptyResult<OrderRow>(),
      matchedCustomerIds.length > 0
        ? buildOrderQuery(ctx.supabase, limit).in('customer_id', matchedCustomerIds)
        : emptyResult<OrderRow>(),
      search ? emptyResult<OrderRow>() : buildOrderQuery(ctx.supabase, limit),
      search
        ? buildQuoteQuery(ctx.supabase, limit).ilike('quote_number', likeTerm)
        : emptyResult<QuoteRow>(),
      matchedCustomerIds.length > 0
        ? buildQuoteQuery(ctx.supabase, limit).in('customer_id', matchedCustomerIds)
        : emptyResult<QuoteRow>(),
      search ? emptyResult<QuoteRow>() : buildQuoteQuery(ctx.supabase, limit),
      numericSearch !== null
        ? buildSupplierOrderQuery(ctx.supabase, limit).eq('order_id', numericSearch)
        : emptyResult<SupplierOrderRow>(),
      matchedPurchaseOrderIds.length > 0
        ? buildSupplierOrderQuery(ctx.supabase, limit).in('purchase_order_id', matchedPurchaseOrderIds)
        : emptyResult<SupplierOrderRow>(),
      search ? emptyResult<SupplierOrderRow>() : buildSupplierOrderQuery(ctx.supabase, limit),
    ]);

    assertNoError('Orders by number', ordersByNumberResult.error);
    assertNoError('Orders by customer', ordersByCustomerResult.error);
    assertNoError('Recent orders', recentOrdersResult.error);
    assertNoError('Quotes by number', quotesByNumberResult.error);
    assertNoError('Quotes by customer', quotesByCustomerResult.error);
    assertNoError('Recent quotes', recentQuotesResult.error);
    assertNoError('Supplier orders by line id', supplierOrdersByLineIdResult.error);
    assertNoError('Supplier orders by purchase order', supplierOrdersByPurchaseOrderResult.error);
    assertNoError('Recent supplier orders', recentSupplierOrdersResult.error);

    const orderRows = sortBySearch(
      uniqueBy(
        [
          ...(recentOrdersResult.data ?? []),
          ...(ordersByNumberResult.data ?? []),
          ...(ordersByCustomerResult.data ?? []),
        ],
        row => String(row.order_id),
      ),
      search,
      row => [
        row.order_number,
        extractSingle(row.customers)?.name,
        row.order_id,
      ],
      row => row.created_at ?? row.delivery_date,
    ).slice(0, limit);

    const quoteRows = sortBySearch(
      uniqueBy(
        [
          ...(recentQuotesResult.data ?? []),
          ...(quotesByNumberResult.data ?? []),
          ...(quotesByCustomerResult.data ?? []),
        ],
        row => String(row.id),
      ),
      search,
      row => [
        row.quote_number,
        extractSingle(row.customers)?.name,
      ],
      row => row.created_at,
    ).slice(0, limit);

    const supplierOrderRows = sortBySearch(
      uniqueBy(
        [
          ...(recentSupplierOrdersResult.data ?? []),
          ...(supplierOrdersByLineIdResult.data ?? []),
          ...(supplierOrdersByPurchaseOrderResult.data ?? []),
        ],
        row => String(row.order_id),
      ),
      search,
      row => {
        const purchaseOrder = extractSingle(row.purchase_order);
        const supplier = extractSingle(purchaseOrder?.supplier)?.name;
        const supplierComponent = extractSingle(row.suppliercomponents);
        const component = extractSingle(supplierComponent?.component);

        return [
          row.order_id,
          purchaseOrder?.q_number,
          supplier,
          component?.internal_code,
          component?.description,
        ];
      },
      row => row.order_date,
    ).slice(0, limit);

    const customerRows = sortBySearch(
      uniqueBy(customerSearchResult.data ?? [], row => String(row.id)),
      search,
      row => [row.name, row.email, row.id],
    ).slice(0, limit);

    const productRows = sortBySearch(
      uniqueBy(
        [...(productNameSearchResult.data ?? []), ...(productCodeSearchResult.data ?? [])],
        row => String(row.product_id),
      ),
      search,
      row => [row.name, row.internal_code, row.description, row.product_id],
    ).slice(0, limit);

    const mappedOrders = orderRows.map(order => {
      const customer = extractSingle(order.customers)?.name?.trim() ?? null;
      const status = extractSingle(order.order_statuses)?.status_name?.trim() ?? null;
      const label = order.order_number?.trim() || `Order #${order.order_id}`;

      return {
        type: 'order' as const,
        id: String(order.order_id),
        path: `/orders/${order.order_id}`,
        label,
        meta: {
          customer,
          status,
          createdAt: order.created_at ?? null,
          deliveryDate: order.delivery_date ?? null,
          orderId: order.order_id,
        },
      };
    });

    const mappedSupplierOrders = supplierOrderRows.map(order => {
      const purchaseOrder = extractSingle(order.purchase_order);
      const supplier = extractSingle(purchaseOrder?.supplier)?.name?.trim() ?? null;
      const supplierComponent = extractSingle(order.suppliercomponents);
      const component = extractSingle(supplierComponent?.component);
      const status = extractSingle(order.supplier_order_statuses)?.status_name?.trim() ?? null;
      const purchaseOrderId = purchaseOrder?.purchase_order_id ?? order.purchase_order_id ?? null;
      const purchaseOrderNumber = purchaseOrder?.q_number?.trim() || (purchaseOrderId ? `PO #${purchaseOrderId}` : null);

      return {
        type: 'supplier_order' as const,
        id: String(order.order_id),
        path: purchaseOrderId ? `/purchasing/purchase-orders/${purchaseOrderId}` : `/purchasing/purchase-orders/${order.order_id}`,
        label: purchaseOrderNumber || `Supplier Order #${order.order_id}`,
        meta: {
          supplier,
          status,
          orderDate: order.order_date ?? null,
          orderId: order.order_id,
          purchaseOrderId,
          purchaseOrderNumber,
          componentCode: component?.internal_code?.trim() ?? supplierComponent?.supplier_code?.trim() ?? null,
          componentDescription: component?.description?.trim() ?? null,
          orderedQuantity: order.order_quantity ?? null,
          receivedQuantity: order.total_received ?? null,
        },
      };
    });

    const mappedQuotes = quoteRows.map(quote => {
      const customer = extractSingle(quote.customers)?.name?.trim() ?? null;
      const label = quote.quote_number?.trim() || `Quote ${quote.id}`;

      return {
        type: 'quote' as const,
        id: quote.id,
        path: `/quotes/${quote.id}`,
        label,
        meta: {
          customer,
          status: quote.status ?? null,
          createdAt: quote.created_at ?? null,
        },
      };
    });

    const mappedCustomers = customerRows.map(customer => ({
      type: 'customer' as const,
      id: String(customer.id),
      path: `/customers/${customer.id}`,
      label: customer.name?.trim() || `Customer #${customer.id}`,
      meta: {
        customerId: customer.id,
        email: customer.email?.trim() ?? null,
        telephone: customer.telephone?.trim() ?? null,
      },
    }));

    const mappedProducts = productRows.map(product => ({
      type: 'product' as const,
      id: String(product.product_id),
      path: `/products/${product.product_id}`,
      label: buildProductLabel(product),
      meta: {
        productId: product.product_id,
        internalCode: product.internal_code?.trim() ?? null,
        description: product.description?.trim() ?? null,
      },
    }));

    return NextResponse.json({
      orders: mappedOrders,
      supplierOrders: mappedSupplierOrders,
      quotes: mappedQuotes,
      customers: mappedCustomers,
      products: mappedProducts,
    });
  } catch (error) {
    console.error('[entity-links][GET] Failed to load entity links', error);
    return NextResponse.json({ error: 'Failed to load entity links' }, { status: 500 });
  }
}

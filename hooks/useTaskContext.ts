// hooks/useTaskContext.ts
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export interface TaskContext {
  contextType: string;
  contextId: string;
  contextPath: string;
  contextLabel: string;
  contextSnapshot?: Record<string, unknown>;
}

const ID_PATTERN = '([0-9a-f-]{36}|\\d+)';

type RoutePattern = {
  pattern: RegExp;
  type: string;
  table: string;
  idCol: string;
  select: string;
  buildFallbackLabel: (id: string) => string;
  buildContext: (row: any, id: string, pathname: string) => TaskContext;
};

function extractSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function buildOrderLabel(orderNumber: string | null | undefined, customer: string | null | undefined, fallbackId: string) {
  const orderLabel = orderNumber?.trim() || `Order #${fallbackId}`;
  const customerLabel = customer?.trim();
  return customerLabel ? `${orderLabel} - ${customerLabel}` : orderLabel;
}

function buildQuoteLabel(quoteNumber: string | null | undefined, customer: string | null | undefined, fallbackId: string) {
  const quoteLabel = quoteNumber?.trim() || `Quote ${fallbackId}`;
  const customerLabel = customer?.trim();
  return customerLabel ? `${quoteLabel} - ${customerLabel}` : quoteLabel;
}

function buildSupplierOrderLabel(poNumber: string | null | undefined, supplier: string | null | undefined, fallbackId: string) {
  const purchaseOrderLabel = poNumber?.trim() || `PO #${fallbackId}`;
  const supplierLabel = supplier?.trim();
  return supplierLabel ? `${purchaseOrderLabel} - ${supplierLabel}` : purchaseOrderLabel;
}

function buildProductLabel(name: string | null | undefined, internalCode: string | null | undefined, fallbackId: string) {
  const productName = name?.trim();
  const productCode = internalCode?.trim();

  if (productName && productCode && productCode.toLowerCase() !== productName.toLowerCase()) {
    return `${productName} (${productCode})`;
  }

  if (productName) {
    return productName;
  }

  if (productCode) {
    return productCode;
  }

  return `Product #${fallbackId}`;
}

function coerceContextRecordId(id: string) {
  return /^\d+$/.test(id) ? Number(id) : id;
}

const ROUTE_PATTERNS: RoutePattern[] = [
  {
    pattern: new RegExp(`^\\/orders\\/${ID_PATTERN}`),
    type: 'order',
    table: 'orders',
    idCol: 'order_id',
    select: 'order_id, order_number, delivery_date, customers(name), order_statuses(status_name)',
    buildFallbackLabel: (id) => `Order #${id}`,
    buildContext: (row, id, pathname) => {
      const customer = extractSingle(row.customers)?.name?.trim() ?? null;
      const status = extractSingle(row.order_statuses)?.status_name?.trim() ?? null;
      const orderNumber = row.order_number?.trim() ?? null;
      const label = buildOrderLabel(orderNumber, customer, id);

      return {
        contextType: 'order',
        contextId: id,
        contextPath: pathname,
        contextLabel: label,
        contextSnapshot: {
          label,
          customer,
          status,
          deliveryDate: row.delivery_date ?? null,
          orderId: row.order_id ?? coerceContextRecordId(id),
          orderNumber,
        },
      };
    },
  },
  {
    pattern: new RegExp(`^\\/purchasing\\/purchase-orders\\/${ID_PATTERN}`),
    type: 'supplier_order',
    table: 'purchase_orders',
    idCol: 'purchase_order_id',
    select: 'purchase_order_id, q_number, supplier:suppliers(name)',
    buildFallbackLabel: (id) => `PO #${id}`,
    buildContext: (row, id, pathname) => {
      const supplier = extractSingle(row.supplier)?.name?.trim() ?? null;
      const purchaseOrderNumber = row.q_number?.trim() ?? null;
      const label = buildSupplierOrderLabel(purchaseOrderNumber, supplier, id);

      return {
        contextType: 'supplier_order',
        contextId: id,
        contextPath: pathname,
        contextLabel: label,
        contextSnapshot: {
          label,
          supplier,
          purchaseOrderId: row.purchase_order_id ?? coerceContextRecordId(id),
          purchaseOrderNumber,
        },
      };
    },
  },
  {
    pattern: new RegExp(`^\\/quotes\\/${ID_PATTERN}`),
    type: 'quote',
    table: 'quotes',
    idCol: 'id',
    select: 'id, quote_number, status, customers(name)',
    buildFallbackLabel: (id) => `Quote ${id}`,
    buildContext: (row, id, pathname) => {
      const customer = extractSingle(row.customers)?.name?.trim() ?? null;
      const quoteNumber = row.quote_number?.trim() ?? null;
      const label = buildQuoteLabel(quoteNumber, customer, id);

      return {
        contextType: 'quote',
        contextId: id,
        contextPath: pathname,
        contextLabel: label,
        contextSnapshot: {
          label,
          customer,
          status: row.status ?? null,
          quoteNumber,
        },
      };
    },
  },
  {
    pattern: new RegExp(`^\\/customers\\/${ID_PATTERN}`),
    type: 'customer',
    table: 'customers',
    idCol: 'id',
    select: 'id, name, email, telephone',
    buildFallbackLabel: (id) => `Customer #${id}`,
    buildContext: (row, id, pathname) => {
      const label = row.name?.trim() || `Customer #${id}`;

      return {
        contextType: 'customer',
        contextId: id,
        contextPath: pathname,
        contextLabel: label,
        contextSnapshot: {
          label,
          customerId: row.id ?? coerceContextRecordId(id),
          email: row.email?.trim() ?? null,
          telephone: row.telephone?.trim() ?? null,
        },
      };
    },
  },
  {
    pattern: new RegExp(`^\\/products\\/${ID_PATTERN}`),
    type: 'product',
    table: 'products',
    idCol: 'product_id',
    select: 'product_id, name, internal_code, description',
    buildFallbackLabel: (id) => `Product #${id}`,
    buildContext: (row, id, pathname) => {
      const label = buildProductLabel(row.name, row.internal_code, id);

      return {
        contextType: 'product',
        contextId: id,
        contextPath: pathname,
        contextLabel: label,
        contextSnapshot: {
          label,
          description: row.description?.trim() ?? null,
          internalCode: row.internal_code?.trim() ?? null,
          productId: row.product_id ?? coerceContextRecordId(id),
        },
      };
    },
  },
];

export function useTaskContext(): TaskContext | null {
  const pathname = usePathname();
  const [context, setContext] = useState<TaskContext | null>(null);

  useEffect(() => {
    if (!pathname) {
      setContext(null);
      return;
    }

    let cancelled = false;

    const match = ROUTE_PATTERNS.find(route => route.pattern.test(pathname));
    if (!match) {
      setContext(null);
      return;
    }

    const id = pathname.match(match.pattern)?.[1];
    if (!id) {
      setContext(null);
      return;
    }

    const fallbackLabel = match.buildFallbackLabel(id);
    const fallbackContext: TaskContext = {
      contextType: match.type,
      contextId: id,
      contextPath: pathname,
      contextLabel: fallbackLabel,
      contextSnapshot: { label: fallbackLabel },
    };

    (async () => {
      try {
        const { data, error } = await supabase
          .from(match.table)
          .select(match.select)
          .eq(match.idCol, id)
          .maybeSingle();

        if (cancelled) {
          return;
        }

        if (error || !data) {
          setContext(fallbackContext);
          return;
        }

        setContext(match.buildContext(data, id, pathname));
      } catch {
        if (!cancelled) {
          setContext(fallbackContext);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return context;
}

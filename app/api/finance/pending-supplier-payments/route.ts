import { NextRequest, NextResponse } from 'next/server';

import { getRouteClient } from '@/lib/supabase-route';

// Board is capped at the newest MAX_ROWS cash-supplier POs; Phase C adds
// server-side status filtering + pagination so older open items can't fall off.
const MAX_ROWS = 500;
const CASH_SUPPLIER_LIMIT = 500;

type PaymentStatus =
  | 'awaiting_invoice'
  | 'awaiting_payment'
  | 'awaiting_pop'
  | 'closed'
  | 'cancelled';

type FinanceCard = {
  purchase_order_id: number;
  q_number: string | null;
  supplier_name: string;
  amount: number;
  age_days: number;
  order_date: string | null;
  payment_status: Exclude<PaymentStatus, 'closed' | 'cancelled'>;
};

type InvoiceRow = {
  id: string;
  payment_status: PaymentStatus | null;
  invoice_amount: number | string | null;
  updated_at: string | null;
  created_at: string | null;
};

type SupplierOrderRow = {
  order_quantity: number | string | null;
  supplier_component:
    | {
        price: number | string | null;
      }
    | Array<{
        price: number | string | null;
      }>
    | null;
};

type PurchaseOrderRow = {
  purchase_order_id: number;
  q_number: string | null;
  order_date: string | null;
  created_at: string;
  supplier_id: number | null;
  purchase_order_invoices: InvoiceRow[] | InvoiceRow | null;
  supplier_orders: SupplierOrderRow[] | null;
};

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateDerivedAmount(row: PurchaseOrderRow) {
  return (row.supplier_orders ?? []).reduce((sum, line) => {
    const quantity = numberValue(line.order_quantity);
    const supplierComponent = Array.isArray(line.supplier_component)
      ? line.supplier_component[0]
      : line.supplier_component;
    const price = numberValue(supplierComponent?.price);
    return sum + quantity * price;
  }, 0);
}

function getAgeDays(orderDate: string | null, createdAt: string) {
  const source = orderDate || createdAt;
  const start = new Date(source);
  if (!Number.isFinite(start.getTime())) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);

  return Math.max(
    0,
    Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  );
}

function latestOpenInvoice(invoices: InvoiceRow[]) {
  return [...invoices]
    .sort((left, right) => {
      const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightTime - leftTime;
    })
    .find((invoice) => !['closed', 'cancelled'].includes(invoice.payment_status ?? ''));
}

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const { data: cashSuppliers, error: supplierError } = await ctx.supabase
    .from('suppliers')
    .select('supplier_id, name')
    .eq('payment_type', 'cash')
    .eq('is_active', true)
    .order('name')
    .limit(CASH_SUPPLIER_LIMIT);

  if (supplierError) {
    return NextResponse.json({ error: supplierError.message }, { status: 500 });
  }

  const supplierRows = cashSuppliers ?? [];
  if (supplierRows.length === 0) {
    return NextResponse.json({
      groups: {
        awaiting_invoice: [],
        awaiting_payment: [],
        awaiting_pop: [],
      },
      total: 0,
    });
  }

  const supplierById = new Map(
    supplierRows.map((supplier) => [supplier.supplier_id, supplier.name ?? 'Unknown Supplier'])
  );

  const { data: purchaseOrders, error: poError } = await ctx.supabase
    .from('purchase_orders')
    .select(
      `
        purchase_order_id,
        q_number,
        order_date,
        created_at,
        supplier_id,
        purchase_order_invoices(
          id,
          payment_status,
          invoice_amount,
          updated_at,
          created_at
        ),
        supplier_orders(
          order_quantity,
          supplier_component:suppliercomponents(
            price
          )
        )
      `
    )
    .in(
      'supplier_id',
      supplierRows.map((supplier) => supplier.supplier_id)
    )
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  if (poError) {
    return NextResponse.json({ error: poError.message }, { status: 500 });
  }

  const cards = ((purchaseOrders ?? []) as unknown as PurchaseOrderRow[])
    .map((row): FinanceCard | null => {
      const invoices = asArray(row.purchase_order_invoices);
      const openInvoice = latestOpenInvoice(invoices);
      // Invoices exist but none are open -> lifecycle finished (closed/cancelled);
      // don't resurrect the PO as awaiting_invoice. No invoices at all -> genuinely
      // awaiting its first invoice.
      if (invoices.length > 0 && !openInvoice) {
        return null;
      }
      const paymentStatus = openInvoice?.payment_status ?? 'awaiting_invoice';

      // Unreachable given latestOpenInvoice's filter; kept for type narrowing.
      if (paymentStatus === 'closed' || paymentStatus === 'cancelled') {
        return null;
      }

      return {
        purchase_order_id: row.purchase_order_id,
        q_number: row.q_number,
        supplier_name: supplierById.get(row.supplier_id ?? -1) ?? 'Unknown Supplier',
        amount:
          openInvoice?.invoice_amount !== null && openInvoice?.invoice_amount !== undefined
            ? numberValue(openInvoice.invoice_amount)
            : calculateDerivedAmount(row),
        age_days: getAgeDays(row.order_date, row.created_at),
        order_date: row.order_date,
        payment_status: paymentStatus,
      };
    })
    .filter((card): card is FinanceCard => card !== null);

  return NextResponse.json({
    groups: {
      awaiting_invoice: cards.filter((card) => card.payment_status === 'awaiting_invoice'),
      awaiting_payment: cards.filter((card) => card.payment_status === 'awaiting_payment'),
      awaiting_pop: cards.filter((card) => card.payment_status === 'awaiting_pop'),
    },
    total: cards.length,
  });
}

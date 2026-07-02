'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { fetchDeliveryNote, type DeliveryNoteStatus, type OrderDeliveryNote } from '@/lib/db/internalOrders';
import { openDeliveryNotePdf, type DeliveryOrderDetail } from '@/components/features/orders/delivery/CreateDeliveryNoteModal';

interface DeliveryNotePageProps {
  params: Promise<{ orderId: string; deliveryNoteId: string }>;
}

interface OrderSummary {
  order_id: number;
  order_number: string | null;
  customer: { name: string | null } | null;
}

interface DetailRow {
  order_detail_id: number;
  product_id: number;
  quantity: number;
  products: { internal_code: string | null; name: string | null } | null;
}

const STATUS_BADGE: Record<DeliveryNoteStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  printed: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  signed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

function noteLabel(note: OrderDeliveryNote): string {
  if (note.source === 'pastel') return `Pastel: ${note.external_reference ?? '-'}`;
  return note.note_number ?? `DN-${note.order_delivery_note_id}`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: '2-digit' });
}

function formatQty(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.001) return Math.round(value).toString();
  return value.toFixed(2);
}

async function fetchOrderSummary(orderId: number): Promise<OrderSummary | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('order_id, order_number, customer:customers(name)')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as OrderSummary) ?? null;
}

async function fetchOrderDetails(orderId: number): Promise<DeliveryOrderDetail[]> {
  const { data, error } = await supabase
    .from('order_details')
    .select('order_detail_id, product_id, quantity, products(internal_code, name)')
    .eq('order_id', orderId)
    .order('order_detail_id', { ascending: true });
  if (error) throw error;

  return ((data as unknown as DetailRow[]) ?? []).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      order_detail_id: row.order_detail_id,
      product_code: product?.internal_code ?? null,
      product_name: product?.name ?? `Product ${row.product_id}`,
      quantity: Number(row.quantity ?? 0),
      ready_qty: Number(row.quantity ?? 0),
      allocated_delivery_qty: 0,
    };
  });
}

export default function DeliveryNotePreviewPage({ params }: DeliveryNotePageProps) {
  const resolvedParams = React.use(params);
  const orderId = Number.parseInt(resolvedParams.orderId, 10);
  const deliveryNoteId = Number.parseInt(resolvedParams.deliveryNoteId, 10);
  const [openingPdf, setOpeningPdf] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['delivery-note-preview', orderId, deliveryNoteId],
    enabled: Number.isFinite(orderId) && Number.isFinite(deliveryNoteId),
    queryFn: async () => {
      const [note, order, orderDetails] = await Promise.all([
        fetchDeliveryNote(deliveryNoteId),
        fetchOrderSummary(orderId),
        fetchOrderDetails(orderId),
      ]);
      if (!note || note.order_id !== orderId) return null;
      return { note, order, orderDetails };
    },
  });

  const detailById = useMemo(() => {
    const map = new Map<number, DeliveryOrderDetail>();
    for (const detail of data?.orderDetails ?? []) map.set(detail.order_detail_id, detail);
    return map;
  }, [data?.orderDetails]);

  const totalQty = useMemo(
    () => (data?.note.items ?? []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [data?.note.items],
  );

  const handleOpenPdf = async () => {
    if (!data?.note) return;
    setOpeningPdf(true);
    try {
      await openDeliveryNotePdf({ orderId, note: data.note, orderDetails: data.orderDetails });
      toast.success('Delivery note PDF opened.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open delivery note PDF.';
      toast.error(message);
    } finally {
      setOpeningPdf(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading delivery note...
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/orders/${Number.isFinite(orderId) ? orderId : ''}?tab=delivery-notes`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to order
          </Link>
        </Button>
        <Card className="border-border/50 p-8 text-sm text-muted-foreground">Delivery note not found.</Card>
      </div>
    );
  }

  const { note, order } = data;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/orders/${orderId}?tab=delivery-notes`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to order
          </Link>
        </Button>
        <Button onClick={handleOpenPdf} disabled={openingPdf || note.status === 'cancelled'} size="sm">
          {openingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Open PDF
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {note.source === 'pastel' ? (
              <ExternalLink className="h-5 w-5 text-muted-foreground" />
            ) : (
              <FileText className="h-5 w-5 text-muted-foreground" />
            )}
            <h1 className="text-xl font-semibold tracking-tight">{noteLabel(note)}</h1>
            <Badge className={`${STATUS_BADGE[note.status]} border-0 capitalize`}>{note.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {order?.order_number ?? `Order #${orderId}`} · {order?.customer?.name ?? 'No customer visible'} · {formatDate(note.delivery_date)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-border/50 p-4">
          <p className="text-xs uppercase text-muted-foreground">Source</p>
          <p className="mt-1 text-sm font-medium capitalize">{note.source}</p>
        </Card>
        <Card className="border-border/50 p-4">
          <p className="text-xs uppercase text-muted-foreground">Lines</p>
          <p className="mt-1 text-sm font-medium">{note.items?.length ?? 0}</p>
        </Card>
        <Card className="border-border/50 p-4">
          <p className="text-xs uppercase text-muted-foreground">Quantity</p>
          <p className="mt-1 text-sm font-medium tabular-nums">{formatQty(totalQty)}</p>
        </Card>
      </div>

      <div className="overflow-hidden rounded-md border border-border/50">
        <table className="w-full text-sm">
          <thead className="border-b border-border/50 bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Code</th>
              <th className="px-4 py-2 text-left font-medium">Item</th>
              <th className="px-4 py-2 text-right font-medium">Qty</th>
            </tr>
          </thead>
          <tbody>
            {(note.items ?? []).map((item) => {
              const detail = detailById.get(item.order_detail_id);
              return (
                <tr key={item.order_delivery_note_item_id} className="border-b border-border/30 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{detail?.product_code ?? '-'}</td>
                  <td className="px-4 py-2">{detail?.product_name ?? `Item #${item.order_detail_id}`}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(Number(item.quantity || 0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {note.notes ? (
        <Card className="border-border/50 p-4">
          <p className="text-xs uppercase text-muted-foreground">Notes</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{note.notes}</p>
        </Card>
      ) : null}
    </div>
  );
}

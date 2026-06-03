'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2, ClipboardCheck } from 'lucide-react';

type DnStatus = 'draft' | 'printed' | 'signed' | 'cancelled';

interface DeliveryRow {
  order_delivery_note_id: number;
  order_id: number;
  note_number: string | null;
  source: 'unity' | 'pastel';
  external_reference: string | null;
  delivery_date: string;
  status: DnStatus;
  created_at: string;
  orders: { order_number: string | null; customer_id: number | null } | null;
  items: { quantity: number }[] | null;
}

const STATUS_VARIANT: Record<DnStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  printed: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  signed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

const STATUSES: (DnStatus | 'all')[] = ['all', 'draft', 'printed', 'signed', 'cancelled'];

export default function DeliveriesPage() {
  const { user } = useAuth();
  const orgId = getOrgId(user);
  const [statusFilter, setStatusFilter] = useState<DnStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries-list', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_delivery_notes')
        .select('order_delivery_note_id, order_id, note_number, source, external_reference, delivery_date, status, created_at, orders(order_number, customer_id), items:order_delivery_note_items(quantity)')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as unknown as DeliveryRow[]) ?? [];
    },
  });

  const rows = useMemo(() => {
    let r = data ?? [];
    if (statusFilter !== 'all') r = r.filter((x) => x.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((x) =>
        (x.note_number ?? '').toLowerCase().includes(q) ||
        (x.external_reference ?? '').toLowerCase().includes(q) ||
        (x.orders?.order_number ?? String(x.order_id)).toLowerCase().includes(q));
    }
    return r;
  }, [data, statusFilter, search]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Deliveries</h1>
          <p className="text-sm text-muted-foreground">Customer delivery notes across all orders.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-sm px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search DN # / Pastel ref / order…"
          className="h-8 w-64"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading deliveries…
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-border/50 p-10 text-center text-sm text-muted-foreground">No delivery notes found.</Card>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/50">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Note</th>
                <th className="px-4 py-2 text-left font-medium">Order</th>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Items</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.order_delivery_note_id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono text-xs tabular-nums">
                    {r.source === 'unity' ? (r.note_number ?? '—') : `Pastel: ${r.external_reference ?? '—'}`}
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/orders/${r.order_id}?tab=delivery-notes`} className="text-primary hover:underline">
                      {r.orders?.order_number ?? `#${r.order_id}`}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.delivery_date}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{(r.items ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0)}</td>
                  <td className="px-4 py-2">
                    <Badge className={`${STATUS_VARIANT[r.status]} border-0 capitalize`}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

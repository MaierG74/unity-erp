'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ClipboardCheck, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';

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
  orders: { order_number: string | null; customer_id: number | null; customer?: { name: string | null } | null } | null;
  items: { quantity: number }[] | null;
}

interface CustomerOption {
  id: number;
  name: string | null;
}

const STATUS_VARIANT: Record<DnStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  printed: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  signed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

const STATUSES: (DnStatus | 'all')[] = ['all', 'draft', 'printed', 'signed', 'cancelled'];
const PAGE_SIZE = 25;

function parseStatus(value: string | null): DnStatus | 'all' {
  return STATUSES.includes(value as DnStatus | 'all') ? (value as DnStatus | 'all') : 'all';
}

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseCustomerId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function resolveMatchingOrderIds(params: { search: string; customerId: number | null }): Promise<number[] | null> {
  const search = params.search.trim();
  if (!search) return null;

  let customerIds: number[] = [];
  if (search) {
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .ilike('name', `%${search}%`)
      .limit(500);
    if (customerError) throw customerError;
    customerIds = ((customers ?? []) as Array<{ id: number }>).map((customer) => customer.id);
  }

  let query = supabase
    .from('orders')
    .select('order_id')
    .eq('order_type', 'customer')
    .limit(500);

  if (params.customerId) {
    query = query.eq('customer_id', params.customerId);
  }

  if (search) {
    const orderFilters = [`order_number.ilike.%${search}%`];
    if (customerIds.length > 0) orderFilters.push(`customer_id.in.(${customerIds.join(',')})`);
    query = query.or(orderFilters.join(','));
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as Array<{ order_id: number }>).map((row) => row.order_id);
}

export default function DeliveriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const orgId = getOrgId(user);

  const statusFilter = parseStatus(searchParams?.get('status'));
  const search = searchParams?.get('q') ?? '';
  const customerId = parseCustomerId(searchParams?.get('customer'));
  const dateFrom = searchParams?.get('from') ?? '';
  const dateTo = searchParams?.get('to') ?? '';
  const page = parsePage(searchParams?.get('page'));

  const setParam = (key: string, value: string | null, options?: { resetPage?: boolean }) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    const next = value?.trim() ?? '';
    if (next) {
      params.set(key, next);
    } else {
      params.delete(key);
    }
    if (options?.resetPage !== false) params.delete('page');
    const query = params.toString();
    router.replace(query ? `/inventory/deliveries?${query}` : '/inventory/deliveries', { scroll: false });
  };

  const { data: customers = [] } = useQuery({
    queryKey: ['delivery-note-customers', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('id, name').order('name', { ascending: true });
      if (error) throw error;
      return (data as CustomerOption[]) ?? [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries-list', orgId, statusFilter, search, customerId, dateFrom, dateTo, page],
    enabled: !!orgId,
    queryFn: async () => {
      const matchingOrderIds = await resolveMatchingOrderIds({ search, customerId });
      if (matchingOrderIds && matchingOrderIds.length === 0) {
        const q = search.trim();
        if (!q) return { rows: [] as DeliveryRow[], total: 0 };
      }

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('order_delivery_notes')
        .select(
          'order_delivery_note_id, order_id, note_number, source, external_reference, delivery_date, status, created_at, orders!inner(order_number, customer_id, customer:customers(name)), items:order_delivery_note_items(quantity)',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(from, to);

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (dateFrom) query = query.gte('delivery_date', dateFrom);
      if (dateTo) query = query.lte('delivery_date', dateTo);
      if (customerId) query = query.eq('orders.customer_id', customerId);

      const q = search.trim();
      if (q) {
        const orFilters = [`note_number.ilike.%${q}%`, `external_reference.ilike.%${q}%`];
        const numeric = Number.parseInt(q, 10);
        if (Number.isFinite(numeric)) orFilters.push(`order_id.eq.${numeric}`);
        if (matchingOrderIds && matchingOrderIds.length > 0) {
          orFilters.push(`order_id.in.(${matchingOrderIds.join(',')})`);
        }
        query = query.or(orFilters.join(','));
      } else if (matchingOrderIds && matchingOrderIds.length > 0) {
        query = query.in('order_id', matchingOrderIds);
      }

      const { data: rows, error, count } = await query;
      if (error) throw error;
      return { rows: (rows as unknown as DeliveryRow[]) ?? [], total: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  const goToPage = (nextPage: number) => {
    setParam('page', nextPage > 1 ? String(nextPage) : null, { resetPage: false });
  };

  const clearFilters = () => {
    router.replace('/inventory/deliveries', { scroll: false });
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Deliveries</h1>
          <p className="text-sm text-muted-foreground">Customer delivery notes across all orders.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border/50 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setParam('status', s === 'all' ? null : s)}
                className={`rounded-sm px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="relative min-w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setParam('q', event.target.value)}
              placeholder="Search DN # / Pastel ref / order..."
              className="h-8 pl-8"
            />
          </div>
          <Select value={customerId ? String(customerId) : 'all'} onValueChange={(value) => setParam('customer', value === 'all' ? null : value)}>
            <SelectTrigger className="h-8 w-56">
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {customers.map((customer) => (
                <SelectItem key={customer.id} value={String(customer.id)}>
                  {customer.name ?? `Customer ${customer.id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
            <X className="mr-2 h-4 w-4" />
            Clear
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => setParam('from', event.target.value)}
            className="h-8 w-40"
            aria-label="Delivery date from"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(event) => setParam('to', event.target.value)}
            className="h-8 w-40"
            aria-label="Delivery date to"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading deliveries...
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-border/50 p-10 text-center text-sm text-muted-foreground">No delivery notes found.</Card>
      ) : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-md border border-border/50">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Note</th>
                  <th className="px-4 py-2 text-left font-medium">Order</th>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Items</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.order_delivery_note_id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs tabular-nums">
                      <Link href={`/orders/${r.order_id}/delivery-notes/${r.order_delivery_note_id}`} className="text-primary hover:underline">
                        {r.source === 'unity' ? (r.note_number ?? '-') : `Pastel: ${r.external_reference ?? '-'}`}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/orders/${r.order_id}?tab=delivery-notes`} className="text-primary hover:underline">
                        {r.orders?.order_number ?? `#${r.order_id}`}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{r.orders?.customer?.name ?? '-'}</td>
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
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              Showing {showingFrom.toLocaleString()}-{showingTo.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <span className="text-xs tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="sm" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}>
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

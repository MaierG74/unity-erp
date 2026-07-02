'use client';

/**
 * StockMovementsView — global finished-goods stock movement ledger (Phase 6).
 *
 * Reads the `product_inventory_transactions_with_balance` view (signed quantity +
 * a precomputed running_balance per product), joins `products` for the code/name
 * cell, and renders a calm, filterable ledger newest-first.
 *
 * Filter state lives in the URL search params (list-state-persistence rule): when an
 * operator clicks into an order and navigates back they land on the same filtered view.
 * A capped fetch (FETCH_CAP rows) keeps v1 simple; the footer notes when truncated.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { format, formatDistanceToNow, isToday, isSameMonth } from 'date-fns';
import {
  Download,
  Search,
  CalendarRange,
  ChevronDown,
  PackagePlus,
  SlidersHorizontal,
  TrendingDown,
} from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type MovementType = 'build' | 'consume' | 'adjust' | 'receive' | 'ship' | 'return';

const MOVEMENT_TYPES: MovementType[] = ['build', 'consume', 'adjust', 'receive', 'ship', 'return'];

interface MovementRowRaw {
  id: number;
  org_id: string | null;
  product_id: number;
  quantity: number | string | null;
  type: MovementType | string | null;
  occurred_at: string;
  order_id: number | null;
  reference: string | null;
  running_balance: number | string | null;
}

interface ProductLookupRow {
  product_id: number;
  internal_code: string | null;
  name: string | null;
}

interface StockReceiptLookupRow {
  stock_receipt_id: number;
  source: 'draft_confirm' | 'manual' | null;
}

export interface StockMovement {
  id: number;
  productId: number;
  quantity: number;
  type: MovementType | 'unknown';
  occurredAt: string;
  orderId: number | null;
  reference: string | null;
  runningBalance: number | null;
  productCode: string | null;
  productName: string | null;
  receiptSource: 'draft_confirm' | 'manual' | null;
}

const FETCH_CAP = 500;

// -----------------------------------------------------------------------------
// Type chip presentation
// -----------------------------------------------------------------------------

const TYPE_CHIP: Record<MovementType, { label: string; className: string }> = {
  build: { label: 'Build', className: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400' },
  receive: { label: 'Receive', className: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400' },
  return: { label: 'Return', className: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400' },
  ship: { label: 'Ship', className: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  consume: { label: 'Consume', className: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  adjust: { label: 'Adjust', className: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400' },
};

function TypeChip({ type, isManualReceipt = false }: { type: MovementType | 'unknown'; isManualReceipt?: boolean }) {
  if (isManualReceipt) {
    return (
      <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
        Manual receipt
      </span>
    );
  }
  if (type === 'unknown') {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Unknown
      </span>
    );
  }
  const chip = TYPE_CHIP[type];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', chip.className)}>
      {chip.label}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Source parsing — reference is `stock_receipts:<id>` / `stock_adjustments:<id>`
// -----------------------------------------------------------------------------

interface ParsedSource {
  kind: 'stock_receipt' | 'stock_adjustment' | 'other';
  refId: number | null;
  label: string;
}

function parseSourceReference(reference: string | null): ParsedSource | null {
  if (!reference) return null;
  const [rawTable, rawId] = reference.split(':');
  const refId = rawId != null && rawId !== '' && Number.isFinite(Number(rawId)) ? Number(rawId) : null;
  if (rawTable === 'stock_receipts') {
    return { kind: 'stock_receipt', refId, label: refId != null ? `Stock receipt SR${refId}` : 'Stock receipt' };
  }
  if (rawTable === 'stock_adjustments') {
    return { kind: 'stock_adjustment', refId, label: refId != null ? `Adjustment #${refId}` : 'Adjustment' };
  }
  return { kind: 'other', refId: null, label: reference };
}

// -----------------------------------------------------------------------------
// URL-backed filter state
// -----------------------------------------------------------------------------

interface FilterState {
  q: string;
  types: MovementType[];
  from: string; // yyyy-MM-dd or ''
  to: string; // yyyy-MM-dd or ''
  negativeOnly: boolean;
}

function parseTypesParam(raw: string | null): MovementType[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is MovementType => (MOVEMENT_TYPES as string[]).includes(t));
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function StockMovementsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const orgId = getOrgId(user);

  // --- Filter state derived from URL --------------------------------------
  const filters: FilterState = useMemo(
    () => ({
      q: searchParams?.get('q') ?? '',
      types: parseTypesParam(searchParams?.get('types') ?? null),
      from: searchParams?.get('from') ?? '',
      to: searchParams?.get('to') ?? '',
      negativeOnly: searchParams?.get('neg') === '1',
    }),
    [searchParams],
  );

  const setFilters = useCallback(
    (next: Partial<FilterState>) => {
      const merged: FilterState = { ...filters, ...next };
      const params = new URLSearchParams(searchParams?.toString() ?? '');

      const apply = (key: string, value: string, isDefault: boolean) => {
        if (isDefault) params.delete(key);
        else params.set(key, value);
      };

      apply('q', merged.q, merged.q.trim() === '');
      apply('types', merged.types.join(','), merged.types.length === 0);
      apply('from', merged.from, merged.from === '');
      apply('to', merged.to, merged.to === '');
      apply('neg', '1', !merged.negativeOnly);

      const query = params.toString();
      router.replace(query ? `?${query}` : '?', { scroll: false });
    },
    [filters, router, searchParams],
  );

  const toggleType = useCallback(
    (type: MovementType) => {
      const has = filters.types.includes(type);
      setFilters({ types: has ? filters.types.filter((t) => t !== type) : [...filters.types, type] });
    },
    [filters.types, setFilters],
  );

  const clearFilters = useCallback(() => {
    router.replace('?', { scroll: false });
  }, [router]);

  // --- Data ---------------------------------------------------------------
  const {
    data: movements = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['stock-movements', orgId],
    enabled: !!orgId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<StockMovement[]> => {
      const { data: rows, error: viewErr } = await supabase
        .from('product_inventory_transactions_with_balance')
        .select('id, org_id, product_id, quantity, type, occurred_at, order_id, reference, running_balance')
        .order('occurred_at', { ascending: false })
        .limit(FETCH_CAP);
      if (viewErr) {
        console.error('[stock-movements] view error', viewErr);
        throw viewErr;
      }

      const raw = (rows ?? []) as MovementRowRaw[];
      const productIds = Array.from(new Set(raw.map((r) => r.product_id))).filter(
        (id): id is number => Number.isFinite(id),
      );
      const receiptIds = Array.from(
        new Set(
          raw
            .map((r) => parseSourceReference(r.reference))
            .filter((source): source is ParsedSource => source?.kind === 'stock_receipt' && source.refId != null)
            .map((source) => source.refId as number),
        ),
      );

      const lookup = new Map<number, ProductLookupRow>();
      if (productIds.length) {
        const { data: products, error: prodErr } = await supabase
          .from('products')
          .select('product_id, internal_code, name')
          .in('product_id', productIds);
        if (prodErr) {
          // Non-fatal: products may be filtered by RLS; show movements without names.
          console.error('[stock-movements] products lookup error', prodErr);
        }
        for (const p of (products ?? []) as ProductLookupRow[]) {
          lookup.set(p.product_id, p);
        }
      }

      const receiptLookup = new Map<number, StockReceiptLookupRow>();
      if (receiptIds.length) {
        const { data: receipts, error: receiptErr } = await supabase
          .from('stock_receipts')
          .select('stock_receipt_id, source')
          .in('stock_receipt_id', receiptIds);
        if (receiptErr) {
          console.error('[stock-movements] stock receipts lookup error', receiptErr);
        }
        for (const receipt of (receipts ?? []) as StockReceiptLookupRow[]) {
          receiptLookup.set(receipt.stock_receipt_id, receipt);
        }
      }

      return raw.map((r) => {
        const product = lookup.get(r.product_id) ?? null;
        const source = parseSourceReference(r.reference);
        const typeValue = (r.type as MovementType | null) ?? null;
        const isKnownType = typeValue != null && (MOVEMENT_TYPES as string[]).includes(typeValue);
        const balance = r.running_balance == null ? null : Number(r.running_balance);
        return {
          id: r.id,
          productId: r.product_id,
          quantity: Number(r.quantity ?? 0),
          type: isKnownType ? (typeValue as MovementType) : 'unknown',
          occurredAt: r.occurred_at,
          orderId: r.order_id,
          reference: r.reference,
          runningBalance: balance != null && Number.isFinite(balance) ? balance : null,
          productCode: product?.internal_code ?? null,
          productName: product?.name ?? null,
          receiptSource:
            source?.kind === 'stock_receipt' && source.refId != null
              ? receiptLookup.get(source.refId)?.source ?? null
              : null,
        } satisfies StockMovement;
      });
    },
  });

  // --- Client-side filtering ----------------------------------------------
  const filtered = useMemo(() => {
    const needle = filters.q.trim().toLowerCase();
    const fromMs = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : null;
    const toMs = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : null;

    return movements.filter((m) => {
      if (filters.types.length && (m.type === 'unknown' || !filters.types.includes(m.type))) return false;
      if (filters.negativeOnly && m.quantity >= 0) return false;

      if (needle) {
        const code = m.productCode?.toLowerCase() ?? '';
        const name = m.productName?.toLowerCase() ?? '';
        if (!code.includes(needle) && !name.includes(needle)) return false;
      }

      if (fromMs != null || toMs != null) {
        const t = new Date(m.occurredAt).getTime();
        if (fromMs != null && t < fromMs) return false;
        if (toMs != null && t > toMs) return false;
      }
      return true;
    });
  }, [movements, filters]);

  // --- Quick-view pill counts (from the full fetched set) -----------------
  const pillCounts = useMemo(() => {
    const now = new Date();
    let todaysReceipts = 0;
    let adjustmentsThisMonth = 0;
    let negatives = 0;
    for (const m of movements) {
      const d = new Date(m.occurredAt);
      if (m.type === 'build' && isToday(d)) todaysReceipts += 1;
      if (m.type === 'adjust' && isSameMonth(d, now)) adjustmentsThisMonth += 1;
      if (m.quantity < 0) negatives += 1;
    }
    return { todaysReceipts, adjustmentsThisMonth, negatives };
  }, [movements]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const monthStartStr = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd');

  const applyTodaysReceipts = () =>
    setFilters({ types: ['build'], from: todayStr, to: todayStr, negativeOnly: false });
  const applyAdjustmentsThisMonth = () =>
    setFilters({ types: ['adjust'], from: monthStartStr, to: '', negativeOnly: false });
  const applyNegativeMovements = () =>
    setFilters({ types: [], from: '', to: '', negativeOnly: true });

  // --- CSV export ----------------------------------------------------------
  const exportCsv = useCallback(() => {
    if (filtered.length === 0) {
      toast.info('Nothing to export', { description: 'Adjust the filters to include at least one movement.' });
      return;
    }
    const header = ['Time', 'Type', 'Product code', 'Product name', 'Quantity', 'QOH after', 'Order', 'Source', 'Reference'];
    const escape = (value: string | number | null) => {
      const s = value == null ? '' : String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = filtered.map((m) => {
      const source = parseSourceReference(m.reference);
      return [
        new Date(m.occurredAt).toISOString(),
        m.receiptSource === 'manual' && m.type === 'build' ? 'manual receipt' : m.type,
        m.productCode ?? '',
        m.productName ?? '',
        m.quantity,
        m.runningBalance ?? '',
        m.orderId ?? '',
        source?.label ?? '',
        m.reference ?? '',
      ]
        .map(escape)
        .join(',');
    });
    const csv = [header.map(escape).join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-movements-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Export started', { description: `${filtered.length} movement${filtered.length === 1 ? '' : 's'} exported.` });
  }, [filtered]);

  const hasActiveFilters =
    filters.q.trim() !== '' ||
    filters.types.length > 0 ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.negativeOnly;

  const truncated = movements.length >= FETCH_CAP;

  // -------------------------------------------------------------------------
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Stock Movements</h1>
        <p className="text-sm text-muted-foreground">
          Every finished-goods inventory event across the org, newest first.
        </p>
      </div>

      {/* Quick-view pills */}
      <div className="flex flex-wrap items-center gap-2">
        <QuickPill
          icon={<PackagePlus className="h-3.5 w-3.5" />}
          label="Today's receipts"
          count={pillCounts.todaysReceipts}
          onClick={applyTodaysReceipts}
        />
        <QuickPill
          icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          label="Adjustments this month"
          count={pillCounts.adjustmentsThisMonth}
          onClick={applyAdjustmentsThisMonth}
        />
        <QuickPill
          icon={<TrendingDown className="h-3.5 w-3.5" />}
          label="Negative movements"
          count={pillCounts.negatives}
          onClick={applyNegativeMovements}
        />
      </div>

      {/* Sticky filter bar */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Search */}
          <div className="relative w-full lg:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Search product code or name…"
              className="pl-8"
              aria-label="Search by product code or name"
            />
          </div>

          {/* Type chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {MOVEMENT_TYPES.map((type) => {
              const active = filters.types.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    active
                      ? cn(TYPE_CHIP[type].className, 'ring-1 ring-inset ring-current/30')
                      : 'border-border text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {TYPE_CHIP[type].label}
                </button>
              );
            })}
          </div>

          {/* Date range + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarRange className="h-4 w-4" />
              <Input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters({ from: e.target.value })}
                className="h-9 w-[8.5rem]"
                aria-label="From date"
              />
              <span className="text-xs">to</span>
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({ to: e.target.value })}
                className="h-9 w-[8.5rem]"
                aria-label="To date"
              />
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[8rem]" />
              <TableHead>Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">QOH after</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  Loading stock movements…
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-rose-600">
                  Unable to load stock movements: {(error as Error)?.message ?? 'Unknown error'}
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  {hasActiveFilters
                    ? 'No movements match these filters.'
                    : 'No stock movements recorded yet.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((m) => <MovementRow key={m.id} movement={m} />)
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer line */}
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>
          Showing {filtered.length.toLocaleString()} of {movements.length.toLocaleString()} loaded movement
          {movements.length === 1 ? '' : 's'}
          {hasActiveFilters ? ' (filtered)' : ''}.
        </span>
        {truncated && <span>Capped at the {FETCH_CAP.toLocaleString()} most recent — narrow the date range to see older activity.</span>}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Row (expandable)
// -----------------------------------------------------------------------------

function MovementRow({ movement }: { movement: StockMovement }) {
  const [open, setOpen] = useState(false);
  const occurred = new Date(movement.occurredAt);
  const source = parseSourceReference(movement.reference);
  const isPositive = movement.quantity > 0;
  const isNegative = movement.quantity < 0;

  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Hide movement details' : 'Show movement details'}
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 aria-expanded:text-foreground"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            Details
          </button>
        </TableCell>

        <TableCell className="align-top">
          <div className="flex flex-col">
            <span className="text-sm tabular-nums">{format(occurred, 'MMM d, yyyy HH:mm')}</span>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(occurred, { addSuffix: true })}
            </span>
          </div>
        </TableCell>

        <TableCell className="align-top">
          <TypeChip type={movement.type} isManualReceipt={movement.type === 'build' && movement.receiptSource === 'manual'} />
        </TableCell>

        <TableCell className="align-top">
          {movement.productCode || movement.productName ? (
            <div className="flex flex-col">
              {movement.productCode && (
                <span className="font-mono text-xs tabular-nums text-foreground">{movement.productCode}</span>
              )}
              <span className="text-sm text-muted-foreground">
                {movement.productName ?? `Product #${movement.productId}`}
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Product #{movement.productId}</span>
          )}
        </TableCell>

        <TableCell className="text-right align-top">
          <span
            className={cn(
              'text-sm font-semibold tabular-nums',
              isPositive && 'text-green-600 dark:text-green-400',
              isNegative && 'text-rose-600 dark:text-rose-400',
              !isPositive && !isNegative && 'text-muted-foreground',
            )}
          >
            {isPositive ? '+' : ''}
            {movement.quantity.toLocaleString()}
          </span>
        </TableCell>

        <TableCell className="text-right align-top">
          <span className="text-sm tabular-nums text-foreground">
            {movement.runningBalance != null ? movement.runningBalance.toLocaleString() : '—'}
          </span>
        </TableCell>

        <TableCell className="align-top">
          <SourceCell movement={movement} source={source} />
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={7} className="py-3">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-3">
              <div className="space-y-0.5">
                <dt className="font-medium uppercase tracking-wide text-muted-foreground">Reference</dt>
                <dd className="font-mono text-foreground">{movement.reference ?? '—'}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="font-medium uppercase tracking-wide text-muted-foreground">Order</dt>
                <dd className="text-foreground">
                  {movement.orderId != null ? (
                    <Link href={`/orders/${movement.orderId}`} className="text-primary underline-offset-2 hover:underline">
                      #{movement.orderId}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="font-medium uppercase tracking-wide text-muted-foreground">Movement ID</dt>
                <dd className="font-mono text-foreground">{movement.id}</dd>
              </div>
            </dl>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function SourceCell({ movement, source }: { movement: StockMovement; source: ParsedSource | null }) {
  // Prefer an order link when present — most actionable.
  if (movement.orderId != null) {
    return (
      <Link
        href={`/orders/${movement.orderId}`}
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        Order #{movement.orderId}
      </Link>
    );
  }
  if (source) {
    return <span className="text-sm text-muted-foreground">{source.label}</span>;
  }
  return <span className="text-sm text-muted-foreground">—</span>;
}

// -----------------------------------------------------------------------------
// Quick-view pill
// -----------------------------------------------------------------------------

function QuickPill({
  icon,
  label,
  count,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-muted/50"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
        {count.toLocaleString()}
      </span>
    </button>
  );
}

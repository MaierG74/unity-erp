'use client';

import { useMemo } from 'react';
import { format, subDays, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { supabase } from '@/lib/supabase';
import { SO_STATUS } from '@/types/purchasing';

// ─── Purchase Activity Chart ─────────────────────────────────────────────────

interface DailyActivity {
  date: string;
  created: number;
  received: number;
}

interface ReceivedPurchaseOrderRow {
  receipt_date: string;
  supplier_orders:
    | {
        purchase_order_id: number | null;
      }
    | Array<{
        purchase_order_id: number | null;
      }>
    | null;
}

function getReceiptPurchaseOrderId(receipt: ReceivedPurchaseOrderRow) {
  const supplierOrder = Array.isArray(receipt.supplier_orders)
    ? receipt.supplier_orders[0]
    : receipt.supplier_orders;
  const purchaseOrderId = Number(supplierOrder?.purchase_order_id);
  return Number.isFinite(purchaseOrderId) ? purchaseOrderId : null;
}

function buildLast30DaysChart(
  createdOrders: any[],
  receivedOrders: ReceivedPurchaseOrderRow[]
): DailyActivity[] {
  const grouped: Record<
    string,
    { created: number; receivedPurchaseOrders: Set<number> }
  > = {};
  for (let i = 29; i >= 0; i--) {
    const dateStr = format(subDays(new Date(), i), 'MMM dd');
    grouped[dateStr] = { created: 0, receivedPurchaseOrders: new Set<number>() };
  }

  createdOrders.forEach((po) => {
    const dateStr = format(parseISO(po.created_at), 'MMM dd');
    if (grouped[dateStr]) grouped[dateStr].created++;
  });

  receivedOrders.forEach((receipt) => {
    const purchaseOrderId = getReceiptPurchaseOrderId(receipt);
    if (!purchaseOrderId) return;

    const dateStr = format(parseISO(receipt.receipt_date), 'MMM dd');
    if (grouped[dateStr]) {
      grouped[dateStr].receivedPurchaseOrders.add(purchaseOrderId);
    }
  });

  const chartData: DailyActivity[] = [];
  for (let i = 29; i >= 0; i--) {
    const dateStr = format(subDays(new Date(), i), 'MMM dd');
    chartData.push({
      date: dateStr,
      created: grouped[dateStr].created,
      received: grouped[dateStr].receivedPurchaseOrders.size,
    });
  }
  return chartData;
}

export function PurchaseActivityChart() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'purchase-activity-chart'],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30);

      const [{ data: createdOrders, error: createdError }, { data: receivedOrders, error: receivedError }] =
        await Promise.all([
          supabase
            .from('purchase_orders')
            .select('created_at')
            .gte('created_at', thirtyDaysAgo.toISOString())
            .order('created_at', { ascending: true }),
          supabase
            .from('supplier_order_receipts')
            .select(`
              receipt_date,
              supplier_orders!inner(
                purchase_order_id
              )
            `)
            .gte('receipt_date', thirtyDaysAgo.toISOString())
            .order('receipt_date', { ascending: true }),
        ]);

      if (createdError) throw createdError;
      if (receivedError) throw receivedError;

      return buildLast30DaysChart(createdOrders ?? [], receivedOrders ?? []);
    },
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-5 w-36 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-[220px] w-full animate-pulse rounded-lg bg-muted/50" />
      </div>
    );
  }

  const hasActivity = data?.some((d) => d.created > 0 || d.received > 0);

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Purchase Activity</h3>
        <span className="text-xs text-muted-foreground">Last 30 days</span>
      </div>
      {!hasActivity ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          No purchase orders created or received in the last 30 days.
        </div>
      ) : (
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(173, 58%, 50%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(173, 58%, 50%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradReceived" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              stroke="hsl(215, 20%, 65%)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tickCount={6}
            />
            <YAxis
              stroke="hsl(215, 20%, 65%)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload?.length) {
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {payload[0]?.payload?.date}
                      </p>
                      <p className="text-xs">
                        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-primary" />
                        Created: <span className="font-semibold">{payload[0]?.value}</span>
                      </p>
                      <p className="text-xs">
                        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-info" />
                        Received POs: <span className="font-semibold">{payload[1]?.value}</span>
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="created"
              stroke="hsl(173, 58%, 50%)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#gradCreated)"
            />
            <Area
              type="monotone"
              dataKey="received"
              stroke="hsl(217, 91%, 60%)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#gradReceived)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      )}
    </div>
  );
}

// ─── Order Status Donut Chart ────────────────────────────────────────────────

const STATUS_ID_LABELS: Record<number, string> = {
  [SO_STATUS.OPEN]: 'Open',
  [SO_STATUS.IN_PROGRESS]: 'In Progress',
  [SO_STATUS.COMPLETED]: 'Completed',
  [SO_STATUS.CANCELLED]: 'Cancelled',
  [SO_STATUS.DRAFT]: 'Draft',
  [SO_STATUS.PENDING_APPROVAL]: 'Pending Approval',
  [SO_STATUS.APPROVED]: 'Approved',
  [SO_STATUS.PARTIALLY_RECEIVED]: 'Partially Received',
  [SO_STATUS.FULLY_RECEIVED]: 'Received',
};

const STATUS_COLORS: Record<string, string> = {
  Draft: 'hsl(215, 20%, 65%)',
  'Pending Approval': 'hsl(38, 92%, 50%)',
  Approved: 'hsl(173, 58%, 50%)',
  'In Progress': 'hsl(200, 80%, 55%)',
  'Partially Received': 'hsl(217, 91%, 60%)',
  Received: 'hsl(142, 71%, 45%)',
  Completed: 'hsl(142, 71%, 35%)',
  Open: 'hsl(260, 50%, 60%)',
  Cancelled: 'hsl(0, 40%, 50%)',
};

interface StatusCount {
  name: string;
  value: number;
}

export function OrderStatusDonut() {
  const { data: statusData, isLoading } = useQuery({
    queryKey: ['dashboard', 'po-status-donut'],
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from('purchase_orders')
        .select('status_id');

      if (error) throw error;

      const counts: Record<string, number> = {};
      (orders ?? []).forEach((order: any) => {
        const label = STATUS_ID_LABELS[order.status_id] ?? 'Unknown';
        counts[label] = (counts[label] || 0) + 1;
      });

      return Object.entries(counts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    },
    staleTime: 120_000,
  });

  const data = statusData ?? [];
  const total = useMemo(
    () => data.reduce((sum, s) => sum + s.value, 0),
    [data]
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex h-[220px] items-center justify-center">
          <div className="h-40 w-40 animate-pulse rounded-full bg-muted/50" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">PO Status Breakdown</h3>
        <span className="text-xs text-muted-foreground">All orders</span>
      </div>
      <div className="flex h-[220px] items-center justify-center gap-4">
        <div className="relative h-[200px] w-[200px] shrink-0">
          <PieChart width={200} height={200}>
            <Pie
              data={data}
              cx={100}
              cy={100}
              innerRadius={55}
              outerRadius={80}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={STATUS_COLORS[entry.name] ?? 'hsl(215, 20%, 45%)'}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload?.length) {
                  const entry = payload[0];
                  return (
                    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
                      <p className="text-xs font-medium">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.value} order{Number(entry.value) !== 1 ? 's' : ''}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
          </PieChart>
          {/* Center label */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-2xl font-bold">{total}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Total
              </p>
            </div>
          </div>
        </div>
        {/* Legend */}
        <div className="space-y-1.5">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor:
                    STATUS_COLORS[entry.name] ?? 'hsl(215, 20%, 45%)',
                }}
              />
              <span className="text-muted-foreground">{entry.name}</span>
              <span className="font-semibold">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

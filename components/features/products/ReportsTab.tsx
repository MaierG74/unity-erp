'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AlertTriangle, BarChart3, Link2, Package, RefreshCcw } from 'lucide-react';

type InventoryRow = {
  product_id: number;
  quantity_on_hand: number | null;
  reorder_level: number | null;
};

type ReservationRow = {
  product_id: number;
  qty_reserved: number | null;
};

type Summary = {
  totalProducts: number;
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
  lowStock: number;
  outOfStock: number;
};

async function fetchSummary(): Promise<Summary> {
  const { count: totalProducts, error: productsError } = await supabase
    .from('products')
    .select('product_id', { count: 'exact', head: true });

  if (productsError) {
    throw productsError;
  }

  const [
    { data: inventoryRows, error: inventoryError },
    { data: reservationRows, error: reservationError },
  ] =
    await Promise.all([
      supabase
        .from('product_inventory')
        .select('product_id, quantity_on_hand, reorder_level'),
      supabase.from('product_reservations').select('product_id, qty_reserved'),
    ]);

  if (inventoryError) throw inventoryError;
  if (reservationError) throw reservationError;

  const inventoryByProduct = new Map<number, { qty: number; reorder: number | null }>();

  const inventoryData = (inventoryRows ?? []) as InventoryRow[];
  const reservationData = (reservationRows ?? []) as ReservationRow[];

  inventoryData.forEach((row) => {
    const entry = inventoryByProduct.get(row.product_id) ?? { qty: 0, reorder: null as number | null };
    entry.qty += Number(row.quantity_on_hand || 0);
    if (row.reorder_level != null) {
      entry.reorder = row.reorder_level;
    }
    inventoryByProduct.set(row.product_id, entry);
  });

  const reservationByProduct = new Map<number, number>();
  reservationData.forEach((row) => {
    reservationByProduct.set(
      row.product_id,
      (reservationByProduct.get(row.product_id) || 0) + Number(row.qty_reserved || 0)
    );
  });

  let totalOnHand = 0;
  let totalReserved = 0;
  let totalAvailable = 0;
  let lowStock = 0;
  let outOfStock = 0;

  inventoryByProduct.forEach((entry, productId) => {
    const reserved = reservationByProduct.get(productId) || 0;
    const available = Math.max(0, entry.qty - reserved);

    totalOnHand += entry.qty;
    totalReserved += reserved;
    totalAvailable += available;

    if (entry.qty <= 0) {
      outOfStock += 1;
    } else if (entry.reorder != null && entry.qty <= entry.reorder) {
      lowStock += 1;
    }
  });

  return {
    totalProducts: totalProducts ?? 0,
    totalOnHand,
    totalReserved,
    totalAvailable,
    lowStock,
    outOfStock,
  };
}

export function ProductsReportsTab() {
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['products', 'reports', 'summary'],
    queryFn: fetchSummary,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const cards = useMemo(() => {
    if (!data) return [];
    return [
      {
        title: 'Finished Goods On Hand',
        value: data.totalOnHand,
        description: 'Total units ready to ship',
        icon: Package,
        accent: 'text-green-600',
      },
      {
        title: 'Reserved for Orders',
        value: data.totalReserved,
        description: 'Allocated via FG reservations',
        icon: Link2,
        accent: 'text-amber-600',
      },
      {
        title: 'Available to Promise',
        value: data.totalAvailable,
        description: 'On hand minus reservations',
        icon: BarChart3,
        accent: 'text-blue-600',
      },
      {
        title: 'Low Stock Products',
        value: data.lowStock,
        description: 'At or below reorder level',
        icon: AlertTriangle,
        accent: 'text-amber-600',
      },
      {
        title: 'Out of Stock Products',
        value: data.outOfStock,
        description: 'Zero finished goods remaining',
        icon: AlertTriangle,
        accent: 'text-destructive',
      },
      {
        title: 'Catalog Size',
        value: data.totalProducts,
        description: 'Total active products',
        icon: Package,
        accent: 'text-muted-foreground',
      },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-sm text-muted-foreground">Loading product insights…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
        Unable to load finished-good summary: {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Finished-Good Snapshot</h2>
          <p className="text-sm text-muted-foreground">
            Quick stats for products inventory. Detailed shortage analytics track in{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              docs/plans/products-section-upgrade.md
            </code>
            .
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCcw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title} className="border bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <card.icon className={`h-5 w-5 ${card.accent}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground">{card.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What’s next?</CardTitle>
          <CardDescription>
            Deeper shortage, coverage, and costing insights are being implemented as part of the
            Products Section upgrade. Follow the plan for deliverable timelines.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Upcoming iterations will mirror the Inventory analytics experience: shortage heatmaps,
            order impact tables, and margin alerts. Today’s snapshot keeps planners informed while we
            build out the full experience.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

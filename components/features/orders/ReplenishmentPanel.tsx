'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, PackagePlus, TrendingDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  fetchReplenishmentSuggestions,
  type ReplenishmentSuggestion,
} from '@/lib/db/internalOrders';

export interface ReplenishmentPanelProps {
  orgId: string;
}

export function ReplenishmentPanel({ orgId }: ReplenishmentPanelProps) {
  const router = useRouter();

  const {
    data: suggestions = [],
    isLoading,
    isError,
  } = useQuery<ReplenishmentSuggestion[]>({
    queryKey: ['replenishment-suggestions', orgId],
    queryFn: () => fetchReplenishmentSuggestions(orgId),
    enabled: Boolean(orgId),
  });

  const prefillHref = useMemo(() => {
    if (suggestions.length === 0) return null;
    const prefill = suggestions.map((s) => ({
      product_id: s.product_id,
      quantity: s.suggested_qty,
    }));
    return `/orders/new-internal?prefill=${encodeURIComponent(
      JSON.stringify(prefill)
    )}`;
  }, [suggestions]);

  if (isLoading || isError) {
    // Stay quiet while loading, and don't surface a noisy error block here —
    // this is an advisory panel, not a primary workflow.
    return null;
  }

  if (suggestions.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-5 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          All stocked products are above their reorder level.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-amber-500" />
          {suggestions.length} stocked{' '}
          {suggestions.length === 1 ? 'product is' : 'products are'} below reorder
          level
        </CardTitle>
        <CardDescription>
          Restock these into inventory with a single internal order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y divide-border/50">
          {suggestions.map((s) => (
            <li
              key={s.product_id}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                {s.internal_code ? (
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {s.internal_code}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm tabular-nums">
                  <span className="font-medium text-amber-500">
                    {s.quantity_on_hand}
                  </span>
                  <span className="text-muted-foreground"> / {s.reorder_level}</span>
                </p>
                <p className="text-xs text-muted-foreground">on hand / reorder</p>
              </div>
              <div className="w-20 shrink-0 text-right">
                <p className="text-sm font-medium tabular-nums">+{s.suggested_qty}</p>
                <p className="text-xs text-muted-foreground">suggested</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex justify-end border-t border-border/50 pt-4">
          <Button
            type="button"
            onClick={() => {
              if (prefillHref) router.push(prefillHref);
            }}
            disabled={!prefillHref}
          >
            <PackagePlus className="mr-2 h-4 w-4" />
            Create internal order for these
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default ReplenishmentPanel;

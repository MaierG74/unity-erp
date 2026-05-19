'use client';

import React from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { QuoteItem, QuoteItemCluster } from '@/lib/db/quotes';
import { formatCurrency } from '@/lib/db/quotes';
import {
  getQuoteCostingGroups,
  hasPersistedQuoteCostingLines,
  type QuoteCostingGroupKey,
  type QuoteCostingLineView,
} from '@/lib/quotes/costing-tree';
import { cn } from '@/lib/utils';

interface QuoteProductCostingTreeProps {
  item: QuoteItem;
  onClustersChange: (itemId: string, clusters: QuoteItemCluster[]) => void;
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString('en-ZA', { maximumFractionDigits: 3 });
}

function formatDelta(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) < 0.005) return 'R0.00';
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`;
}

function statusBadge(line: QuoteCostingLineView) {
  if (line.status === 'missing_price') {
    return <Badge variant="outline" className="border-amber-500/40 text-amber-600">check price on order</Badge>;
  }
  if (line.status === 'override') {
    return <Badge variant="secondary">override</Badge>;
  }
  if (line.status === 'info') {
    return <Badge variant="outline">summary</Badge>;
  }
  return <span className="text-muted-foreground">—</span>;
}

export function QuoteProductCostingTree({ item, onClustersChange }: QuoteProductCostingTreeProps) {
  const [openGroups, setOpenGroups] = React.useState<Record<QuoteCostingGroupKey, boolean>>({
    board_materials: true,
    edging: true,
    hardware_components: false,
    labour: false,
    overhead: false,
    commercial: false,
  });
  const [draftCosts, setDraftCosts] = React.useState<Record<string, string>>({});
  const [initializing, setInitializing] = React.useState(false);
  const [savingLineId, setSavingLineId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const groups = React.useMemo(() => getQuoteCostingGroups(item), [item]);
  const hasCosting = hasPersistedQuoteCostingLines(item);
  const snapshotDate = item.quote_item_clusters?.[0]?.created_at
    ? new Date(item.quote_item_clusters[0].created_at).toLocaleDateString('en-ZA')
    : null;

  React.useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const group of groups) {
      for (const line of group.lines) {
        if (line.editable && line.quoteUnitCost !== null) {
          nextDrafts[line.id] = String(line.quoteUnitCost);
        }
      }
    }
    setDraftCosts(nextDrafts);
  }, [groups]);

  async function initializeCosting() {
    const confirmed = window.confirm(
      'Create quote-owned costing detail from today\'s product costs? This does not change the quote price, totals, product prices, or supplier prices.'
    );
    if (!confirmed) return;

    setInitializing(true);
    setError(null);
    try {
      const response = await authorizedFetch(`/api/quote-items/${item.id}/costing`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to create quote costing detail');
      onClustersChange(item.id, payload?.clusters ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create quote costing detail');
    } finally {
      setInitializing(false);
    }
  }

  async function saveLineCost(line: QuoteCostingLineView) {
    const rawValue = draftCosts[line.id];
    const nextValue = Number(rawValue);
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      setError('Enter a non-negative quote cost.');
      setDraftCosts((current) => ({ ...current, [line.id]: String(line.quoteUnitCost ?? 0) }));
      return;
    }
    if (line.quoteUnitCost !== null && Math.abs(nextValue - line.quoteUnitCost) < 0.005) return;

    setSavingLineId(line.id);
    setError(null);
    try {
      const response = await authorizedFetch(`/api/quote-items/${item.id}/costing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_id: line.id, unit_cost: nextValue }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to update quote cost');
      onClustersChange(item.id, payload?.clusters ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quote cost');
      setDraftCosts((current) => ({ ...current, [line.id]: String(line.quoteUnitCost ?? 0) }));
    } finally {
      setSavingLineId(null);
    }
  }

  if (!hasCosting) {
    return (
      <div className="border-t bg-muted/20 px-4 py-3">
        <div className="rounded-lg border bg-background p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Quote costing detail</div>
              <p className="max-w-3xl text-xs text-muted-foreground">
                Create a quote-owned costing snapshot from current product costs. Older quote rows stay unchanged until this is clicked.
              </p>
            </div>
            <Button size="sm" onClick={initializeCosting} disabled={initializing}>
              {initializing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Make costing editable for this quote
            </Button>
          </div>
          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t bg-muted/20 px-4 py-3">
      <div className="rounded-lg border bg-background">
        <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-semibold">Quote costing detail</div>
            <p className="text-xs text-muted-foreground">
              {snapshotDate ? `Baseline captured ${snapshotDate}. ` : ''}
              Deltas compare quote costs to the captured source cost. Quote price and totals stay unchanged.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">Quote-only costs</Badge>
        </div>

        {error ? (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </div>
        ) : null}

        <div className="divide-y">
          {groups.map((group) => {
            const isOpen = openGroups[group.key];
            const hasWarnings = group.warningCount > 0;
            return (
              <div key={group.key}>
                <button
                  type="button"
                  className="grid w-full grid-cols-[minmax(180px,1fr)_90px_90px_90px_90px] items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40"
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{group.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{group.description}</span>
                    </span>
                  </span>
                  <span className="text-right tabular-nums">{formatCurrency(group.total)}</span>
                  <span className={cn('text-right tabular-nums', group.delta && group.delta > 0 ? 'text-amber-600' : group.delta && group.delta < 0 ? 'text-emerald-600' : 'text-muted-foreground')}>
                    {formatDelta(group.delta)}
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    {group.overrideCount || 0} override{group.overrideCount === 1 ? '' : 's'}
                  </span>
                  <span className={cn('text-right text-xs', hasWarnings ? 'text-amber-600' : 'text-muted-foreground')}>
                    {group.warningCount || 0} warning{group.warningCount === 1 ? '' : 's'}
                  </span>
                </button>

                {isOpen ? (
                  <div className="overflow-x-auto px-4 pb-4">
                    {group.lines.length === 0 ? (
                      <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">No lines in this group.</div>
                    ) : (
                      <div className="min-w-[860px] rounded-md border">
                        <div className="grid grid-cols-[minmax(220px,1fr)_120px_140px_90px_110px_100px_150px] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <span>Description</span>
                          <span className="text-right">Source cost</span>
                          <span className="text-right">Quote cost</span>
                          <span className="text-right">Qty</span>
                          <span className="text-right">Total</span>
                          <span className="text-right">Delta</span>
                          <span>Status</span>
                        </div>
                        {group.lines.map((line) => (
                          <div key={line.id} className="grid grid-cols-[minmax(220px,1fr)_120px_140px_90px_110px_100px_150px] items-center gap-3 px-3 py-2 text-sm odd:bg-muted/15">
                            <span className="min-w-0 truncate font-medium">{line.description}</span>
                            <span className="text-right tabular-nums text-muted-foreground">
                              {line.sourceUnitCost === null ? '—' : formatCurrency(line.sourceUnitCost)}
                            </span>
                            <span className="text-right">
                              {line.editable ? (
                                <span className="relative block">
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={draftCosts[line.id] ?? ''}
                                    onChange={(event) => setDraftCosts((current) => ({ ...current, [line.id]: event.target.value }))}
                                    onBlur={() => saveLineCost(line)}
                                    className="h-8 pr-8 text-right"
                                    aria-label={`Quote cost for ${line.description}`}
                                  />
                                  {savingLineId === line.id ? <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-muted-foreground" /> : null}
                                </span>
                              ) : (
                                <span className="tabular-nums">{line.quoteUnitCost === null ? '—' : formatCurrency(line.quoteUnitCost)}</span>
                              )}
                            </span>
                            <span className="text-right tabular-nums text-muted-foreground">{formatQty(line.displayQuantity)}</span>
                            <span className="text-right tabular-nums">{line.quoteTotal === null ? '—' : formatCurrency(line.quoteTotal)}</span>
                            <span className={cn('text-right tabular-nums', line.delta && line.delta > 0 ? 'text-amber-600' : line.delta && line.delta < 0 ? 'text-emerald-600' : 'text-muted-foreground')}>
                              {formatDelta(line.delta)}
                            </span>
                            <span className="text-xs">{statusBadge(line)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

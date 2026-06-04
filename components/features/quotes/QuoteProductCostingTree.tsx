'use client';

import React from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { QuoteItem, QuoteItemCluster } from '@/lib/db/quotes';
import { formatCurrency } from '@/lib/db/quotes';
import {
  getQuoteCostingGroups,
  hasPersistedQuoteCostingLines,
  isQuoteCostingMaterialsStale,
  type QuoteCostingGroupKey,
  type QuoteCostingLineView,
} from '@/lib/quotes/costing-tree';
import {
  calculateMarkupAmountPerUnit,
  calculateMarkupPercentFromFixedAmount,
  calculateMarkupPercentFromTargetPrice,
  calculateUnitPriceFromMarkupPercent,
} from '@/lib/quotes/markup';
import { cn } from '@/lib/utils';

interface QuoteProductCostingTreeProps {
  item: QuoteItem;
  onClustersChange: (itemId: string, clusters: QuoteItemCluster[]) => void;
  onUpdateItemPrice?: (itemId: string, price: number) => void | Promise<void>;
  onUpdateClusterMarkup?: (clusterId: string, markupPercent: number) => void | Promise<void>;
  costSurchargeMode?: boolean;
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString('en-ZA', { maximumFractionDigits: 3 });
}

function formatDelta(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) < 0.005) return 'R0.00';
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`;
}

function formatCostSurchargeSummary(line: QuoteCostingLineView): string | null {
  if (!line.costSurchargeKind || line.costSurchargeValue === null) return null;
  const value = line.costSurchargeKind === 'percentage'
    ? `${line.costSurchargeValue}%`
    : formatCurrency(line.costSurchargeValue);
  const resolved = line.costSurchargeResolved === null ? '' : ` (${formatDelta(line.costSurchargeResolved)}/unit)`;
  return `${line.costSurchargeLabel || 'Cost surcharge'} · ${value}${resolved}`;
}

export function QuoteProductCostingTree({
  item,
  onClustersChange,
  onUpdateItemPrice,
  onUpdateClusterMarkup,
  costSurchargeMode = false,
}: QuoteProductCostingTreeProps) {
  const [openGroups, setOpenGroups] = React.useState<Record<QuoteCostingGroupKey, boolean>>({
    board_materials: false,
    edging: false,
    hardware_components: false,
    labour: false,
    overhead: false,
    commercial: false,
  });
  const [draftCosts, setDraftCosts] = React.useState<Record<string, string>>({});
  const [surchargeDrafts, setSurchargeDrafts] = React.useState<Record<string, string>>({});
  const [surchargeKindDrafts, setSurchargeKindDrafts] = React.useState<Record<string, 'fixed' | 'percentage'>>({});
  const [initializing, setInitializing] = React.useState(false);
  const [dialog, setDialog] = React.useState<'initialize' | 'refresh' | null>(null);
  const [savingLineId, setSavingLineId] = React.useState<string | null>(null);
  const [savingMarkup, setSavingMarkup] = React.useState(false);
  const [updatingPrice, setUpdatingPrice] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [markupPercentDraft, setMarkupPercentDraft] = React.useState('0');
  const [markupAmountDraft, setMarkupAmountDraft] = React.useState('0');
  const [targetPriceDraft, setTargetPriceDraft] = React.useState('0');
  const [priceBuilderError, setPriceBuilderError] = React.useState<string | null>(null);

  const groups = React.useMemo(() => getQuoteCostingGroups(item), [item]);
  const hasCosting = hasPersistedQuoteCostingLines(item);
  const materialsStale = isQuoteCostingMaterialsStale(item);
  const snapshotDate = item.quote_item_clusters?.[0]?.created_at
    ? new Date(item.quote_item_clusters[0].created_at).toLocaleDateString('en-ZA')
    : null;
  const lineGridClass = costSurchargeMode
    ? 'grid-cols-[minmax(260px,1fr)_120px_120px_150px_90px_110px_100px]'
    : 'grid-cols-[minmax(260px,1fr)_120px_150px_90px_110px_100px]';
  const tableMinWidthClass = costSurchargeMode ? 'min-w-[950px]' : 'min-w-[800px]';
  const commercialSummary = groups.find((group) => group.key === 'commercial')?.commercialSummary ?? null;
  const primaryClusterId = item.quote_item_clusters?.[0]?.id ?? null;
  const nonCommercialGroups = React.useMemo(
    () => groups.filter((group) => group.key !== 'commercial'),
    [groups],
  );
  const draftPercent = Number(markupPercentDraft);
  const draftUnitPrice = commercialSummary && markupPercentDraft.trim() !== '' && Number.isFinite(draftPercent)
    ? calculateUnitPriceFromMarkupPercent(commercialSummary.quoteCostUnitTotal, draftPercent)
    : commercialSummary?.currentUnitPrice ?? 0;
  const draftLineTotal = Math.round(draftUnitPrice * Math.max(Number(item.qty ?? 0), 0) * 100) / 100;

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

  React.useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    const nextKinds: Record<string, 'fixed' | 'percentage'> = {};
    for (const group of groups) {
      for (const line of group.lines) {
        if (!line.editable) continue;
        nextKinds[line.id] = line.costSurchargeKind ?? 'fixed';
        nextDrafts[line.id] = line.costSurchargeValue === null ? '' : String(line.costSurchargeValue);
      }
    }
    setSurchargeDrafts(nextDrafts);
    setSurchargeKindDrafts(nextKinds);
  }, [groups]);

  React.useEffect(() => {
    if (!commercialSummary) return;
    const percent = commercialSummary.markupPercent;
    const amount = calculateMarkupAmountPerUnit(commercialSummary.quoteCostUnitTotal, percent);
    const target = calculateUnitPriceFromMarkupPercent(commercialSummary.quoteCostUnitTotal, percent);
    setMarkupPercentDraft(percent === 0 ? '' : String(percent));
    setMarkupAmountDraft(amount === 0 ? '' : String(amount));
    setTargetPriceDraft(target === 0 ? '' : String(target));
    setPriceBuilderError(null);
  }, [commercialSummary]);

  async function postCosting(action?: 'refresh_materials') {
    setInitializing(true);
    setError(null);
    try {
      const response = await authorizedFetch(`/api/quote-items/${item.id}/costing`, action ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      } : { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to update quote costing detail');
      onClustersChange(item.id, payload?.clusters ?? []);
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quote costing detail');
    } finally {
      setInitializing(false);
    }
  }

  async function initializeCosting() { await postCosting(); }
  async function refreshMaterials() { await postCosting('refresh_materials'); }

  function setPriceBuilderFromPercent(rawValue: string) {
    setMarkupPercentDraft(rawValue);
    const percent = Number(rawValue);
    if (!commercialSummary || rawValue.trim() === '' || !Number.isFinite(percent)) {
      setPriceBuilderError(rawValue.trim() === '' ? null : 'Enter a valid markup percentage.');
      return;
    }
    const amount = calculateMarkupAmountPerUnit(commercialSummary.quoteCostUnitTotal, percent);
    const target = calculateUnitPriceFromMarkupPercent(commercialSummary.quoteCostUnitTotal, percent);
    setMarkupAmountDraft(String(amount));
    setTargetPriceDraft(String(target));
    setPriceBuilderError(target < 0 ? 'New unit price cannot be negative.' : null);
  }

  function setPriceBuilderFromAmount(rawValue: string) {
    setMarkupAmountDraft(rawValue);
    const amount = Number(rawValue);
    if (!commercialSummary || rawValue.trim() === '' || !Number.isFinite(amount)) {
      setPriceBuilderError(rawValue.trim() === '' ? null : 'Enter a valid Rand markup per unit.');
      return;
    }
    const percent = calculateMarkupPercentFromFixedAmount(commercialSummary.quoteCostUnitTotal, amount);
    if (percent === null) {
      setPriceBuilderError('Quote cost per unit is zero, so Rand markup cannot be converted to a stored markup percentage.');
      return;
    }
    const target = calculateUnitPriceFromMarkupPercent(commercialSummary.quoteCostUnitTotal, percent);
    setMarkupPercentDraft(String(percent));
    setTargetPriceDraft(String(target));
    setPriceBuilderError(target < 0 ? 'New unit price cannot be negative.' : null);
  }

  function setPriceBuilderFromTarget(rawValue: string) {
    setTargetPriceDraft(rawValue);
    const target = Number(rawValue);
    if (!commercialSummary || rawValue.trim() === '' || !Number.isFinite(target)) {
      setPriceBuilderError(rawValue.trim() === '' ? null : 'Enter a valid target unit price.');
      return;
    }
    const percent = calculateMarkupPercentFromTargetPrice(commercialSummary.quoteCostUnitTotal, target);
    if (percent === null) {
      setPriceBuilderError('Quote cost per unit is zero, so target price cannot be converted to a stored markup percentage.');
      return;
    }
    const amount = calculateMarkupAmountPerUnit(commercialSummary.quoteCostUnitTotal, percent);
    setMarkupPercentDraft(String(percent));
    setMarkupAmountDraft(String(amount));
    setPriceBuilderError(target < 0 ? 'New unit price cannot be negative.' : null);
  }

  function readPriceBuilder() {
    if (!commercialSummary) return { error: 'Commercial summary is unavailable.' } as const;
    const percent = Number(markupPercentDraft);
    const unitPrice = calculateUnitPriceFromMarkupPercent(commercialSummary.quoteCostUnitTotal, percent);
    if (markupPercentDraft.trim() === '' || !Number.isFinite(percent)) {
      return { error: 'Enter a valid markup before saving.' } as const;
    }
    if (unitPrice < 0) {
      return { error: 'New unit price cannot be negative.' } as const;
    }
    return {
      error: null,
      markupPercent: Math.round(percent * 100) / 100,
      unitPrice,
      lineTotal: Math.round(unitPrice * Math.max(Number(item.qty ?? 0), 0) * 100) / 100,
    } as const;
  }

  async function saveMarkupOnly(): Promise<number | null> {
    const next = readPriceBuilder();
    if (next.error) {
      setPriceBuilderError(next.error);
      return null;
    }
    if (!primaryClusterId || !onUpdateClusterMarkup) {
      setPriceBuilderError('No costing cluster is available for markup updates.');
      return null;
    }
    setSavingMarkup(true);
    setPriceBuilderError(null);
    try {
      await onUpdateClusterMarkup(primaryClusterId, next.markupPercent);
      return next.markupPercent;
    } catch (err) {
      setPriceBuilderError(err instanceof Error ? err.message : 'Failed to save markup.');
      return null;
    } finally {
      setSavingMarkup(false);
    }
  }

  async function saveMarkupAndUpdatePrice() {
    const next = readPriceBuilder();
    if (next.error) {
      setPriceBuilderError(next.error);
      return;
    }
    if (!primaryClusterId || !onUpdateClusterMarkup) {
      setPriceBuilderError('No costing cluster is available for markup updates.');
      return;
    }
    if (!onUpdateItemPrice) {
      setPriceBuilderError('Line price updates are unavailable here.');
      return;
    }

    const priceUpdated = await updateLinePriceFromQuoteCosts(next.unitPrice);
    if (!priceUpdated) return;

    // Save markup last so the estimator's typed markup wins after the normal unit_price path
    // recomputes markup from the updated customer-facing price.
    setSavingMarkup(true);
    setPriceBuilderError(null);
    try {
      await onUpdateClusterMarkup(primaryClusterId, next.markupPercent);
    } catch (err) {
      setPriceBuilderError(err instanceof Error ? err.message : 'Failed to save markup.');
    } finally {
      setSavingMarkup(false);
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

  async function updateLinePriceFromQuoteCosts(price: number): Promise<boolean> {
    if (!onUpdateItemPrice) return false;
    setUpdatingPrice(true);
    setError(null);
    try {
      await onUpdateItemPrice(item.id, price);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quote line price');
      return false;
    } finally {
      setUpdatingPrice(false);
    }
  }

  async function saveLineSurcharge(line: QuoteCostingLineView, clear = false) {
    const rawValue = (surchargeDrafts[line.id] ?? '').trim();
    const value = Number(rawValue);
    const kind = surchargeKindDrafts[line.id] ?? line.costSurchargeKind ?? 'fixed';

    if (!clear && rawValue === '' && !line.costSurchargeKind) return;
    if (!clear && (rawValue === '' || (Number.isFinite(value) && Math.abs(value) < 0.005))) {
      clear = true;
    }
    if (!clear && !Number.isFinite(value)) {
      setError('Enter a valid numeric line surcharge value.');
      setSurchargeDrafts((current) => ({ ...current, [line.id]: String(line.costSurchargeValue ?? '') }));
      setSurchargeKindDrafts((current) => ({ ...current, [line.id]: line.costSurchargeKind ?? 'fixed' }));
      return;
    }

    setSavingLineId(line.id);
    setError(null);
    try {
      const response = await authorizedFetch(`/api/quote-items/${item.id}/costing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clear ? {
          line_id: line.id,
          action: 'clear_cost_surcharge',
        } : {
          line_id: line.id,
          action: 'cost_surcharge',
          cost_surcharge_kind: kind,
          cost_surcharge_value: value,
          cost_surcharge_label: line.costSurchargeLabel || 'Cost surcharge',
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to update line surcharge');
      onClustersChange(item.id, payload?.clusters ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update line surcharge');
      setSurchargeDrafts((current) => ({ ...current, [line.id]: String(line.costSurchargeValue ?? '') }));
      setSurchargeKindDrafts((current) => ({ ...current, [line.id]: line.costSurchargeKind ?? 'fixed' }));
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
            <Button size="sm" onClick={() => setDialog('initialize')} disabled={initializing}>
              {initializing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Make costing editable for this quote
            </Button>
          </div>
          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        </div>
        <AlertDialog open={dialog === 'initialize'} onOpenChange={(open) => !initializing && setDialog(open ? 'initialize' : null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Create quote costing detail?</AlertDialogTitle>
              <AlertDialogDescription>
                This creates quote-owned costing rows from current product costs and current Materials. Quote selling price, totals, product prices, and supplier prices stay unchanged.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={initializing}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={initializing} onClick={(event) => { event.preventDefault(); void initializeCosting(); }}>
                {initializing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Make costing editable
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <>
    <div className="border-t bg-muted/20 px-4 py-3">
      <div className="rounded-lg border bg-background">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-2.5">
          <div className="text-sm font-semibold">Quote costing detail</div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {costSurchargeMode ? <span className="text-amber-600">Cost surcharge mode</span> : null}
            {snapshotDate ? <span>Captured {snapshotDate}</span> : null}
          </div>
        </div>

        {materialsStale ? (
          <div className="mx-4 mt-3 flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> Materials changed since costing rows were captured.</span>
            <Button size="sm" variant="outline" onClick={() => setDialog('refresh')} disabled={initializing}>Refresh costing from current materials</Button>
          </div>
        ) : null}

        {error ? (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </div>
        ) : null}

        <AlertDialog open={dialog === 'refresh'} onOpenChange={(open) => !initializing && setDialog(open ? 'refresh' : null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Refresh costing from current materials?</AlertDialogTitle>
              <AlertDialogDescription>
                Quote selling price and material surcharge stay unchanged. Board/edging rows rebuild from current Materials; same-material quote cost overrides may be kept; changed-material overrides are discarded; source-cost baseline refreshes to today’s selected material costs.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={initializing}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={initializing} onClick={(event) => { event.preventDefault(); void refreshMaterials(); }}>
                {initializing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Refresh costing from current materials
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {commercialSummary ? (
          <div className="px-5 py-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Price</div>
              <div className="text-[11px] text-muted-foreground">
                Stored markup <span className="font-medium tabular-nums text-foreground">{commercialSummary.markupPercent}%</span>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current</div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums">
                  {formatCurrency(commercialSummary.currentUnitPrice)}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">/ unit</span>
                </div>
              </div>
              <ArrowRight className="mb-2 h-4 w-4 text-muted-foreground/60" aria-hidden />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Proposed</div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums">
                  {formatCurrency(draftUnitPrice)}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">/ unit</span>
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Line total</div>
                <div className="mt-0.5 text-base tabular-nums">{formatCurrency(draftLineTotal)}</div>
              </div>
            </div>

            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Markup %</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={markupPercentDraft}
                  onChange={(event) => setPriceBuilderFromPercent(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-8 bg-background text-right text-sm tabular-nums"
                  aria-label="Markup percentage"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Markup R / unit</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={markupAmountDraft}
                  onChange={(event) => setPriceBuilderFromAmount(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-8 bg-background text-right text-sm tabular-nums"
                  aria-label="Markup Rand per unit"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Target price / unit</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={targetPriceDraft}
                  onChange={(event) => setPriceBuilderFromTarget(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-8 bg-background text-right text-sm tabular-nums"
                  aria-label="Target price per unit"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[11px] text-muted-foreground">
                Quote cost <span className="font-medium tabular-nums text-foreground">{formatCurrency(commercialSummary.quoteCostUnitTotal)}</span> / unit
                <span className="mx-2 text-muted-foreground/40">·</span>
                Qty <span className="font-medium tabular-nums text-foreground">{Number(item.qty ?? 0).toLocaleString('en-ZA')}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void saveMarkupOnly()}
                  disabled={savingMarkup || updatingPrice || Boolean(priceBuilderError) || !primaryClusterId || !onUpdateClusterMarkup}
                  title="Save the stored markup percentage only. Customer-facing quote price stays unchanged."
                >
                  {savingMarkup ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  Save markup only
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void saveMarkupAndUpdatePrice()}
                  disabled={savingMarkup || updatingPrice || Boolean(priceBuilderError) || !primaryClusterId || !onUpdateClusterMarkup || !onUpdateItemPrice}
                  title="Save markup, then copy quote cost plus markup into the customer-facing unit price. Quote material/BOM surcharges stay unchanged."
                >
                  {updatingPrice ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  Save markup + update line price
                </Button>
              </div>
            </div>
            {priceBuilderError ? <p className="mt-3 text-xs text-destructive">{priceBuilderError}</p> : null}
          </div>
        ) : null}

        <div className="border-t bg-muted/15">
          <div className="flex items-baseline justify-between gap-3 px-5 pt-3 pb-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Internal cost build-up</div>
              <p className="text-[11px] text-muted-foreground">Stays out of the customer-facing price.</p>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums">
                {commercialSummary ? formatCurrency(commercialSummary.quoteCostUnitTotal) : '—'}
                <span className="ml-1 text-xs font-normal text-muted-foreground">/ unit</span>
              </div>
            </div>
          </div>

          <div className="divide-y border-t border-border/60">
            {nonCommercialGroups.map((group) => {
              const isOpen = openGroups[group.key];
              const hasWarnings = group.warningCount > 0;
              const deltaNonZero = group.delta !== null && Math.abs(group.delta) >= 0.005;
              return (
                <div key={group.key}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm hover:bg-muted/40"
                    onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="flex-1 truncate font-medium">{group.label}</span>
                    {hasWarnings ? (
                      <span className="flex items-center gap-1 text-xs text-amber-600" title={`${group.warningCount} warning${group.warningCount === 1 ? '' : 's'}`}>
                        <AlertTriangle className="h-3 w-3" />
                        {group.warningCount}
                      </span>
                    ) : null}
                    {deltaNonZero ? (
                      <span className={cn('text-xs tabular-nums', group.delta! > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                        {formatDelta(group.delta)}
                      </span>
                    ) : null}
                    <span className="tabular-nums">{formatCurrency(group.total)}</span>
                  </button>

                  {isOpen ? (
                    <div className="overflow-x-auto bg-background/40 px-5 pb-4 pt-2">
                      {group.lines.length === 0 ? (
                        <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">No lines in this group.</div>
                      ) : (
                        <div className={cn(tableMinWidthClass, 'rounded-md border')}>
                          <div className={cn('grid gap-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground', lineGridClass)}>
                            <span>Description</span>
                            <span className="text-right">Source cost</span>
                            {costSurchargeMode ? <span className="text-right">Surcharge</span> : null}
                            <span className="text-right">Quote cost</span>
                            <span className="text-right">Qty</span>
                            <span className="text-right">Total</span>
                            <span className="text-right">Delta</span>
                          </div>
                          {group.lines.map((line) => (
                            <div key={line.id} className={cn('grid items-center gap-3 px-3 py-2 text-sm odd:bg-muted/15', lineGridClass)}>
                              <span className="flex min-w-0 items-center gap-2 truncate font-medium">
                                <span className="truncate">{line.description}</span>
                                {line.status === 'missing_price' ? (
                                  <Badge variant="outline" className="shrink-0 border-amber-500/40 px-1.5 py-0 text-[10px] text-amber-600">price?</Badge>
                                ) : null}
                                {line.status === 'info' ? (
                                  <span className="shrink-0 rounded-full border px-1.5 py-0 text-[10px] text-muted-foreground">summary</span>
                                ) : null}
                              </span>
                              <span className="text-right tabular-nums text-muted-foreground">
                                {line.sourceUnitCost === null ? '—' : formatCurrency(line.sourceUnitCost)}
                              </span>
                              {costSurchargeMode ? (
                                <span className="relative block text-right">
                                  {line.editable ? (
                                    <span className="relative block">
                                      <button
                                        type="button"
                                        className="absolute left-1 top-1 z-10 h-6 min-w-6 rounded border bg-background px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                                        aria-label={`Toggle cost surcharge kind for ${line.description}`}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => setSurchargeKindDrafts((current) => ({
                                          ...current,
                                          [line.id]: (current[line.id] ?? line.costSurchargeKind ?? 'fixed') === 'fixed' ? 'percentage' : 'fixed',
                                        }))}
                                        disabled={line.sourceUnitCost === null || savingLineId === line.id}
                                      >
                                        {(surchargeKindDrafts[line.id] ?? line.costSurchargeKind ?? 'fixed') === 'fixed' ? 'R' : '%'}
                                      </button>
                                      <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={surchargeDrafts[line.id] ?? ''}
                                        onChange={(event) => setSurchargeDrafts((current) => ({ ...current, [line.id]: event.target.value }))}
                                        onBlur={() => saveLineSurcharge(line)}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.preventDefault();
                                            event.currentTarget.blur();
                                          }
                                        }}
                                        placeholder="0"
                                        className="h-8 pr-6 pl-8 text-right"
                                        aria-label={`Cost surcharge for ${line.description}`}
                                        disabled={line.sourceUnitCost === null || savingLineId === line.id}
                                      />
                                      {line.costSurchargeKind ? (
                                        <button
                                          type="button"
                                          className="absolute right-2 top-1.5 text-xs text-muted-foreground hover:text-foreground"
                                          aria-label={`Clear cost surcharge for ${line.description}`}
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => saveLineSurcharge(line, true)}
                                          disabled={savingLineId === line.id}
                                        >
                                          ×
                                        </button>
                                      ) : null}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                  {formatCostSurchargeSummary(line) ? (
                                    <span
                                      className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500"
                                      title={formatCostSurchargeSummary(line) ?? undefined}
                                      aria-label={formatCostSurchargeSummary(line) ?? undefined}
                                    />
                                  ) : null}
                                </span>
                              ) : null}
                              <span className="text-right">
                                {line.editable ? (
                                  <span className="relative block">
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      value={draftCosts[line.id] ?? ''}
                                      onChange={(event) => setDraftCosts((current) => ({ ...current, [line.id]: event.target.value }))}
                                      onBlur={() => saveLineCost(line)}
                                      onFocus={(event) => event.currentTarget.select()}
                                      className="h-8 pr-8 text-right tabular-nums"
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
                              <span
                                className={cn('text-right tabular-nums', line.delta && line.delta > 0 ? 'text-amber-600' : line.delta && line.delta < 0 ? 'text-emerald-600' : 'text-muted-foreground')}
                                title={line.note ?? undefined}
                              >
                                {formatDelta(line.delta)}
                              </span>
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
    </div>
    </>
  );
}

'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTransactionsQuery } from '@/hooks/use-transactions-query';
import { useComponentStockSummary } from '@/hooks/use-component-stock-summary';
import { TransactionsToolbar } from './TransactionsToolbar';
import { TransactionsGroupedTable } from './TransactionsGroupedTable';
import { PrintView } from './PrintView';
import { StockAdjustmentDialog } from '@/components/features/inventory/component-detail/StockAdjustmentDialog';
import type { ViewConfig } from '@/types/transaction-views';
import { DEFAULT_VIEW_CONFIG } from '@/types/transaction-views';
import { toast } from 'sonner';

export function TransactionsExplorer() {
  const [config, setConfig] = useState<ViewConfig>(DEFAULT_VIEW_CONFIG);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [activeViewName, setActiveViewName] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{
    componentId: number;
    componentName: string;
    currentStock: number;
  } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: transactions = [], isLoading, error, dateRange } = useTransactionsQuery({
    dateFrom: config.dateRange.from,
    dateTo: config.dateRange.to,
    datePreset: config.dateRange.preset,
    productId: config.filters.productId,
    transactionTypeId: config.filters.transactionTypeId,
    supplierId: config.filters.supplierId,
    categoryId: config.filters.categoryId,
    componentIds: config.filters.componentIds,
    search: config.filters.search,
    composableFilter: config.filters.composableFilter,
  });

  // Get unique component IDs for stock summary (only when grouping by component)
  const componentIds = useMemo(() => {
    if (config.groupBy !== 'component' && config.groupBy !== 'supplier_component') return [];
    const ids = new Set<number>();
    transactions.forEach((t) => ids.add(t.component_id));
    return Array.from(ids);
  }, [transactions, config.groupBy]);

  const { data: stockSummaryMap } = useComponentStockSummary(componentIds);

  const orderedComponents = useMemo(() => {
    if (config.groupBy !== 'component') return [];
    const seen = new Map<number, { name: string; stock: number }>();
    transactions.forEach((t) => {
      if (!seen.has(t.component_id)) {
        seen.set(t.component_id, {
          name: t.component?.internal_code || 'Unknown',
          stock: stockSummaryMap?.get(t.component_id)?.quantityOnHand ?? 0,
        });
      }
    });
    return Array.from(seen.entries())
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map(([id, info]) => ({ componentId: id, ...info }));
  }, [transactions, config.groupBy, stockSummaryMap]);

  // Summary stats
  const summary = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    transactions.forEach((t) => {
      const qty = t.quantity || 0;
      if (qty > 0) totalIn += qty;
      else totalOut += Math.abs(qty);
    });
    return { total: transactions.length, totalIn, totalOut };
  }, [transactions]);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'transactions', 'explorer'] });
  }, [queryClient]);

  const handleAdjust = useCallback((componentId: number, componentName: string, currentStock: number) => {
    setAdjustTarget({ componentId, componentName, currentStock });
  }, []);

  const handleAdjustSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'transactions', 'explorer'] });
    queryClient.invalidateQueries({ queryKey: ['component-stock-summary'] });
  }, [queryClient]);

  const handleSaveAndNext = useCallback(() => {
    handleAdjustSuccess();
    if (!adjustTarget) return;
    const idx = orderedComponents.findIndex((c) => c.componentId === adjustTarget.componentId);
    const next = orderedComponents[idx + 1];
    if (next) {
      setAdjustTarget({ componentId: next.componentId, componentName: next.name, currentStock: next.stock });
    } else {
      setAdjustTarget(null);
      toast.info('All components adjusted');
    }
  }, [adjustTarget, orderedComponents, handleAdjustSuccess]);

  const handleLoadView = useCallback((viewConfig: ViewConfig, viewId: string, viewName: string) => {
    setConfig(viewConfig);
    setActiveViewId(viewId);
    setActiveViewName(viewName);
  }, []);

  const handleConfigChange = useCallback((newConfig: ViewConfig) => {
    setConfig(newConfig);
    // Mark view as dirty (no longer exactly matching saved view)
    setActiveViewId(null);
    setActiveViewName(null);
  }, []);

  if (error) {
    return (
      <div className="p-4">
        <div className="text-destructive">
          Error loading transactions: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <TransactionsToolbar
        config={config}
        onConfigChange={handleConfigChange}
        onRefresh={handleRefresh}
        onLoadView={handleLoadView}
        activeViewId={activeViewId}
        activeViewName={activeViewName}
        summary={summary}
        printRef={printRef}
        transactionCount={transactions.length}
      />

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <TransactionsGroupedTable
          transactions={transactions}
          groupBy={config.groupBy}
          stockSummaryMap={stockSummaryMap}
          onAdjust={handleAdjust}
        />
      )}

      {transactions.length >= 10000 && (
        <p className="text-sm text-amber-500 text-center">
          Results capped at 10,000 rows. Narrow your date range or add filters for complete results.
        </p>
      )}

      {/* Hidden print container */}
      <PrintView
        ref={printRef}
        transactions={transactions}
        groupBy={config.groupBy}
        config={config}
        dateRange={dateRange}
        summary={summary}
        stockSummaryMap={stockSummaryMap}
      />

      {adjustTarget && (
        <StockAdjustmentDialog
          open={!!adjustTarget}
          onOpenChange={(open) => { if (!open) setAdjustTarget(null); }}
          componentId={adjustTarget.componentId}
          componentName={adjustTarget.componentName}
          currentStock={adjustTarget.currentStock}
          onSuccess={handleAdjustSuccess}
          onSaveAndNext={orderedComponents.length > 1 ? handleSaveAndNext : undefined}
        />
      )}
    </div>
  );
}

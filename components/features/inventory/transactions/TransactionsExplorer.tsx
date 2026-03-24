'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTransactionsQuery } from '@/hooks/use-transactions-query';
import { useComponentStockSummary } from '@/hooks/use-component-stock-summary';
import { TransactionsToolbar } from './TransactionsToolbar';
import { TransactionsGroupedTable } from './TransactionsGroupedTable';
import { PrintView } from './PrintView';
import type { ViewConfig, EnrichedTransaction } from '@/types/transaction-views';
import { DEFAULT_VIEW_CONFIG } from '@/types/transaction-views';

export function TransactionsExplorer() {
  const [config, setConfig] = useState<ViewConfig>(DEFAULT_VIEW_CONFIG);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [activeViewName, setActiveViewName] = useState<string | null>(null);
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
  });

  // Get unique component IDs for stock summary (only when grouping by component)
  const componentIds = useMemo(() => {
    if (config.groupBy !== 'component' && config.groupBy !== 'supplier_component') return [];
    const ids = new Set<number>();
    transactions.forEach((t) => ids.add(t.component_id));
    return Array.from(ids);
  }, [transactions, config.groupBy]);

  const { data: stockSummaryMap } = useComponentStockSummary(componentIds);

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
        />
      )}

      {transactions.length >= 5000 && (
        <p className="text-sm text-amber-500 text-center">
          Results limited to 5,000 transactions. Narrow your date range for complete results.
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
    </div>
  );
}

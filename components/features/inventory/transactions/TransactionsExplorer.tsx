'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTransactionsQuery } from '@/hooks/use-transactions-query';
import { useComponentStockSummary } from '@/hooks/use-component-stock-summary';
import { TransactionsToolbar } from './TransactionsToolbar';
import { TransactionsGroupedTable } from './TransactionsGroupedTable';
import { PrintView } from './PrintView';
import { CountSheetPrintView, type CountSheetComponent } from './CountSheetPrintView';
import { StockAdjustmentDialog } from '@/components/features/inventory/component-detail/StockAdjustmentDialog';
import { BatchAdjustMode, type BatchEntry } from './BatchAdjustMode';
import type { ViewConfig } from '@/types/transaction-views';
import { DEFAULT_VIEW_CONFIG } from '@/types/transaction-views';
import { toast } from 'sonner';
import { useReactToPrint } from 'react-to-print';
import { supabase } from '@/lib/supabase';

export function TransactionsExplorer() {
  const [config, setConfig] = useState<ViewConfig>(DEFAULT_VIEW_CONFIG);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [activeViewName, setActiveViewName] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{
    componentId: number;
    componentName: string;
    currentStock: number;
  } | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const countSheetRef = useRef<HTMLDivElement>(null);
  const [countSheetData, setCountSheetData] = useState<CountSheetComponent[] | null>(null);
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

  const batchEntries: BatchEntry[] = useMemo(() => {
    if (!batchMode) return [];
    const seen = new Map<number, BatchEntry>();
    transactions.forEach((t) => {
      if (!seen.has(t.component_id)) {
        seen.set(t.component_id, {
          componentId: t.component_id,
          code: t.component?.internal_code || 'Unknown',
          description: t.component?.description || '',
          systemStock: stockSummaryMap?.get(t.component_id)?.quantityOnHand ?? 0,
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [batchMode, transactions, stockSummaryMap]);

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

  const handleDisableComponent = useCallback(async (componentId: number, componentName: string) => {
    const confirmed = window.confirm(
      `Disable ${componentName}? It will be hidden from PO creation, BOM pickers, and stock issue. Historical data is preserved.`
    );
    if (!confirmed) return;

    const { error } = await supabase
      .from('components')
      .update({ is_active: false })
      .eq('component_id', componentId);

    if (error) {
      toast.error('Failed to disable component', { description: error.message });
      return;
    }

    toast.success(`${componentName} disabled`);
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

  const handleBatchApply = useCallback(async (
    adjustments: Array<{ componentId: number; code: string; systemStock: number; newStock: number }>,
    reason: string,
    notes: string
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const fullReason = `${reason}${notes ? `: ${notes}` : ''}`;

    const results = await Promise.allSettled(
      adjustments.map(async (adj) => {
        const adjustmentQty = adj.newStock - adj.systemStock;

        const { error: txError } = await supabase.from('inventory_transactions').insert({
          component_id: adj.componentId,
          quantity: adjustmentQty,
          transaction_type_id: 3,
          transaction_date: new Date().toISOString(),
          user_id: user.id,
          reason: fullReason,
        });
        if (txError) throw txError;

        const { error: invError } = await supabase.from('inventory').upsert(
          { component_id: adj.componentId, quantity_on_hand: adj.newStock, reorder_level: 0, location: null },
          { onConflict: 'component_id' }
        );
        if (invError) throw invError;

        return adj;
      })
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected');

    if (failed.length === 0) {
      toast.success(`${succeeded} adjustments applied successfully`);
    } else {
      toast.warning(`${succeeded} succeeded, ${failed.length} failed`, {
        description: 'Failed items can be retried individually via the Adjust button.',
      });
    }

    queryClient.invalidateQueries({ queryKey: ['inventory', 'transactions', 'explorer'] });
    queryClient.invalidateQueries({ queryKey: ['component-stock-summary'] });
    setBatchMode(false);
  }, [queryClient]);

  const handleEnterBatchMode = useCallback(() => {
    if (config.groupBy !== 'component') {
      setConfig((prev) => ({ ...prev, groupBy: 'component' }));
    }
    setBatchMode(true);
  }, [config.groupBy]);

  const handlePrintCountSheetNow = useReactToPrint({
    contentRef: countSheetRef,
    documentTitle: 'Stock Count Sheet',
  });

  useEffect(() => {
    if (countSheetData) {
      const timer = setTimeout(() => {
        handlePrintCountSheetNow();
        setCountSheetData(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [countSheetData, handlePrintCountSheetNow]);

  const fetchCountSheetData = useCallback(async () => {
    let q = supabase
      .from('components')
      .select('component_id, internal_code, description, category_id, component_categories(categoryname), inventory(quantity_on_hand)')
      .order('internal_code');

    if (config.filters.categoryId && config.filters.categoryId !== 'all') {
      q = q.eq('category_id', Number(config.filters.categoryId));
    }
    if (config.filters.search?.trim()) {
      q = q.or(`internal_code.ilike.%${config.filters.search}%,description.ilike.%${config.filters.search}%`);
    }

    const { data, error: fetchError } = await q;
    if (fetchError) {
      toast.error('Failed to load count sheet data');
      return;
    }

    const components: CountSheetComponent[] = (data || []).map((c: any) => ({
      componentId: c.component_id,
      code: c.internal_code || '',
      description: c.description || '',
      category: (c.component_categories as any)?.categoryname || '',
      currentStock: Array.isArray(c.inventory) ? (c.inventory[0]?.quantity_on_hand ?? 0) : 0,
      onOrder: 0,
    }));

    setCountSheetData(components);
  }, [config.filters]);

  const countSheetFilterDesc = useMemo(() => {
    const parts: string[] = [];
    if (config.filters.categoryId && config.filters.categoryId !== 'all') parts.push('Category filter active');
    if (config.filters.search?.trim()) parts.push(`Search: "${config.filters.search}"`);
    if (config.filters.supplierId && config.filters.supplierId !== 'all') parts.push('Supplier filter active');
    return parts.length > 0 ? parts.join(' | ') : 'All components';
  }, [config.filters]);

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
        onPrintCountSheet={fetchCountSheetData}
        batchMode={batchMode}
        onBatchAdjust={handleEnterBatchMode}
      />

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : batchMode ? (
        <BatchAdjustMode
          entries={batchEntries}
          onApplyAll={handleBatchApply}
          onCancel={() => setBatchMode(false)}
        />
      ) : (
        <TransactionsGroupedTable
          transactions={transactions}
          groupBy={config.groupBy}
          stockSummaryMap={stockSummaryMap}
          onAdjust={handleAdjust}
          onDisableComponent={handleDisableComponent}
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

      {/* Hidden count sheet print container */}
      <CountSheetPrintView
        ref={countSheetRef}
        components={countSheetData || []}
        filterDescription={countSheetFilterDesc}
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

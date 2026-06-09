'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useTransactionsQuery } from '@/hooks/use-transactions-query';
import { useComponentStockSummary } from '@/hooks/use-component-stock-summary';
import { TransactionsToolbar } from './TransactionsToolbar';
import { TransactionsGroupedTable } from './TransactionsGroupedTable';
import { PrintView } from './PrintView';
import { CountSheetPrintView, type CountSheetComponent } from './CountSheetPrintView';
import { StockAdjustmentDialog } from '@/components/features/inventory/component-detail/StockAdjustmentDialog';
import { BatchAdjustMode, type BatchEntry } from './BatchAdjustMode';
import type { TransactionIssueAudit, ViewConfig } from '@/types/transaction-views';
import { DEFAULT_VIEW_CONFIG } from '@/types/transaction-views';
import { toast } from 'sonner';
import { useReactToPrint } from 'react-to-print';
import { supabase } from '@/lib/supabase';

const STORAGE_KEY = 'transactions-explorer-config';
const DETAIL_QUERY_CHUNK_SIZE = 500;

type ActorProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  login: string | null;
};

type StockIssuanceAuditRow = {
  transaction_id: number | null;
  issuance_id: number;
  staff_id: number | null;
  notes: string | null;
  external_reference: string | null;
  issue_category: string | null;
  quantity_issued: number | null;
  created_by: string | null;
  staff:
    | {
        first_name: string | null;
        last_name: string | null;
        job_description: string | null;
      }
    | Array<{
        first_name: string | null;
        last_name: string | null;
        job_description: string | null;
      }>
    | null;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function loadPersistedConfig(): ViewConfig {
  if (typeof window === 'undefined') return DEFAULT_VIEW_CONFIG;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_VIEW_CONFIG, ...JSON.parse(saved) };
  } catch { /* corrupted data — fall back to default */ }
  return DEFAULT_VIEW_CONFIG;
}

export function TransactionsExplorer() {
  const [config, setConfig] = useState<ViewConfig>(loadPersistedConfig);
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

  // Persist config to localStorage on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

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

  const actorUserIds = useMemo(() => {
    const ids = new Set<string>();
    transactions.forEach((transaction) => {
      if (transaction.user_id) ids.add(transaction.user_id);
    });
    return Array.from(ids).sort();
  }, [transactions]);

  const transactionIds = useMemo(() => {
    return transactions
      .map((transaction) => transaction.transaction_id)
      .filter((id): id is number => Number.isFinite(id))
      .sort((a, b) => a - b);
  }, [transactions]);

  const { data: actorProfiles = [] } = useQuery({
    queryKey: ['inventory', 'transactions', 'actor-profiles', actorUserIds],
    queryFn: async () => {
      const rows: ActorProfileRow[] = [];
      for (const chunk of chunkArray(actorUserIds, DETAIL_QUERY_CHUNK_SIZE)) {
        const { data, error: profileError } = await supabase
          .from('profiles')
          .select('id, username, display_name, login')
          .in('id', chunk);
        if (profileError) throw profileError;
        rows.push(...((data || []) as ActorProfileRow[]));
      }
      return rows;
    },
    enabled: actorUserIds.length > 0,
    staleTime: 60_000,
  });

  const actorNameById = useMemo(() => {
    const map = new Map<string, string>();
    actorProfiles.forEach((profile) => {
      const label = profile.display_name || profile.username || profile.login;
      if (profile.id && label) map.set(profile.id, label);
    });
    return map;
  }, [actorProfiles]);

  const { data: issueAuditRows = [] } = useQuery({
    queryKey: ['inventory', 'transactions', 'issue-audit', transactionIds],
    queryFn: async () => {
      const rows: StockIssuanceAuditRow[] = [];
      for (const chunk of chunkArray(transactionIds, DETAIL_QUERY_CHUNK_SIZE)) {
        const { data, error: issueError } = await supabase
          .from('stock_issuances')
          .select(`
            transaction_id,
            issuance_id,
            staff_id,
            notes,
            external_reference,
            issue_category,
            quantity_issued,
            created_by,
            staff:staff(
              first_name,
              last_name,
              job_description
            )
          `)
          .in('transaction_id', chunk);
        if (issueError) throw issueError;
        rows.push(...((data || []) as StockIssuanceAuditRow[]));
      }
      return rows;
    },
    enabled: transactionIds.length > 0,
    staleTime: 30_000,
  });

  const issueAuditByTransactionId = useMemo(() => {
    const map = new Map<number, TransactionIssueAudit>();
    issueAuditRows.forEach((row) => {
      if (!row.transaction_id) return;
      const staff = Array.isArray(row.staff) ? row.staff[0] : row.staff;
      const staffName = [staff?.first_name, staff?.last_name].filter(Boolean).join(' ').trim();
      map.set(row.transaction_id, {
        issuance_id: row.issuance_id,
        transaction_id: row.transaction_id,
        staff_id: row.staff_id,
        issued_to_name: staffName || null,
        issued_to_role: staff?.job_description || null,
        notes: row.notes,
        external_reference: row.external_reference,
        issue_category: row.issue_category,
        quantity_issued: row.quantity_issued,
        created_by: row.created_by,
      });
    });
    return map;
  }, [issueAuditRows]);

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
      currentStock: Array.isArray(c.inventory)
        ? (c.inventory[0]?.quantity_on_hand ?? 0)
        : (c.inventory?.quantity_on_hand ?? 0),
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
          actorNameById={actorNameById}
          issueAuditByTransactionId={issueAuditByTransactionId}
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

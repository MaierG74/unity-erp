import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import type { EnrichedTransaction } from '@/types/transaction-views';
import type { ComposableFilter } from '@/components/features/inventory/transactions/filters/filter-types';
import { applyServerFilters, buildSearchFilters } from '@/components/features/inventory/transactions/filters/filter-to-postgrest';
import { mapFlatToEnriched, type FlatTransactionRow } from '@/components/features/inventory/transactions/filters/map-enriched-row';
import { startOfWeek, subDays, startOfMonth, startOfYear, endOfDay } from 'date-fns';

function getPresetDateRange(preset: string | null): { from: Date; to: Date } {
  const now = new Date();
  const to = endOfDay(now);
  switch (preset) {
    case 'thisWeek':
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to };
    case 'thisMonth':
      return { from: startOfMonth(now), to };
    case 'last30':
      return { from: subDays(now, 30), to };
    case 'thisQuarter': {
      const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
      return { from: new Date(now.getFullYear(), quarterMonth, 1), to };
    }
    case 'ytd':
      return { from: startOfYear(now), to };
    default:
      return { from: subDays(now, 30), to };
  }
}

type UseTransactionsQueryParams = {
  dateFrom?: string | null;
  dateTo?: string | null;
  datePreset?: string | null;
  productId?: string;
  transactionTypeId?: string;
  supplierId?: string;
  categoryId?: string;
  componentIds?: string[];
  search?: string;
  composableFilter?: ComposableFilter;
};

export function useTransactionsQuery(params: UseTransactionsQueryParams) {
  const { user } = useAuth();

  const dateRange = useMemo(() => {
    if (params.dateFrom && params.dateTo) {
      return { from: new Date(params.dateFrom), to: new Date(params.dateTo) };
    }
    return getPresetDateRange(params.datePreset ?? 'last30');
  }, [params.dateFrom, params.dateTo, params.datePreset]);

  // BOM component lookup (unchanged)
  const bomQuery = useQuery({
    queryKey: ['bom-components', params.productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billofmaterials')
        .select('component_id')
        .eq('product_id', Number(params.productId));
      if (error) throw error;
      return data.map((d) => d.component_id);
    },
    enabled: !!user && !!params.productId && params.productId !== 'all',
  });

  const bomComponentIds = bomQuery.data;

  const transactionsQuery = useQuery({
    queryKey: [
      'inventory',
      'transactions',
      'explorer',
      {
        dateFrom: dateRange.from.toISOString(),
        dateTo: dateRange.to.toISOString(),
        productId: params.productId,
        transactionTypeId: params.transactionTypeId,
        supplierId: params.supplierId,
        categoryId: params.categoryId,
        componentIds: params.componentIds,
        bomComponentIds,
        search: params.search,
        composableFilter: params.composableFilter,
      },
    ],
    queryFn: async () => {
      // Flat column select from the enriched view
      const selectStr = [
        'transaction_id', 'component_id', 'quantity', 'transaction_date',
        'order_id', 'purchase_order_id', 'user_id', 'reason', 'org_id',
        'transaction_type_id', 'component_code', 'component_description',
        'category_id', 'category_name', 'transaction_type_name',
        'po_number', 'supplier_id', 'supplier_name', 'order_number',
      ].join(',');

      function buildQuery() {
        let q = supabase
          .from('inventory_transactions_enriched')
          .select(selectStr)
          .gte('transaction_date', dateRange.from.toISOString())
          .lte('transaction_date', dateRange.to.toISOString())
          .order('transaction_date', { ascending: false });

        // --- Server-side toolbar filters ---
        if (params.transactionTypeId && params.transactionTypeId !== 'all') {
          q = q.eq('transaction_type_id', Number(params.transactionTypeId));
        }
        if (params.supplierId && params.supplierId !== 'all') {
          q = q.eq('supplier_id', Number(params.supplierId));
        }
        if (params.categoryId && params.categoryId !== 'all') {
          q = q.eq('category_id', Number(params.categoryId));
        }
        if (params.componentIds && params.componentIds.length > 0) {
          q = q.in('component_id', params.componentIds.map(Number));
        } else if (bomComponentIds && bomComponentIds.length > 0) {
          q = q.in('component_id', bomComponentIds);
        }

        // --- Server-side composable filter ---
        q = applyServerFilters(q, params.composableFilter);

        // --- Server-side text search (AND of ORs: each word must match at least one column) ---
        if (params.search?.trim()) {
          const searchFilters = buildSearchFilters(params.search);
          for (const orFilter of searchFilters) {
            q = q.or(orFilter);
          }
        }

        return q;
      }

      // Paginate in 1000-row chunks (PostgREST max_rows)
      const PAGE_SIZE = 1000;
      const MAX_ROWS = 10_000;
      let allData: FlatTransactionRow[] = [];

      for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data as unknown as FlatTransactionRow[]);
        if (data.length < PAGE_SIZE) break;
      }

      // Map flat rows to nested EnrichedTransaction
      return allData.map(mapFlatToEnriched);
    },
    enabled:
      !!user &&
      (params.productId === 'all' ||
        !params.productId ||
        bomQuery.isSuccess ||
        bomQuery.data !== undefined),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    ...transactionsQuery,
    dateRange,
    isLoadingBom: bomQuery.isLoading && !!params.productId && params.productId !== 'all',
  };
}

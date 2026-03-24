import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import type { EnrichedTransaction } from '@/types/transaction-views';
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
};

export function useTransactionsQuery(params: UseTransactionsQueryParams) {
  const { user } = useAuth();

  // Resolve date range — memoize so the query key stays stable across re-renders
  const dateRange = useMemo(() => {
    if (params.dateFrom && params.dateTo) {
      return { from: new Date(params.dateFrom), to: new Date(params.dateTo) };
    }
    return getPresetDateRange(params.datePreset ?? 'last30');
  }, [params.dateFrom, params.dateTo, params.datePreset]);

  // If filtering by product, first get BOM component IDs
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
      },
    ],
    queryFn: async () => {
      let query = supabase
        .from('inventory_transactions')
        .select(`
          transaction_id,
          component_id,
          quantity,
          transaction_date,
          order_id,
          purchase_order_id,
          user_id,
          reason,
          component:components!inner (
            component_id,
            internal_code,
            description,
            category:component_categories (
              cat_id,
              categoryname
            )
          ),
          transaction_type:transaction_types (
            transaction_type_id,
            type_name
          ),
          purchase_order:purchase_orders (
            purchase_order_id,
            q_number,
            supplier:suppliers (
              supplier_id,
              name
            )
          ),
          order:orders (
            order_id,
            order_number
          )
        `)
        .gte('transaction_date', dateRange.from.toISOString())
        .lte('transaction_date', dateRange.to.toISOString())
        .order('transaction_date', { ascending: false })
        .limit(5000);

      // Apply server-side filters
      if (params.transactionTypeId && params.transactionTypeId !== 'all') {
        query = query.eq('transaction_type_id', Number(params.transactionTypeId));
      }

      // Filter by specific component IDs (multi-select)
      if (params.componentIds && params.componentIds.length > 0) {
        query = query.in('component_id', params.componentIds.map(Number));
      }
      // Filter by BOM components if product selected
      else if (bomComponentIds && bomComponentIds.length > 0) {
        query = query.in('component_id', bomComponentIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      let results = data as unknown as EnrichedTransaction[];

      // Client-side filters for nested joins
      if (params.supplierId && params.supplierId !== 'all') {
        const sid = Number(params.supplierId);
        results = results.filter(
          (t) => t.purchase_order?.supplier?.supplier_id === sid
        );
      }

      if (params.categoryId && params.categoryId !== 'all') {
        const cid = Number(params.categoryId);
        results = results.filter(
          (t) => t.component?.category?.cat_id === cid
        );
      }

      return results;
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

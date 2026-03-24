import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';

/** Reusable hook that provides option lists for select-type filter fields */
export function useFilterOptions() {
  const { user } = useAuth();
  const enabled = !!user;

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'list-brief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_categories')
        .select('cat_id, categoryname')
        .order('categoryname');
      if (error) throw error;
      return data.map((c) => c.categoryname);
    },
    enabled,
    staleTime: 120_000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', 'list-brief-names'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('supplier_id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data.map((s) => s.name);
    },
    enabled,
    staleTime: 120_000,
  });

  const { data: transactionTypes = [] } = useQuery({
    queryKey: ['transaction-types-names'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transaction_types')
        .select('transaction_type_id, type_name')
        .order('type_name');
      if (error) throw error;
      return data.map((t) => t.type_name);
    },
    enabled,
    staleTime: 120_000,
  });

  const { data: components = [] } = useQuery({
    queryKey: ['components', 'list-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code')
        .not('internal_code', 'is', null)
        .order('internal_code')
        .limit(1000);
      if (error) throw error;
      return data.map((c) => c.internal_code as string);
    },
    enabled,
    staleTime: 120_000,
  });

  return {
    categories,
    suppliers,
    components,
    'transaction-types': transactionTypes,
  } as Record<string, string[]>;
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@/types/orders';

async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .order('name');

  if (error) throw new Error(error.message);
  return (data ?? []) as Customer[];
}

export function useCustomersList() {
  return useQuery<Customer[]>({
    queryKey: ['customers-list'],
    queryFn: fetchCustomers,
    staleTime: 5 * 60 * 1000,
  });
}

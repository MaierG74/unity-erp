import { supabase } from '@/lib/supabase';

export interface Customer {
  id: number;
  name: string;
}

/**
 * Fetches all customers for selection dropdown.
 */
export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

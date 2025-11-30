import { supabase } from '@/lib/supabase';

export interface Customer {
  id: number;
  name: string;
  email?: string | null;
  telephone?: string | null;
  contact?: string | null;
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

/**
 * Fetches a single customer with all contact details (including email, telephone, contact).
 * Useful for email sending and detailed customer views.
 */
export async function fetchCustomerById(id: number): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, email, telephone, contact')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching customer:', error);
    return null;
  }

  return data;
}

import { supabase } from '@/lib/supabase';

export interface Order {
  id: string;
  quote_id: string;
  created_at: string;
  updated_at: string;
}

/**
 * Creates a new order linked to a quote.
 */
export async function createOrder(
  order: Partial<Order>
): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .insert([order])
    .select()
    .single();
  if (error) throw error;
  return data as Order;
}

/**
 * Fetches all orders (minimal implementation).
 */
export async function fetchOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

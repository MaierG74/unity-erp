import { supabase } from '@/lib/supabase';
export type { Order } from '@/types/orders';

/**
 * Creates a new order linked to a quote.
 */
export async function createOrder(
  // Allow extra fields like quote_id that may exist on the table but not in the Order type
  order: Partial<any>
): Promise<any> {
  const { data, error } = await supabase
    .from('orders')
    .insert([order])
    .select()
    .single();
  if (error) throw error;
  return data as any;
}

/**
 * Fetches all orders (minimal implementation).
 */
export async function fetchOrders(): Promise<any[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

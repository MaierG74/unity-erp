import { supabase } from '@/lib/supabase';
import type { Order, OrderAttachment } from '@/types/orders';
export type { Order, OrderAttachment };

// ============================================================================
// ORDER ATTACHMENTS
// ============================================================================

/**
 * Fetches all attachments for an order
 */
export async function fetchOrderAttachments(orderId: number): Promise<OrderAttachment[]> {
  const { data, error } = await supabase
    .from('order_attachments')
    .select('*')
    .eq('order_id', orderId)
    .order('uploaded_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Uploads a file to Supabase storage and creates a DB record
 */
export async function uploadOrderAttachment(
  file: File,
  orderId: number
): Promise<OrderAttachment> {
  const timestamp = Date.now();
  const unique = crypto.randomUUID();
  const filePath = `order-attachments/${orderId}/${timestamp}_${unique}_${file.name}`;
  
  const { data: uploadData, error: uploadError } = await supabase
    .storage
    .from('QButton')
    .upload(filePath, file);
  
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase
    .storage
    .from('QButton')
    .getPublicUrl(uploadData.path);
  
  const publicUrl = urlData.publicUrl;

  const attachmentRecord = {
    order_id: orderId,
    file_url: publicUrl,
    file_name: file.name,
    mime_type: file.type || 'application/octet-stream',
  };

  const { data, error } = await supabase
    .from('order_attachments')
    .insert([attachmentRecord])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes an order attachment (DB record only - storage cleanup would need admin)
 */
export async function deleteOrderAttachment(attachmentId: number): Promise<void> {
  const { error } = await supabase
    .from('order_attachments')
    .delete()
    .eq('id', attachmentId);

  if (error) throw error;
}

// ============================================================================
// ORDERS
// ============================================================================

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

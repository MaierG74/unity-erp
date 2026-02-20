import { supabase } from '@/lib/supabase';
import type { Order, OrderAttachment, OrderDocumentType, OrderDocumentCategory } from '@/types/orders';
export type { Order, OrderAttachment, OrderDocumentType, OrderDocumentCategory };

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
  orderId: number,
  documentType: OrderDocumentType = 'customer_order'
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
    document_type: documentType,
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
 * Updates the document_type of an existing attachment
 */
export async function updateAttachmentType(
  attachmentId: number,
  documentType: OrderDocumentType
): Promise<void> {
  const { error } = await supabase
    .from('order_attachments')
    .update({ document_type: documentType })
    .eq('id', attachmentId);

  if (error) throw error;
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
// DOCUMENT CATEGORIES
// ============================================================================

export async function fetchDocumentCategories(): Promise<OrderDocumentCategory[]> {
  const { data, error } = await supabase
    .from('order_document_categories')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createDocumentCategory(
  category: Pick<OrderDocumentCategory, 'key' | 'label' | 'description'> & { icon?: string }
): Promise<OrderDocumentCategory> {
  // Get the max sort_order to place the new one before "general" (which is 100)
  const { data: existing } = await supabase
    .from('order_document_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSort = existing?.[0]?.sort_order || 0;
  // Place before "general" (100) but after existing ones
  const newSort = maxSort >= 100 ? maxSort - 1 : maxSort + 5;

  const { data, error } = await supabase
    .from('order_document_categories')
    .insert([{
      key: category.key,
      label: category.label,
      icon: category.icon || 'File',
      description: category.description || '',
      sort_order: newSort < 100 ? newSort : 95,
      is_system: false,
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteDocumentCategory(categoryId: number): Promise<void> {
  const { error } = await supabase
    .from('order_document_categories')
    .delete()
    .eq('id', categoryId)
    .eq('is_system', false); // Prevent deleting system categories

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

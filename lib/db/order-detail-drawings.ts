import { supabase } from '@/lib/supabase';
import type { OrderDetailDrawing } from '@/types/drawings';

import { validateImageFile } from './bol-drawings';

const DRAWING_BUCKET = 'QButton';
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function orderDrawingStoragePath(orderDetailId: number, bolId: number, uuid: string, ext: string): string {
  if (!Number.isInteger(orderDetailId) || orderDetailId <= 0) {
    throw new Error('orderDetailId must be a positive integer');
  }
  if (!Number.isInteger(bolId) || bolId <= 0) {
    throw new Error('bolId must be a positive integer');
  }
  const normalizedExt = ext.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(normalizedExt)) {
    throw new Error('PNG or JPEG required');
  }
  return `Order Drawings/${orderDetailId}-${bolId}/${uuid}.${normalizedExt}`;
}

export async function uploadOrderDetailDrawing(
  file: File,
  orderDetailId: number,
  bolId: number,
  orgId: string,
): Promise<OrderDetailDrawing> {
  validateImageFile(file);
  const path = orderDrawingStoragePath(orderDetailId, bolId, crypto.randomUUID(), getFileExtension(file.name));

  const { error: uploadError } = await supabase.storage
    .from(DRAWING_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });

  if (uploadError) {
    throw new Error(`Failed to upload override drawing: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(DRAWING_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) {
    throw new Error('Failed to get public URL for override drawing');
  }

  const { data: userData } = await supabase.auth.getUser();
  const { data: row, error: upsertError } = await supabase
    .from('order_detail_drawings')
    .upsert(
      {
        order_detail_id: orderDetailId,
        bol_id: bolId,
        drawing_url: data.publicUrl,
        org_id: orgId,
        uploaded_by: userData.user?.id ?? null,
      },
      { onConflict: 'order_detail_id,bol_id' },
    )
    .select('*')
    .single();

  if (upsertError) {
    throw new Error(`Failed to persist override drawing: ${upsertError.message}`);
  }

  return row as OrderDetailDrawing;
}

export async function deleteOrderDetailDrawing(orderDetailId: number, bolId: number): Promise<void> {
  const { error } = await supabase
    .from('order_detail_drawings')
    .delete()
    .eq('order_detail_id', orderDetailId)
    .eq('bol_id', bolId);

  if (error) {
    throw new Error(`Failed to delete override drawing: ${error.message}`);
  }
}

export async function listOrderDetailDrawings(orderId: number): Promise<OrderDetailDrawing[]> {
  const { data: details, error: detailsError } = await supabase
    .from('order_details')
    .select('order_detail_id')
    .eq('order_id', orderId);

  if (detailsError) {
    throw new Error(`Failed to load order lines for drawings: ${detailsError.message}`);
  }

  const detailIds = (details ?? []).map((detail) => Number(detail.order_detail_id));
  if (detailIds.length === 0) return [];

  const { data, error } = await supabase
    .from('order_detail_drawings')
    .select('*')
    .in('order_detail_id', detailIds);

  if (error) {
    throw new Error(`Failed to load order drawings: ${error.message}`);
  }

  return (data ?? []) as OrderDetailDrawing[];
}

import { supabase } from '@/lib/supabase';

export type POAttachment = {
  id: string;
  purchase_order_id: number;
  file_url: string;
  mime_type: string | null;
  original_name: string | null;
  file_size: number | null;
  uploaded_at: string;
  receipt_id: number | null;
  uploaded_by: string | null;
  notes: string | null;
  attachment_type: string | null;
};

const STORAGE_BUCKET = 'QButton';
const STORAGE_PATH_PREFIX = 'Purchase Orders';

export async function fetchPOAttachments(purchaseOrderId: number): Promise<POAttachment[]> {
  const { data, error } = await supabase
    .from('purchase_order_attachments')
    .select('*')
    .eq('purchase_order_id', purchaseOrderId)
    .order('uploaded_at', { ascending: true });

  if (error) {
    console.error('Error fetching PO attachments:', error);
    throw new Error('Failed to fetch attachments');
  }

  return (data ?? []) as POAttachment[];
}

export async function uploadPOAttachment(
  file: File,
  purchaseOrderId: number,
  options?: {
    receiptId?: number;
    notes?: string;
    attachmentType?: 'general' | 'delivery_note';
  }
): Promise<POAttachment> {
  const fileExt = file.name.split('.').pop() || 'bin';
  const uniqueName = `${crypto.randomUUID()}.${fileExt}`;
  const storagePath = `${STORAGE_PATH_PREFIX}/${purchaseOrderId}/${uniqueName}`;

  // Upload file to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('Error uploading PO attachment:', uploadError);
    throw new Error('Failed to upload file');
  }

  // Get the public URL
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  const fileUrl = urlData?.publicUrl;
  if (!fileUrl) {
    throw new Error('Failed to get file URL after upload');
  }

  // Insert DB record
  const { data, error: insertError } = await supabase
    .from('purchase_order_attachments')
    .insert({
      purchase_order_id: purchaseOrderId,
      file_url: fileUrl,
      mime_type: file.type || null,
      original_name: file.name,
      file_size: file.size,
      receipt_id: options?.receiptId ?? null,
      notes: options?.notes ?? null,
      attachment_type: options?.attachmentType ?? 'general',
    })
    .select('*')
    .single();

  if (insertError || !data) {
    console.error('Error inserting PO attachment record:', insertError);
    throw new Error('Failed to save attachment record');
  }

  return data as POAttachment;
}

export async function deletePOAttachment(id: string, fileUrl: string): Promise<void> {
  // Extract storage path from the public URL
  const bucketUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl('').data.publicUrl;
  const storagePath = fileUrl.replace(bucketUrl, '').replace(/^\//, '');

  // Delete from storage
  if (storagePath) {
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath]);

    if (storageError) {
      console.error('Error deleting file from storage:', storageError);
      // Continue to delete DB record even if storage delete fails
    }
  }

  // Delete DB record
  const { error: deleteError } = await supabase
    .from('purchase_order_attachments')
    .delete()
    .eq('id', id);

  if (deleteError) {
    console.error('Error deleting PO attachment record:', deleteError);
    throw new Error('Failed to delete attachment');
  }
}

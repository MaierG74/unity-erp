import { supabase } from '@/lib/supabase';

export const PO_ATTACHMENT_TYPES = ['general', 'delivery_note', 'proof_of_payment', 'invoice'] as const;

export type POAttachmentType = (typeof PO_ATTACHMENT_TYPES)[number];

export const PO_ATTACHMENT_TYPE_OPTIONS: Array<{
  value: POAttachmentType;
  label: string;
  description: string;
}> = [
  {
    value: 'general',
    label: 'General Attachment',
    description: 'Store a supporting file against the purchase order.',
  },
  {
    value: 'delivery_note',
    label: 'Delivery Note',
    description: 'File supplier delivery paperwork, optionally linked to a receipt.',
  },
  {
    value: 'proof_of_payment',
    label: 'Proof of Payment',
    description: 'Store EFT slips, remittance advice, or payment confirmations.',
  },
  {
    value: 'invoice',
    label: 'Supplier Invoice',
    description: 'Store the supplier invoice that starts the cash-payment lifecycle.',
  },
];

export type POAttachment = {
  id: string;
  purchase_order_id: number;
  file_url: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  original_name: string | null;
  file_size: number | null;
  uploaded_at: string;
  receipt_id: number | null;
  uploaded_by: string | null;
  notes: string | null;
  attachment_type: string | null;
};

export function normalizePOAttachmentType(value: string | null | undefined): POAttachmentType {
  switch (value) {
    case 'delivery_note':
      return 'delivery_note';
    case 'proof_of_payment':
      return 'proof_of_payment';
    case 'invoice':
      return 'invoice';
    default:
      return 'general';
  }
}

export function getPOAttachmentTypeLabel(value: string | null | undefined): string {
  const normalized = normalizePOAttachmentType(value);
  return PO_ATTACHMENT_TYPE_OPTIONS.find((option) => option.value === normalized)?.label ?? 'General Attachment';
}

const STORAGE_BUCKET = 'QButton';
const STORAGE_PATH_PREFIX = 'Purchase Orders';
const PRIVATE_FINANCE_BUCKET = 'finance-docs';
const PRIVATE_ATTACHMENT_TYPES = new Set<POAttachmentType>(['invoice', 'proof_of_payment']);

function sanitizeFileExtension(name: string) {
  const ext = name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return ext.slice(0, 12) || 'bin';
}

export async function fetchPOAttachments(purchaseOrderId: number): Promise<POAttachment[]> {
  const { data, error } = await supabase
    .from('purchase_order_attachments')
    .select(`
      id,
      purchase_order_id,
      file_url,
      storage_bucket,
      storage_path,
      mime_type,
      original_name,
      file_size,
      uploaded_at,
      receipt_id,
      uploaded_by,
      notes,
      attachment_type
    `)
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
    attachmentType?: POAttachmentType;
  }
): Promise<POAttachment> {
  const attachmentType = options?.attachmentType ?? 'general';
  const shouldUsePrivateStorage = PRIVATE_ATTACHMENT_TYPES.has(attachmentType);
  const fileExt = sanitizeFileExtension(file.name);
  const uniqueName = `${crypto.randomUUID()}.${fileExt}`;
  let bucket = STORAGE_BUCKET;
  let storagePath = `${STORAGE_PATH_PREFIX}/${purchaseOrderId}/${uniqueName}`;
  let fileUrl: string;

  if (shouldUsePrivateStorage) {
    const { data: purchaseOrder, error: poError } = await supabase
      .from('purchase_orders')
      .select('org_id')
      .eq('purchase_order_id', purchaseOrderId)
      .single();

    if (poError || !purchaseOrder?.org_id) {
      console.error('Error fetching purchase order org for attachment:', poError);
      throw new Error('Failed to resolve purchase order organization');
    }

    bucket = PRIVATE_FINANCE_BUCKET;
    storagePath = `${purchaseOrder.org_id}/purchase-orders/${purchaseOrderId}/${uniqueName}`;
  }

  // Upload file to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('Error uploading PO attachment:', uploadError);
    throw new Error('Failed to upload file');
  }

  if (shouldUsePrivateStorage) {
    fileUrl = `${PRIVATE_FINANCE_BUCKET}/${storagePath}`;
  } else {
    // Get the public URL
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    fileUrl = urlData?.publicUrl;
    if (!fileUrl) {
      throw new Error('Failed to get file URL after upload');
    }
  }

  // Insert DB record
  const { data, error: insertError } = await supabase
    .from('purchase_order_attachments')
    .insert({
      purchase_order_id: purchaseOrderId,
      file_url: fileUrl,
      storage_bucket: shouldUsePrivateStorage ? bucket : null,
      storage_path: shouldUsePrivateStorage ? storagePath : null,
      mime_type: file.type || null,
      original_name: file.name,
      file_size: file.size,
      receipt_id: options?.receiptId ?? null,
      notes: options?.notes ?? null,
      attachment_type: attachmentType,
    })
    .select('*')
    .single();

  if (insertError || !data) {
    console.error('Error inserting PO attachment record:', insertError);
    throw new Error('Failed to save attachment record');
  }

  return data as POAttachment;
}

export async function deletePOAttachment(attachment: POAttachment): Promise<void> {
  if (attachment.storage_bucket && attachment.storage_path) {
    const { authorizedFetch } = await import('@/lib/client/auth-fetch');
    const response = await authorizedFetch(`/api/purchase-orders/attachments/${attachment.id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || 'Failed to delete attachment');
    }

    return;
  }

  // Extract storage path from the public URL
  const bucketUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl('').data.publicUrl;
  const storagePath = attachment.file_url.replace(bucketUrl, '').replace(/^\//, '');

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
    .eq('id', attachment.id);

  if (deleteError) {
    console.error('Error deleting PO attachment record:', deleteError);
    throw new Error('Failed to delete attachment');
  }
}

export async function getPOAttachmentAccessUrl(attachment: POAttachment): Promise<string> {
  if (!attachment.storage_bucket || !attachment.storage_path) {
    return attachment.file_url;
  }

  const { authorizedFetch } = await import('@/lib/client/auth-fetch');
  const response = await authorizedFetch(`/api/purchase-orders/attachments/${attachment.id}/access-url`, {
    method: 'GET',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || 'Failed to get attachment URL');
  }

  const body = await response.json();
  if (!body?.url) {
    throw new Error('Missing attachment URL');
  }

  return body.url;
}

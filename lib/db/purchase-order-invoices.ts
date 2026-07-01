import { supabase } from '@/lib/supabase';
import { uploadPOAttachment } from '@/lib/db/purchase-order-attachments';
import type { PurchaseOrderInvoice } from '@/types/purchasing';

export type RecordInvoiceInput = {
  file: File;
  purchaseOrderId: number;
  invoiceNumber?: string | null;
  invoiceDate?: string | null; // yyyy-mm-dd
  invoiceAmount?: number | null;
  note?: string | null;
};

/**
 * Shared "record invoice" action for a purchase order (Cash-supplier Part Two).
 *
 * 1. Uploads the file as an `invoice`-type attachment (reuses uploadPOAttachment;
 *    public QButton bucket for v1 — private-bucket move is a separate task).
 * 2. Calls the SECURITY DEFINER `record_invoice` RPC, which atomically creates/updates
 *    the PO's purchase_order_invoices row (payment_status -> 'awaiting_payment') and
 *    writes both audit trails (po_payment_signoff_activity + purchase_order_activity).
 *
 * Used by both entry points: the PO detail page control and the finance-board drop-target.
 */
export async function recordPurchaseOrderInvoice(
  input: RecordInvoiceInput
): Promise<PurchaseOrderInvoice> {
  const { file, purchaseOrderId, invoiceNumber, invoiceDate, invoiceAmount, note } = input;

  const attachment = await uploadPOAttachment(file, purchaseOrderId, {
    attachmentType: 'invoice',
    notes: invoiceNumber ? `Invoice ${invoiceNumber}` : undefined,
  });

  const { data, error } = await supabase.rpc('record_invoice', {
    p_purchase_order_id: purchaseOrderId,
    p_invoice_number: invoiceNumber ?? null,
    p_invoice_date: invoiceDate ?? null,
    p_invoice_amount: invoiceAmount ?? null,
    p_attachment_id: attachment.id,
    p_note: note ?? null,
  });

  if (error) {
    console.error('record_invoice RPC failed:', error);
    throw new Error(error.message || 'Failed to record invoice');
  }

  // RETURNS a single composite row; PostgREST may hand it back as an object or 1-element array.
  const invoice = Array.isArray(data) ? data[0] : data;
  return invoice as PurchaseOrderInvoice;
}

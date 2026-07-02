import { supabase } from '@/lib/supabase';
import { deletePOAttachment, uploadPOAttachment } from '@/lib/db/purchase-order-attachments';
import type { PurchaseOrderInvoice } from '@/types/purchasing';

export type RecordInvoiceInput = {
  file: File;
  purchaseOrderId: number;
  invoiceNumber?: string | null;
  invoiceDate?: string | null; // yyyy-mm-dd
  invoiceAmount?: number | null;
  note?: string | null;
};

export type PaymentMethod = 'eft' | 'cash' | 'card';

export type RecordPaymentInput = {
  invoiceId: string;
  purchaseOrderId: number;
  amountPaid: number;
  paymentDate: string; // yyyy-mm-dd
  paymentMethod: PaymentMethod;
  paymentReference?: string | null;
  popFile?: File | null;
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
  input: RecordInvoiceInput,
): Promise<PurchaseOrderInvoice> {
  const {
    file,
    purchaseOrderId,
    invoiceNumber,
    invoiceDate,
    invoiceAmount,
    note,
  } = input;

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

export async function recordPurchaseOrderPayment(
  input: RecordPaymentInput,
): Promise<PurchaseOrderInvoice> {
  const {
    invoiceId,
    purchaseOrderId,
    amountPaid,
    paymentDate,
    paymentMethod,
    paymentReference,
    popFile,
    note,
  } = input;

  const popAttachment = popFile
    ? await uploadPOAttachment(popFile, purchaseOrderId, {
        attachmentType: 'proof_of_payment',
        notes: paymentReference
          ? `POP ${paymentReference}`
          : 'Proof of payment',
      })
    : null;

  const { data, error } = await supabase.rpc('record_payment', {
    p_invoice_id: invoiceId,
    p_amount_paid: amountPaid,
    p_payment_date: paymentDate,
    p_payment_method: paymentMethod,
    p_payment_reference: paymentReference ?? null,
    p_pop_attachment_id: popAttachment?.id ?? null,
    p_note: note ?? null,
  });

  if (error) {
    // Best-effort cleanup: the POP was uploaded before the RPC; without this a
    // rejected transition (stale dialog, double submit) strands the file.
    if (popAttachment) {
      try {
        await deletePOAttachment(popAttachment);
      } catch (cleanupError) {
        console.error('Failed to clean up orphaned POP attachment:', cleanupError);
      }
    }
    console.error('record_payment RPC failed:', error);
    throw new Error(error.message || 'Failed to record payment');
  }

  const invoice = Array.isArray(data) ? data[0] : data;
  return invoice as PurchaseOrderInvoice;
}

export async function signOffPayment(
  invoiceId: string,
  note?: string | null,
): Promise<PurchaseOrderInvoice> {
  const { data, error } = await supabase.rpc('sign_off_payment', {
    p_invoice_id: invoiceId,
    p_note: note ?? null,
  });

  if (error) {
    console.error('sign_off_payment RPC failed:', error);
    throw new Error(error.message || 'Failed to sign off payment');
  }

  const invoice = Array.isArray(data) ? data[0] : data;
  return invoice as PurchaseOrderInvoice;
}

export async function markPopSent(
  invoiceId: string,
  popAttachmentId?: string | null,
  note?: string | null,
): Promise<PurchaseOrderInvoice> {
  const { data, error } = await supabase.rpc('mark_pop_sent', {
    p_invoice_id: invoiceId,
    p_pop_attachment_id: popAttachmentId ?? null,
    p_note: note ?? null,
  });

  if (error) {
    console.error('mark_pop_sent RPC failed:', error);
    throw new Error(error.message || 'Failed to mark POP sent');
  }

  const invoice = Array.isArray(data) ? data[0] : data;
  return invoice as PurchaseOrderInvoice;
}

export async function reopenPayment(
  invoiceId: string,
  note: string,
): Promise<PurchaseOrderInvoice> {
  const { data, error } = await supabase.rpc('reopen_payment', {
    p_invoice_id: invoiceId,
    p_note: note,
  });

  if (error) {
    console.error('reopen_payment RPC failed:', error);
    throw new Error(error.message || 'Failed to reopen payment');
  }

  const invoice = Array.isArray(data) ? data[0] : data;
  return invoice as PurchaseOrderInvoice;
}

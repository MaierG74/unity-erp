import { NextRequest, NextResponse } from 'next/server';
import { renderAsync } from '@react-email/render';
import { Resend } from 'resend';

import PopEmail from '@/emails/pop-email';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type InvoiceRow = {
  id: string;
  org_id: string;
  purchase_order_id: number;
  payment_status: string | null;
  pop_attachment_id: string | null;
};

type PurchaseOrderRow = {
  purchase_order_id: number;
  org_id: string;
  q_number: string | null;
  supplier_id: number | null;
};

type AttachmentRow = {
  id: string;
  purchase_order_id: number;
  file_url: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  original_name: string | null;
  file_size: number | null;
};

// Attachment is buffered in memory and must fit in an email; refuse anything bigger.
const MAX_POP_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function asPositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatQNumber(qNumber: string | null, purchaseOrderId: number) {
  if (!qNumber) return `PO-${purchaseOrderId}`;
  return qNumber.startsWith('Q') ? qNumber : `Q${qNumber}`;
}

function sanitizeFilename(value: string) {
  return value.replace(/[^\w.\-() ]+/g, '_').trim() || 'proof-of-payment.pdf';
}

async function getCompanyInfo(supabase: any, orgId: string) {
  const fallback = {
    name: process.env.COMPANY_NAME || 'Unity',
    email: process.env.EMAIL_FROM || 'purchasing@example.com',
    phone: process.env.COMPANY_PHONE || '',
    address: process.env.COMPANY_ADDRESS || '',
    website: undefined as string | undefined,
  };

  const { data: settings, error } = await supabase
    .from('quote_company_settings')
    .select('company_name,email,phone,address_line1,address_line2,city,postal_code,country,website')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error || !settings) {
    const { data: legacySettings } = await supabase
      .from('quote_company_settings')
      .select('company_name,email,phone,address_line1,address_line2,city,postal_code,country,website')
      .eq('setting_id', 1)
      .maybeSingle();

    if (!legacySettings) return fallback;

    const legacyAddress = [
      legacySettings.address_line1,
      legacySettings.address_line2,
      [legacySettings.city, legacySettings.postal_code].filter(Boolean).join(' ').trim(),
      legacySettings.country,
    ].filter(Boolean);

    return {
      name: legacySettings.company_name || fallback.name,
      email: legacySettings.email || fallback.email,
      phone: legacySettings.phone || fallback.phone,
      address: legacyAddress.join(', ') || fallback.address,
      website: legacySettings.website || undefined,
    };
  }

  const address = [
    settings.address_line1,
    settings.address_line2,
    [settings.city, settings.postal_code].filter(Boolean).join(' ').trim(),
    settings.country,
  ].filter(Boolean);

  return {
    name: settings.company_name || fallback.name,
    email: settings.email || fallback.email,
    phone: settings.phone || fallback.phone,
    address: address.join(', ') || fallback.address,
    website: settings.website || undefined,
  };
}

async function downloadAttachment(attachment: AttachmentRow) {
  if (attachment.file_size && attachment.file_size > MAX_POP_ATTACHMENT_BYTES) {
    throw new Error('POP attachment is too large to email (15MB limit)');
  }

  if (attachment.storage_bucket && attachment.storage_path) {
    const { data, error } = await supabaseAdmin.storage
      .from(attachment.storage_bucket)
      .download(attachment.storage_path);

    if (error || !data) {
      throw new Error(error?.message || 'Failed to download POP attachment');
    }

    return Buffer.from(await data.arrayBuffer());
  }

  if (!attachment.file_url) {
    throw new Error('POP attachment has no downloadable file URL');
  }

  const response = await fetch(attachment.file_url);
  if (!response.ok) {
    throw new Error(`Failed to fetch legacy POP attachment (${response.status})`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_POP_ATTACHMENT_BYTES) {
    throw new Error('POP attachment is too large to email (15MB limit)');
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_POP_ATTACHMENT_BYTES) {
    throw new Error('POP attachment is too large to email (15MB limit)');
  }
  return bytes;
}

export async function POST(req: NextRequest) {
  const access = await requireModuleAccess(req, MODULE_KEYS.FINANCE);
  if ('error' in access) {
    return access.error;
  }

  const { ctx, orgId } = access;

  try {
    const body = await req.json().catch(() => ({}));
    const purchaseOrderId = asPositiveInteger(body.purchase_order_id);
    const invoiceId = asNonEmptyString(body.invoice_id);

    if (!purchaseOrderId || !invoiceId) {
      return NextResponse.json(
        { error: 'purchase_order_id and invoice_id are required' },
        { status: 400 },
      );
    }

    let invoiceQuery = ctx.supabase
      .from('purchase_order_invoices')
      .select('id, org_id, purchase_order_id, payment_status, pop_attachment_id')
      .eq('id', invoiceId)
      .eq('purchase_order_id', purchaseOrderId);

    if (orgId) {
      invoiceQuery = invoiceQuery.eq('org_id', orgId);
    }

    const { data: invoice, error: invoiceError } = await invoiceQuery.maybeSingle();

    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 });
    }
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const invoiceRow = invoice as InvoiceRow;
    if (invoiceRow.payment_status !== 'awaiting_pop') {
      return NextResponse.json(
        { error: 'Invoice is not awaiting POP' },
        { status: 400 },
      );
    }
    if (!invoiceRow.pop_attachment_id) {
      return NextResponse.json(
        { error: 'Invoice has no POP attachment' },
        { status: 400 },
      );
    }

    const { data: purchaseOrder, error: poError } = await ctx.supabase
      .from('purchase_orders')
      .select('purchase_order_id, org_id, q_number, supplier_id')
      .eq('purchase_order_id', purchaseOrderId)
      .eq('org_id', invoiceRow.org_id)
      .maybeSingle();

    if (poError) {
      return NextResponse.json({ error: poError.message }, { status: 500 });
    }
    if (!purchaseOrder) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    const poRow = purchaseOrder as PurchaseOrderRow;
    if (!poRow.supplier_id) {
      return NextResponse.json(
        { error: 'Purchase order has no supplier' },
        { status: 400 },
      );
    }

    const { data: attachment, error: attachmentError } = await ctx.supabase
      .from('purchase_order_attachments')
      .select('id, purchase_order_id, file_url, storage_bucket, storage_path, mime_type, original_name, file_size')
      .eq('id', invoiceRow.pop_attachment_id)
      .eq('purchase_order_id', purchaseOrderId)
      .maybeSingle();

    if (attachmentError) {
      return NextResponse.json({ error: attachmentError.message }, { status: 500 });
    }
    if (!attachment) {
      return NextResponse.json({ error: 'POP attachment not found' }, { status: 404 });
    }

    const { data: supplier } = await ctx.supabase
      .from('suppliers')
      .select('name')
      .eq('supplier_id', poRow.supplier_id)
      .maybeSingle();

    const { data: emailRows, error: emailError } = await ctx.supabase
      .from('supplier_emails')
      .select('email, is_primary')
      .eq('supplier_id', poRow.supplier_id)
      .eq('org_id', invoiceRow.org_id)
      .order('is_primary', { ascending: false });

    if (emailError) {
      return NextResponse.json({ error: emailError.message }, { status: 500 });
    }

    const toEmail = (emailRows ?? [])
      .map((row) => (typeof row.email === 'string' ? row.email.trim() : ''))
      .find(Boolean);

    if (!toEmail) {
      return NextResponse.json(
        { error: 'No supplier email found' },
        { status: 400 },
      );
    }

    const attachmentRow = attachment as AttachmentRow;
    const [companyInfo, attachmentContent] = await Promise.all([
      getCompanyInfo(ctx.supabase, invoiceRow.org_id),
      downloadAttachment(attachmentRow),
    ]);

    const qNumber = formatQNumber(poRow.q_number, purchaseOrderId);
    const html = await renderAsync(
      PopEmail({
        supplierName: supplier?.name || 'Supplier',
        qNumber,
        companyName: companyInfo.name,
        companyAddress: companyInfo.address,
        companyPhone: companyInfo.phone,
        companyEmail: companyInfo.email,
      }),
    );

    const fromAddress =
      process.env.EMAIL_FROM_ORDERS ||
      process.env.EMAIL_FROM ||
      companyInfo.email ||
      'purchasing@example.com';
    // Dedupe guard: if a POP email for this PO went out in the last 10 minutes,
    // refuse — the likely cause is a retry after a failed close, and resending
    // would email the supplier a duplicate. "Mark sent" closes without email.
    const { data: recentSend } = await ctx.supabase
      .from('purchase_order_emails')
      .select('id, sent_at')
      .eq('purchase_order_id', purchaseOrderId)
      .eq('email_type', 'po_pop_send')
      .gte('sent_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();

    if (recentSend) {
      return NextResponse.json(
        { error: 'A POP email for this PO was already sent in the last few minutes. Use "Mark sent" to close the card instead of emailing again.' },
        { status: 409 },
      );
    }

    const resend = new Resend(process.env.RESEND_API_KEY!);
    const subject = `Proof of payment for PO ${qNumber}`;
    const filename = sanitizeFilename(
      attachmentRow.original_name || `proof-of-payment-${qNumber}.pdf`,
    );

    const { data: result, error: sendError } = await resend.emails.send({
      from: `${companyInfo.name} Purchasing <${fromAddress}>`,
      to: [toEmail],
      subject,
      html,
      attachments: [
        {
          filename,
          content: attachmentContent,
          contentType: attachmentRow.mime_type || undefined,
        },
      ],
    });

    const status = sendError ? 'failed' : 'sent';
    const messageId = result?.id ?? null;

    const { error: logError } = await ctx.supabase
      .from('purchase_order_emails')
      .insert({
        org_id: invoiceRow.org_id,
        purchase_order_id: purchaseOrderId,
        supplier_id: poRow.supplier_id,
        supplier_order_id: null,
        recipient_email: toEmail,
        cc_emails: [],
        email_type: 'po_pop_send',
        status,
        message_id: messageId,
        error_message: sendError?.message || null,
      });

    if (logError) {
      console.error('Failed to log POP email:', logError);
    }

    if (sendError) {
      return NextResponse.json(
        { error: sendError.message || 'Failed to send POP email' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message_id: messageId,
      recipient_email: toEmail,
    });
  } catch (error) {
    console.error('Error sending POP email:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to send POP email',
      },
      { status: 500 },
    );
  }
}

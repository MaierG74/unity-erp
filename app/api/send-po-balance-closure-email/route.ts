import { NextResponse } from 'next/server';
import { renderAsync } from '@react-email/render';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import PurchaseOrderBalanceClosureEmail, {
  BalanceClosureItem,
  PurchaseOrderBalanceClosureEmailProps,
} from '@/emails/purchase-order-balance-closure-email';
import { parsePOContactInfo, DEFAULT_TEMPLATES } from '@/lib/templates';

const BALANCE_CLOSURE_REASON_LABELS: Record<string, string> = {
  supplier_shortfall_cancelled: 'Supplier shortfall cancelled',
  covered_from_stock: 'Covered from stock or offcuts',
  borrowed_from_other_order: 'Borrowed from another order',
  loss_or_damage_writeoff: 'Loss or damage write-off',
  reconciliation_unknown: 'Unknown, needs review',
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const parseEmailList = (value: string | null | undefined): string[] =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const normalizeQuantity = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1_000_000) / 1_000_000;
};

export async function POST(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const resend = new Resend(process.env.RESEND_API_KEY!);

  try {
    const {
      purchaseOrderId,
      supplierOrderId,
      quantityClosed,
      reasonCode,
      notes,
      cc,
    } = await request.json();

    const parsedPurchaseOrderId = Number(purchaseOrderId);
    const parsedSupplierOrderId = Number(supplierOrderId);
    const parsedQuantityClosed = normalizeQuantity(quantityClosed);

    if (!Number.isFinite(parsedPurchaseOrderId) || parsedPurchaseOrderId <= 0) {
      return NextResponse.json(
        { error: 'Purchase order ID is required' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(parsedSupplierOrderId) || parsedSupplierOrderId <= 0) {
      return NextResponse.json(
        { error: 'Supplier order ID is required' },
        { status: 400 }
      );
    }

    if (parsedQuantityClosed <= 0) {
      return NextResponse.json(
        { error: 'Quantity closed must be greater than zero' },
        { status: 400 }
      );
    }

    const ccList = Array.isArray(cc)
      ? cc.map((value: any) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value: string) => value.length > 0)
      : [] as string[];

    const { data: supplierOrder, error: orderError } = await supabase
      .from('supplier_orders')
      .select(`
        order_id,
        purchase_order_id,
        order_quantity,
        total_received,
        closed_quantity,
        supplier_component:suppliercomponents(
          supplier_code,
          price,
          component:components(
            internal_code,
            description
          ),
          supplier:suppliers(
            supplier_id,
            name
          )
        ),
        purchase_order:purchase_orders(
          purchase_order_id,
          q_number,
          order_date,
          created_at
        )
      `)
      .eq('order_id', parsedSupplierOrderId)
      .eq('purchase_order_id', parsedPurchaseOrderId)
      .single();

    if (orderError || !supplierOrder) {
      return NextResponse.json(
        { error: `Failed to fetch supplier order: ${orderError?.message || 'Not found'}` },
        { status: 404 }
      );
    }

    const supplierComponent = Array.isArray(supplierOrder.supplier_component)
      ? supplierOrder.supplier_component[0]
      : supplierOrder.supplier_component;
    const component = Array.isArray(supplierComponent?.component)
      ? supplierComponent.component[0]
      : supplierComponent?.component;
    const supplier = Array.isArray(supplierComponent?.supplier)
      ? supplierComponent?.supplier[0]
      : supplierComponent?.supplier;
    const purchaseOrder = Array.isArray(supplierOrder.purchase_order)
      ? supplierOrder.purchase_order[0]
      : supplierOrder.purchase_order;

    if (!supplier?.supplier_id || !supplier?.name) {
      return NextResponse.json(
        { error: 'Supplier details are missing for this supplier order' },
        { status: 400 }
      );
    }

    if (!purchaseOrder?.purchase_order_id) {
      return NextResponse.json(
        { error: 'Purchase order details are missing for this supplier order' },
        { status: 400 }
      );
    }

    const { data: emailRows, error: emailError } = await supabase
      .from('supplier_emails')
      .select('email, is_primary')
      .eq('supplier_id', supplier.supplier_id);

    if (emailError) {
      return NextResponse.json({
        success: false,
        message: 'Failed to resolve supplier email',
        results: [{
          supplier: supplier.name,
          supplierId: supplier.supplier_id,
          success: false,
          error: emailError.message,
        }],
      });
    }

    const sortedEmails = (emailRows || []).sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary));
    const toEmail = sortedEmails[0]?.email;

    if (!toEmail) {
      return NextResponse.json({
        success: false,
        message: 'No supplier email found',
        results: [{
          supplier: supplier.name,
          supplierId: supplier.supplier_id,
          success: false,
          error: 'No supplier email found',
        }],
      });
    }

    const { data: settings } = await supabase
      .from('quote_company_settings')
      .select('*')
      .eq('setting_id', 1)
      .single();

    const logoBucket = process.env.NEXT_PUBLIC_SUPABASE_LOGO_BUCKET || 'QButton';
    let companyLogoUrl: string | undefined;
    if (settings?.company_logo_path) {
      const { data: logoData } = supabase.storage.from(logoBucket).getPublicUrl(settings.company_logo_path);
      companyLogoUrl = logoData?.publicUrl || undefined;
    }

    const { data: templates } = await supabase
      .from('document_templates')
      .select('template_type, content')
      .eq('template_type', 'po_contact_info');

    const poContactTemplate = templates?.find((template) => template.template_type === 'po_contact_info')?.content || DEFAULT_TEMPLATES.po_contact_info;
    const contactInfo = parsePOContactInfo(poContactTemplate);

    const companyAddressParts = [
      settings?.address_line1,
      settings?.address_line2,
      [settings?.city, settings?.postal_code].filter(Boolean).join(' ').trim(),
      settings?.country,
    ].filter((part) => part && part.length > 0);

    const companyInfo = {
      name: settings?.company_name || process.env.COMPANY_NAME || 'Unity',
      email: settings?.email || process.env.EMAIL_FROM || 'purchasing@example.com',
      phone: settings?.phone || process.env.COMPANY_PHONE || '',
      address: companyAddressParts.join(', ') || process.env.COMPANY_ADDRESS || '',
      logoUrl: companyLogoUrl || process.env.COMPANY_LOGO || undefined,
    };
    const fromAddress = process.env.EMAIL_FROM_ORDERS || process.env.EMAIL_FROM || companyInfo.email || 'purchasing@example.com';
    const defaultCcEmails = parseEmailList(settings?.po_default_cc_email);
    const mergedCcList = Array.from(
      new Set([...defaultCcEmails, ...ccList].map((email) => normalizeEmail(email)))
    );

    const orderedQuantity = normalizeQuantity(supplierOrder.order_quantity);
    const receivedQuantity = normalizeQuantity(supplierOrder.total_received);
    const closedQuantity = normalizeQuantity(supplierOrder.closed_quantity);
    const previouslyClosedQuantity = normalizeQuantity(Math.max(closedQuantity - parsedQuantityClosed, 0));
    const remainingOutstandingQuantity = normalizeQuantity(
      Math.max(orderedQuantity - receivedQuantity - closedQuantity, 0)
    );
    const item: BalanceClosureItem = {
      orderId: Number(supplierOrder.order_id),
      supplierCode: supplierComponent?.supplier_code ?? '',
      internalCode: component?.internal_code ?? '',
      description: component?.description ?? '',
      unitPrice: Number(supplierComponent?.price ?? 0),
      orderedQuantity,
      receivedQuantity,
      previouslyClosedQuantity,
      closedNowQuantity: parsedQuantityClosed,
      remainingOutstandingQuantity,
    };
    const qNumber = String(purchaseOrder.q_number || `PO-${purchaseOrder.purchase_order_id}`);
    const createdAt = String(purchaseOrder.order_date || purchaseOrder.created_at);
    const emailData: PurchaseOrderBalanceClosureEmailProps = {
      qNumber,
      supplierName: String(supplier.name),
      createdAt,
      item,
      reasonLabel: BALANCE_CLOSURE_REASON_LABELS[String(reasonCode || '')] || undefined,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      companyName: companyInfo.name,
      companyLogoUrl: companyInfo.logoUrl,
      companyAddress: companyInfo.address,
      companyPhone: companyInfo.phone,
      companyEmail: companyInfo.email,
      supplierEmail: toEmail,
      contactName: contactInfo.name,
      contactEmail: contactInfo.email,
    };

    let success = false;
    let errorMessage: string | undefined;
    let messageId: string | undefined;

    try {
      const html = await renderAsync(PurchaseOrderBalanceClosureEmail(emailData));
      const subjectPrefix = remainingOutstandingQuantity > 0 ? 'BALANCE UPDATED' : 'BALANCE CANCELLED';

      const { data: result, error } = await resend.emails.send({
        from: `${companyInfo.name} Purchasing <${fromAddress}>`,
        to: [toEmail],
        cc: mergedCcList.length ? mergedCcList : undefined,
        subject: `${subjectPrefix}: Purchase Order ${qNumber} - ${item.description || item.internalCode || item.supplierCode}`,
        html,
      });

      if (error) {
        errorMessage = error.message;
      } else {
        success = true;
        messageId = result?.id;
      }
    } catch (renderError: any) {
      errorMessage = `Email rendering error: ${renderError.message}`;
    }

    await supabase.from('purchase_order_emails').insert({
      purchase_order_id: parsedPurchaseOrderId,
      supplier_id: Number(supplier.supplier_id),
      supplier_order_id: parsedSupplierOrderId,
      recipient_email: toEmail,
      cc_emails: mergedCcList.length > 0 ? mergedCcList : [],
      email_type: 'po_balance_close',
      status: success ? 'sent' : 'failed',
      message_id: messageId || null,
      error_message: errorMessage || null,
    });

    return NextResponse.json({
      success,
      message: success ? 'Balance-closure email sent' : 'Failed to send balance-closure email',
      results: [{
        supplier: supplier.name,
        supplierId: Number(supplier.supplier_id),
        success,
        error: errorMessage,
        messageId,
        recipientEmail: toEmail,
      }],
    });
  } catch (error: any) {
    console.error('Error sending PO balance closure email:', error);
    return NextResponse.json(
      { error: `Failed to send balance closure email: ${error.message}` },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { renderAsync } from '@react-email/render';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import PurchaseOrderEmail, { PurchaseOrderEmailProps, SupplierOrderItem } from '@/emails/purchase-order-email';
import PurchaseOrderInternalEmail, {
  InternalSupplierOrderItem,
  PurchaseOrderInternalEmailProps,
} from '@/emails/purchase-order-internal-email';
import { processTemplate, parsePOContactInfo, DEFAULT_TEMPLATES } from '@/lib/templates';


const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const parseEmailList = (value: string | null | undefined): string[] =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const normalizeOrderReference = (value: string | number | null | undefined): string => {
  const raw = String(value ?? '').trim();
  return raw.replace(/^#+/, '');
};

const buildForOrderReference = (order: any): string => {
  const links = Array.isArray(order?.supplier_order_customer_orders)
    ? order.supplier_order_customer_orders
    : [];

  const orderReferences = Array.from(
    new Set(
      links
        .map((link: any) => {
          const customerOrder = Array.isArray(link?.customer_order)
            ? link.customer_order[0]
            : link?.customer_order;
          if (!customerOrder) return '';
          return normalizeOrderReference(customerOrder.order_number || customerOrder.order_id);
        })
        .filter((value: string) => value.length > 0)
    )
  );

  const stockQuantity = links.reduce(
    (sum: number, link: any) => sum + Number(link?.quantity_for_stock || 0),
    0
  );

  if (orderReferences.length > 0 && stockQuantity > 0) {
    return `${orderReferences.join(', ')} + Stock`;
  }
  if (orderReferences.length > 0) {
    return orderReferences.join(', ');
  }
  if (stockQuantity > 0) {
    return 'Stock';
  }
  return '—';
};

const mapSupplierOrderItem = (order: any): SupplierOrderItem => {
  const sc = Array.isArray(order.supplier_component)
    ? order.supplier_component[0]
    : order.supplier_component;

  return {
    order_id: Number(order.order_id),
    order_quantity: Number(order.order_quantity),
    notes: order.notes ?? undefined,
    supplier_component: {
      supplier_code: sc?.supplier_code ?? '',
      price: Number(sc?.price ?? 0),
      component: {
        internal_code: sc?.component?.internal_code ?? '',
        description: sc?.component?.description ?? '',
      },
    },
  };
};

export async function POST(request: Request) {
  // Initialize Supabase client lazily to ensure env vars exist at runtime
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // Initialize Resend lazily
  const resend = new Resend(process.env.RESEND_API_KEY!);
  try {
    const { purchaseOrderId, overrides, cc, pdfBase64, pdfFilename, additionalAttachments } = await request.json();

    if (!purchaseOrderId) {
      return NextResponse.json(
        { error: 'Purchase order ID is required' },
        { status: 400 }
      );
    }

    const overrideMap = new Map<number, string>();
    if (Array.isArray(overrides)) {
      for (const entry of overrides) {
        const supplierId = Number(entry?.supplierId);
        const email = typeof entry?.email === 'string' ? entry.email.trim() : '';
        if (supplierId && email) {
          overrideMap.set(supplierId, email);
        }
      }
    }

    const ccList = Array.isArray(cc)
      ? cc.map((value: any) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value: string) => value.length > 0)
      : [] as string[];

    // Fetch the purchase order with all necessary details
    const { data: purchaseOrder, error: poError } = await supabase
      .from('purchase_orders')
      .select(`
        purchase_order_id,
        q_number,
        notes,
        created_at,
        supplier_orders(
          order_id,
          order_quantity,
          notes,
          supplier_order_customer_orders(
            quantity_for_order,
            quantity_for_stock,
            customer_order:orders(
              order_id,
              order_number
            )
          ),
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
          )
        )
      `)
      .eq('purchase_order_id', purchaseOrderId)
      .single();

    if (poError || !purchaseOrder) {
      return NextResponse.json(
        { error: `Failed to fetch purchase order: ${poError?.message || 'Not found'}` },
        { status: 404 }
      );
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

    // Fetch document templates for PO email
    const { data: templates } = await supabase
      .from('document_templates')
      .select('template_type, content')
      .in('template_type', ['po_email_notice', 'po_contact_info']);

    const poNoticeTemplate = templates?.find(t => t.template_type === 'po_email_notice')?.content || DEFAULT_TEMPLATES.po_email_notice;
    const poContactTemplate = templates?.find(t => t.template_type === 'po_contact_info')?.content || DEFAULT_TEMPLATES.po_contact_info;
    const contactInfo = parsePOContactInfo(poContactTemplate);

    // Process the notice template with contact info
    const processedNotice = processTemplate(poNoticeTemplate, {
      contact_name: contactInfo.name,
      contact_email: contactInfo.email,
    });

    const companyAddressParts = [
      settings?.address_line1,
      settings?.address_line2,
      [settings?.city, settings?.postal_code].filter(Boolean).join(' ').trim(),
      settings?.country,
    ].filter((part) => part && part.length > 0);

    const companyInfo = {
      name: settings?.company_name || process.env.COMPANY_NAME || 'Unity',
      email: settings?.email || process.env.EMAIL_FROM || 'purchasing@example.com',
      phone: settings?.phone || process.env.COMPANY_PHONE || '+44 123 456 7890',
      address: companyAddressParts.join(', ') || process.env.COMPANY_ADDRESS || '123 Unity Street, London, UK',
      website: settings?.website || undefined,
      logoUrl: companyLogoUrl || process.env.COMPANY_LOGO || undefined,
    };
    const fromAddress = process.env.EMAIL_FROM_ORDERS || process.env.EMAIL_FROM || companyInfo.email || 'purchasing@example.com';
    const defaultCcSet = new Set(
      parseEmailList(settings?.po_default_cc_email).map((entry) => normalizeEmail(entry))
    );
    const internalCcList = ccList.filter((entry) => defaultCcSet.has(normalizeEmail(entry)));
    const supplierCcList = ccList.filter((entry) => !defaultCcSet.has(normalizeEmail(entry)));

    // Build attachments array for Resend once and reuse for supplier + internal copies.
    const emailAttachments: { content: Buffer; filename: string }[] = [];
    if (pdfBase64 && pdfFilename) {
      emailAttachments.push({
        content: Buffer.from(pdfBase64, 'base64'),
        filename: pdfFilename,
      });
    }
    if (Array.isArray(additionalAttachments)) {
      for (const att of additionalAttachments) {
        if (att?.content && att?.filename) {
          emailAttachments.push({
            content: Buffer.from(att.content, 'base64'),
            filename: att.filename,
          });
        }
      }
    }

    // Extract unique suppliers from the order (handle array/object shapes from Supabase)
    const uniqueSuppliers = (purchaseOrder.supplier_orders || [])
      .map((order: any) => {
        const sc = Array.isArray(order.supplier_component)
          ? order.supplier_component[0]
          : order.supplier_component;
        const sup = Array.isArray(sc?.supplier) ? sc.supplier[0] : sc?.supplier;
        if (!sup) return null;
        return { supplier_id: sup.supplier_id, name: sup.name };
      })
      .filter((s: any): s is { supplier_id: number; name: string } => !!s)
      .filter((supplier, index, self) =>
        index === self.findIndex((t) => t.supplier_id === supplier.supplier_id)
      );
    
    // Send email to each supplier
    const emailResults: { supplier: string; supplierId: number; success: boolean; error?: string; messageId?: string; recipientEmail?: string }[] = [];
    
    for (const supplier of uniqueSuppliers) {
      // Resolve recipient email (override -> primary -> any)
      let toEmail = overrideMap.get(supplier.supplier_id);
      if (!toEmail) {
        const { data: emailRows, error: emailError } = await supabase
          .from('supplier_emails')
          .select('email, is_primary')
          .eq('supplier_id', supplier.supplier_id);
        if (emailError) {
          emailResults.push({
            supplier: supplier.name,
            supplierId: supplier.supplier_id,
            success: false,
            error: emailError.message
          });
          continue;
        }
        const sorted = (emailRows || []).sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary));
        toEmail = sorted[0]?.email;
      }

      if (!toEmail) {
        emailResults.push({
          supplier: supplier.name,
          supplierId: supplier.supplier_id,
          success: false,
          error: 'No supplier email found'
        });
        continue;
      }

      // Get only the orders for this supplier and normalize shape for email template
      const supplierOrdersRaw = purchaseOrder.supplier_orders.filter((order: any) => {
        const sc = Array.isArray(order.supplier_component)
          ? order.supplier_component[0]
          : order.supplier_component;
        const sup = Array.isArray(sc?.supplier) ? sc.supplier[0] : sc?.supplier;
        return sup?.supplier_id === supplier.supplier_id;
      });

      const supplierOrdersForEmail: SupplierOrderItem[] = supplierOrdersRaw.map((order: any) =>
        mapSupplierOrderItem(order)
      );
      const internalSupplierOrdersForEmail: InternalSupplierOrderItem[] = supplierOrdersRaw.map((order: any) => ({
        ...mapSupplierOrderItem(order),
        forOrder: buildForOrderReference(order),
      }));
      const purchaseOrderNumber = String(
        purchaseOrder.q_number || `PO-${purchaseOrder.purchase_order_id}`
      );

      // Prepare email data in the exact shape expected by the template
      const emailData: PurchaseOrderEmailProps = {
        purchaseOrderId: Number(purchaseOrder.purchase_order_id),
        qNumber: purchaseOrderNumber,
        supplierName: String(supplier.name),
        createdAt: String(purchaseOrder.created_at),
        supplierOrders: supplierOrdersForEmail,
        notes: purchaseOrder.notes ?? undefined,
        companyName: companyInfo.name,
        companyLogoUrl: companyInfo.logoUrl,
        companyAddress: companyInfo.address,
        companyPhone: companyInfo.phone,
        companyEmail: companyInfo.email,
        companyWebsite: companyInfo.website,
        supplierEmail: toEmail,
        importantNotice: processedNotice,
        contactName: contactInfo.name,
        contactEmail: contactInfo.email,
      };
      
      try {
        // Render the email template to HTML
        const html = await renderAsync(PurchaseOrderEmail(emailData));

        // Send the email via Resend
        const { data: result, error } = await resend.emails.send({
          from: `${emailData.companyName} Purchasing <${fromAddress}>`,
          to: [toEmail],
          cc: supplierCcList.length ? supplierCcList : undefined,
          subject: `Purchase Order: ${emailData.qNumber}`,
          html,
          attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
        });
  
        if (error) {
          emailResults.push({
            supplier: supplier.name,
            supplierId: supplier.supplier_id,
            success: false,
            error: error.message,
            recipientEmail: toEmail,
          });
        } else {
          emailResults.push({
            supplier: supplier.name,
            supplierId: supplier.supplier_id,
            success: true,
            messageId: result?.id,
            recipientEmail: toEmail,
          });

          // Send a separate internal copy that includes "For Order" references.
          if (internalCcList.length > 0) {
            try {
              const internalEmailData: PurchaseOrderInternalEmailProps = {
                ...emailData,
                supplierOrders: internalSupplierOrdersForEmail,
              };
              const internalHtml = await renderAsync(PurchaseOrderInternalEmail(internalEmailData));

              await resend.emails.send({
                from: `${emailData.companyName} Purchasing <${fromAddress}>`,
                to: internalCcList,
                subject: `Internal Copy - Purchase Order: ${emailData.qNumber} (${supplier.name})`,
                html: internalHtml,
                attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
              });
            } catch (internalError) {
              console.error(
                `Error sending internal PO copy for supplier ${supplier.name}:`,
                internalError
              );
            }
          }
        }
      } catch (renderError: any) {
        emailResults.push({
          supplier: supplier.name,
          supplierId: supplier.supplier_id,
          success: false,
          error: `Email rendering error: ${renderError.message}`,
          recipientEmail: toEmail,
        });
      }
    }

    // Log all email results to the database
    for (const result of emailResults) {
      if (result.recipientEmail) {
        await supabase.from('purchase_order_emails').insert({
          purchase_order_id: purchaseOrderId,
          supplier_id: result.supplierId,
          supplier_order_id: null,
          recipient_email: result.recipientEmail,
          cc_emails: supplierCcList.length > 0 ? supplierCcList : [],
          email_type: 'po_send',
          status: result.success ? 'sent' : 'failed',
          message_id: result.messageId || null,
          error_message: result.error || null,
        });
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Purchase order emails sent',
      results: emailResults
    });
  } catch (error: any) {
    console.error('Error sending purchase order emails:', error);
    return NextResponse.json(
      { error: `Failed to send purchase order emails: ${error.message}` },
      { status: 500 }
    );
  }
} 

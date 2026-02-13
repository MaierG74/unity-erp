import { NextResponse } from 'next/server';
import { renderAsync } from '@react-email/render';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import PurchaseOrderCancellationEmail from '@/emails/purchase-order-cancellation-email';
import { processTemplate, parsePOContactInfo, DEFAULT_TEMPLATES } from '@/lib/templates';

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const parseEmailList = (value: string | null | undefined): string[] =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export async function POST(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const resend = new Resend(process.env.RESEND_API_KEY!);

  try {
    const {
      purchaseOrderId,
      cancellationReason,
      overrides,
      cc,
      supplierOrderIds,
      emailType,
    } = await request.json();

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

    const scopedSupplierOrderIds = Array.isArray(supplierOrderIds)
      ? supplierOrderIds
          .map((value: any) => Number(value))
          .filter((value: number) => Number.isFinite(value))
      : [];
    const cancellationScope: 'order' | 'line' =
      emailType === 'po_line_cancel' || scopedSupplierOrderIds.length > 0 ? 'line' : 'order';

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

    const filteredSupplierOrders =
      scopedSupplierOrderIds.length > 0
        ? (purchaseOrder.supplier_orders || []).filter((order: any) =>
            scopedSupplierOrderIds.includes(Number(order.order_id))
          )
        : purchaseOrder.supplier_orders || [];

    if (filteredSupplierOrders.length === 0) {
      return NextResponse.json(
        { error: 'No supplier order lines found for cancellation email' },
        { status: 400 }
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

    // Fetch document templates for contact info
    const { data: templates } = await supabase
      .from('document_templates')
      .select('template_type, content')
      .in('template_type', ['po_contact_info']);

    const poContactTemplate = templates?.find(t => t.template_type === 'po_contact_info')?.content || DEFAULT_TEMPLATES.po_contact_info;
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

    // Extract unique suppliers
    const uniqueSuppliers = filteredSupplierOrders
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
            error: emailError.message,
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
          error: 'No supplier email found',
        });
        continue;
      }

      // Get only the orders for this supplier
      const supplierOrdersRaw = filteredSupplierOrders.filter((order: any) => {
        const sc = Array.isArray(order.supplier_component)
          ? order.supplier_component[0]
          : order.supplier_component;
        const sup = Array.isArray(sc?.supplier) ? sc.supplier[0] : sc?.supplier;
        return sup?.supplier_id === supplier.supplier_id;
      });

      const supplierOrdersForEmail = supplierOrdersRaw.map((order: any) => {
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
      });

      try {
        const html = await renderAsync(PurchaseOrderCancellationEmail({
          purchaseOrderId: Number(purchaseOrder.purchase_order_id),
          qNumber: String(purchaseOrder.q_number || `PO-${purchaseOrder.purchase_order_id}`),
          supplierName: String(supplier.name),
          createdAt: String(purchaseOrder.created_at),
          supplierOrders: supplierOrdersForEmail,
          cancellationReason: cancellationReason || undefined,
          companyName: companyInfo.name,
          companyLogoUrl: companyInfo.logoUrl,
          companyAddress: companyInfo.address,
          companyPhone: companyInfo.phone,
          companyEmail: companyInfo.email,
          supplierEmail: toEmail,
          contactName: contactInfo.name,
          contactEmail: contactInfo.email,
          cancellationScope,
        }));

        const { data: result, error } = await resend.emails.send({
          from: `${companyInfo.name} Purchasing <${fromAddress}>`,
          to: [toEmail],
          cc: mergedCcList.length ? mergedCcList : undefined,
          subject:
            cancellationScope === 'line'
              ? `LINE ITEM CANCELLED: Purchase Order ${purchaseOrder.q_number || `PO-${purchaseOrder.purchase_order_id}`}`
              : `CANCELLED: Purchase Order ${purchaseOrder.q_number || `PO-${purchaseOrder.purchase_order_id}`}`,
          html,
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

    // Log all email results
    for (const result of emailResults) {
      if (result.recipientEmail) {
        const scopedSupplierOrderId =
          scopedSupplierOrderIds.length === 1 ? scopedSupplierOrderIds[0] : null;
        await supabase.from('purchase_order_emails').insert({
          purchase_order_id: purchaseOrderId,
          supplier_id: result.supplierId,
          supplier_order_id: scopedSupplierOrderId,
          recipient_email: result.recipientEmail,
          cc_emails: mergedCcList.length > 0 ? mergedCcList : [],
          email_type: cancellationScope === 'line' ? 'po_line_cancel' : 'po_cancel',
          status: result.success ? 'sent' : 'failed',
          message_id: result.messageId || null,
          error_message: result.error || null,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Cancellation emails sent',
      results: emailResults,
    });
  } catch (error: any) {
    console.error('Error sending cancellation emails:', error);
    return NextResponse.json(
      { error: `Failed to send cancellation emails: ${error.message}` },
      { status: 500 }
    );
  }
}

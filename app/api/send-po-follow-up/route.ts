import { NextResponse } from 'next/server';
import { renderAsync } from '@react-email/render';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import FollowUpEmail, { FollowUpEmailProps, FollowUpItem } from '@/emails/follow-up-email';

export async function POST(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const resend = new Resend(process.env.RESEND_API_KEY!);

  try {
    const { purchaseOrderId, supplierId, cc } = await request.json();

    if (!purchaseOrderId) {
      return NextResponse.json(
        { error: 'Purchase order ID is required' },
        { status: 400 }
      );
    }

    const ccList = Array.isArray(cc)
      ? cc.map((value: any) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value: string) => value.length > 0)
      : [] as string[];

    // Fetch the purchase order with outstanding items
    const { data: purchaseOrder, error: poError } = await supabase
      .from('purchase_orders')
      .select(`
        purchase_order_id,
        q_number,
        order_date,
        supplier_orders(
          order_id,
          order_quantity,
          total_received,
          supplier_component:suppliercomponents(
            supplier_code,
            price,
            component:components(
              component_id,
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

    // Filter to only outstanding items (not fully received)
    const outstandingOrders = (purchaseOrder.supplier_orders || []).filter((order: any) => {
      const received = Number(order.total_received || 0);
      const ordered = Number(order.order_quantity || 0);
      return received < ordered;
    });

    if (outstandingOrders.length === 0) {
      return NextResponse.json(
        { error: 'No outstanding items to follow up on' },
        { status: 400 }
      );
    }

    // Group by supplier
    const ordersBySupplier = new Map<number, any[]>();
    for (const order of outstandingOrders) {
      const sc = Array.isArray(order.supplier_component)
        ? order.supplier_component[0]
        : order.supplier_component;
      const supplier = Array.isArray(sc?.supplier) ? sc.supplier[0] : sc?.supplier;
      
      if (!supplier?.supplier_id) continue;
      
      // If supplierId is specified, only include that supplier
      if (supplierId && supplier.supplier_id !== supplierId) continue;
      
      if (!ordersBySupplier.has(supplier.supplier_id)) {
        ordersBySupplier.set(supplier.supplier_id, []);
      }
      ordersBySupplier.get(supplier.supplier_id)?.push({
        ...order,
        supplierName: supplier.name,
        supplierComponent: sc
      });
    }

    if (ordersBySupplier.size === 0) {
      return NextResponse.json(
        { error: 'No suppliers found with outstanding items' },
        { status: 400 }
      );
    }

    // Get company settings
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

    // Send follow-up email to each supplier
    const emailResults: { supplier: string; supplierId: number; success: boolean; error?: string; messageId?: string; recipientEmail?: string }[] = [];

    for (const [currentSupplierId, orders] of Array.from(ordersBySupplier.entries())) {
      const supplierName = orders[0]?.supplierName || 'Supplier';

      // Get supplier email
      const { data: emailRows } = await supabase
        .from('supplier_emails')
        .select('email, is_primary')
        .eq('supplier_id', currentSupplierId);

      const sorted = (emailRows || []).sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary));
      const toEmail = sorted[0]?.email;

      if (!toEmail) {
        emailResults.push({
          supplier: supplierName,
          supplierId: currentSupplierId,
          success: false,
          error: 'No supplier email found'
        });
        continue;
      }

      // Build items list
      const items: FollowUpItem[] = orders.map((order: any) => {
        const sc = order.supplierComponent;
        const component = Array.isArray(sc?.component) ? sc.component[0] : sc?.component;
        const outstanding = Number(order.order_quantity) - Number(order.total_received || 0);
        
        return {
          internal_code: component?.internal_code || '',
          description: component?.description || '',
          supplier_code: sc?.supplier_code || '',
          quantity_ordered: outstanding,
          po_number: purchaseOrder.q_number || `PO-${purchaseOrderId}`,
          order_date: new Date(purchaseOrder.order_date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
        };
      });

      // Create follow-up record for tracking
      const { data: followUpRecord } = await supabase
        .from('component_follow_up_emails')
        .insert({
          purchase_order_id: purchaseOrderId,
          supplier_id: currentSupplierId,
          supplier_name: supplierName,
          po_numbers: [purchaseOrder.q_number || `PO-${purchaseOrderId}`],
          status: 'pending'
        })
        .select('id')
        .single();

      // Create response token for supplier to respond via web form
      let responseUrl: string | undefined;
      if (followUpRecord?.id) {
        const { data: responseRecord } = await supabase
          .from('supplier_follow_up_responses')
          .insert({ 
            follow_up_id: followUpRecord.id,
            line_item_responses: items
          })
          .select('token')
          .single();
        
        if (responseRecord?.token) {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          responseUrl = `${baseUrl}/supplier-response/${responseRecord.token}`;
        }
      }

      const emailData: FollowUpEmailProps = {
        supplierName,
        items,
        companyName: companyInfo.name,
        companyLogoUrl: companyInfo.logoUrl,
        companyAddress: companyInfo.address,
        companyPhone: companyInfo.phone,
        companyEmail: companyInfo.email,
        companyWebsite: companyInfo.website,
        supplierEmail: toEmail,
        responseUrl,
      };

      try {
        const html = await renderAsync(FollowUpEmail(emailData));

        const { data: result, error } = await resend.emails.send({
          from: `${emailData.companyName} Purchasing <${fromAddress}>`,
          to: [toEmail],
          cc: ccList.length ? ccList : undefined,
          subject: `Order Follow-Up: ${purchaseOrder.q_number || `PO-${purchaseOrderId}`} - Delivery Status Request`,
          html,
        });

        if (error) {
          emailResults.push({
            supplier: supplierName,
            supplierId: currentSupplierId,
            success: false,
            error: error.message,
            recipientEmail: toEmail,
          });
          // Update follow-up record as failed
          if (followUpRecord?.id) {
            await supabase
              .from('component_follow_up_emails')
              .update({ status: 'failed', error_message: error.message })
              .eq('id', followUpRecord.id);
          }
        } else {
          emailResults.push({
            supplier: supplierName,
            supplierId: currentSupplierId,
            success: true,
            messageId: result?.id,
            recipientEmail: toEmail,
          });
          // Update follow-up record as sent
          if (followUpRecord?.id) {
            await supabase
              .from('component_follow_up_emails')
              .update({ status: 'sent' })
              .eq('id', followUpRecord.id);
          }
        }
      } catch (renderError: any) {
        emailResults.push({
          supplier: supplierName,
          supplierId: currentSupplierId,
          success: false,
          error: `Email rendering error: ${renderError.message}`,
          recipientEmail: toEmail,
        });
        // Update follow-up record as failed
        if (followUpRecord?.id) {
          await supabase
            .from('component_follow_up_emails')
            .update({ status: 'failed', error_message: `Email rendering error: ${renderError.message}` })
            .eq('id', followUpRecord.id);
        }
      }
    }

    // Log all email results to the database as follow-ups
    for (const result of emailResults) {
      if (result.recipientEmail) {
        await supabase.from('purchase_order_emails').insert({
          purchase_order_id: purchaseOrderId,
          supplier_id: result.supplierId,
          recipient_email: result.recipientEmail,
          cc_emails: ccList.length > 0 ? ccList : [],
          status: result.success ? 'sent' : 'failed',
          message_id: result.messageId || null,
          error_message: result.error || null,
        });
      }
    }

    const successCount = emailResults.filter(r => r.success).length;

    return NextResponse.json({
      success: successCount > 0,
      message: successCount > 0
        ? `Follow-up email${successCount > 1 ? 's' : ''} sent to ${successCount} supplier${successCount > 1 ? 's' : ''}`
        : 'Failed to send follow-up emails',
      results: emailResults
    });
  } catch (error: any) {
    console.error('Error sending PO follow-up emails:', error);
    return NextResponse.json(
      { error: `Failed to send follow-up emails: ${error.message}` },
      { status: 500 }
    );
  }
}

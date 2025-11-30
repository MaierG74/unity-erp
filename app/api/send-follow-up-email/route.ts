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
    const { componentId, cc } = await request.json();

    if (!componentId) {
      return NextResponse.json(
        { error: 'Component ID is required' },
        { status: 400 }
      );
    }

    const ccList = Array.isArray(cc)
      ? cc.map((value: any) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value: string) => value.length > 0)
      : [] as string[];

    // Get component details
    const { data: component, error: compError } = await supabase
      .from('components')
      .select('component_id, internal_code, description')
      .eq('component_id', componentId)
      .single();

    if (compError || !component) {
      return NextResponse.json(
        { error: 'Component not found' },
        { status: 404 }
      );
    }

    // First, get supplier_component_ids for this component
    const { data: supplierComponents, error: scError } = await supabase
      .from('suppliercomponents')
      .select('supplier_component_id, supplier_code, supplier:suppliers(supplier_id, name)')
      .eq('component_id', componentId);

    if (scError || !supplierComponents || supplierComponents.length === 0) {
      return NextResponse.json(
        { error: 'No supplier components found for this component' },
        { status: 404 }
      );
    }

    const supplierComponentIds = supplierComponents.map(sc => sc.supplier_component_id);

    // Find all supplier orders for these supplier components
    const { data: supplierOrders, error: soError } = await supabase
      .from('supplier_orders')
      .select(`
        order_id,
        order_quantity,
        total_received,
        supplier_component_id,
        order_date,
        purchase_order:purchase_orders(
          purchase_order_id,
          q_number,
          order_date,
          status:supplier_order_statuses(status_name)
        )
      `)
      .in('supplier_component_id', supplierComponentIds);

    if (soError) {
      return NextResponse.json(
        { error: `Failed to fetch supplier orders: ${soError.message}` },
        { status: 500 }
      );
    }

    // Filter to only pending orders (not fully received, and status indicates it's active)
    const pendingOrders = (supplierOrders || []).filter((so: any) => {
      const received = Number(so.total_received || 0);
      const ordered = Number(so.order_quantity || 0);
      const po = Array.isArray(so.purchase_order) ? so.purchase_order[0] : so.purchase_order;
      const statusObj = Array.isArray(po?.status) ? po.status[0] : po?.status;
      const status = statusObj?.status_name;
      // Include Draft, Approved, Pending Approval, In Progress, Partially Received
      const validStatuses = ['Draft', 'Approved', 'Pending Approval', 'In Progress', 'Partially Received', 'Open'];
      return received < ordered && validStatuses.includes(status);
    });

    if (pendingOrders.length === 0) {
      return NextResponse.json(
        { error: 'No pending orders found for this component' },
        { status: 404 }
      );
    }

    // Create a lookup map for supplier components
    const scLookup = new Map<number, any>();
    for (const sc of supplierComponents) {
      const supplier = Array.isArray(sc.supplier) ? sc.supplier[0] : sc.supplier;
      scLookup.set(sc.supplier_component_id, {
        supplier_code: sc.supplier_code,
        supplier_id: supplier?.supplier_id,
        supplier_name: supplier?.name
      });
    }

    // Group orders by supplier
    const ordersBySupplier = new Map<number, any[]>();
    for (const order of pendingOrders) {
      const scInfo = scLookup.get(order.supplier_component_id);
      
      if (scInfo?.supplier_id) {
        if (!ordersBySupplier.has(scInfo.supplier_id)) {
          ordersBySupplier.set(scInfo.supplier_id, []);
        }
        ordersBySupplier.get(scInfo.supplier_id)?.push({
          ...order,
          supplierName: scInfo.supplier_name,
          supplierCode: scInfo.supplier_code
        });
      }
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
    const fromAddress = process.env.EMAIL_FROM || companyInfo.email || 'purchasing@example.com';

    // Send email to each supplier
    const emailResults: { supplier: string; success: boolean; error?: string; messageId?: string }[] = [];

    for (const [supplierId, orders] of Array.from(ordersBySupplier.entries())) {
      const supplierName = orders[0]?.supplierName || 'Supplier';

      // Get supplier email
      const { data: emailRows } = await supabase
        .from('supplier_emails')
        .select('email, is_primary')
        .eq('supplier_id', supplierId);

      const sorted = (emailRows || []).sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary));
      const toEmail = sorted[0]?.email;

      if (!toEmail) {
        emailResults.push({
          supplier: supplierName,
          success: false,
          error: 'No supplier email found'
        });
        continue;
      }

      // Build items list
      const items: FollowUpItem[] = orders.map((order: any) => {
        const po = Array.isArray(order.purchase_order)
          ? order.purchase_order[0]
          : order.purchase_order;
        
        return {
          internal_code: component.internal_code,
          description: component.description || '',
          supplier_code: order.supplierCode || '',
          quantity_ordered: Number(order.order_quantity) - Number(order.total_received || 0),
          po_number: po?.q_number || 'N/A',
          order_date: new Date(po?.order_date || order.order_date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
        };
      });

      const poNumbersList = [...new Set(items.map(i => i.po_number))];
      
      // Create follow-up record first
      const { data: followUpRecord } = await supabase
        .from('component_follow_up_emails')
        .insert({
          component_id: componentId,
          supplier_id: supplierId,
          supplier_name: supplierName,
          po_numbers: poNumbersList,
          status: 'pending'
        })
        .select('id')
        .single();

      // Create response token for supplier to respond via web form
      // Include line items so supplier can respond per-item
      let responseUrl: string | undefined;
      if (followUpRecord?.id) {
        const { data: responseRecord } = await supabase
          .from('supplier_follow_up_responses')
          .insert({ 
            follow_up_id: followUpRecord.id,
            line_item_responses: items // Store items so supplier can respond to each
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
        const poNumbers = poNumbersList.join(', ');

        const { data: result, error } = await resend.emails.send({
          from: `${emailData.companyName} Purchasing <${fromAddress}>`,
          to: [toEmail],
          cc: ccList.length ? ccList : undefined,
          subject: `Order Follow-Up: ${poNumbers} - ${component.internal_code}`,
          html,
        });

        if (error) {
          emailResults.push({
            supplier: supplierName,
            success: false,
            error: error.message
          });
          
          // Update record as failed
          if (followUpRecord?.id) {
            await supabase
              .from('component_follow_up_emails')
              .update({ status: 'failed', error_message: error.message })
              .eq('id', followUpRecord.id);
          }
        } else {
          emailResults.push({
            supplier: supplierName,
            success: true,
            messageId: result?.id
          });
          
          // Update record as sent
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
          success: false,
          error: `Email rendering error: ${renderError.message}`
        });
        
        // Update record as failed
        if (followUpRecord?.id) {
          await supabase
            .from('component_follow_up_emails')
            .update({ status: 'failed', error_message: `Email rendering error: ${renderError.message}` })
            .eq('id', followUpRecord.id);
        }
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
    console.error('Error sending follow-up emails:', error);
    return NextResponse.json(
      { error: `Failed to send follow-up emails: ${error.message}` },
      { status: 500 }
    );
  }
}

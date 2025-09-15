import { NextResponse } from 'next/server';
import { renderAsync } from '@react-email/render';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import PurchaseOrderEmail, { PurchaseOrderEmailProps, SupplierOrderItem } from '@/emails/purchase-order-email';



export async function POST(request: Request) {
  // Initialize Supabase client lazily to ensure env vars exist at runtime
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // Initialize Resend lazily
  const resend = new Resend(process.env.RESEND_API_KEY!);
  try {
    const { purchaseOrderId } = await request.json();

    if (!purchaseOrderId) {
      return NextResponse.json(
        { error: 'Purchase order ID is required' },
        { status: 400 }
      );
    }

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

    // Extract unique suppliers from the order (handle array/object shapes from Supabase)
    const uniqueSuppliers = purchaseOrder.supplier_orders
      .map((order: any) => {
        const sc = Array.isArray(order.supplier_component)
          ? order.supplier_component[0]
          : order.supplier_component;
        const sup = Array.isArray(sc?.supplier) ? sc.supplier[0] : sc?.supplier;
        if (!sup) return null;
        return { supplier_id: sup.supplier_id, name: sup.name };
      })
      .filter((s: any) => !!s)
      .filter((supplier: any, index: number, self: any[]) =>
        index === self.findIndex((t: any) => t.supplier_id === supplier.supplier_id)
      );
    
    // Send email to each supplier
    const emailResults = [];
    
    for (const supplier of uniqueSuppliers) {
      // Get supplier email
      const { data: supplierEmails, error: emailError } = await supabase
        .from('supplier_emails')
        .select('email')
        .eq('supplier_id', supplier.supplier_id)
        .eq('is_primary', true)
        .single();
      
      if (emailError) {
        emailResults.push({
          supplier: supplier.name,
          success: false,
          error: `Could not find primary email: ${emailError.message}`
        });
        continue; // Skip to next supplier if email not found
      }
      
      // Get only the orders for this supplier and normalize shape for email template
      const supplierOrdersRaw = purchaseOrder.supplier_orders.filter((order: any) => {
        const sc = Array.isArray(order.supplier_component)
          ? order.supplier_component[0]
          : order.supplier_component;
        const sup = Array.isArray(sc?.supplier) ? sc.supplier[0] : sc?.supplier;
        return sup?.supplier_id === supplier.supplier_id;
      });

      const supplierOrdersForEmail: SupplierOrderItem[] = supplierOrdersRaw.map((order: any) => {
        const sc = Array.isArray(order.supplier_component)
          ? order.supplier_component[0]
          : order.supplier_component;
        return {
          order_id: Number(order.order_id),
          order_quantity: Number(order.order_quantity),
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

      // Prepare email data in the exact shape expected by the template
      const emailData: PurchaseOrderEmailProps = {
        purchaseOrderId: Number(purchaseOrder.purchase_order_id),
        qNumber: String(purchaseOrder.q_number),
        supplierName: String(supplier.name),
        createdAt: String(purchaseOrder.created_at),
        supplierOrders: supplierOrdersForEmail,
        notes: purchaseOrder.notes ?? undefined,
        // Company details could be loaded from environment variables or database
        companyName: process.env.COMPANY_NAME || 'Unity',
        companyLogo: process.env.COMPANY_LOGO || 'https://your-company-logo-url.com',
        companyAddress: process.env.COMPANY_ADDRESS || '123 Unity Street, London, UK',
        companyPhone: process.env.COMPANY_PHONE || '+44 123 456 7890',
        companyEmail: process.env.EMAIL_FROM || 'purchasing@example.com',
      };
      
      try {
        // Render the email template to HTML
        const html = await renderAsync(PurchaseOrderEmail(emailData));
        
        // Send the email via Resend
        const { data: result, error } = await resend.emails.send({
          from: `${emailData.companyName} Purchasing <${emailData.companyEmail}>`,
          to: [supplierEmails.email],
          subject: `Purchase Order: ${emailData.qNumber}`,
          html,
        });
  
        if (error) {
          emailResults.push({
            supplier: supplier.name,
            success: false,
            error: error.message
          });
        } else {
          emailResults.push({
            supplier: supplier.name,
            success: true,
            messageId: result?.id
          });
        }
      } catch (renderError: any) {
        emailResults.push({
          supplier: supplier.name,
          success: false,
          error: `Email rendering error: ${renderError.message}`
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
import { NextResponse } from 'next/server';
import { renderAsync } from '@react-email/render';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import SupplierReturnEmail, { SupplierReturnEmailProps, ReturnItem } from '@/emails/supplier-return-email';

export async function POST(request: Request) {
  // Initialize Supabase client lazily to ensure env vars exist at runtime
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // Initialize Resend lazily
  const resend = new Resend(process.env.RESEND_API_KEY!);

  try {
    const { returnId, overrideEmail, cc } = await request.json();

    if (!returnId) {
      return NextResponse.json(
        { error: 'Return ID is required' },
        { status: 400 }
      );
    }

    const ccList = Array.isArray(cc)
      ? cc.map((value: any) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value: string) => value.length > 0)
      : [] as string[];

    // Fetch the supplier return with all necessary details
    const { data: returnRecord, error: returnError } = await supabase
      .from('supplier_order_returns')
      .select(`
        return_id,
        goods_return_number,
        quantity_returned,
        reason,
        return_type,
        return_date,
        notes,
        document_url,
        supplier_order_id,
        supplier_orders(
          order_id,
          purchase_order_id,
          supplier_component_id,
          suppliercomponents(
            supplier_code,
            component:components(
              internal_code,
              description
            ),
            supplier:suppliers(
              supplier_id,
              name
            )
          ),
          purchase_orders(
            q_number
          )
        )
      `)
      .eq('return_id', returnId)
      .single();

    if (returnError || !returnRecord) {
      return NextResponse.json(
        { error: `Failed to fetch return record: ${returnError?.message || 'Not found'}` },
        { status: 404 }
      );
    }

    // Normalize the supplier order structure
    const supplierOrder = Array.isArray(returnRecord.supplier_orders)
      ? returnRecord.supplier_orders[0]
      : returnRecord.supplier_orders;

    if (!supplierOrder) {
      return NextResponse.json(
        { error: 'Supplier order not found for this return' },
        { status: 404 }
      );
    }

    const supplierComponent = Array.isArray(supplierOrder.suppliercomponents)
      ? supplierOrder.suppliercomponents[0]
      : supplierOrder.suppliercomponents;

    if (!supplierComponent) {
      return NextResponse.json(
        { error: 'Supplier component not found' },
        { status: 404 }
      );
    }

    const supplier = Array.isArray(supplierComponent.supplier)
      ? supplierComponent.supplier[0]
      : supplierComponent.supplier;

    const component = Array.isArray(supplierComponent.component)
      ? supplierComponent.component[0]
      : supplierComponent.component;

    const purchaseOrder = Array.isArray(supplierOrder.purchase_orders)
      ? supplierOrder.purchase_orders[0]
      : supplierOrder.purchase_orders;

    if (!supplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      );
    }

    // Get company settings for email configuration
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
    // Sanitize company name for email header (remove special chars that break RFC 5322)
    const sanitizedCompanyName = companyInfo.name.replace(/[<>()[\]\\,;:@"]/g, '').trim();

    // Resolve recipient email (override -> primary -> any)
    let toEmail = overrideEmail;
    if (!toEmail) {
      const { data: emailRows, error: emailError } = await supabase
        .from('supplier_emails')
        .select('email, is_primary')
        .eq('supplier_id', supplier.supplier_id);

      if (emailError) {
        return NextResponse.json(
          { error: `Failed to fetch supplier email: ${emailError.message}` },
          { status: 500 }
        );
      }

      const sorted = (emailRows || []).sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary));
      toEmail = sorted[0]?.email;
    }

    if (!toEmail) {
      return NextResponse.json(
        { error: 'No supplier email found. Please provide an override email.' },
        { status: 400 }
      );
    }

    // Prepare return items for email
    const items: ReturnItem[] = [{
      component_code: component?.internal_code || supplierComponent.supplier_code,
      component_name: component?.description || 'N/A',
      quantity_returned: returnRecord.quantity_returned,
      reason: returnRecord.reason,
    }];

    // Prepare email data
    const emailData: SupplierReturnEmailProps = {
      goodsReturnNumber: returnRecord.goods_return_number || 'PENDING',
      purchaseOrderNumber: purchaseOrder?.q_number || 'N/A',
      returnDate: returnRecord.return_date,
      items,
      returnType: returnRecord.return_type as 'rejection' | 'later_return' | 'mixed',
      notes: returnRecord.notes || undefined,
      pdfDownloadUrl: returnRecord.document_url || undefined,
      supplierName: supplier.name,
      supplierEmail: toEmail,
      companyName: companyInfo.name,
      companyLogoUrl: companyInfo.logoUrl,
      companyAddress: companyInfo.address,
      companyPhone: companyInfo.phone,
      companyEmail: companyInfo.email,
    };

    // Render the email template to HTML
    const html = await renderAsync(SupplierReturnEmail(emailData));

    // Send the email via Resend
    const { data: result, error } = await resend.emails.send({
      from: `${sanitizedCompanyName} Purchasing <${fromAddress}>`,
      to: [toEmail],
      cc: ccList.length ? ccList : undefined,
      subject: `Goods Returned - ${emailData.goodsReturnNumber} (PO: ${emailData.purchaseOrderNumber})`,
      html,
    });

    if (error) {
      return NextResponse.json(
        { error: `Failed to send email: ${error.message}` },
        { status: 500 }
      );
    }

    // Update the return record with email status
    const { error: updateError } = await supabase
      .from('supplier_order_returns')
      .update({
        email_status: 'sent',
        email_sent_at: new Date().toISOString(),
        email_message_id: result?.id,
      })
      .eq('return_id', returnId);

    if (updateError) {
      console.warn('Failed to update email status:', updateError);
      // Don't fail the request if email was sent successfully
    }

    return NextResponse.json({
      success: true,
      message: 'Supplier return email sent successfully',
      messageId: result?.id,
      recipient: toEmail,
    });
  } catch (error: any) {
    console.error('Error sending supplier return email:', error);
    return NextResponse.json(
      { error: `Failed to send supplier return email: ${error.message}` },
      { status: 500 }
    );
  }
}

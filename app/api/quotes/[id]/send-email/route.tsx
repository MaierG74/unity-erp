import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendQuoteEmail } from '@/lib/email';
import { QuoteEmailProps } from '@/emails/quote-email';

/**
 * POST /api/quotes/[id]/send-email
 * Send quote PDF via email to one or more recipients
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const quoteId = id;
  try {
    const body = await req.json();
    const {
      recipientEmail,   // legacy: single string
      recipientEmails,  // new: array of strings
      ccEmails,
      customMessage,
      pdfBase64,
      pdfFilename,
    } = body;

    // Build recipient list (support both old single and new multi format)
    let toEmails: string[] = [];
    if (Array.isArray(recipientEmails) && recipientEmails.length > 0) {
      toEmails = recipientEmails;
    } else if (recipientEmail) {
      toEmails = [recipientEmail];
    }

    // Fetch quote with customer
    const { data: quote, error: quoteError } = await supabaseAdmin
      .from('quotes')
      .select('*, customer:customers(id, name, email, telephone)')
      .eq('id', quoteId)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: 'Quote not found' },
        { status: 404 }
      );
    }

    // Fallback to customer email if no recipients provided
    if (toEmails.length === 0 && quote.customer?.email) {
      toEmails = [quote.customer.email];
    }

    if (toEmails.length === 0) {
      return NextResponse.json(
        { error: 'No recipient email available. Please provide at least one recipient.' },
        { status: 400 }
      );
    }

    // Validate email formats
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmail = toEmails.find(e => !emailRegex.test(e));
    if (invalidEmail) {
      return NextResponse.json(
        { error: `Invalid email format: ${invalidEmail}` },
        { status: 400 }
      );
    }

    // Fetch items separately
    const { data: items } = await supabaseAdmin
      .from('quote_items')
      .select('*, quote_item_clusters(*, quote_cluster_lines(*))')
      .eq('quote_id', quoteId);

    // Fetch attachments separately
    const { data: attachments } = await supabaseAdmin
      .from('quote_attachments')
      .select('*')
      .eq('quote_id', quoteId);

    // Group attachments by scope and quote_item_id
    const allAttachments = attachments || [];
    const quoteAttachments = allAttachments.filter((att: any) => att.scope === 'quote');
    const itemAttachmentsMap = new Map<string, any[]>();

    allAttachments
      .filter((att: any) => att.scope === 'item' && att.quote_item_id)
      .forEach((att: any) => {
        if (!itemAttachmentsMap.has(att.quote_item_id)) {
          itemAttachmentsMap.set(att.quote_item_id, []);
        }
        itemAttachmentsMap.get(att.quote_item_id)!.push(att);
      });

    // Attach items and attachments to quote
    (quote as any).items = (items || []).map((item: any) => ({
      ...item,
      attachments: itemAttachmentsMap.get(item.id) || [],
    }));
    (quote as any).attachments = quoteAttachments;

    // Fetch company settings for branding
    const { data: settings } = await supabaseAdmin
      .from('quote_company_settings')
      .select('*')
      .eq('setting_id', 1)
      .single();

    // Build company info for email and PDF
    const addressLines = [
      settings?.address_line1,
      settings?.address_line2,
      `${settings?.city ?? ''} ${settings?.postal_code ?? ''}`.trim(),
      settings?.country,
    ]
      .filter(Boolean)
      .join(', ');

    const companyInfo = {
      name: settings?.company_name || 'Unity ERP',
      address: addressLines || 'Your Business Address',
      phone: settings?.phone || '+27 XX XXX XXXX',
      email: settings?.email || 'info@unity-erp.com',
      website: settings?.website || undefined,
      logo: settings?.company_logo_path ?
        supabaseAdmin.storage.from('QButton').getPublicUrl(settings.company_logo_path).data?.publicUrl :
        undefined,
    };

    // Convert base64 PDF to buffer (PDF is generated client-side)
    let pdfBuffer: Buffer | undefined;
    if (pdfBase64) {
      pdfBuffer = Buffer.from(pdfBase64, 'base64');
    }

    // Format quote date
    const quoteDate = new Date(quote.created_at).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    // Prepare email data
    const emailData: QuoteEmailProps = {
      quoteNumber: quote.quote_number,
      customerName: quote.customer?.name || 'Valued Customer',
      quoteDate,
      subtotal: Number(quote.subtotal || 0),
      vatAmount: Number(quote.vat_amount || 0),
      grandTotal: Number(quote.grand_total || 0),
      itemCount: quote.items?.length || 0,
      validityDays: 30,
      customMessage,
      companyName: companyInfo.name,
      companyLogo: companyInfo.logo,
      companyAddress: companyInfo.address,
      companyPhone: companyInfo.phone,
      companyEmail: companyInfo.email,
      companyWebsite: companyInfo.website,
    };

    const pdfAttachment = pdfBuffer && pdfFilename ? {
      content: pdfBuffer,
      filename: pdfFilename,
    } : undefined;

    // Send to all recipients
    const results: { email: string; success: boolean; messageId?: string; error?: string }[] = [];

    for (const email of toEmails) {
      try {
        const { success, messageId } = await sendQuoteEmail(email, emailData, pdfAttachment);

        // Log each send
        await supabaseAdmin.from('quote_email_log').insert({
          quote_id: quoteId,
          recipient_email: email,
          resend_message_id: messageId,
          status: success ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
        }).then(({ error: logError }) => {
          if (logError) console.error('Failed to log email send:', logError);
        });

        results.push({ email, success, messageId });
      } catch (err: any) {
        // Log failed attempt
        await supabaseAdmin.from('quote_email_log').insert({
          quote_id: quoteId,
          recipient_email: email,
          status: 'failed',
          error_message: err.message,
          sent_at: new Date().toISOString(),
        }).catch(logErr => console.error('Failed to log email error:', logErr));

        results.push({ email, success: false, error: err.message });
      }
    }

    const allSucceeded = results.every(r => r.success);
    const anySucceeded = results.some(r => r.success);

    if (!anySucceeded) {
      return NextResponse.json(
        { error: 'Failed to send email to all recipients', details: results },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      recipients: results,
      message: allSucceeded
        ? `Quote email sent to ${results.length} recipient${results.length !== 1 ? 's' : ''}`
        : `Email sent to ${results.filter(r => r.success).length} of ${results.length} recipients`,
    });

  } catch (error: any) {
    console.error('Error sending quote email:', error);

    try {
      await supabaseAdmin.from('quote_email_log').insert({
        quote_id: quoteId,
        recipient_email: 'unknown',
        status: 'failed',
        error_message: error.message,
        sent_at: new Date().toISOString(),
      });
    } catch (logError) {
      console.error('Failed to log email error:', logError);
    }

    return NextResponse.json(
      {
        error: 'Failed to send quote email',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

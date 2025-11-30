import React from 'react';
import { Resend } from 'resend';
import { renderAsync } from '@react-email/render';
import PurchaseOrderEmail, { PurchaseOrderEmailProps } from '@/emails/purchase-order-email';
import QuoteEmail, { QuoteEmailProps } from '@/emails/quote-email';

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send a purchase order notification email to a supplier
 */
export async function sendPurchaseOrderEmail(
  supplierEmail: string,
  data: PurchaseOrderEmailProps
) {
  try {
    // Render the email template to HTML
    const html = await renderAsync(PurchaseOrderEmail(data));

    // Send the email via Resend
    const { data: result, error } = await resend.emails.send({
      from: `Unity Purchasing <${process.env.EMAIL_FROM || 'purchasing@example.com'}>`,
      to: [supplierEmail],
      subject: `Purchase Order: ${data.qNumber}`,
      html,
      text: generatePlainTextVersion(data),
    });

    if (error) {
      console.error('Error sending email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return { success: true, messageId: result?.id };
  } catch (error) {
    console.error('Error sending purchase order email:', error);
    throw error;
  }
}

/**
 * Generate a plain text version of the email for clients that don't support HTML
 */
function generatePlainTextVersion(data: PurchaseOrderEmailProps): string {
  const { qNumber, supplierName, createdAt, supplierOrders, notes, companyName } = data;
  
  // Calculate total amount
  const totalAmount = supplierOrders.reduce(
    (sum, item) => sum + item.order_quantity * item.supplier_component.price,
    0
  );

  // Format date
  const formattedDate = new Date(createdAt).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  let plainText = `
PURCHASE ORDER: ${qNumber}
Date: ${formattedDate}

From: ${companyName}
To: ${supplierName}

ORDER ITEMS:
${supplierOrders.map(item => 
  `- ${item.supplier_component.supplier_code} | ${item.supplier_component.component.internal_code} | ${item.supplier_component.component.description} | Qty: ${item.order_quantity} | Price: R${item.supplier_component.price.toFixed(2)}`
).join('\n')}

TOTAL: R${totalAmount.toFixed(2)}
`;

  if (notes) {
    plainText += `\nNOTES:\n${notes}\n`;
  }

  plainText += `\nThis is an automatically generated email. Please contact us if you have any questions.`;

  return plainText;
}

/**
 * Send a quote email to a customer with PDF attachment
 */
export async function sendQuoteEmail(
  customerEmail: string,
  data: QuoteEmailProps,
  pdfAttachment?: { content: Buffer | string; filename: string }
) {
  try {
    // Render the email template to HTML
    const html = await renderAsync(QuoteEmail(data));

    // Prepare email payload
    const emailPayload: any = {
      from: `${data.companyName || 'Unity'} <${process.env.EMAIL_FROM || 'quotes@example.com'}>`,
      to: [customerEmail],
      subject: `Quotation ${data.quoteNumber} from ${data.companyName || 'Unity'}`,
      html,
      text: generateQuotePlainTextVersion(data),
      reply_to: data.companyEmail || process.env.EMAIL_FROM || 'quotes@example.com',
    };

    // Add PDF attachment if provided
    if (pdfAttachment) {
      emailPayload.attachments = [
        {
          filename: pdfAttachment.filename,
          content: pdfAttachment.content,
        },
      ];
    }

    // Send the email via Resend
    const { data: result, error } = await resend.emails.send(emailPayload);

    if (error) {
      console.error('Error sending quote email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    return { success: true, messageId: result?.id };
  } catch (error) {
    console.error('Error sending quote email:', error);
    throw error;
  }
}

/**
 * Generate a plain text version of the quote email
 */
function generateQuotePlainTextVersion(data: QuoteEmailProps): string {
  const { quoteNumber, customerName, quoteDate, subtotal, vatAmount, grandTotal, itemCount, validityDays = 30, customMessage, companyName = 'Unity', companyAddress, companyPhone, companyEmail } = data;

  const formatCurrency = (amount: number) => `R ${amount.toFixed(2)}`;

  let plainText = `
QUOTATION: ${quoteNumber}
Date: ${quoteDate}

Dear ${customerName},

Thank you for your interest in our products and services. Please find attached our quotation for your review.

QUOTE SUMMARY:
Quote Number: ${quoteNumber}
Date: ${quoteDate}
Number of Items: ${itemCount}

Subtotal (excl. VAT): ${formatCurrency(subtotal)}
VAT (15%): ${formatCurrency(vatAmount)}
Total (incl. VAT): ${formatCurrency(grandTotal)}
`;

  if (customMessage) {
    plainText += `\n${customMessage}\n`;
  }

  plainText += `\n⏰ This quotation is valid for ${validityDays} days from the date above.\n`;
  plainText += `\nShould you have any questions or require any clarifications, please don't hesitate to contact us. We look forward to working with you.\n`;
  plainText += `\n---\n${companyName}\n${companyAddress}\nTel: ${companyPhone}\nEmail: ${companyEmail}\n`;
  plainText += `\n© ${new Date().getFullYear()} ${companyName}. All rights reserved.`;

  return plainText;
}
import { Resend } from 'resend';
import { renderAsync } from '@react-email/render';
import PurchaseOrderEmail, { PurchaseOrderEmailProps } from '@/emails/purchase-order-email';

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
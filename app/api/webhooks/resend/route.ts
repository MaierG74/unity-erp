import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Create admin client for webhook operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Resend webhook event types
type ResendEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.complained'
  | 'email.bounced'
  | 'email.opened'
  | 'email.clicked';

interface ResendWebhookPayload {
  type: ResendEventType;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    // Bounce specific
    bounce?: {
      message: string;
      type?: 'hard' | 'soft';
    };
    // Complaint specific
    complaint?: {
      type?: string;
    };
    // Click specific
    click?: {
      link: string;
      timestamp: string;
    };
  };
}

// Verify Resend webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  webhookSecret: string | undefined
): boolean {
  if (!webhookSecret || !signature) {
    // If no secret configured, skip verification (development mode)
    console.warn('Webhook signature verification skipped - no secret configured');
    return true;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

// Map Resend event type to our simplified type
function mapEventType(resendType: ResendEventType): string {
  const mapping: Record<ResendEventType, string> = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'delayed',
    'email.complained': 'complained',
    'email.bounced': 'bounced',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
  };
  return mapping[resendType] || resendType;
}

// Find linked purchase order or quote by resend_message_id
async function findLinkedRecords(emailId: string) {
  // Check purchase_order_emails
  const { data: poEmail } = await supabaseAdmin
    .from('purchase_order_emails')
    .select('purchase_order_id, id')
    .eq('message_id', emailId)
    .single();

  // Check quote_email_log
  const { data: quoteEmail } = await supabaseAdmin
    .from('quote_email_log')
    .select('quote_id, id')
    .eq('resend_message_id', emailId)
    .single();

  return {
    purchaseOrderId: poEmail?.purchase_order_id || null,
    purchaseOrderEmailId: poEmail?.id || null,
    quoteId: quoteEmail?.quote_id || null,
    quoteEmailLogId: quoteEmail?.id || null,
  };
}

// Update delivery status on our email logs
async function updateEmailStatus(
  emailId: string,
  eventType: string,
  bounceReason?: string
) {
  const now = new Date().toISOString();

  // Update purchase_order_emails if exists
  if (eventType === 'delivered') {
    await supabaseAdmin
      .from('purchase_order_emails')
      .update({ delivery_status: 'delivered', delivered_at: now })
      .eq('message_id', emailId);

    await supabaseAdmin
      .from('quote_email_log')
      .update({ delivery_status: 'delivered', delivered_at: now })
      .eq('resend_message_id', emailId);
  } else if (eventType === 'bounced') {
    await supabaseAdmin
      .from('purchase_order_emails')
      .update({
        delivery_status: 'bounced',
        bounced_at: now,
        bounce_reason: bounceReason,
      })
      .eq('message_id', emailId);

    await supabaseAdmin
      .from('quote_email_log')
      .update({
        delivery_status: 'bounced',
        bounced_at: now,
        bounce_reason: bounceReason,
      })
      .eq('resend_message_id', emailId);
  } else if (eventType === 'complained') {
    await supabaseAdmin
      .from('purchase_order_emails')
      .update({ delivery_status: 'complained' })
      .eq('message_id', emailId);

    await supabaseAdmin
      .from('quote_email_log')
      .update({ delivery_status: 'complained' })
      .eq('resend_message_id', emailId);
  } else if (eventType === 'delayed') {
    await supabaseAdmin
      .from('purchase_order_emails')
      .update({ delivery_status: 'delayed' })
      .eq('message_id', emailId);

    await supabaseAdmin
      .from('quote_email_log')
      .update({ delivery_status: 'delayed' })
      .eq('resend_message_id', emailId);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('svix-signature');
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    // Verify signature if secret is configured
    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error('Invalid webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload: ResendWebhookPayload = JSON.parse(rawBody);
    const eventType = mapEventType(payload.type);
    const emailId = payload.data.email_id;

    console.log(`Resend webhook: ${payload.type} for email ${emailId}`);

    // Find linked records
    const linkedRecords = await findLinkedRecords(emailId);

    // Get the first recipient (Resend sends array)
    const recipientEmail = payload.data.to?.[0] || '';

    // Store the event
    const { error: insertError } = await supabaseAdmin.from('email_events').insert({
      resend_email_id: emailId,
      event_type: eventType,
      event_timestamp: payload.created_at,
      recipient_email: recipientEmail,
      subject: payload.data.subject,
      purchase_order_id: linkedRecords.purchaseOrderId,
      quote_id: linkedRecords.quoteId,
      bounce_type: payload.data.bounce?.type || null,
      bounce_message: payload.data.bounce?.message || null,
      complaint_type: payload.data.complaint?.type || null,
      raw_payload: payload,
    });

    if (insertError) {
      console.error('Error storing email event:', insertError);
      // Don't fail the webhook - Resend will retry
    }

    // Update status on our email logs
    await updateEmailStatus(
      emailId,
      eventType,
      payload.data.bounce?.message
    );

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

// Handle GET for webhook verification (some services use this)
export async function GET() {
  return NextResponse.json({ status: 'Resend webhook endpoint active' });
}

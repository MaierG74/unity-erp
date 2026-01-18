import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: purchaseOrderId } = await context.params;

    // Get email logs for this purchase order
    const { data: emailLogs, error: emailError } = await supabase
      .from('purchase_order_emails')
      .select('*')
      .eq('purchase_order_id', purchaseOrderId)
      .order('sent_at', { ascending: false });

    if (emailError) {
      console.error('Error fetching email logs:', emailError);
      return NextResponse.json({ error: emailError.message }, { status: 500 });
    }

    // Get email events for this purchase order
    const { data: events, error: eventsError } = await supabase
      .from('email_events')
      .select('*')
      .eq('purchase_order_id', purchaseOrderId)
      .order('event_timestamp', { ascending: false });

    if (eventsError) {
      console.error('Error fetching email events:', eventsError);
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }

    // Group events by email ID
    const eventsByEmailId = new Map<string, any[]>();
    events?.forEach((event) => {
      const emailId = event.resend_email_id;
      if (!eventsByEmailId.has(emailId)) {
        eventsByEmailId.set(emailId, []);
      }
      eventsByEmailId.get(emailId)!.push(event);
    });

    // Combine email logs with their events
    const emailsWithStatus = emailLogs?.map((email) => {
      const emailEvents = eventsByEmailId.get(email.message_id || '') || [];

      // Get the latest status from events
      const latestEvent = emailEvents[0];

      return {
        ...email,
        events: emailEvents,
        latest_event: latestEvent,
        has_bounced: emailEvents.some((e) => e.event_type === 'bounced'),
        has_complained: emailEvents.some((e) => e.event_type === 'complained'),
        has_delivered: emailEvents.some((e) => e.event_type === 'delivered'),
        has_opened: emailEvents.some((e) => e.event_type === 'opened'),
        has_clicked: emailEvents.some((e) => e.event_type === 'clicked'),
      };
    });

    return NextResponse.json({
      emails: emailsWithStatus || [],
      totalEvents: events?.length || 0,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch email status' },
      { status: 500 }
    );
  }
}

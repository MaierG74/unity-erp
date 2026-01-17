import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Get recent bounced or complained emails from the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: issues, error } = await supabase
      .from('email_events')
      .select(
        'id, event_type, recipient_email, subject, event_timestamp, purchase_order_id, quote_id, bounce_message'
      )
      .in('event_type', ['bounced', 'complained'])
      .gte('event_timestamp', sevenDaysAgo.toISOString())
      .order('event_timestamp', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Error fetching email issues:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      issues: issues || [],
      count: issues?.length || 0,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch email issues' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface EmailIssueRecord {
  id: string;
  event_type: string;
  recipient_email: string;
  subject: string | null;
  event_timestamp: string;
  purchase_order_id: number | null;
  quote_id: string | null;
  bounce_message: string | null;
}

interface PurchaseOrderLookup {
  purchase_order_id: number;
  q_number: string | null;
}

function normalizeQNumber(value: string): string {
  return value.trim().toUpperCase();
}

function extractPurchaseOrderNumber(subject: string | null): string | null {
  if (!subject) return null;

  const patterns = [
    /purchase\s*order\s*[:#-]?\s*([A-Za-z0-9-]+)/i,
    /\b(Q\d{1,4}-\d{1,6})\b/i,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match?.[1]) {
      return normalizeQNumber(match[1]);
    }
  }

  return null;
}

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

    const issueRows: EmailIssueRecord[] = issues ?? [];

    const purchaseOrderIds = Array.from(
      new Set(
        issueRows
          .map((issue) => issue.purchase_order_id)
          .filter((value): value is number => typeof value === 'number')
      )
    );

    const qNumbersToResolve = Array.from(
      new Set(
        issueRows
          .filter((issue) => !issue.purchase_order_id)
          .map((issue) => extractPurchaseOrderNumber(issue.subject))
          .filter((value): value is string => !!value)
      )
    );

    const purchaseOrdersById = new Map<number, PurchaseOrderLookup>();
    const purchaseOrdersByQNumber = new Map<string, PurchaseOrderLookup>();

    if (purchaseOrderIds.length > 0) {
      const { data: linkedPurchaseOrders, error: linkedError } = await supabase
        .from('purchase_orders')
        .select('purchase_order_id, q_number')
        .in('purchase_order_id', purchaseOrderIds);

      if (linkedError) {
        console.error('Error resolving purchase order numbers by ID:', linkedError);
      } else {
        (linkedPurchaseOrders as PurchaseOrderLookup[] | null)?.forEach((po) => {
          purchaseOrdersById.set(po.purchase_order_id, po);
          if (po.q_number) {
            purchaseOrdersByQNumber.set(normalizeQNumber(po.q_number), po);
          }
        });
      }
    }

    if (qNumbersToResolve.length > 0) {
      const { data: parsedPurchaseOrders, error: parsedError } = await supabase
        .from('purchase_orders')
        .select('purchase_order_id, q_number')
        .in('q_number', qNumbersToResolve);

      if (parsedError) {
        console.error('Error resolving purchase orders by Q-number:', parsedError);
      } else {
        (parsedPurchaseOrders as PurchaseOrderLookup[] | null)?.forEach((po) => {
          purchaseOrdersById.set(po.purchase_order_id, po);
          if (po.q_number) {
            purchaseOrdersByQNumber.set(normalizeQNumber(po.q_number), po);
          }
        });
      }
    }

    const resolvedIssues = issueRows.map((issue) => {
      const parsedQNumber = extractPurchaseOrderNumber(issue.subject);
      const linkedPurchaseOrder = issue.purchase_order_id
        ? purchaseOrdersById.get(issue.purchase_order_id)
        : undefined;
      const parsedPurchaseOrder = !issue.purchase_order_id && parsedQNumber
        ? purchaseOrdersByQNumber.get(parsedQNumber)
        : undefined;
      const resolvedPurchaseOrderId =
        issue.purchase_order_id ??
        parsedPurchaseOrder?.purchase_order_id ??
        null;
      const resolvedPurchaseOrderNumber =
        linkedPurchaseOrder?.q_number ??
        parsedPurchaseOrder?.q_number ??
        parsedQNumber ??
        null;

      return {
        ...issue,
        purchase_order_id: resolvedPurchaseOrderId,
        purchase_order_number: resolvedPurchaseOrderNumber,
      };
    });

    return NextResponse.json({
      issues: resolvedIssues,
      count: resolvedIssues.length,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch email issues' },
      { status: 500 }
    );
  }
}

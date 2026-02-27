'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format, parseISO } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Package, CheckCircle, Clock, Truck, Loader2, ExternalLink, Mail, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// Types
interface ProcurementLineDetail {
  supplier_order_id: number;
  order_quantity: number;
  total_received: number;
  po_number: string | null;
  purchase_order_id: number | null;
  component_code: string | null;
  component_name: string | null;
  supplier_name: string | null;
  line_status: string | null;
  last_receipt_date: string | null;
  quantity_for_order: number;
  received_quantity: number | null;
}

interface POGroup {
  po_number: string;
  purchase_order_id: number | null;
  supplier_name: string | null;
  lines: ProcurementLineDetail[];
}

interface EmailInfo {
  sent_at: string;
  delivery_status: string | null;
}

interface FollowUpInfo {
  sent_at: string;
  supplier_name: string;
  response_status: string | null;
  response_notes: string | null;
  responded_at: string | null;
  expected_delivery_date: string | null;
  line_item_responses: any[] | null;
}

interface POEmailData {
  lastEmail: EmailInfo | null;
  followUps: FollowUpInfo[];
}

// Fetch procurement lines
async function fetchOrderProcurement(orderId: number): Promise<ProcurementLineDetail[]> {
  const { data, error } = await supabase
    .from('supplier_order_customer_orders')
    .select(`
      quantity_for_order,
      received_quantity,
      supplier_order:supplier_orders(
        order_id,
        order_quantity,
        total_received,
        purchase_order:purchase_orders(
          purchase_order_id,
          q_number,
          supplier:suppliers(name)
        ),
        supplier_component:suppliercomponents(
          component:components(internal_code, description)
        ),
        status:supplier_order_statuses(status_name)
      )
    `)
    .eq('order_id', orderId);

  if (error) {
    console.error('Error fetching procurement data:', error);
    return [];
  }

  if (!data || data.length === 0) return [];

  const supplierOrderIds: number[] = [];
  const lines: ProcurementLineDetail[] = [];

  for (const row of data) {
    const so = row.supplier_order as any;
    if (!so) continue;

    const soId = so.order_id;
    supplierOrderIds.push(soId);

    const po = so.purchase_order;
    const sc = so.supplier_component;
    const status = so.status;

    lines.push({
      supplier_order_id: soId,
      order_quantity: so.order_quantity || 0,
      total_received: so.total_received || 0,
      po_number: po?.q_number || (po?.purchase_order_id ? `PO-${po.purchase_order_id}` : null),
      purchase_order_id: po?.purchase_order_id || null,
      component_code: sc?.component?.internal_code || null,
      component_name: sc?.component?.description || null,
      supplier_name: po?.supplier?.name || null,
      line_status: status?.status_name || null,
      last_receipt_date: null,
      quantity_for_order: Number(row.quantity_for_order || 0),
      received_quantity: row.received_quantity !== null && row.received_quantity !== undefined
        ? Number(row.received_quantity)
        : null,
    });
  }

  // Last receipt dates
  if (supplierOrderIds.length > 0) {
    const { data: receipts } = await supabase
      .from('supplier_order_receipts')
      .select('order_id, receipt_date')
      .in('order_id', supplierOrderIds)
      .order('receipt_date', { ascending: false });

    if (receipts && receipts.length > 0) {
      const receiptMap = new Map<number, string>();
      for (const r of receipts) {
        if (!receiptMap.has(r.order_id)) {
          receiptMap.set(r.order_id, r.receipt_date);
        }
      }
      for (const line of lines) {
        line.last_receipt_date = receiptMap.get(line.supplier_order_id) || null;
      }
    }
  }

  return lines;
}

// Fetch email + follow-up data per PO
async function fetchPOEmailData(purchaseOrderIds: number[]): Promise<Record<number, POEmailData>> {
  const result: Record<number, POEmailData> = {};
  for (const id of purchaseOrderIds) {
    result[id] = { lastEmail: null, followUps: [] };
  }

  if (purchaseOrderIds.length === 0) return result;

  // Last email per PO
  const { data: emails } = await supabase
    .from('purchase_order_emails')
    .select('purchase_order_id, sent_at, delivery_status')
    .in('purchase_order_id', purchaseOrderIds)
    .order('sent_at', { ascending: false });

  if (emails) {
    const seen = new Set<number>();
    for (const e of emails) {
      if (!seen.has(e.purchase_order_id)) {
        seen.add(e.purchase_order_id);
        result[e.purchase_order_id].lastEmail = {
          sent_at: e.sent_at,
          delivery_status: e.delivery_status,
        };
      }
    }
  }

  // Follow-ups per PO
  const { data: followUps } = await supabase
    .from('component_follow_up_emails')
    .select(`
      id,
      purchase_order_id,
      supplier_name,
      sent_at,
      status,
      response:supplier_follow_up_responses(
        status,
        expected_delivery_date,
        notes,
        responded_at,
        line_item_responses
      )
    `)
    .in('purchase_order_id', purchaseOrderIds)
    .order('sent_at', { ascending: false });

  if (followUps) {
    for (const fu of followUps) {
      const poId = fu.purchase_order_id;
      if (!poId || !result[poId]) continue;
      // response is an array (one-to-many join) — take the first entry
      const respArr = fu.response as any;
      const resp = Array.isArray(respArr) ? respArr[0] : respArr;
      result[poId].followUps.push({
        sent_at: fu.sent_at,
        supplier_name: fu.supplier_name,
        response_status: resp?.status || null,
        response_notes: resp?.notes || null,
        responded_at: resp?.responded_at || null,
        expected_delivery_date: resp?.expected_delivery_date || null,
        line_item_responses: resp?.line_item_responses || null,
      });
    }
  }

  return result;
}

// Effective quantity for this order's allocation.
// When a PO line is split across multiple orders, quantity_for_order holds
// the portion allocated to *this* customer order, which may be less than the
// full PO line order_quantity.
function effectiveQty(line: ProcurementLineDetail) {
  return line.quantity_for_order > 0 ? line.quantity_for_order : line.order_quantity;
}

// Effective received:
// - If allocation tracking is available, use it directly.
// - Otherwise, fall back to capped PO-line received quantity.
function effectiveReceived(line: ProcurementLineDetail) {
  if (line.received_quantity !== null) {
    return line.received_quantity;
  }
  const qty = effectiveQty(line);
  return Math.min(line.total_received, qty);
}

// Helper: line status colour + progress bar colour
function getLineStatusInfo(line: ProcurementLineDetail) {
  const qty = effectiveQty(line);
  const received = effectiveReceived(line);
  if (received >= qty && qty > 0) {
    return { dot: 'bg-emerald-500', label: 'Received', variant: 'default' as const, progressClass: '[&>div]:bg-emerald-500' };
  }
  if (received > 0) {
    return { dot: 'bg-amber-500', label: 'Partial', variant: 'default' as const, progressClass: '[&>div]:bg-amber-500' };
  }
  return { dot: 'bg-gray-400', label: 'Awaiting', variant: 'secondary' as const, progressClass: '[&>div]:bg-gray-400' };
}

// Follow-up status helpers
const followUpStatusColors: Record<string, string> = {
  on_track: 'text-green-600 dark:text-green-400',
  shipped: 'text-blue-600 dark:text-blue-400',
  delayed: 'text-amber-600 dark:text-amber-400',
  issue: 'text-red-600 dark:text-red-400',
};

const followUpStatusLabels: Record<string, string> = {
  on_track: 'On Track',
  shipped: 'Shipped',
  delayed: 'Delayed',
  issue: 'Issue',
};

// Main component
export function ProcurementTab({ orderId }: { orderId: number }) {
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['orderProcurement', orderId],
    queryFn: () => fetchOrderProcurement(orderId),
  });

  // Group by PO
  const poGroups = useMemo(() => {
    const map = new Map<string, POGroup>();
    for (const line of lines) {
      const key = line.po_number || 'Unassigned';
      if (!map.has(key)) {
        map.set(key, {
          po_number: key,
          purchase_order_id: line.purchase_order_id,
          supplier_name: line.supplier_name,
          lines: [],
        });
      }
      map.get(key)!.lines.push(line);
    }
    return Array.from(map.values());
  }, [lines]);

  // Collect PO IDs for email query
  const poIds = useMemo(() => {
    return poGroups.map(g => g.purchase_order_id).filter((id): id is number => id !== null);
  }, [poGroups]);

  const { data: emailData = {} } = useQuery({
    queryKey: ['poEmailData', poIds],
    queryFn: () => fetchPOEmailData(poIds),
    enabled: poIds.length > 0,
  });

  // Compute stats
  const stats = useMemo(() => {
    const total = lines.length;
    const fullyReceived = lines.filter(l => effectiveReceived(l) >= effectiveQty(l) && effectiveQty(l) > 0).length;
    const partial = lines.filter(l => effectiveReceived(l) > 0 && effectiveReceived(l) < effectiveQty(l)).length;
    const awaiting = lines.filter(l => effectiveReceived(l) === 0).length;
    return { total, fullyReceived, partial, awaiting };
  }, [lines]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
        <span className="text-sm text-muted-foreground">Loading procurement data...</span>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Package className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No supplier orders placed for this order</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Use the Components tab to order parts from suppliers</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Package} label="Total Lines" value={stats.total} color="text-foreground" bgColor="bg-muted/30" />
        <SummaryCard icon={CheckCircle} label="Fully Received" value={stats.fullyReceived} color="text-emerald-600 dark:text-emerald-400" bgColor="bg-emerald-500/10" />
        <SummaryCard icon={Truck} label="Partially Received" value={stats.partial} color="text-amber-600 dark:text-amber-400" bgColor="bg-amber-500/10" />
        <SummaryCard icon={Clock} label="Awaiting Delivery" value={stats.awaiting} color="text-gray-500 dark:text-gray-400" bgColor="bg-gray-500/10" />
      </div>

      {/* Grouped PO Table */}
      <div className="space-y-4">
        {poGroups.map((group) => {
          const groupLines = group.lines;
          const poEmail = group.purchase_order_id ? emailData[group.purchase_order_id] : null;

          return (
            <Card key={group.po_number} className="overflow-hidden">
              {/* PO Group Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
                <div className="flex items-center gap-3">
                  {group.purchase_order_id ? (
                    <Link
                      href={`/purchasing/purchase-orders/${group.purchase_order_id}`}
                      target="_blank"
                      className="text-sm font-semibold text-primary hover:underline flex items-center gap-1"
                    >
                      {group.po_number}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-muted-foreground">{group.po_number}</span>
                  )}
                  {group.supplier_name && (
                    <span className="text-xs text-muted-foreground">from {group.supplier_name}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {groupLines.filter(l => effectiveReceived(l) >= effectiveQty(l) && effectiveQty(l) > 0).length}/{groupLines.length} received
                  </span>
                </div>
              </div>

              {/* Email / Follow-up summary */}
              {poEmail && (poEmail.lastEmail || poEmail.followUps.length > 0) && (
                <POEmailSummary data={poEmail} />
              )}

              {/* Line Items */}
              <div className="divide-y divide-border/50">
                {groupLines.map((line) => {
                  const statusInfo = getLineStatusInfo(line);
                  const qty = effectiveQty(line);
                  const received = effectiveReceived(line);
                  const pct = qty > 0 ? Math.min(100, Math.round((received / qty) * 100)) : 0;

                  return (
                    <div key={line.supplier_order_id} className="flex items-center gap-4 px-4 py-3">
                      {/* Status dot */}
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusInfo.dot}`} />

                      {/* Component */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          {line.component_code && (
                            <span className="text-xs font-mono font-medium text-foreground">{line.component_code}</span>
                          )}
                          <span className="text-xs text-muted-foreground truncate">{line.component_name || '—'}</span>
                        </div>
                      </div>

                      {/* Qty + Progress (colour-coded) */}
                      <div className="flex items-center gap-3 shrink-0 w-40">
                        <span className="text-xs tabular-nums font-medium w-16 text-right">
                          {received}/{qty}
                        </span>
                        <div className="flex-1">
                          <Progress
                            value={pct}
                            className={cn("h-1.5 bg-muted", statusInfo.progressClass)}
                          />
                        </div>
                      </div>

                      {/* Status badge */}
                      <Badge variant={statusInfo.variant} className="text-[10px] px-1.5 py-0 shrink-0">
                        {statusInfo.label}
                      </Badge>

                      {/* Last receipt */}
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-20 text-right">
                        {line.last_receipt_date ? format(parseISO(line.last_receipt_date), 'MMM d, yyyy') : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// Email + follow-up summary beneath PO header
function POEmailSummary({ data }: { data: POEmailData }) {
  const { lastEmail, followUps } = data;
  const latestFollowUp = followUps.length > 0 ? followUps[0] : null;
  const hasResponse = latestFollowUp?.responded_at;

  return (
    <div className="px-4 py-2.5 bg-muted/10 border-b border-border/30 space-y-2">
      {/* Email sent row */}
      <div className="flex items-center gap-4 text-[11px]">
        {lastEmail && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3 w-3" />
            Sent {format(parseISO(lastEmail.sent_at), 'MMM d, yyyy')}
            {lastEmail.delivery_status && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1">
                {lastEmail.delivery_status === 'delivered' ? 'Delivered' :
                 lastEmail.delivery_status === 'bounced' ? 'Bounced' :
                 lastEmail.delivery_status === 'sent' ? 'Sent' :
                 lastEmail.delivery_status}
              </Badge>
            )}
          </span>
        )}
        {latestFollowUp && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            Follow-up {format(parseISO(latestFollowUp.sent_at), 'MMM d')}
            {hasResponse ? (
              <Badge variant="outline" className={cn(
                "text-[9px] px-1 py-0 ml-1",
                followUpStatusColors[latestFollowUp.response_status || '']
              )}>
                {followUpStatusLabels[latestFollowUp.response_status || ''] || 'Responded'}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 text-muted-foreground">
                Awaiting Response
              </Badge>
            )}
          </span>
        )}
      </div>

      {/* Supplier response details */}
      {hasResponse && latestFollowUp && (
        <div className="space-y-1.5">
          {/* Global response */}
          <div className="flex items-center gap-3 text-[11px]">
            {latestFollowUp.expected_delivery_date && (
              <span className="text-muted-foreground">
                Supplier ETA: <span className="font-medium text-foreground">{format(parseISO(latestFollowUp.expected_delivery_date), 'MMM d, yyyy')}</span>
              </span>
            )}
            {latestFollowUp.response_notes && (
              <span className="text-muted-foreground italic truncate">"{latestFollowUp.response_notes}"</span>
            )}
          </div>

          {/* Per-item responses (if any have notes or non-on_track status) */}
          {latestFollowUp.line_item_responses && Array.isArray(latestFollowUp.line_item_responses) &&
           latestFollowUp.line_item_responses.some((item: any) => item.item_notes || (item.item_status && item.item_status !== 'on_track')) && (
            <div className="space-y-1 pl-4 border-l-2 border-border/40">
              {(latestFollowUp.line_item_responses as any[])
                .filter((item: any) => item.item_notes || (item.item_status && item.item_status !== 'on_track'))
                .map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 text-[10px]">
                    <span className="font-mono text-foreground">{item.supplier_code || item.description}</span>
                    {item.item_status && (
                      <span className={cn("font-medium", followUpStatusColors[item.item_status] || 'text-muted-foreground')}>
                        {followUpStatusLabels[item.item_status] || item.item_status}
                      </span>
                    )}
                    {item.item_expected_date && (
                      <span className="text-muted-foreground">
                        ETA: {format(new Date(item.item_expected_date), 'MMM d')}
                      </span>
                    )}
                    {item.item_notes && (
                      <span className="text-muted-foreground italic truncate">"{item.item_notes}"</span>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Summary card sub-component
function SummaryCard({ icon: Icon, label, value, color, bgColor }: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
  bgColor: string;
}) {
  return (
    <Card className={`${bgColor} border-0`}>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className={`h-5 w-5 ${color} shrink-0`} />
        <div>
          <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import type { DragEvent } from 'react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { minutesToClock, formatDuration, stretchForBreaks } from '@/src/lib/laborScheduling';
import { Circle, GripHorizontal, X, Calendar, Clock, User, Briefcase, CheckCircle2, ClipboardList, Loader2, Undo2, Play, PackageCheck, Pause, ExternalLink, ChevronDown, ChevronRight, Timer } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { LaborDragPayload, StaffAssignment, StaffLane, TimeMarker } from './types';
import { CompleteJobDialog } from './complete-job-dialog';
import type { ScheduleBreak } from '@/types/work-schedule';
import { getExecutionStatusMeta } from '@/components/production/execution-status';

import { formatDate } from '@/lib/date-utils';

const PRINT_AFTER_ISSUE_STORAGE_KEY = 'labor-planning-print-after-issue';
const MIN_SCHEDULE_BLOCK = 15;

function getStoredPrintAfterIssue(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem(PRINT_AFTER_ISSUE_STORAGE_KEY);
  if (stored == null) return true;
  return stored !== 'false';
}

function storePrintAfterIssue(enabled: boolean): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(PRINT_AFTER_ISSUE_STORAGE_KEY, String(enabled));
  }
}

/** Collapsible "More details" section for the job assignment dialog */
function ExpandableDetails({
  dueDate,
  staffName,
  staffRole,
}: {
  dueDate?: string | null;
  staffName?: string;
  staffRole?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-5 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        More details
      </button>
      {open && (
        <div className="px-5 pb-3 space-y-1 text-[13px] text-muted-foreground">
          {dueDate && (
            <div className="flex justify-between">
              <span>Delivery</span>
              <span className="text-foreground">{(() => {
                try {
                  const d = new Date(dueDate.includes('T') ? dueDate : dueDate + 'T00:00:00');
                  return Number.isNaN(d.getTime()) ? dueDate : formatDate(d);
                } catch { return dueDate; }
              })()}</span>
            </div>
          )}
          {staffName && (
            <div className="flex justify-between">
              <span>Staff</span>
              <span className="text-foreground">{staffName}{staffRole ? ` · ${staffRole}` : ''}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function extractCardIdFromJobKey(jobKey?: string): number | null {
  if (!jobKey) return null;
  const match = jobKey.match(/:card-(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractItemIdFromJobKey(jobKey?: string): number | null {
  if (!jobKey) return null;
  const match = jobKey.match(/:jci-(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPoolIdFromJobKey(jobKey?: string): number | null {
  if (!jobKey) return null;
  const match = jobKey.match(/^pool-(\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

interface StaffLaneListProps {
  staff: StaffLane[];
  markers: TimeMarker[];
  startMinutes: number;
  endMinutes: number;
  onDrop: (options: { staff: StaffLane; startMinutes: number; payload: LaborDragPayload }) => void;
  onUnassign?: (assignment: StaffAssignment) => void;
  compact?: boolean;
  timelineWidth?: number;
  /** Default snap increment (minutes) for drag preview indicator. Falls back to 15. */
  dragSnapIncrement?: number;
  /** Scheduled break windows to render as overlays on each lane. */
  breaks?: ScheduleBreak[];
  /** Current time in minutes from midnight. Only shown when viewing today. */
  nowMinutes?: number | null;
}

export function StaffLaneList({
  staff,
  markers,
  startMinutes,
  endMinutes,
  onDrop,
  onUnassign,
  compact = false,
  timelineWidth,
  dragSnapIncrement = 15,
  breaks = [],
  nowMinutes,
}: StaffLaneListProps) {
  const router = useRouter();
  const totalMinutes = endMinutes - startMinutes;
  const laneHeightClass = compact ? 'h-14' : 'h-16';
  const [issuingJobCard, setIssuingJobCard] = useState(false);
  const [printAfterIssue, setPrintAfterIssue] = useState(() => getStoredPrintAfterIssue());

  useEffect(() => {
    storePrintAfterIssue(printAfterIssue);
  }, [printAfterIssue]);

  // Use fixed pixel positioning when timelineWidth is provided
  const useFixedWidth = timelineWidth != null && timelineWidth > 0;
  const toPosition = (value: number) => {
    const ratio = (value - startMinutes) / totalMinutes;
    return useFixedWidth ? ratio * timelineWidth : ratio * 100;
  };
  const toWidth = (start: number, end: number) => {
    const ratio = (end - start) / totalMinutes;
    return useFixedWidth ? ratio * timelineWidth : ratio * 100;
  };

  // Keep old percent helpers for compatibility
  const toPercent = (value: number) => ((value - startMinutes) / totalMinutes) * 100;
  const widthPercent = (start: number, end: number) => ((end - start) / totalMinutes) * 100;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const isAvailable = (lane: StaffLane) => {
    const availability = lane.availability;
    if (!availability) return true;
    if (availability.isActive === false) return false;
    if (availability.isCurrent === false) return false;
    if (availability.isAvailableOnDate === false) return false;
    return true;
  };

  const parsePayload = (event: DragEvent<HTMLDivElement>): LaborDragPayload | null => {
    const raw = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LaborDragPayload;
    } catch {
      return null;
    }
  };

  const computeMinutesFromEvent = (event: DragEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    // Use the element's actual rendered width for calculation
    // getBoundingClientRect gives us the full element dimensions even when scrolled
    const elementWidth = rect.width;
    // Calculate click offset from the element's left edge
    const clickOffset = event.clientX - rect.left;
    const offset = clamp(clickOffset, 0, elementWidth);
    const ratio = elementWidth === 0 ? 0 : offset / elementWidth;
    return Math.round(startMinutes + ratio * totalMinutes);
  };

  // Track which lane is being dragged over
  const [dragOverLaneId, setDragOverLaneId] = useState<string | null>(null);
  // Track selected assignment for modal
  const [selectedAssignment, setSelectedAssignment] = useState<StaffAssignment | null>(null);
  // Track selected lane for getting staff info
  const [selectedLane, setSelectedLane] = useState<StaffLane | null>(null);
  // Track drag position for time indicator
  const [dragIndicator, setDragIndicator] = useState<{ laneId: string; x: number; minutes: number; snappedMinutes: number } | null>(null);
  // Track assignment being completed
  const [completeAssignment, setCompleteAssignment] = useState<{
    assignment_id: number;
    job_instance_id?: string;
    order_id?: number;
    orderNumber?: string;
    job_id?: number;
    jobName?: string;
    productName?: string;
    staffName?: string;
    staff_id?: number;
    assignment_date?: string;
    start_minutes: number;
    end_minutes: number;
    issued_at?: string;
    started_at?: string;
    job_status?: string;
  } | null>(null);

  // Issue quantity state — fetched when the assignment dialog opens
  const [availableQty, setAvailableQty] = useState<number | null>(null);
  const [issueQty, setIssueQty] = useState(1);

  useEffect(() => {
    if (!selectedAssignment) {
      setAvailableQty(null);
      setIssueQty(1);
      return;
    }
    const poolId = extractPoolIdFromJobKey(selectedAssignment.jobKey);
    const plannedPoolAssignment = poolId != null && extractCardIdFromJobKey(selectedAssignment.jobKey) == null;
    if (plannedPoolAssignment) {
      const plannedQty = Math.max(selectedAssignment.quantity ?? 1, 1);
      setAvailableQty(plannedQty);
      setIssueQty(plannedQty);
      return;
    }
    const orderId = typeof selectedAssignment.orderId === 'number' ? selectedAssignment.orderId : null;
    const jobId = selectedAssignment.jobId ?? null;
    if (!orderId || !jobId) { setAvailableQty(null); return; }

    (async () => {
      // Only count items on unassigned cards (staff_id IS NULL) that haven't been completed
      const { data: cards } = await supabase
        .from('job_cards')
        .select('job_card_id')
        .eq('order_id', orderId)
        .is('staff_id', null);
      if (!cards || cards.length === 0) { setAvailableQty(null); return; }

      const { data: items } = await supabase
        .from('job_card_items')
        .select('quantity')
        .in('job_card_id', cards.map(c => c.job_card_id))
        .eq('job_id', jobId)
        .neq('status', 'completed');

      const total = (items ?? []).reduce((sum, i) => sum + (i.quantity ?? 0), 0);
      setAvailableQty(total > 0 ? total : null);
      setIssueQty(total > 0 ? total : 1);
    })();
  }, [selectedAssignment]);

  // Issue job card from assignment — splits quantity from existing item if present
  const handleIssueJobCard = async () => {
    if (!selectedAssignment || !selectedLane) return;

    setIssuingJobCard(true);
    let printWindow: Window | null = null;
    try {
      const poolId = extractPoolIdFromJobKey(selectedAssignment.jobKey);
      const targetCardId = extractCardIdFromJobKey(selectedAssignment.jobKey);
      const plannedPoolAssignment = poolId != null && targetCardId == null;
      const qtyToIssue = Math.max(1, issueQty);

      if (printAfterIssue) {
        printWindow = window.open('about:blank', '_blank');
      }

      if (plannedPoolAssignment) {
        const plannedQty = Math.max(selectedAssignment.quantity ?? qtyToIssue, 1);
        const actualQtyToIssue = Math.min(qtyToIssue, plannedQty);
        const fallbackPerUnitMinutes =
          plannedQty > 0
            ? Math.max((selectedAssignment.endMinutes - selectedAssignment.startMinutes) / plannedQty, 0)
            : null;
        const timePerUnitMinutes = selectedAssignment.timePerUnitMinutes ?? fallbackPerUnitMinutes;
        const workMinutes = Math.max(
          Math.round((timePerUnitMinutes ?? 0) * actualQtyToIssue) || 0,
          MIN_SCHEDULE_BLOCK,
        );
        const stretched = stretchForBreaks(selectedAssignment.startMinutes, workMinutes, breaks);
        const computedEnd = Math.min(stretched.wallEnd, endMinutes);
        const issuedAt = new Date().toISOString();

        const { data: cardId, error: issueError } = await supabase.rpc('issue_job_card_from_pool', {
          p_pool_id: poolId,
          p_quantity: actualQtyToIssue,
          p_staff_id: parseInt(selectedLane.id, 10),
        });

        if (issueError) throw issueError;

        const nextJobKey = `pool-${poolId}:card-${cardId}`;
        const { error: assignmentError } = await supabase
          .from('labor_plan_assignments')
          .update({
            job_instance_id: nextJobKey,
            job_status: 'issued',
            issued_at: issuedAt,
            end_minutes: computedEnd,
            updated_at: issuedAt,
          })
          .eq('assignment_id', parseInt(selectedAssignment.id, 10));

        if (assignmentError) throw assignmentError;

        const reopenPrint = () => window.open(`/staff/job-cards/${cardId}?print=1`, '_blank');
        const remaining = Math.max(plannedQty - actualQtyToIssue, 0);
        toast.success(`Job card #${cardId} issued`, {
          description: printAfterIssue
            ? `${actualQtyToIssue} unit${actualQtyToIssue === 1 ? '' : 's'} issued to ${selectedLane.name}. Print opened.${remaining > 0 ? ` ${remaining} remain in the pool.` : ''}`
            : `${actualQtyToIssue} unit${actualQtyToIssue === 1 ? '' : 's'} issued to ${selectedLane.name}.${remaining > 0 ? ` ${remaining} remain in the pool.` : ''}`,
          action: {
            label: printAfterIssue ? 'Reopen print' : 'Print now',
            onClick: reopenPrint,
          },
        });

        if (printWindow) {
          printWindow.location.href = `/staff/job-cards/${cardId}?print=1`;
        }

        setSelectedAssignment(null);
        setSelectedLane(null);
        window.dispatchEvent(new Event('focus'));
        return;
      }

      // Look up BOL data if we have a bolId to get product_id and quantity
      let productId: number | null = null;
      let bolQuantity = 1;
      let jobId = selectedAssignment.jobId || null;

      if (selectedAssignment.bolId) {
        const { data: bolData } = await supabase
          .from('billoflabour')
          .select('product_id, job_id, quantity')
          .eq('bol_id', selectedAssignment.bolId)
          .single();
        if (bolData) {
          productId = bolData.product_id;
          jobId = bolData.job_id || jobId;
          bolQuantity = bolData.quantity || 1;
        }
      }

      // Look up piece rate if it's a piecework job
      let pieceRate = 0;
      if (selectedAssignment.payType === 'piece' && selectedAssignment.pieceRateId) {
        const { data: rateData } = await supabase
          .from('piece_work_rates')
          .select('rate')
          .eq('rate_id', selectedAssignment.pieceRateId)
          .single();
        if (rateData) {
          pieceRate = rateData.rate;
        }
      }

      const orderId = typeof selectedAssignment.orderId === 'number' ? selectedAssignment.orderId : null;

      // Find ANY existing job_card_item for this (order, job) across all cards
      type SourceItem = {
        item_id: number;
        job_card_id: number;
        quantity: number;
        piece_rate: number | null;
        product_id: number | null;
        work_pool_id: number | null;
        drawing_url: string | null;
        card_staff_id: number | null;
      };
      let sourceItem: SourceItem | null = null;
      let issuedItemId: number | null = null;

      if (orderId && jobId) {
        const { data: allCards } = await supabase
          .from('job_cards')
          .select('job_card_id, staff_id')
          .eq('order_id', orderId);

        if (allCards && allCards.length > 0) {
          const cardMap = new Map(allCards.map(c => [c.job_card_id, c.staff_id]));
          const cardIds = allCards.map(c => c.job_card_id);

          const { data: matchingItems } = await supabase
            .from('job_card_items')
            .select('item_id, job_card_id, quantity, piece_rate, product_id, work_pool_id, drawing_url')
            .in('job_card_id', cardIds)
            .eq('job_id', jobId)
            .order('quantity', { ascending: false })
            .limit(1);

          if (matchingItems && matchingItems.length > 0) {
            const item = matchingItems[0];
            sourceItem = {
              ...item,
              card_staff_id: cardMap.get(item.job_card_id) ?? null,
            };
          }
        }
      }

      // If the source item has no remaining balance and is already on a staff-assigned card, block
      if (sourceItem && sourceItem.quantity <= 0 && sourceItem.card_staff_id != null) {
        toast.error('Already fully issued', {
          description: 'This job has already been issued with no remaining balance.',
        });
        return;
      }

      // Create the staff-assigned job card
      const { data: jobCardData, error: jobCardError } = await supabase
        .from('job_cards')
        .insert({
          order_id: orderId,
          staff_id: parseInt(selectedLane.id, 10),
          issue_date: selectedAssignment.assignmentDate || new Date().toISOString().split('T')[0],
          status: 'pending',
          notes: `Scheduled: ${minutesToClock(selectedAssignment.startMinutes)} - ${minutesToClock(selectedAssignment.endMinutes)}`,
        })
        .select()
        .single();

      if (jobCardError) throw jobCardError;
      if (!jobCardData) throw new Error('Failed to create job card');

      const remaining = sourceItem ? sourceItem.quantity - qtyToIssue : 0;

      if (sourceItem && remaining > 0) {
        // Split: decrement source item, create new item with issued qty
        await supabase
          .from('job_card_items')
          .update({ quantity: remaining })
          .eq('item_id', sourceItem.item_id);

        const { data: insertedItem, error: insertError } = await supabase
          .from('job_card_items')
          .insert({
            job_card_id: jobCardData.job_card_id,
            product_id: sourceItem.product_id ?? productId,
            job_id: jobId,
            quantity: qtyToIssue,
            piece_rate: sourceItem.piece_rate ?? pieceRate,
            status: 'pending',
          })
          .select('item_id')
          .single();
        if (insertError) throw insertError;
        issuedItemId = insertedItem?.item_id ?? null;
      } else if (sourceItem && remaining <= 0) {
        // Issuing full balance — move the item to the new staff card
        await supabase
          .from('job_card_items')
          .update({ job_card_id: jobCardData.job_card_id })
          .eq('item_id', sourceItem.item_id);
        issuedItemId = sourceItem.item_id;

        // Clean up empty source card if no items remain
        const { data: leftover } = await supabase
          .from('job_card_items')
          .select('item_id')
          .eq('job_card_id', sourceItem.job_card_id)
          .limit(1);

        if (!leftover || leftover.length === 0) {
          await supabase
            .from('job_cards')
            .delete()
            .eq('job_card_id', sourceItem.job_card_id);
        }
      } else if (jobId || productId) {
        // No existing item found at all — create fresh
        const { data: insertedItem, error: itemError } = await supabase
          .from('job_card_items')
          .insert({
            job_card_id: jobCardData.job_card_id,
            product_id: productId,
            job_id: jobId,
            quantity: qtyToIssue || bolQuantity,
            piece_rate: pieceRate,
            status: 'pending',
          })
          .select('item_id')
          .single();

        if (itemError) throw itemError;
        issuedItemId = insertedItem?.item_id ?? null;
      }

      // Update labor_plan_assignments to mark as issued
      if (selectedAssignment.id) {
        const poolId = extractPoolIdFromJobKey(selectedAssignment.jobKey);
        const nextJobKey =
          poolId != null
            ? `pool-${poolId}:card-${jobCardData.job_card_id}`
            : orderId != null && issuedItemId != null
              ? `order-${orderId}:jci-${issuedItemId}`
              : selectedAssignment.jobKey;

        await supabase
          .from('labor_plan_assignments')
          .update({
            job_instance_id: nextJobKey,
            job_status: 'issued',
            issued_at: new Date().toISOString(),
          })
          .eq('assignment_id', parseInt(selectedAssignment.id, 10));
      }

      const jobCardId = jobCardData.job_card_id;
      const issuedRemaining = remaining > 0 ? ` (${qtyToIssue} issued, ${remaining} remaining)` : '';
      const reopenPrint = () => window.open(`/staff/job-cards/${jobCardId}?print=1`, '_blank');

      toast.success(`Job card #${jobCardId} issued${issuedRemaining}`, {
        description: printAfterIssue ? 'Print opened.' : undefined,
        action: {
          label: printAfterIssue ? 'Reopen print' : 'Print now',
          onClick: reopenPrint,
        },
      });

      // Open the print-ready job card immediately after issue
      if (printWindow) {
        printWindow.location.href = `/staff/job-cards/${jobCardId}?print=1`;
      }

      setSelectedAssignment(null);
      setSelectedLane(null);
      window.dispatchEvent(new Event('focus'));
    } catch (err: any) {
      printWindow?.close();
      console.error('Failed to create job card:', err);
      toast.error(err.message || 'Failed to create job card');
    } finally {
      setIssuingJobCard(false);
    }
  };

  const [unissuing, setUnissuing] = useState(false);

  const handleUnissueJobCard = async () => {
    if (!selectedAssignment || !selectedLane) return;

    setUnissuing(true);
    try {
      const orderId = typeof selectedAssignment.orderId === 'number' ? selectedAssignment.orderId : null;
      const jobId = selectedAssignment.jobId ?? null;
      const staffId = parseInt(selectedLane.id, 10);
      const isPoolSourced = selectedAssignment.jobKey?.startsWith('pool-');
      const targetCardId = extractCardIdFromJobKey(selectedAssignment.jobKey);
      const targetItemId = extractItemIdFromJobKey(selectedAssignment.jobKey);

      if (orderId && jobId) {
        let cardIds: number[] = [];
        let issuedItems: Array<{
          item_id: number;
          job_card_id: number;
          quantity: number;
          product_id: number | null;
          piece_rate: number | null;
          work_pool_id: number | null;
        }> = [];

        if (targetItemId != null) {
          const { data: exactItem, error: exactItemError } = await supabase
            .from('job_card_items')
            .select('item_id, job_card_id, quantity, product_id, piece_rate, work_pool_id')
            .eq('item_id', targetItemId)
            .maybeSingle();

          if (exactItemError) throw exactItemError;
          if (exactItem) {
            issuedItems = [exactItem];
            cardIds = [exactItem.job_card_id];
          }
        } else if (targetCardId != null) {
          const { data: exactItems, error: exactItemsError } = await supabase
            .from('job_card_items')
            .select('item_id, job_card_id, quantity, product_id, piece_rate, work_pool_id')
            .eq('job_card_id', targetCardId)
            .eq('job_id', jobId)
            .neq('status', 'completed');

          if (exactItemsError) throw exactItemsError;
          issuedItems = exactItems ?? [];
          cardIds = [targetCardId];
        } else {
          // Fallback for legacy assignments without embedded card/item identity.
          const { data: staffCards } = await supabase
            .from('job_cards')
            .select('job_card_id')
            .eq('order_id', orderId)
            .eq('staff_id', staffId);

          if (staffCards && staffCards.length > 0) {
            cardIds = staffCards.map(c => c.job_card_id);

            const { data: fallbackItems, error: fallbackItemsError } = await supabase
              .from('job_card_items')
              .select('item_id, job_card_id, quantity, product_id, piece_rate, work_pool_id')
              .in('job_card_id', cardIds)
              .eq('job_id', jobId)
              .neq('status', 'completed');

            if (fallbackItemsError) throw fallbackItemsError;
            issuedItems = fallbackItems ?? [];
          }
        }

        if (issuedItems.length > 0) {
          if (isPoolSourced) {
            // Pool-sourced: cancel only the targeted card item(s).
            for (const item of issuedItems) {
              await supabase
                .from('job_card_items')
                .update({ status: 'cancelled' })
                .eq('item_id', item.item_id);
            }
          } else {
            // Legacy (non-pool): merge only the targeted card item(s) back to source cards.
            for (const item of issuedItems) {
              const { data: sourceItems } = await supabase
                .from('job_card_items')
                .select('item_id, quantity, job_card_id')
                .eq('job_id', jobId)
                .not('job_card_id', 'in', `(${cardIds.join(',')})`)
                .limit(1);

              if (sourceItems && sourceItems.length > 0) {
                await supabase
                  .from('job_card_items')
                  .update({ quantity: sourceItems[0].quantity + item.quantity })
                  .eq('item_id', sourceItems[0].item_id);
                await supabase.from('job_card_items').delete().eq('item_id', item.item_id);
              } else {
                // No source — find or create an unassigned card
                const { data: unassignedCard } = await supabase
                  .from('job_cards')
                  .select('job_card_id')
                  .eq('order_id', orderId)
                  .is('staff_id', null)
                  .limit(1)
                  .maybeSingle();

                let targetUnassignedCardId: number;
                if (unassignedCard) {
                  targetUnassignedCardId = unassignedCard.job_card_id;
                } else {
                  const { data: newCard } = await supabase
                    .from('job_cards')
                    .insert({ order_id: orderId, staff_id: null, status: 'pending', issue_date: new Date().toISOString().split('T')[0] })
                    .select()
                    .single();
                  targetUnassignedCardId = newCard!.job_card_id;
                }
                await supabase
                  .from('job_card_items')
                  .update({ job_card_id: targetUnassignedCardId })
                  .eq('item_id', item.item_id);
              }
            }
          }

          // Clean up only the targeted card(s).
          for (const cardId of cardIds) {
            const { data: activeItems } = await supabase
              .from('job_card_items')
              .select('item_id')
              .eq('job_card_id', cardId)
              .not('status', 'eq', 'cancelled')
              .limit(1);
            if (!activeItems || activeItems.length === 0) {
              // Cancel the card itself (don't delete — preserves audit trail for pool)
              await supabase
                .from('job_cards')
                .update({ status: 'cancelled' })
                .eq('job_card_id', cardId);
            }
          }
        } else if (targetCardId != null || targetItemId != null) {
          throw new Error('Could not find the exact issued card for this scheduled job');
        }
      }

      // Delete the swim lane assignment entirely so it disappears from the timeline
      if (selectedAssignment.id) {
        await supabase
          .from('labor_plan_assignments')
          .delete()
          .eq('assignment_id', parseInt(selectedAssignment.id, 10));
      }

      toast.success('Job card un-issued', {
        description: 'Quantity returned to pool. You can re-issue from the sidebar.',
      });

      setSelectedAssignment(null);
      setSelectedLane(null);

      // Force window refocus to trigger React Query refetch
      window.dispatchEvent(new Event('focus'));
    } catch (err: any) {
      console.error('Failed to un-issue job card:', err);
      toast.error(err.message || 'Failed to un-issue job card');
    } finally {
      setUnissuing(false);
    }
  };

  return (
    <div className="space-y-2 p-2">
      {staff.length === 0 && (
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/60 text-sm text-muted-foreground">
          No staff available to accept drops for this date.
        </div>
      )}
      {staff.map((lane) => {
        const laneAvailable = isAvailable(lane);
        const isDragOver = dragOverLaneId === lane.id;

        // Capacity utilization calculation
        const totalAssignedMinutes = lane.assignments.reduce(
          (sum, a) => sum + Math.max(0, a.endMinutes - a.startMinutes), 0
        );
        const shiftMinutes = endMinutes - startMinutes;
        const utilization = shiftMinutes > 0 ? Math.round((totalAssignedMinutes / shiftMinutes) * 100) : 0;

        return (
          <div key={lane.id} className={cn(
            "flex rounded-lg border bg-card shadow-xs transition-all",
            dragIndicator?.laneId === lane.id ? "overflow-visible" : "overflow-hidden",
            isDragOver && laneAvailable && "ring-2 ring-primary ring-offset-1 border-primary/50"
          )}>
            {/* Staff info column - fixed width */}
            <div className={cn(
              "flex w-[120px] shrink-0 flex-col justify-center border-r px-2 transition-colors",
              compact ? "py-1.5" : "py-2",
              isDragOver && laneAvailable ? "bg-primary/10" : "bg-muted/20"
            )}>
              <div className="flex items-center gap-1.5">
                <Circle className={cn('h-2 w-2 shrink-0', laneAvailable ? 'fill-emerald-500 text-emerald-500' : 'fill-amber-500 text-amber-500')} />
                <span className="truncate text-xs font-semibold">{lane.name}</span>
              </div>
              <p className="truncate text-[10px] text-muted-foreground">
                {lane.role} • {lane.capacityHours}h
              </p>
              {/* Utilization bar */}
              <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    utilization > 90 ? "bg-red-500" :
                    utilization > 70 ? "bg-amber-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${Math.min(utilization, 100)}%` }}
                />
              </div>
              {totalAssignedMinutes > 0 && (
                <span className="text-[9px] text-muted-foreground">{utilization}% loaded</span>
              )}
            </div>

            {/* Timeline grid - scrollable with fixed width */}
            <div
              className={cn(
                "relative transition-colors",
                useFixedWidth ? "" : "flex-1",
                laneHeightClass,
                isDragOver && laneAvailable ? "bg-primary/5" : "bg-muted/30"
              )}
              style={useFixedWidth ? { width: timelineWidth, flexShrink: 0 } : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                if (laneAvailable) {
                  setDragOverLaneId(lane.id);
                  // Calculate position for time indicator with snap preview
                  const rect = event.currentTarget.getBoundingClientRect();
                  const x = event.clientX - rect.left;
                  const minutes = computeMinutesFromEvent(event);
                  // Compute snapped position for preview
                  const snappedMinutes = Math.round(minutes / dragSnapIncrement) * dragSnapIncrement;
                  const clampedSnapped = Math.min(Math.max(snappedMinutes, startMinutes), endMinutes);
                  // Compute pixel position for snapped indicator
                  const snappedRatio = (clampedSnapped - startMinutes) / totalMinutes;
                  const snappedX = snappedRatio * rect.width;
                  setDragIndicator({ laneId: lane.id, x: snappedX, minutes, snappedMinutes: clampedSnapped });
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                if (laneAvailable) setDragOverLaneId(lane.id);
              }}
              onDragLeave={(event) => {
                // Only clear if leaving the lane entirely (not entering a child)
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setDragOverLaneId(null);
                  setDragIndicator(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOverLaneId(null);
                setDragIndicator(null);
                const payload = parsePayload(event);
                if (!payload) return;
                const rawMinutes = computeMinutesFromEvent(event);
                // Snap to the same grid the visual indicator uses so what
                // the user sees matches what gets saved.
                const snappedMinutes = Math.round(rawMinutes / dragSnapIncrement) * dragSnapIncrement;
                const dropMinutes = Math.min(Math.max(snappedMinutes, startMinutes), endMinutes);
                onDrop({ staff: lane, startMinutes: dropMinutes, payload });
              }}
            >
              {/* Grid lines */}
              <div className="pointer-events-none absolute inset-0">
                {markers.map((marker) => {
                  const pos = toPosition(marker.minutes);
                  return (
                    <div
                      key={`${lane.id}-grid-${marker.minutes}`}
                      className={cn(
                        'absolute inset-y-0 border-l',
                        marker.isMajor ? 'border-border/60' : 'border-dashed border-muted-foreground/20',
                      )}
                      style={{ left: useFixedWidth ? pos : `${pos}%` }}
                    />
                  );
                })}
              </div>

              {/* Break zone overlays */}
              {breaks.length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-[1]">
                  {breaks.map((brk) => {
                    const left = toPosition(brk.startMinutes);
                    const width = toWidth(brk.startMinutes, brk.endMinutes);
                    return (
                      <div
                        key={`${lane.id}-break-${brk.startMinutes}`}
                        className="absolute inset-y-0"
                        style={{
                          left: useFixedWidth ? left : `${left}%`,
                          width: useFixedWidth ? width : `${width}%`,
                          background: 'repeating-linear-gradient(135deg, transparent, transparent 3px, hsl(var(--muted-foreground) / 0.08) 3px, hsl(var(--muted-foreground) / 0.08) 6px)',
                          backgroundColor: 'hsl(var(--muted-foreground) / 0.06)',
                        }}
                        title={brk.label}
                      />
                    );
                  })}
                </div>
              )}

              {/* Now indicator */}
              {nowMinutes != null && nowMinutes >= startMinutes && nowMinutes <= endMinutes && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-[2]"
                  style={{ left: useFixedWidth ? toPosition(nowMinutes) : `${toPosition(nowMinutes)}%` }}
                >
                  <div className="absolute inset-y-0 border-l-2 border-rose-500/60" />
                </div>
              )}

              {/* Time indicator during drag - shows snapped position */}
              {dragIndicator && dragIndicator.laneId === lane.id && (
                <div
                  className="pointer-events-none absolute inset-y-0 z-50"
                  style={{ left: dragIndicator.x }}
                >
                  {/* Vertical line */}
                  <div className="absolute inset-y-0 w-0.5 bg-primary" />
                  {/* Time badge showing snapped time */}
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground shadow-lg">
                    {formatTimeDisplay(dragIndicator.snappedMinutes)}
                  </div>
                  {/* Arrow pointing down */}
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-primary" />
                </div>
              )}

              {/* Assignment bars */}
              <TooltipProvider delayDuration={300}>
              {lane.assignments.map((assignment) => {
                const left = toPosition(assignment.startMinutes);
                const width = toWidth(assignment.startMinutes, assignment.endMinutes);
                const baseColor =
                  assignment.color ??
                  (assignment.status === 'overbooked'
                    ? '#fb7185'
                    : assignment.status === 'tentative'
                      ? '#60a5fa'
                      : '#34d399');

                const durationMins = assignment.endMinutes - assignment.startMinutes;
                const statusInfo = getExecutionStatusMeta(assignment.jobStatus);
                const isCompleted = assignment.jobStatus === 'completed';
                // Sliver mode: when the true pixel width is too small for text
                const isSliver = useFixedWidth && width < 60;
                const sliverWidth = useFixedWidth ? Math.max(width, 6) : Math.max(width, 1);

                return (
                  <Tooltip key={assignment.id} delayDuration={isSliver ? 100 : 300}>
                  <TooltipTrigger asChild>
                  <div
                    data-job-key={assignment.jobKey}
                    className={cn(
                      'absolute top-1 flex items-center cursor-pointer',
                      isSliver
                        ? 'group/sliver rounded-md z-[1] hover:z-10 transition-[width,box-shadow] duration-200 ease-out'
                        : 'rounded-xl transition-all duration-150 hover:scale-[1.02] hover:shadow-lg active:scale-[0.99]',
                      compact ? 'h-12' : 'h-14',
                      isCompleted && 'opacity-60',
                    )}
                    draggable
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedAssignment(assignment);
                      setSelectedLane(lane);
                    }}
                    onDragStart={(event) => {
                      const payload: LaborDragPayload = { type: 'assignment', assignment };
                      event.dataTransfer.setData('application/json', JSON.stringify(payload));
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    style={{
                      left: useFixedWidth ? left : `${left}%`,
                      width: isSliver
                        ? sliverWidth
                        : (useFixedWidth ? Math.max(width, 60) : `${Math.max(width, 5)}%`),
                      ...(isSliver ? {} : { minWidth: '60px' }),
                      background: `linear-gradient(145deg, ${baseColor}ee 0%, ${baseColor}bb 100%)`,
                      boxShadow: isSliver
                        ? `0 1px 4px ${baseColor}66`
                        : `0 2px 8px ${baseColor}55, inset 0 1px 0 rgba(255,255,255,0.15)`,
                    }}
                  >
                    {/* Left accent stripe — coloured by job status when present */}
                    <div
                      className={cn(
                        'absolute left-0 top-0 h-full',
                        isSliver ? 'w-full rounded-md' : 'w-1 rounded-l-xl',
                      )}
                      style={{ background: isSliver ? undefined : (statusInfo?.stripeColor ?? 'rgba(255,255,255,0.35)') }}
                    />

                    {/* ─── Sliver mode: compact dot, expand on hover ─── */}
                    {isSliver && (
                      <>
                        {/* Pulsing dot visible at rest */}
                        <div className="absolute inset-0 flex items-center justify-center group-hover/sliver:opacity-0 transition-opacity duration-150">
                          <div className="h-2 w-2 rounded-full bg-white/80 shadow-xs" />
                        </div>
                        {/* Expanded card — appears on hover */}
                        <div
                          className="pointer-events-none absolute left-0 top-0 flex h-full items-center overflow-hidden rounded-xl opacity-0 group-hover/sliver:pointer-events-auto group-hover/sliver:opacity-100 transition-[opacity] duration-200"
                          style={{
                            width: '180px',
                            background: `linear-gradient(145deg, ${baseColor} 0%, ${baseColor}dd 100%)`,
                            boxShadow: `0 4px 16px ${baseColor}88, 0 0 0 1px rgba(255,255,255,0.1)`,
                          }}
                        >
                          <div className="flex min-w-0 flex-1 flex-col justify-center pl-3 pr-2">
                            <span className="truncate text-[10px] font-semibold leading-tight text-white drop-shadow-xs">
                              {assignment.productName || assignment.jobName || assignment.label}
                            </span>
                            <span className="truncate text-[8px] font-medium text-white/80 mt-px">
                              #{assignment.orderNumber || 'N/A'}
                              {assignment.jobName && assignment.jobName !== (assignment.productName || assignment.label) && ` · ${assignment.jobName}`}
                              {' · '}{formatDuration(durationMins)}
                            </span>
                          </div>
                          {statusInfo && (
                            <div className={cn('mr-1.5 flex shrink-0 items-center justify-center rounded-full p-0.5', statusInfo.textClassName)}>
                              <statusInfo.icon className="h-3 w-3 drop-shadow-xs" />
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    {/* ─── Normal card content ─── */}
                    {!isSliver && (
                      <>
                        {/* Resize handles */}
                        {assignment.showHandles !== false && (
                          <>
                            <div
                              className="absolute left-0 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center rounded-l-xl bg-black/15 opacity-0 transition hover:opacity-100"
                              draggable
                              onDragStart={(event) => {
                                event.stopPropagation();
                                const payload: LaborDragPayload = { type: 'resize-start', assignment };
                                event.dataTransfer.setData('application/json', JSON.stringify(payload));
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                            >
                              <GripHorizontal className="h-3 w-3 rotate-90 text-white/80" />
                            </div>
                            <div
                              className="absolute right-0 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center rounded-r-xl bg-black/15 opacity-0 transition hover:opacity-100"
                              draggable
                              onDragStart={(event) => {
                                event.stopPropagation();
                                const payload: LaborDragPayload = { type: 'resize-end', assignment };
                                event.dataTransfer.setData('application/json', JSON.stringify(payload));
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                            >
                              <GripHorizontal className="h-3 w-3 rotate-90 text-white/80" />
                            </div>
                          </>
                        )}

                        <div className="flex min-w-0 flex-1 flex-col justify-center pl-3.5 pr-1.5">
                          <span className="truncate text-[10px] font-semibold leading-tight text-white drop-shadow-xs">
                            {assignment.productName || assignment.jobName || assignment.label}
                          </span>
                          <span className="truncate text-[8px] font-medium text-white/70 mt-px">
                            #{assignment.orderNumber || 'N/A'}
                            {assignment.jobName && assignment.jobName !== (assignment.productName || assignment.label) && ` · ${assignment.jobName}`}
                            {' · '}{formatDuration(durationMins)}
                          </span>
                        </div>

                        {/* Job status indicator */}
                        {statusInfo && (
                          <div className={cn('mr-1 flex shrink-0 items-center justify-center rounded-full p-0.5', statusInfo.textClassName)}>
                            <statusInfo.icon className="h-3.5 w-3.5 drop-shadow-xs" />
                          </div>
                        )}

                        {onUnassign && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onUnassign(assignment);
                            }}
                            className="mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/20 text-white/90 transition hover:bg-white/35"
                            aria-label="Unassign job"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={6}
                    className="z-50 max-w-[220px] rounded-lg border-0 bg-neutral-900 px-3 py-2.5 shadow-xl"
                  >
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold leading-tight text-white">
                        {assignment.productName || assignment.jobName || assignment.label}
                      </p>
                      {assignment.jobName && assignment.productName && assignment.jobName !== assignment.productName && (
                        <p className="text-[10px] text-neutral-400">{assignment.jobName}</p>
                      )}
                      <div className="h-px bg-neutral-700" />
                      <div className="flex items-center gap-1.5 text-[10px] text-neutral-300">
                        <Clock className="h-3 w-3 shrink-0 text-neutral-500" />
                        <span>{minutesToClock(assignment.startMinutes)} – {minutesToClock(assignment.endMinutes)}</span>
                        <span className="ml-auto text-neutral-500">{formatDuration(durationMins)}</span>
                      </div>
                      {assignment.orderNumber && (
                        <div className="flex items-center gap-1.5 text-[10px] text-neutral-300">
                          <ClipboardList className="h-3 w-3 shrink-0 text-neutral-500" />
                          {assignment.orderId ? (
                            <a
                              href={`/orders/${assignment.orderId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-neutral-500 underline-offset-2 hover:text-white"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Order #{assignment.orderNumber}
                            </a>
                          ) : (
                            <span>Order #{assignment.orderNumber}</span>
                          )}
                        </div>
                      )}
                      {assignment.quantity != null && assignment.quantity > 0 && (
                        <div className="flex items-center gap-1.5 text-[10px] text-neutral-300">
                          <Circle className="h-3 w-3 shrink-0 text-neutral-500" />
                          <span>Qty: {assignment.quantity}</span>
                        </div>
                      )}
                      {statusInfo && (
                        <div className={cn('flex items-center gap-1.5 text-[10px]', statusInfo.textClassName)}>
                          <statusInfo.icon className="h-3 w-3 shrink-0" />
                          <span>{statusInfo.label}</span>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                  </Tooltip>
                );
              })}
              </TooltipProvider>
            </div>
          </div>
        );
      })}

      {/* Job Details Modal */}
      <Dialog open={!!selectedAssignment} onOpenChange={(open) => !open && setSelectedAssignment(null)}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          {selectedAssignment && (() => {
            const durationMin = selectedAssignment.endMinutes - selectedAssignment.startMinutes;
            const qty = selectedAssignment.quantity ?? 0;
            const perItem = qty > 1 ? durationMin / qty : null;
            const statusMeta = getExecutionStatusMeta(selectedAssignment.jobStatus);
            const isPlanned = selectedAssignment.status === 'scheduled' && !selectedAssignment.jobStatus;
            const canIssue = selectedAssignment.jobStatus == null;
            const canComplete =
              selectedAssignment.jobStatus != null && selectedAssignment.jobStatus !== 'completed';
            return (
              <>
                {/* ── Colour accent bar ── */}
                <div
                  className="h-1.5 w-full"
                  style={{ background: selectedAssignment.color ?? 'hsl(var(--primary))' }}
                />

                {/* ── Header ── */}
                <div className="px-5 pt-4 pb-3">
                  <DialogHeader className="space-y-1">
                    <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold leading-snug">
                      {selectedAssignment.orderNumber ? (
                        <a
                          href={`/orders/${selectedAssignment.orderId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-foreground hover:text-primary transition-colors"
                        >
                          {selectedAssignment.orderNumber}
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      ) : (
                        <span>Unlinked Job</span>
                      )}
                      {selectedAssignment.customerName && (
                        <>
                          <span className="text-muted-foreground/60 font-normal">·</span>
                          <span className="font-normal text-muted-foreground truncate text-sm">
                            {selectedAssignment.customerName}
                          </span>
                        </>
                      )}
                    </DialogTitle>
                    <DialogDescription className="text-[13px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      {selectedAssignment.jobName && (
                        selectedAssignment.jobId ? (
                          <a
                            href={`/labor/jobs/${selectedAssignment.jobId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground/80 hover:text-primary transition-colors inline-flex items-center gap-1"
                          >
                            {selectedAssignment.jobName}
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                        ) : (
                          <span className="text-foreground/80">{selectedAssignment.jobName}</span>
                        )
                      )}
                      {selectedAssignment.jobName && selectedAssignment.productName && (
                        <span className="text-muted-foreground/40">·</span>
                      )}
                      {selectedAssignment.productName && (
                        selectedAssignment.productId ? (
                          <a
                            href={`/products/${selectedAssignment.productId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground/80 hover:text-primary transition-colors inline-flex items-center gap-1"
                          >
                            {selectedAssignment.productName}
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                        ) : (
                          <span className="text-foreground/80">{selectedAssignment.productName}</span>
                        )
                      )}
                      {!selectedAssignment.jobName && !selectedAssignment.productName && 'Job'}
                    </DialogDescription>
                  </DialogHeader>

                  {/* Metadata chips */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {isPlanned && (
                      <Badge
                        variant="outline"
                        className="text-[11px] font-medium border-violet-200 bg-violet-500/10 text-violet-700 dark:border-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
                      >
                        Planned
                      </Badge>
                    )}
                    {selectedAssignment.jobStatus && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[11px] capitalize gap-1 font-medium',
                          statusMeta?.badgeClassName,
                        )}
                      >
                        {statusMeta && <statusMeta.icon className="h-3 w-3" />}
                        {statusMeta?.label ?? selectedAssignment.jobStatus.replace('_', ' ')}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[11px] font-medium">
                      {selectedAssignment.payType === 'piece' ? 'Piecework' : 'Hourly'}
                    </Badge>
                    {qty > 0 && (
                      <Badge variant="secondary" className="text-[11px] font-medium">
                        Qty: {qty}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* ── Schedule block ── */}
                <div className="mx-5 rounded-lg border bg-muted/40 px-4 py-3 mb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                        <Timer className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold tabular-nums">
                          {minutesToClock(selectedAssignment.startMinutes)}
                          <span className="mx-1 text-muted-foreground font-normal">→</span>
                          {minutesToClock(selectedAssignment.endMinutes)}
                        </div>
                        <div className="text-[12px] text-muted-foreground leading-tight">
                          {formatDuration(durationMin)} total
                          {perItem != null && (
                            <span> · {formatDuration(perItem)}/item × {qty}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Staff assignment */}
                  {selectedLane && (
                    <div className="flex items-center gap-2.5 mt-2.5 pt-2.5 border-t border-border/50">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{selectedLane.name}</div>
                        {selectedLane.role && (
                          <div className="text-[12px] text-muted-foreground leading-tight">{selectedLane.role}</div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Due date */}
                  {selectedAssignment.dueDate && (
                    <div className="flex items-center gap-2.5 mt-2.5 pt-2.5 border-t border-border/50">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {(() => {
                            try {
                              const d = new Date(selectedAssignment.dueDate!.includes('T') ? selectedAssignment.dueDate! : selectedAssignment.dueDate! + 'T00:00:00');
                              return Number.isNaN(d.getTime()) ? selectedAssignment.dueDate : formatDate(d);
                            } catch { return selectedAssignment.dueDate; }
                          })()}
                        </div>
                        <div className="text-[12px] text-muted-foreground leading-tight">Delivery date</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Issue quantity ── */}
                {availableQty != null && isPlanned && (
                  <div className="mx-5 mb-3 flex items-center gap-3 rounded-lg border px-4 py-2.5">
                    <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">Issue quantity</span>
                    <Input
                      type="number"
                      min={1}
                      max={availableQty}
                      value={issueQty}
                      onChange={(e) => setIssueQty(Math.max(1, Math.min(availableQty, parseInt(e.target.value) || 1)))}
                      className="h-7 w-20 text-sm"
                    />
                    <span className="text-[12px] text-muted-foreground">
                      of {availableQty} available to issue
                    </span>
                  </div>
                )}

                {isPlanned && (
                  <div className="mx-5 mb-3 flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3">
                    <Checkbox
                      id="lane-print-after-issue"
                      checked={printAfterIssue}
                      onCheckedChange={(checked) => setPrintAfterIssue(Boolean(checked))}
                      disabled={issuingJobCard}
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor="lane-print-after-issue" className="text-sm font-medium">
                        Print job card after issue
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Opens the print-ready job card as soon as you issue this planned job.
                      </p>
                    </div>
                  </div>
                )}

                {/* ── Actions ── */}
                <div className="flex items-center gap-2 px-5 py-3 border-t bg-muted/20">
                  {selectedAssignment.jobStatus === 'issued' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnissueJobCard}
                      disabled={unissuing}
                      className="text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-600/50 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                    >
                      {unissuing ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <Undo2 className="h-4 w-4 mr-1.5" />
                      )}
                      {unissuing ? 'Un-issuing...' : 'Un-issue'}
                    </Button>
                  ) : canIssue ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleIssueJobCard}
                      disabled={issuingJobCard}
                    >
                      {issuingJobCard ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <ClipboardList className="h-4 w-4 mr-1.5" />
                      )}
                      {issuingJobCard ? 'Issuing...' : `Issue Job${availableQty != null ? ` (${issueQty})` : ''}`}
                    </Button>
                  ) : null}
                  {canComplete && (
                    <Button
                      variant="default"
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      onClick={() => {
                        if (!selectedAssignment || !selectedLane) return;
                        setCompleteAssignment({
                          assignment_id: parseInt(selectedAssignment.id, 10),
                          job_instance_id: selectedAssignment.jobKey,
                          order_id: typeof selectedAssignment.orderId === 'number' ? selectedAssignment.orderId : undefined,
                          orderNumber: selectedAssignment.orderNumber ?? undefined,
                          job_id: selectedAssignment.jobId ?? undefined,
                          jobName: selectedAssignment.jobName ?? undefined,
                          productName: selectedAssignment.productName ?? undefined,
                          staffName: selectedLane.name,
                          staff_id: parseInt(selectedLane.id, 10),
                          assignment_date: selectedAssignment.assignmentDate ?? undefined,
                          start_minutes: selectedAssignment.startMinutes,
                          end_minutes: selectedAssignment.endMinutes,
                          issued_at: selectedAssignment.issuedAt ?? undefined,
                          started_at: selectedAssignment.startedAt ?? undefined,
                          job_status: selectedAssignment.jobStatus,
                        });
                        setSelectedAssignment(null);
                        setSelectedLane(null);
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                      Complete Job
                    </Button>
                  )}
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" onClick={() => {
                    setSelectedAssignment(null);
                    setSelectedLane(null);
                  }}>
                    Close
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Complete Job Dialog */}
      <CompleteJobDialog
        open={!!completeAssignment}
        onOpenChange={(open) => !open && setCompleteAssignment(null)}
        assignment={completeAssignment}
      />
    </div>
  );
}

/** Format minutes to friendly time like "8:00 AM" */
function formatTimeDisplay(minutes: number): string {
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;
  return `${hours12}:${mins.toString().padStart(2, '0')} ${period}`;
}

const defaultSlots = () => [
  { start: '08:00', end: '10:00', label: 'Drop job' },
  { start: '13:00', end: '15:00', label: 'Hold for rework' },
];

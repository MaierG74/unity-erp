'use client';

import type { DragEvent } from 'react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { minutesToClock } from '@/src/lib/laborScheduling';
import { Circle, GripHorizontal, X, Calendar, Clock, User, Briefcase, CheckCircle2, ClipboardList, Loader2, Undo2, Play, PackageCheck, Pause } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { LaborDragPayload, StaffAssignment, StaffLane, TimeMarker } from './types';
import { CompleteJobDialog } from './complete-job-dialog';
import type { ScheduleBreak } from '@/types/work-schedule';

/** Visual metadata for job status indicators on assignment bars */
function getJobStatusInfo(status?: StaffAssignment['jobStatus']) {
  switch (status) {
    case 'issued':
      return { label: 'Issued', icon: ClipboardList, color: 'text-blue-300', dotColor: 'bg-blue-400', stripe: 'rgba(96,165,250,0.5)' };
    case 'in_progress':
      return { label: 'In Progress', icon: Play, color: 'text-amber-300', dotColor: 'bg-amber-400', stripe: 'rgba(251,191,36,0.5)' };
    case 'completed':
      return { label: 'Completed', icon: CheckCircle2, color: 'text-emerald-300', dotColor: 'bg-emerald-400', stripe: 'rgba(52,211,153,0.5)' };
    case 'on_hold':
      return { label: 'On Hold', icon: Pause, color: 'text-orange-300', dotColor: 'bg-orange-400', stripe: 'rgba(251,146,60,0.5)' };
    default:
      return null;
  }
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
    try {
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
        card_staff_id: number | null;
      };
      let sourceItem: SourceItem | null = null;

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
            .select('item_id, job_card_id, quantity, piece_rate, product_id')
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

      const qtyToIssue = issueQty;

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

        await supabase
          .from('job_card_items')
          .insert({
            job_card_id: jobCardData.job_card_id,
            product_id: sourceItem.product_id ?? productId,
            job_id: jobId,
            quantity: qtyToIssue,
            piece_rate: sourceItem.piece_rate ?? pieceRate,
            status: 'pending',
          });
      } else if (sourceItem && remaining <= 0) {
        // Issuing full balance — move the item to the new staff card
        await supabase
          .from('job_card_items')
          .update({ job_card_id: jobCardData.job_card_id })
          .eq('item_id', sourceItem.item_id);

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
        const { error: itemError } = await supabase
          .from('job_card_items')
          .insert({
            job_card_id: jobCardData.job_card_id,
            product_id: productId,
            job_id: jobId,
            quantity: qtyToIssue || bolQuantity,
            piece_rate: pieceRate,
            status: 'pending',
          });

        if (itemError) throw itemError;
      }

      // Update labor_plan_assignments to mark as issued
      if (selectedAssignment.id) {
        await supabase
          .from('labor_plan_assignments')
          .update({
            job_status: 'issued',
            issued_at: new Date().toISOString(),
          })
          .eq('assignment_id', parseInt(selectedAssignment.id, 10));
      }

      const jobCardId = jobCardData.job_card_id;
      const issuedRemaining = remaining > 0 ? ` (${qtyToIssue} issued, ${remaining} remaining)` : '';

      toast.success(`Job card #${jobCardId} issued${issuedRemaining}`);

      // Open job card in new tab so the user can print immediately
      window.open(`/staff/job-cards/${jobCardId}`, '_blank');

      setSelectedAssignment(null);
      setSelectedLane(null);
    } catch (err: any) {
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

      // Find the staff-assigned job card for this order + staff
      if (orderId && jobId) {
        const { data: staffCards } = await supabase
          .from('job_cards')
          .select('job_card_id')
          .eq('order_id', orderId)
          .eq('staff_id', staffId);

        if (staffCards && staffCards.length > 0) {
          const cardIds = staffCards.map(c => c.job_card_id);

          // Find the issued item on this staff's card
          const { data: issuedItems } = await supabase
            .from('job_card_items')
            .select('item_id, job_card_id, quantity, product_id, piece_rate')
            .in('job_card_id', cardIds)
            .eq('job_id', jobId);

          for (const item of issuedItems ?? []) {
            // Find the source item (on any other card for this order+job) to merge qty back
            const { data: sourceItems } = await supabase
              .from('job_card_items')
              .select('item_id, quantity, job_card_id')
              .eq('job_id', jobId)
              .not('job_card_id', 'in', `(${cardIds.join(',')})`)
              .limit(1);

            if (sourceItems && sourceItems.length > 0) {
              // Merge quantity back into source
              await supabase
                .from('job_card_items')
                .update({ quantity: sourceItems[0].quantity + item.quantity })
                .eq('item_id', sourceItems[0].item_id);
            } else {
              // No source item to merge into — find or create an unassigned card
              const { data: unassignedCard } = await supabase
                .from('job_cards')
                .select('job_card_id')
                .eq('order_id', orderId)
                .is('staff_id', null)
                .limit(1)
                .maybeSingle();

              let targetCardId: number;
              if (unassignedCard) {
                targetCardId = unassignedCard.job_card_id;
              } else {
                const { data: newCard } = await supabase
                  .from('job_cards')
                  .insert({ order_id: orderId, staff_id: null, status: 'pending', issue_date: new Date().toISOString().split('T')[0] })
                  .select()
                  .single();
                targetCardId = newCard!.job_card_id;
              }

              // Move the item back to the unassigned card
              await supabase
                .from('job_card_items')
                .update({ job_card_id: targetCardId })
                .eq('item_id', item.item_id);
            }

            // Delete the issued item (if it was merged back) or clean up card
            if (sourceItems && sourceItems.length > 0) {
              await supabase.from('job_card_items').delete().eq('item_id', item.item_id);
            }
          }

          // Clean up empty staff cards
          for (const cardId of cardIds) {
            const { data: remaining } = await supabase
              .from('job_card_items')
              .select('item_id')
              .eq('job_card_id', cardId)
              .limit(1);
            if (!remaining || remaining.length === 0) {
              await supabase.from('job_cards').delete().eq('job_card_id', cardId);
            }
          }
        }
      }

      // Reset the assignment status back to scheduled
      if (selectedAssignment.id) {
        await supabase
          .from('labor_plan_assignments')
          .update({
            job_status: 'scheduled',
            issued_at: null,
          })
          .eq('assignment_id', parseInt(selectedAssignment.id, 10));
      }

      toast.success('Job card un-issued', {
        description: 'Quantity returned. You can re-issue to a different staff member.',
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
            "flex rounded-lg border bg-card shadow-sm transition-all",
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
                const dropMinutes = computeMinutesFromEvent(event);
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
                const durationHours = Math.round(durationMins / 6) / 10;
                const statusInfo = getJobStatusInfo(assignment.jobStatus);
                const isCompleted = assignment.jobStatus === 'completed';

                return (
                  <Tooltip key={assignment.id} delayDuration={300}>
                  <TooltipTrigger asChild>
                  <div
                    data-job-key={assignment.jobKey}
                    className={cn(
                      'absolute top-1 flex items-center rounded-xl cursor-pointer transition-all duration-150 hover:scale-[1.02] hover:shadow-lg active:scale-[0.99]',
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
                      width: useFixedWidth ? Math.max(width, 80) : `${Math.max(width, 8)}%`,
                      minWidth: '80px',
                      background: `linear-gradient(145deg, ${baseColor}ee 0%, ${baseColor}bb 100%)`,
                      boxShadow: `0 2px 8px ${baseColor}55, inset 0 1px 0 rgba(255,255,255,0.15)`,
                    }}
                  >
                    {/* Left accent stripe — coloured by job status when present */}
                    <div
                      className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
                      style={{ background: statusInfo?.stripe ?? 'rgba(255,255,255,0.35)' }}
                    />

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
                      <span className="truncate text-[10px] font-semibold leading-tight text-white drop-shadow-sm">
                        {assignment.productName || assignment.jobName || assignment.label}
                      </span>
                      <div className="mt-0.5 flex items-center gap-1">
                        <span className="rounded bg-black/20 px-1 py-px text-[8px] font-bold tracking-wide text-white/90">
                          #{assignment.orderNumber || 'N/A'}
                        </span>
                        <span className="text-[9px] font-medium text-white/75">
                          {Math.round((assignment.endMinutes - assignment.startMinutes) / 60 * 10) / 10}h
                        </span>
                      </div>
                    </div>

                    {/* Job status indicator */}
                    {statusInfo && (
                      <div className={cn('mr-1 flex shrink-0 items-center justify-center rounded-full p-0.5', statusInfo.color)}>
                        <statusInfo.icon className="h-3.5 w-3.5 drop-shadow-sm" />
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
                        <span className="ml-auto text-neutral-500">{durationHours}h</span>
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
                        <div className={cn('flex items-center gap-1.5 text-[10px]', statusInfo.color)}>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Job Assignment Details
            </DialogTitle>
            <DialogDescription>
              {selectedAssignment?.label}
            </DialogDescription>
          </DialogHeader>

          {selectedAssignment && (
            <div className="space-y-4">
              {/* Time Info */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Scheduled Time</span>
                </div>
                <div className="ml-6 space-y-1 text-sm text-muted-foreground">
                  <div>Start: {minutesToClock(selectedAssignment.startMinutes)}</div>
                  <div>End: {minutesToClock(selectedAssignment.endMinutes)}</div>
                  <div>Duration: {Math.round((selectedAssignment.endMinutes - selectedAssignment.startMinutes) / 60 * 10) / 10}h</div>
                </div>
              </div>

              {/* Order Info */}
              {selectedAssignment.orderNumber && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Order Details</span>
                  </div>
                  <div className="ml-6 space-y-1 text-sm text-muted-foreground">
                    <div>Order #: {selectedAssignment.orderNumber}</div>
                    {selectedAssignment.orderId && <div>ID: {selectedAssignment.orderId}</div>}
                  </div>
                </div>
              )}

              {/* Job Info */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Job Information</span>
                </div>
                <div className="ml-6 space-y-1 text-sm text-muted-foreground">
                  {selectedAssignment.jobName && <div>Job: {selectedAssignment.jobName}</div>}
                  {selectedAssignment.productName && <div>Product: {selectedAssignment.productName}</div>}
                  <div>Pay Type: {selectedAssignment.payType === 'piece' ? 'Piecework' : 'Hourly'}</div>
                  <div>Status: <Badge variant="outline" className="ml-1">{selectedAssignment.status}</Badge></div>
                </div>
              </div>

              {/* Issue quantity — only show when not yet issued */}
              {availableQty != null && selectedAssignment.jobStatus !== 'issued' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Issue Quantity</span>
                  </div>
                  <div className="ml-6 flex items-center gap-3">
                    <Input
                      type="number"
                      min={1}
                      max={availableQty}
                      value={issueQty}
                      onChange={(e) => setIssueQty(Math.max(1, Math.min(availableQty, parseInt(e.target.value) || 1)))}
                      className="h-8 w-24 text-sm"
                    />
                    <span className="text-sm text-muted-foreground">
                      of {availableQty} available
                    </span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 pb-1">
                {selectedAssignment.jobStatus === 'issued' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUnissueJobCard}
                    disabled={unissuing}
                    className="text-amber-600 border-amber-300 hover:bg-amber-50"
                  >
                    {unissuing ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Undo2 className="h-4 w-4 mr-1.5" />
                    )}
                    {unissuing ? 'Un-issuing...' : 'Un-issue'}
                  </Button>
                ) : (
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
                    {issuingJobCard ? 'Creating...' : `Issue${availableQty != null ? ` (${issueQty})` : ''}`}
                  </Button>
                )}
                <Button
                  variant="default"
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
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
                <Button variant="outline" size="sm" onClick={() => {
                  setSelectedAssignment(null);
                  setSelectedLane(null);
                }}>
                  Close
                </Button>
              </div>
            </div>
          )}
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

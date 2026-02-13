'use client';

import type { DragEvent } from 'react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { minutesToClock } from '@/src/lib/laborScheduling';
import { Circle, GripHorizontal, X, Calendar, Clock, User, Briefcase, CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { LaborDragPayload, StaffAssignment, StaffLane, TimeMarker } from './types';
import { CompleteJobDialog } from './complete-job-dialog';

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

  // Issue job card from assignment
  const handleIssueJobCard = async () => {
    if (!selectedAssignment || !selectedLane) return;

    setIssuingJobCard(true);
    try {
      // Look up BOL data if we have a bolId to get product_id and quantity
      let productId: number | null = null;
      let quantity = 1;
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
          quantity = bolData.quantity || 1;
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

      // Create the job card
      const { data: jobCardData, error: jobCardError } = await supabase
        .from('job_cards')
        .insert({
          order_id: typeof selectedAssignment.orderId === 'number' ? selectedAssignment.orderId : null,
          staff_id: parseInt(selectedLane.id, 10),
          issue_date: selectedAssignment.assignmentDate || new Date().toISOString().split('T')[0],
          status: 'pending',
          notes: `Scheduled: ${minutesToClock(selectedAssignment.startMinutes)} - ${minutesToClock(selectedAssignment.endMinutes)}`,
        })
        .select()
        .single();

      if (jobCardError) throw jobCardError;
      if (!jobCardData) throw new Error('Failed to create job card');

      // Create job card item (only if we have valid job data)
      if (jobId || productId) {
        const { error: itemError } = await supabase
          .from('job_card_items')
          .insert({
            job_card_id: jobCardData.job_card_id,
            product_id: productId,
            job_id: jobId,
            quantity: quantity,
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

      toast.success('Job card created successfully');
      setSelectedAssignment(null);
      setSelectedLane(null);

      // Navigate to the new job card
      router.push(`/staff/job-cards/${jobCardData.job_card_id}`);
    } catch (err: any) {
      console.error('Failed to create job card:', err);
      toast.error(err.message || 'Failed to create job card');
    } finally {
      setIssuingJobCard(false);
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

                return (
                  <div
                    key={assignment.id}
                    title={`${assignment.label}\n${minutesToClock(assignment.startMinutes)} – ${minutesToClock(assignment.endMinutes)}\nOrder: ${assignment.orderNumber || 'N/A'}\nClick for details`}
                    className={cn(
                      'absolute top-1 flex items-center rounded-md border px-2 text-xs font-medium text-white shadow-sm cursor-pointer hover:brightness-110 transition-all',
                      compact ? 'h-12' : 'h-14',
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
                      background: `linear-gradient(135deg, ${baseColor} 0%, ${baseColor}dd 100%)`,
                      borderColor: baseColor,
                    }}
                  >
                    {/* Resize handles */}
                    {assignment.showHandles !== false && (
                      <>
                        <div
                          className="absolute left-0 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center rounded-l bg-black/20 opacity-0 transition hover:opacity-100"
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
                          className="absolute right-0 top-0 flex h-full w-3 cursor-ew-resize items-center justify-center rounded-r bg-black/20 opacity-0 transition hover:opacity-100"
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
                    <div className="flex min-w-0 flex-1 flex-col justify-center px-1.5">
                      <span className="truncate text-[10px] font-medium text-white/95">
                        {assignment.productName || assignment.jobName || assignment.label}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-semibold text-white/80">
                          #{assignment.orderNumber || 'N/A'}
                        </span>
                        <span className="text-[8px] text-white/60">•</span>
                        <span className="text-[9px] text-white/70">
                          {Math.round((assignment.endMinutes - assignment.startMinutes) / 60 * 10) / 10}h
                        </span>
                      </div>
                    </div>
                    {onUnassign && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onUnassign(assignment);
                        }}
                        className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/20 text-white/80 transition hover:bg-black/30"
                        aria-label="Unassign job"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
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

              <div className="flex justify-end gap-2 pt-4">
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
                  {issuingJobCard ? 'Creating...' : 'Issue Job Card'}
                </Button>
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

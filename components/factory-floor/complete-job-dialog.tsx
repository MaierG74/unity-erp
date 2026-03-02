'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { FloorStaffJob } from './types';
import { fetchJobCardItems } from '@/lib/queries/factoryFloor';
import { formatDuration } from '@/lib/shift-utils';
import type { ScheduleBreak } from '@/types/work-schedule';
import type { ShiftInfo } from '@/hooks/use-shift-info';

interface CompleteJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (params: {
    items: { item_id: number; completed_quantity: number }[];
    actualStart?: string;
    actualEnd?: string;
    notes?: string;
  }) => void;
  isPending: boolean;
  /** Shift schedule — used to calculate working hours for overnight jobs and deduct breaks */
  shiftInfo?: Pick<ShiftInfo, 'startMinutes' | 'effectiveEndMinutes' | 'breaks'>;
}

function formatTimestampToInput(ts: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return '';
  }
}

function timeInputToTimestamp(timeStr: string, refDate?: string, addDay?: boolean): string {
  const [h, m] = timeStr.split(':').map(Number);
  const base = refDate ? new Date(refDate) : new Date();
  base.setHours(h, m, 0, 0);
  if (addDay) base.setDate(base.getDate() + 1);
  return base.toISOString();
}

/** Calculate total break minutes that overlap with a given work period */
function breakMinutesInRange(breaks: ScheduleBreak[], rangeStart: number, rangeEnd: number): number {
  let total = 0;
  for (const b of breaks) {
    const overlapStart = Math.max(b.startMinutes, rangeStart);
    const overlapEnd = Math.min(b.endMinutes, rangeEnd);
    if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
  }
  return total;
}

export function CompleteJobDialog({ job, open, onOpenChange, onComplete, isPending, shiftInfo }: CompleteJobDialogProps) {
  const shiftStartMinutes = shiftInfo?.startMinutes ?? 420;
  const shiftEndMinutes = shiftInfo?.effectiveEndMinutes ?? 1020;
  const breaks = shiftInfo?.breaks ?? [];
  const [actualStart, setActualStart] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ['job-card-items', job?.job_card_id],
    queryFn: () => fetchJobCardItems(job!.job_card_id!),
    enabled: open && !!job?.job_card_id,
  });

  // Pre-fill times when dialog opens
  useEffect(() => {
    if (open && job) {
      setActualStart(formatTimestampToInput(job.started_at ?? job.issued_at));
      const now = new Date();
      setActualEnd(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
      setNotes('');
      setQuantities({});
    }
  }, [open, job?.assignment_id]);

  // Initialize quantities from fetched items
  useEffect(() => {
    if (items && Object.keys(quantities).length === 0) {
      const initial: Record<number, number> = {};
      for (const item of items) {
        initial[item.item_id] = item.completed_quantity > 0 ? item.completed_quantity : item.quantity;
      }
      setQuantities(initial);
    }
  }, [items]);

  const { actualDurationMinutes, endIsNextDay } = useMemo(() => {
    if (!actualStart || !actualEnd) return { actualDurationMinutes: 0, endIsNextDay: false };
    const [sh, sm] = actualStart.split(':').map(Number);
    const [eh, em] = actualEnd.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    const isNextDay = endMins < startMins;

    let duration: number;
    if (!isNextDay) {
      // Same day — subtract breaks that fall within the work period
      duration = (endMins - startMins) - breakMinutesInRange(breaks, startMins, endMins);
    } else {
      // Overnight: working time = (shift end - actual start) + (actual end - shift start)
      // minus breaks on both days
      const workDay1 = Math.max(0, shiftEndMinutes - startMins);
      const workDay2 = Math.max(0, endMins - shiftStartMinutes);
      duration = workDay1 + workDay2
        - breakMinutesInRange(breaks, startMins, shiftEndMinutes)
        - breakMinutesInRange(breaks, shiftStartMinutes, endMins);
    }
    return { actualDurationMinutes: duration, endIsNextDay: isNextDay };
  }, [actualStart, actualEnd, shiftStartMinutes, shiftEndMinutes, breaks]);

  const variance = useMemo(() => {
    if (!job?.estimated_minutes || actualDurationMinutes <= 0) return null;
    return actualDurationMinutes - job.estimated_minutes;
  }, [actualDurationMinutes, job?.estimated_minutes]);

  const totalEarnings = useMemo(() => {
    if (!items) return 0;
    return items.reduce((sum, item) => {
      const qty = quantities[item.item_id] ?? item.quantity;
      return sum + qty * (item.piece_rate ?? 0);
    }, 0);
  }, [items, quantities]);

  const handleSubmit = () => {
    if (!job) return;
    const itemsPayload = (items ?? []).map((item) => ({
      item_id: item.item_id,
      completed_quantity: quantities[item.item_id] ?? item.quantity,
    }));
    const refDate = job.assignment_date ?? undefined;
    onComplete({
      items: itemsPayload,
      actualStart: actualStart ? timeInputToTimestamp(actualStart, refDate) : undefined,
      actualEnd: actualEnd ? timeInputToTimestamp(actualEnd, refDate, endIsNextDay) : undefined,
      notes: notes || undefined,
    });
  };

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete Job</DialogTitle>
          <DialogDescription>
            Record completion details and finalize the job assignment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <p className="text-sm text-muted-foreground">
            Completing <span className="font-medium text-foreground">{job.job_name}</span> for{' '}
            <span className="font-medium text-foreground">{job.staff_name}</span>.
          </p>

          {/* Actual times */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Actual Start</Label>
              <Input type="time" value={actualStart} onChange={(e) => setActualStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Actual End{endIsNextDay && <span className="text-xs text-muted-foreground ml-1">(next day)</span>}</Label>
              <Input type="time" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} />
            </div>
          </div>

          {/* Duration summary */}
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Actual: </span>
              <span className="font-medium">{actualDurationMinutes > 0 ? formatDuration(actualDurationMinutes) : '-'}</span>
              {endIsNextDay && actualDurationMinutes > 0 && (
                <span className="text-xs text-muted-foreground ml-1">(working hrs only)</span>
              )}
            </div>
            {job.estimated_minutes && (
              <div>
                <span className="text-muted-foreground">Est: </span>
                <span className="font-medium">{formatDuration(job.estimated_minutes)}</span>
              </div>
            )}
            {variance !== null && (
              <div>
                <span className="text-muted-foreground">Variance: </span>
                <span className={`font-medium ${variance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {variance > 0 ? '+' : ''}{formatDuration(Math.abs(variance))}
                </span>
              </div>
            )}
          </div>

          {/* Job card items */}
          {itemsLoading ? (
            <p className="text-sm text-muted-foreground">Loading items...</p>
          ) : items && items.length > 0 ? (
            <div className="space-y-3">
              <Label>Items</Label>
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.item_id} className="flex items-center gap-3 p-3 rounded-md border bg-card">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.job_name ?? item.product_name ?? 'Item'}</div>
                      {item.product_name && item.job_name && (
                        <div className="text-xs text-muted-foreground truncate">{item.product_name}</div>
                      )}
                      {item.piece_rate != null && item.piece_rate > 0 && (
                        <div className="text-xs text-muted-foreground">
                          R{item.piece_rate}/pc = R{((quantities[item.item_id] ?? item.quantity) * item.piece_rate).toFixed(2)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={quantities[item.item_id] ?? item.quantity}
                        onChange={(e) => setQuantities((prev) => ({
                          ...prev,
                          [item.item_id]: Math.min(item.quantity, Math.max(0, parseInt(e.target.value) || 0)),
                        }))}
                        className="w-20 text-center"
                      />
                      <span className="text-sm text-muted-foreground">/ {item.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>
              {totalEarnings > 0 && (
                <div className="text-sm font-medium text-right">
                  Total Earnings: R{totalEarnings.toFixed(2)}
                </div>
              )}
            </div>
          ) : !job.job_card_id ? (
            <p className="text-sm text-muted-foreground italic">No linked job card found. Assignment will be marked complete.</p>
          ) : null}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Completion notes..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || actualDurationMinutes <= 0}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isPending ? 'Completing...' : 'Complete Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

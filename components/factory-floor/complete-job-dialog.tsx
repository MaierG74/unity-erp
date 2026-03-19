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
import { supabase } from '@/lib/supabase';
import { calculateWorkingMinutes } from '@/lib/working-hours';
import { createSASTTimestamp } from '@/lib/utils/timezone';
import type { DaySchedule, PauseEvent, ShiftOverride } from '@/lib/working-hours';
import {
  CompletionItemsList,
  isCompletionValid,
  buildItemsPayload,
  initCompletions,
  type ItemCompletion,
  type CompletionItem,
} from '@/components/features/completion/completion-items';

interface CompleteJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (params: {
    items: { item_id: number; completed_quantity: number; remainder_action?: string | null; remainder_reason?: string | null }[];
    actualStart?: string;
    actualEnd?: string;
    notes?: string;
  }) => void;
  isPending: boolean;
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

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
}

function scheduledStartTimestamp(job: FloorStaffJob): string | null {
  if (!job.assignment_date || job.start_minutes == null) return null;
  const hours = Math.floor(job.start_minutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor(job.start_minutes % 60)
    .toString()
    .padStart(2, '0');
  return createSASTTimestamp(job.assignment_date, `${hours}:${minutes}`);
}

export function CompleteJobDialog({ job, open, onOpenChange, onComplete, isPending }: CompleteJobDialogProps) {
  const [actualStart, setActualStart] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [completions, setCompletions] = useState<Record<number, ItemCompletion>>({});

  const {
    data: rawItems,
    isLoading: itemsLoading,
    isError: itemsError,
  } = useQuery({
    queryKey: ['job-card-items', job?.job_card_id],
    queryFn: () => fetchJobCardItems(job!.job_card_id!),
    enabled: open && !!job?.job_card_id,
  });

  // Map to CompletionItem shape
  const items: CompletionItem[] = useMemo(() => {
    if (!rawItems) return [];
    return rawItems.map((item) => ({
      item_id: item.item_id,
      job_name: item.job_name,
      product_name: item.product_name,
      quantity: item.quantity,
      completed_quantity: item.completed_quantity,
      piece_rate: item.piece_rate,
      status: item.status,
    }));
  }, [rawItems]);

  const { data: rawSchedules } = useQuery({
    queryKey: ['work-schedules', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_schedules')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const allSchedules = useMemo(() => {
    if (!rawSchedules) return [];
    return rawSchedules.map((row: any) => ({
      dayGroup: row.day_group,
      startMinutes: row.start_minutes,
      endMinutes: row.end_minutes,
      breaks: (row.breaks ?? []) as { label: string; startMinutes: number; endMinutes: number }[],
      isActive: row.is_active,
    })) as DaySchedule[];
  }, [rawSchedules]);

  const { data: pauseEvents } = useQuery({
    queryKey: ['pause-events', job?.assignment_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assignment_pause_events')
        .select('paused_at, resumed_at')
        .eq('assignment_id', job!.assignment_id);
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        pausedAt: new Date(p.paused_at),
        resumedAt: p.resumed_at ? new Date(p.resumed_at) : null,
      })) as PauseEvent[];
    },
    enabled: open && !!job?.assignment_id,
  });

  const { data: shiftOverrides } = useQuery({
    queryKey: ['shift-overrides', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shift_overrides')
        .select('override_date, extended_end_minutes')
        .gte('override_date', startDate)
        .lte('override_date', endDate);
      if (error) throw error;
      return (data ?? []).map((o: any) => ({
        overrideDate: o.override_date,
        extendedEndMinutes: o.extended_end_minutes,
      })) as ShiftOverride[];
    },
    enabled: open && !!startDate && !!endDate,
  });

  // Pre-fill times when dialog opens
  useEffect(() => {
    if (open && job) {
      const startTs = job.started_at ?? scheduledStartTimestamp(job) ?? job.issued_at;
      const startDt = startTs ? new Date(startTs) : new Date();
      setStartDate(toDateKey(startDt));
      setActualStart(formatTimestampToInput(startTs));

      const now = new Date();
      setEndDate(toDateKey(now));
      setActualEnd(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
      setNotes('');
      setCompletions({});
    }
  }, [open, job?.assignment_id]);

  // Initialize completions from items — uses functional updater to avoid stale closure
  useEffect(() => {
    if (items.length > 0) {
      setCompletions((prev) =>
        Object.keys(prev).length === 0 ? initCompletions(items) : prev
      );
    }
  }, [items]);

  const handleUpdateCompletion = (itemId: number, update: Partial<ItemCompletion>) => {
    setCompletions((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...update },
    }));
  };

  const workResult = useMemo(() => {
    if (!actualStart || !actualEnd || !startDate || !endDate) {
      return { totalMinutes: 0, workingDays: 0, pauseMinutes: 0 };
    }
    const s = new Date(`${startDate}T${actualStart}:00`);
    const e = new Date(`${endDate}T${actualEnd}:00`);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) {
      return { totalMinutes: 0, workingDays: 0, pauseMinutes: 0 };
    }
    return calculateWorkingMinutes(
      s, e,
      allSchedules ?? [],
      pauseEvents ?? [],
      shiftOverrides ?? [],
    );
  }, [actualStart, actualEnd, startDate, endDate, allSchedules, pauseEvents, shiftOverrides]);

  const isMultiDay = startDate !== endDate;

  const variance = useMemo(() => {
    if (!job?.estimated_minutes || workResult.totalMinutes <= 0) return null;
    return workResult.totalMinutes - job.estimated_minutes;
  }, [workResult.totalMinutes, job?.estimated_minutes]);

  const requiresLoadedItems = !!job?.job_card_id;
  const itemsReadyForCompletion = !requiresLoadedItems || (!itemsLoading && !itemsError && items.length > 0);
  const itemsValid = itemsReadyForCompletion && (!requiresLoadedItems || isCompletionValid(items, completions));

  const handleSubmit = () => {
    if (!job || !itemsReadyForCompletion) return;
    const itemsPayload = buildItemsPayload(items, completions);
    onComplete({
      items: itemsPayload,
      actualStart: actualStart && startDate ? new Date(`${startDate}T${actualStart}:00`).toISOString() : undefined,
      actualEnd: actualEnd && endDate ? new Date(`${endDate}T${actualEnd}:00`).toISOString() : undefined,
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
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Completing <span className="font-medium text-foreground">{job.job_name}</span> for{' '}
            <span className="font-medium text-foreground">{job.staff_name}</span>.
          </p>

          {/* Actual times */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Actual Start</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="time"
                  value={actualStart}
                  onChange={(e) => setActualStart(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Actual End</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="time"
                  value={actualEnd}
                  onChange={(e) => setActualEnd(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          </div>

          {/* Duration summary */}
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Actual: </span>
              <span className="font-medium">
                {workResult.totalMinutes > 0 ? formatDuration(workResult.totalMinutes) : '-'}
              </span>
              {isMultiDay && workResult.workingDays > 0 && (
                <span className="text-xs text-muted-foreground ml-1">
                  ({workResult.workingDays} working day{workResult.workingDays !== 1 ? 's' : ''})
                </span>
              )}
            </div>
            {workResult.pauseMinutes > 0 && (
              <div>
                <span className="text-muted-foreground">Paused: </span>
                <span className="font-medium">{formatDuration(workResult.pauseMinutes)}</span>
              </div>
            )}
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

          {/* Job card items with remainder handling */}
          {itemsLoading ? (
            <p className="text-sm text-muted-foreground">Loading items...</p>
          ) : itemsError ? (
            <p className="text-sm text-destructive">
              Could not load job card items. Reload the dialog before completing this job.
            </p>
          ) : items.length > 0 ? (
            <CompletionItemsList
              items={items}
              completions={completions}
              onUpdate={handleUpdateCompletion}
            />
          ) : !job.job_card_id ? (
            <p className="text-sm text-muted-foreground italic">No linked job card found. Assignment will be marked complete.</p>
          ) : (
            <p className="text-sm text-destructive">
              No active job card items were found for this card. Completion is blocked until the card items load correctly.
            </p>
          )}

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
            disabled={isPending || workResult.totalMinutes <= 0 || !itemsValid}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isPending ? 'Completing...' : 'Complete Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

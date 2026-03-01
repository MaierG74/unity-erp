'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { FloorStaffJob } from './types';
import { fetchJobCardItems } from '@/lib/queries/factoryFloor';

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

function timeInputToTimestamp(timeStr: string, refDate?: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const base = refDate ? new Date(refDate) : new Date();
  base.setHours(h, m, 0, 0);
  return base.toISOString();
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function CompleteJobDialog({ job, open, onOpenChange, onComplete, isPending }: CompleteJobDialogProps) {
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

  const actualDurationMinutes = useMemo(() => {
    if (!actualStart || !actualEnd) return 0;
    const [sh, sm] = actualStart.split(':').map(Number);
    const [eh, em] = actualEnd.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }, [actualStart, actualEnd]);

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
    onComplete({
      items: itemsPayload,
      actualStart: actualStart ? timeInputToTimestamp(actualStart, job.assignment_date ?? undefined) : undefined,
      actualEnd: actualEnd ? timeInputToTimestamp(actualEnd, job.assignment_date ?? undefined) : undefined,
      notes: notes || undefined,
    });
  };

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete Job</DialogTitle>
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
              <Label>Actual End</Label>
              <Input type="time" value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} />
            </div>
          </div>

          {/* Duration summary */}
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Actual: </span>
              <span className="font-medium">{formatDuration(actualDurationMinutes)}</span>
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

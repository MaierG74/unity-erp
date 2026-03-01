'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAUSE_REASONS, type PauseReason } from './types';
import type { FloorStaffJob } from './types';

interface PauseJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPause: (reason: PauseReason, notes?: string) => void;
  isPending: boolean;
}

export function PauseJobDialog({ job, open, onOpenChange, onPause, isPending }: PauseJobDialogProps) {
  const [reason, setReason] = useState<PauseReason | ''>('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!reason) return;
    onPause(reason, notes || undefined);
    setReason('');
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pause Job</DialogTitle>
          <DialogDescription>
            Pause a job and stop the clock until it is resumed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Pausing <span className="font-medium text-foreground">{job?.job_name}</span> for{' '}
            <span className="font-medium text-foreground">{job?.staff_name}</span>.
            The clock will stop until the job is resumed.
          </p>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as PauseReason)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {PAUSE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional details..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!reason || isPending}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isPending ? 'Pausing...' : 'Pause Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

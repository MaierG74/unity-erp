'use client';

import { useState, useMemo } from 'react';
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
import { fetchActiveStaff } from '@/lib/queries/factoryFloor';

interface TransferJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransfer: (newStaffId: number, notes?: string) => void;
  isPending: boolean;
}

export function TransferJobDialog({ job, open, onOpenChange, onTransfer, isPending }: TransferJobDialogProps) {
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');

  const { data: allStaff, isLoading } = useQuery({
    queryKey: ['active-staff'],
    queryFn: fetchActiveStaff,
    enabled: open,
  });

  const filteredStaff = useMemo(() => {
    if (!allStaff) return [];
    return allStaff
      .filter((s) => s.staff_id !== job?.staff_id)
      .filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));
  }, [allStaff, job?.staff_id, search]);

  const selectedStaff = allStaff?.find((s) => s.staff_id === selectedStaffId);
  const isInProgress = job?.job_status === 'in_progress';

  const handleSubmit = () => {
    if (!selectedStaffId) return;
    onTransfer(selectedStaffId, notes || undefined);
    setSelectedStaffId(null);
    setSearch('');
    setNotes('');
  };

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transfer Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Transfer <span className="font-medium text-foreground">{job.job_name}</span> from{' '}
            <span className="font-medium text-foreground">{job.staff_name}</span> to another staff member.
          </p>

          {isInProgress && (
            <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/10 text-sm">
              <p className="font-medium text-amber-400">Work in progress</p>
              <p className="text-muted-foreground mt-1">
                This job has started. The current worker&apos;s completed quantities will be finalized
                and a new job card will be created for the remaining work.
              </p>
            </div>
          )}

          {/* Staff search */}
          <div className="space-y-2">
            <Label>Assign to</Label>
            <Input
              placeholder="Search staff..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading staff...</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-1">
                {filteredStaff.length === 0 && (
                  <p className="text-sm text-muted-foreground p-2">No matching staff found.</p>
                )}
                {filteredStaff.map((s) => (
                  <button
                    key={s.staff_id}
                    type="button"
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      selectedStaffId === s.staff_id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedStaffId(s.staff_id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedStaff && (
            <div className="p-3 rounded-md border bg-card text-sm">
              <p>
                <span className="text-muted-foreground">From:</span>{' '}
                <span className="font-medium">{job.staff_name}</span>
              </p>
              <p>
                <span className="text-muted-foreground">To:</span>{' '}
                <span className="font-medium">{selectedStaff.name}</span>
              </p>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for transfer..."
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
            disabled={!selectedStaffId || isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isPending ? 'Transferring...' : 'Transfer Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

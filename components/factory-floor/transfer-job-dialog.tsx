'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
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
import { Switch } from '@/components/ui/switch';
import type { FloorStaffJob, EarningsSplitItem } from './types';
import { fetchActiveStaff, fetchJobCardItems } from '@/lib/queries/factoryFloor';

interface TransferJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransfer: (newStaffId: number, notes?: string, earningsSplit?: EarningsSplitItem[]) => void;
  isPending: boolean;
}

export function TransferJobDialog({ job, open, onOpenChange, onTransfer, isPending }: TransferJobDialogProps) {
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [customSplit, setCustomSplit] = useState(false);
  const [splitAmounts, setSplitAmounts] = useState<Record<number, number>>({});
  const splitInitializedRef = useRef(false);

  const isPiecework = job?.pay_type === 'piece';
  const isInProgress = job?.job_status === 'in_progress';
  const showEarningsSplit = isPiecework && isInProgress;

  // Reset all state when dialog opens/closes or job changes
  useEffect(() => {
    if (open) {
      setSelectedStaffId(null);
      setSearch('');
      setNotes('');
      setSplitAmounts({});
      setCustomSplit(false);
      splitInitializedRef.current = false;
    }
  }, [open, job?.assignment_id]);

  const { data: allStaff, isLoading } = useQuery({
    queryKey: ['active-staff'],
    queryFn: fetchActiveStaff,
    enabled: open,
  });

  const { data: jobItems } = useQuery({
    queryKey: ['job-card-items', job?.job_card_id],
    queryFn: () => fetchJobCardItems(job!.job_card_id!),
    enabled: open && showEarningsSplit && !!job?.job_card_id,
  });

  const needsCustomSplit = useMemo(() => {
    if (!jobItems) return false;
    return jobItems.some((i) => i.quantity === 1 && (i.piece_rate ?? 0) > 0);
  }, [jobItems]);

  useEffect(() => {
    if (!jobItems || splitInitializedRef.current) return;
    splitInitializedRef.current = true;
    const initial: Record<number, number> = {};
    for (const item of jobItems) {
      if ((item.piece_rate ?? 0) > 0) {
        const ratio = item.completed_quantity / Math.max(item.quantity, 1);
        initial[item.item_id] = Math.round((item.piece_rate ?? 0) * ratio * 100) / 100;
      }
    }
    setSplitAmounts(initial);
  }, [jobItems]);

  const filteredStaff = useMemo(() => {
    if (!allStaff) return [];
    return allStaff
      .filter((s) => s.staff_id !== job?.staff_id)
      .filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));
  }, [allStaff, job?.staff_id, search]);

  const selectedStaff = allStaff?.find((s) => s.staff_id === selectedStaffId);

  const handleSubmit = () => {
    if (!selectedStaffId) return;
    let earningsSplit: EarningsSplitItem[] | undefined;
    if (showEarningsSplit && (needsCustomSplit || customSplit) && jobItems) {
      earningsSplit = jobItems
        .filter((i) => (i.piece_rate ?? 0) > 0 && splitAmounts[i.item_id] != null)
        .map((i) => ({ item_id: i.item_id, original_amount: splitAmounts[i.item_id] }));
    }
    onTransfer(selectedStaffId, notes || undefined, earningsSplit);
  };

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transfer Job</DialogTitle>
          <DialogDescription>
            Reassign a job to a different staff member.
          </DialogDescription>
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

          {/* Earnings split for piecework transfers */}
          {showEarningsSplit && jobItems && jobItems.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Earnings Split</Label>
                {!needsCustomSplit && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="custom-split" className="text-xs text-muted-foreground">Custom split</Label>
                    <Switch id="custom-split" checked={customSplit} onCheckedChange={setCustomSplit} />
                  </div>
                )}
              </div>
              {(needsCustomSplit || customSplit) ? (
                <div className="space-y-2">
                  {jobItems.filter((i) => (i.piece_rate ?? 0) > 0).map((item) => (
                    <div key={item.item_id} className="p-3 rounded-md border bg-card space-y-2">
                      <div className="text-sm font-medium truncate">
                        {item.job_name ?? item.product_name ?? 'Item'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Total rate: R{(item.piece_rate ?? 0).toFixed(2)} per piece
                        {item.quantity > 1 && ` × ${item.quantity} = R${((item.piece_rate ?? 0) * item.quantity).toFixed(2)}`}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">{job?.staff_name} earns</Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R</span>
                            <Input
                              type="number"
                              min={0}
                              max={item.piece_rate ?? 0}
                              step={0.01}
                              value={splitAmounts[item.item_id] ?? 0}
                              onChange={(e) => setSplitAmounts((prev) => ({
                                ...prev,
                                [item.item_id]: Math.min(item.piece_rate ?? 0, Math.max(0, parseFloat(e.target.value) || 0)),
                              }))}
                              className="pl-7 text-sm"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">New worker earns</Label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R</span>
                            <Input
                              type="number"
                              value={((item.piece_rate ?? 0) - (splitAmounts[item.item_id] ?? 0)).toFixed(2)}
                              readOnly
                              className="pl-7 text-sm bg-muted"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Earnings will be split by completed quantities. Toggle &quot;Custom split&quot; to specify rand amounts.
                </p>
              )}
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

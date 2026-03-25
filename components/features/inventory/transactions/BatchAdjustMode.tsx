'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const BATCH_ADJUSTMENT_REASONS = [
  { value: 'cycle_count', label: 'Cycle Count' },
  { value: 'stock_count', label: 'Stock Count Variance' },
  { value: 'data_entry_error', label: 'Data Entry Correction' },
  { value: 'found_stock', label: 'Found Stock' },
  { value: 'other', label: 'Other' },
];

export type BatchEntry = {
  componentId: number;
  code: string;
  description: string;
  systemStock: number;
};

type Props = {
  entries: BatchEntry[];
  onApplyAll: (adjustments: Array<{ componentId: number; code: string; systemStock: number; newStock: number }>, reason: string, notes: string) => Promise<void>;
  onCancel: () => void;
};

export function BatchAdjustMode({ entries, onApplyAll, onCancel }: Props) {
  const [countedValues, setCountedValues] = useState<Map<number, string>>(new Map());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('cycle_count');
  const [notes, setNotes] = useState('');
  const [isPending, setIsPending] = useState(false);
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const setCounted = useCallback((componentId: number, value: string) => {
    setCountedValues((prev) => {
      const next = new Map(prev);
      if (value === '') {
        next.delete(componentId);
      } else {
        next.set(componentId, value);
      }
      return next;
    });
  }, []);

  const changedEntries = useMemo(() => {
    return entries.filter((e) => {
      const counted = countedValues.get(e.componentId);
      if (counted === undefined || counted === '') return false;
      return Number(counted) !== e.systemStock;
    }).map((e) => {
      const counted = Number(countedValues.get(e.componentId));
      return {
        componentId: e.componentId,
        code: e.code,
        systemStock: e.systemStock,
        newStock: counted,
        diff: counted - e.systemStock,
      };
    });
  }, [entries, countedValues]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, currentIndex: number) => {
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    if (e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      const prevEntry = entries[currentIndex - 1];
      if (prevEntry) inputRefs.current.get(prevEntry.componentId)?.focus();
    } else if (!e.shiftKey) {
      e.preventDefault();
      const nextEntry = entries[currentIndex + 1];
      if (nextEntry) inputRefs.current.get(nextEntry.componentId)?.focus();
    }
  }, [entries]);

  const handleConfirm = useCallback(async () => {
    setIsPending(true);
    try {
      await onApplyAll(
        changedEntries,
        BATCH_ADJUSTMENT_REASONS.find((r) => r.value === reason)?.label || reason,
        notes
      );
      setConfirmOpen(false);
    } finally {
      setIsPending(false);
    }
  }, [changedEntries, reason, notes, onApplyAll]);

  return (
    <div className="space-y-3">
      {/* Batch toolbar */}
      <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Batch Adjust Mode</span>
          <span className="text-xs text-muted-foreground">
            {changedEntries.length} of {entries.length} items changed
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={changedEntries.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Apply {changedEntries.length} Adjustments
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      {/* Editable table */}
      <div className="rounded-xl border bg-card shadow-xs overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-center w-[100px]">System</TableHead>
              <TableHead className="text-center w-[120px]">Counted</TableHead>
              <TableHead className="text-center w-[80px]">Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry, idx) => {
              const counted = countedValues.get(entry.componentId);
              const countedNum = counted !== undefined && counted !== '' ? Number(counted) : null;
              const diff = countedNum !== null ? countedNum - entry.systemStock : null;
              const isChanged = diff !== null && diff !== 0;
              const isMatch = diff === 0;

              return (
                <TableRow
                  key={entry.componentId}
                  className={cn(
                    'text-sm',
                    isChanged && 'border-l-2 border-l-amber-500',
                    isMatch && 'border-l-2 border-l-green-500'
                  )}
                >
                  <TableCell className="py-1.5">
                    <Link
                      href={`/inventory/components/${entry.componentId}`}
                      target="_blank"
                      className="text-primary hover:underline font-medium text-xs"
                    >
                      {entry.code}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground py-1.5 max-w-[300px] truncate">
                    {entry.description}
                  </TableCell>
                  <TableCell className="text-center font-medium py-1.5">
                    {entry.systemStock}
                  </TableCell>
                  <TableCell className="py-1 px-2">
                    <Input
                      ref={(el) => {
                        if (el) inputRefs.current.set(entry.componentId, el);
                      }}
                      type="number"
                      value={counted ?? ''}
                      onChange={(e) => setCounted(entry.componentId, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, idx)}
                      placeholder="—"
                      className="h-7 text-center text-sm"
                    />
                  </TableCell>
                  <TableCell className="text-center py-1.5">
                    {isMatch ? (
                      <Check className="h-4 w-4 text-green-500 mx-auto" />
                    ) : diff !== null ? (
                      <span className={cn('font-semibold text-sm', diff > 0 ? 'text-green-600' : 'text-red-500')}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirm {changedEntries.length} Stock Adjustments</DialogTitle>
          </DialogHeader>

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">Component</TableHead>
                  <TableHead className="text-xs text-right">System</TableHead>
                  <TableHead className="text-xs text-right">Counted</TableHead>
                  <TableHead className="text-xs text-right">Adjustment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changedEntries.map((a) => (
                  <TableRow key={a.componentId}>
                    <TableCell className="font-medium text-xs">{a.code}</TableCell>
                    <TableCell className="text-right text-xs">{a.systemStock}</TableCell>
                    <TableCell className="text-right text-xs">{a.newStock}</TableCell>
                    <TableCell className={cn('text-right font-semibold text-xs', a.diff > 0 ? 'text-green-600' : 'text-red-500')}>
                      {a.diff > 0 ? '+' : ''}{a.diff}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Reason for All Adjustments</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BATCH_ADJUSTMENT_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={isPending}>
              {isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Applying...</>
              ) : (
                `Confirm ${changedEntries.length} Adjustments`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

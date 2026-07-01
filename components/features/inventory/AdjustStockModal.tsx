'use client';

import { useEffect, useState } from 'react';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { applyStockAdjustment } from '@/lib/db/internalOrders';

export interface AdjustStockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: number;
  productName: string;
  currentQoh?: number;
  onAdjusted?: () => void;
}

export function AdjustStockModal({
  open,
  onOpenChange,
  productId,
  productName,
  currentQoh,
  onAdjusted,
}: AdjustStockModalProps) {
  const [delta, setDelta] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setDelta('');
      setReason('');
      setSubmitting(false);
    }
  }, [open]);

  const numericDelta = Number(delta);
  const hasDelta = delta.trim() !== '' && Number.isFinite(numericDelta) && numericDelta !== 0;
  const trimmedReason = reason.trim();
  const isValid = hasDelta && trimmedReason.length > 0;

  const projectedQoh =
    typeof currentQoh === 'number' && Number.isFinite(numericDelta)
      ? currentQoh + numericDelta
      : null;

  async function handleSubmit() {
    if (!Number.isFinite(numericDelta) || numericDelta === 0) {
      toast.error('Enter a non-zero adjustment');
      return;
    }
    if (!trimmedReason) {
      toast.error('A reason is required');
      return;
    }

    setSubmitting(true);
    try {
      await applyStockAdjustment(productId, numericDelta, trimmedReason);
      toast.success('Stock adjusted', {
        description: `${productName} ${numericDelta > 0 ? 'increased' : 'decreased'} by ${Math.abs(numericDelta)}`,
      });
      onAdjusted?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to adjust stock';
      toast.error('Could not adjust stock', { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5" />
            Adjust Stock
          </DialogTitle>
          <DialogDescription>
            Apply a manual on-hand correction for{' '}
            <span className="font-medium text-foreground">{productName}</span>. Use a negative value to reduce stock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {typeof currentQoh === 'number' && (
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Current On Hand</p>
                <p className="text-2xl font-semibold tabular-nums">{currentQoh}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Projected</p>
                <p
                  className={`text-2xl font-semibold tabular-nums ${
                    projectedQoh == null || !hasDelta
                      ? 'text-muted-foreground'
                      : projectedQoh > currentQoh
                        ? 'text-emerald-600'
                        : projectedQoh < currentQoh
                          ? 'text-red-600'
                          : 'text-foreground'
                  }`}
                >
                  {hasDelta && projectedQoh != null ? projectedQoh : '—'}
                </p>
              </div>
            </div>
          )}

          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Adjustment</h3>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-stock-delta" className="text-xs text-muted-foreground">
                Quantity Change
              </Label>
              <Input
                id="adjust-stock-delta"
                type="number"
                step="1"
                value={delta || ''}
                onChange={(event) => setDelta(event.target.value)}
                onBlur={() => {
                  if (delta.trim() === '') setDelta('');
                }}
                placeholder="0"
                aria-describedby="adjust-stock-delta-hint"
              />
              <p id="adjust-stock-delta-hint" className="text-xs text-muted-foreground">
                Positive adds stock, negative removes it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adjust-stock-reason" className="text-xs text-muted-foreground">
                Reason <span className="text-red-600">*</span>
              </Label>
              <Textarea
                id="adjust-stock-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                placeholder="Why is this adjustment being made?"
              />
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-border/50 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!isValid || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

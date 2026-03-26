'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/quotes';

interface BatchMarkupConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  selectedCount: number;
  markupValue: number;
  markupType: 'percentage' | 'fixed';
  oldTotal: number;
  newTotal: number;
  isApplying: boolean;
}

export default function BatchMarkupConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  selectedCount,
  markupValue,
  markupType,
  oldTotal,
  newTotal,
  isApplying,
}: BatchMarkupConfirmDialogProps) {
  const difference = newTotal - oldTotal;
  const markupLabel = markupType === 'percentage'
    ? `${markupValue}%`
    : `${formatCurrency(markupValue)} fixed`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Apply Batch Markup?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Updating <span className="text-foreground font-medium">{selectedCount} item{selectedCount !== 1 ? 's' : ''}</span> to{' '}
            <span className="text-primary font-medium">{markupLabel}</span> markup
          </p>
          <div className="space-y-1.5 pt-2 border-t border-border">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Old quote total</span>
              <span className="text-muted-foreground line-through">{formatCurrency(oldTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">New quote total</span>
              <span className="text-primary font-bold">{formatCurrency(newTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Difference</span>
              <span className={difference < 0 ? 'text-destructive font-medium' : 'text-green-500 font-medium'}>
                {difference < 0 ? '-' : '+'}{formatCurrency(Math.abs(difference))}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isApplying}>
            {isApplying ? 'Applying...' : 'Apply Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

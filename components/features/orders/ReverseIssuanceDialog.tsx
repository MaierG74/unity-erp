'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RotateCcw, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface StockIssuance {
  issuance_id: number;
  component_id: number;
  component: {
    internal_code: string;
    description: string | null;
  };
  quantity_issued: number;
  issuance_date: string;
  notes: string | null;
}

interface ReverseIssuanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issuance: StockIssuance | null;
  onReversed: () => void;
}

function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0';
  }
  const numeric = Number(value);
  if (Math.abs(numeric - Math.round(numeric)) < 0.001) {
    return Math.round(numeric).toString();
  }
  return numeric.toFixed(2);
}

export function ReverseIssuanceDialog({ open, onOpenChange, issuance, onReversed }: ReverseIssuanceDialogProps) {
  const [quantityToReverse, setQuantityToReverse] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [isReversing, setIsReversing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens/closes or issuance changes
  useEffect(() => {
    if (open && issuance) {
      setQuantityToReverse(formatQuantity(issuance.quantity_issued));
      setReason('');
      setError(null);
    } else if (!open) {
      setQuantityToReverse('');
      setReason('');
      setError(null);
    }
  }, [open, issuance]);

  const maxQuantity = issuance ? Number(issuance.quantity_issued) : 0;
  const quantityValue = parseFloat(quantityToReverse) || 0;
  const isValidQuantity = quantityValue > 0 && quantityValue <= maxQuantity;

  const handleReverse = async () => {
    if (!issuance) return;

    setError(null);

    if (!isValidQuantity) {
      setError(`Quantity must be between 0 and ${formatQuantity(maxQuantity)}`);
      return;
    }

    setIsReversing(true);

    try {
      const { supabase } = await import('@/lib/supabase');
      const { toast } = await import('sonner');

      const { data, error: rpcError } = await supabase.rpc('reverse_stock_issuance', {
        p_issuance_id: issuance.issuance_id,
        p_quantity_to_reverse: quantityValue,
        p_reason: reason.trim() || null,
      });

      if (rpcError) {
        throw rpcError;
      }

      if (!data || data.length === 0 || !data[0].success) {
        const errorMsg = data?.[0]?.message || 'Failed to reverse issuance';
        throw new Error(errorMsg);
      }

      toast.success(`Successfully reversed ${formatQuantity(quantityValue)} units`);
      onReversed();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Reverse issuance error:', err);
      setError(err.message || 'Failed to reverse issuance');
      const { toast } = await import('sonner');
      toast.error(err.message || 'Failed to reverse issuance');
    } finally {
      setIsReversing(false);
    }
  };

  if (!issuance) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Reverse Stock Issuance
          </DialogTitle>
          <DialogDescription>
            Reverse a stock issuance to bring components back into inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Issuance Details */}
          <div className="rounded-lg border p-4 bg-muted/50">
            <div className="space-y-2">
              <div>
                <span className="text-sm font-medium text-muted-foreground">Component:</span>
                <div className="text-base font-semibold">{issuance.component?.internal_code || 'Unknown'}</div>
                {issuance.component?.description && (
                  <div className="text-sm text-muted-foreground">{issuance.component.description}</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Quantity Issued:</span>
                  <div className="text-base font-semibold">{formatQuantity(issuance.quantity_issued)}</div>
                </div>
                <div>
                  <span className="text-sm font-medium text-muted-foreground">Issuance Date:</span>
                  <div className="text-base font-semibold">
                    {format(new Date(issuance.issuance_date), 'MMM d, yyyy HH:mm')}
                  </div>
                </div>
              </div>
              {issuance.notes && (
                <div className="pt-2">
                  <span className="text-sm font-medium text-muted-foreground">Original Notes:</span>
                  <div className="text-sm">{issuance.notes}</div>
                </div>
              )}
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Quantity Input */}
          <div className="space-y-2">
            <Label htmlFor="quantity-to-reverse">
              Quantity to Reverse <span className="text-muted-foreground">(max: {formatQuantity(maxQuantity)})</span>
            </Label>
            <Input
              id="quantity-to-reverse"
              type="number"
              min="0"
              max={maxQuantity}
              step="0.01"
              value={quantityToReverse}
              onChange={(e) => {
                const value = e.target.value;
                setQuantityToReverse(value);
                setError(null);
              }}
              onBlur={(e) => {
                const value = parseFloat(e.target.value);
                if (value > maxQuantity) {
                  setQuantityToReverse(formatQuantity(maxQuantity));
                } else if (value < 0) {
                  setQuantityToReverse('0');
                }
              }}
              placeholder="Enter quantity to reverse"
              disabled={isReversing}
            />
            <p className="text-xs text-muted-foreground">
              You can reverse up to {formatQuantity(maxQuantity)} units. Partial reversals are allowed.
            </p>
          </div>

          {/* Reason Input */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (Optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for reversal (e.g., 'Returned goods', 'Damaged items', etc.)"
              rows={3}
              disabled={isReversing}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isReversing}>
            Cancel
          </Button>
          <Button
            onClick={handleReverse}
            disabled={isReversing || !isValidQuantity}
            className="min-w-[120px]"
          >
            {isReversing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Reversing...
              </>
            ) : (
              <>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reverse Issuance
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


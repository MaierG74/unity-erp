'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { recordExternalDeliveryNote } from '@/lib/db/internalOrders';
import type { DeliveryOrderDetail } from './CreateDeliveryNoteModal';

interface SelectableLine {
  order_detail_id: number;
  selected: boolean;
  quantity: string;
}

export interface RecordPastelDeliveryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderDetails: DeliveryOrderDetail[];
  onRecorded?: () => void;
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function availableToDeliver(detail: DeliveryOrderDetail): number {
  return Math.max(0, Number(detail.ready_qty || 0) - Number(detail.allocated_delivery_qty || 0));
}

function formatQty(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.001) return Math.round(value).toString();
  return value.toFixed(2);
}

export function RecordPastelDeliveryModal({
  open,
  onOpenChange,
  orderId,
  orderDetails,
  onRecorded,
}: RecordPastelDeliveryModalProps) {
  const [externalRef, setExternalRef] = useState('');
  const [deliveryDate, setDeliveryDate] = useState<string>(todayInputValue());
  const [lines, setLines] = useState<Record<number, SelectableLine>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial: Record<number, SelectableLine> = {};
    for (const detail of orderDetails) {
      const max = availableToDeliver(detail);
      initial[detail.order_detail_id] = {
        order_detail_id: detail.order_detail_id,
        selected: max > 0,
        quantity: max > 0 ? formatQty(max) : '',
      };
    }
    setLines(initial);
    setExternalRef('');
    setDeliveryDate(todayInputValue());
    setSubmitting(false);
  }, [open, orderDetails]);

  const selectedItems = useMemo(
    () =>
      orderDetails
        .map((detail) => ({ detail, line: lines[detail.order_detail_id] }))
        .filter(({ line }) => line?.selected)
        .map(({ detail, line }) => ({
          order_detail_id: detail.order_detail_id,
          quantity: Number(line?.quantity || 0),
        }))
        .filter((item) => item.quantity > 0),
    [orderDetails, lines]
  );

  const hasSelection = selectedItems.length > 0;
  const refIsValid = externalRef.trim().length > 0;

  const setLineSelected = (orderDetailId: number, selected: boolean) => {
    setLines((prev) => ({
      ...prev,
      [orderDetailId]: { ...prev[orderDetailId], selected },
    }));
  };

  const setLineQuantity = (detail: DeliveryOrderDetail, value: string) => {
    const max = availableToDeliver(detail);
    let next = value;
    const parsed = Number(value);
    if (value !== '' && !Number.isNaN(parsed) && parsed > max) {
      next = formatQty(max);
    }
    setLines((prev) => ({
      ...prev,
      [detail.order_detail_id]: { ...prev[detail.order_detail_id], quantity: next },
    }));
  };

  const handleQuantityBlur = (orderDetailId: number) => {
    setLines((prev) => {
      const line = prev[orderDetailId];
      if (!line) return prev;
      if (line.quantity === '') {
        return { ...prev, [orderDetailId]: { ...line, quantity: '0' } };
      }
      return prev;
    });
  };

  const handleRecord = async () => {
    if (!refIsValid) {
      toast.error('Enter the Pastel delivery note number.');
      return;
    }
    if (!hasSelection) {
      toast.error('Select at least one line with a quantity.');
      return;
    }
    setSubmitting(true);
    try {
      await recordExternalDeliveryNote(orderId, externalRef.trim(), selectedItems, deliveryDate || null);
      toast.success('External delivery recorded.');
      onRecorded?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record the external delivery.';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Record external delivery</DialogTitle>
          <DialogDescription className="text-sm">
            Log a delivery note that was raised in Pastel so Unity quantities stay reconciled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* SOURCE */}
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pastel reference
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pastel-ref" className="text-xs text-muted-foreground">
                  Pastel DN number
                </Label>
                <Input
                  id="pastel-ref"
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                  placeholder="e.g. DN-10482"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pastel-date" className="text-xs text-muted-foreground">
                  Delivery date
                </Label>
                <Input
                  id="pastel-date"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </section>

          {/* ITEMS */}
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Items delivered
            </h3>
            {orderDetails.length === 0 ? (
              <p className="text-sm text-muted-foreground">No order lines are available.</p>
            ) : (
              <div className="space-y-3">
                {orderDetails.map((detail) => {
                  const line = lines[detail.order_detail_id];
                  const max = availableToDeliver(detail);
                  const disabled = max <= 0;
                  return (
                    <div
                      key={detail.order_detail_id}
                      className="flex items-start gap-3 rounded-md border border-border/50 bg-background/60 p-3"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-[var(--color-primary,currentColor)]"
                        checked={!!line?.selected}
                        disabled={disabled}
                        onChange={(e) => setLineSelected(detail.order_detail_id, e.target.checked)}
                        aria-label={`Include ${detail.product_name}`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-baseline gap-2">
                          {detail.product_code ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {detail.product_code}
                            </span>
                          ) : null}
                          <span className="truncate text-sm font-medium">{detail.product_name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Available to deliver: {formatQty(max)} ({formatQty(detail.allocated_delivery_qty)} already
                          allocated)
                        </p>
                      </div>
                      <div className="w-24 shrink-0 space-y-1.5">
                        <Label
                          htmlFor={`pastel-qty-${detail.order_detail_id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Qty
                        </Label>
                        <Input
                          id={`pastel-qty-${detail.order_detail_id}`}
                          type="number"
                          min={0}
                          max={max}
                          placeholder="0"
                          value={line?.quantity ?? ''}
                          disabled={disabled || !line?.selected}
                          onChange={(e) => setLineQuantity(detail, e.target.value)}
                          onBlur={() => handleQuantityBlur(detail.order_detail_id)}
                          className="h-8 text-right tabular-nums"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="gap-2 pt-4 sm:gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleRecord} disabled={submitting || !refIsValid || !hasSelection}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {submitting ? 'Recording…' : 'Record delivery'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RecordPastelDeliveryModal;

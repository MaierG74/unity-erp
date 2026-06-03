'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  createManualStockReceipt,
  type ReceiptItemInput,
} from '@/lib/db/internalOrders';

export interface ManualReceiveOrderDetail {
  order_detail_id: number;
  product_name: string;
  quantity: number;
  received_qty: number;
}

export interface ManualReceiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderDetails: ManualReceiveOrderDetail[];
  onReceived?: () => void;
}

export function ManualReceiveModal({
  open,
  onOpenChange,
  orderId,
  orderDetails,
  onReceived,
}: ManualReceiveModalProps) {
  // Only lines that still have outstanding quantity can be received.
  const receivableLines = useMemo(
    () => orderDetails.filter((line) => line.quantity > line.received_qty),
    [orderDetails],
  );

  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQuantities({});
      setNotes('');
      setSubmitting(false);
    }
  }, [open]);

  function remainingFor(line: ManualReceiveOrderDetail): number {
    return Math.max(0, line.quantity - line.received_qty);
  }

  const items: ReceiptItemInput[] = useMemo(
    () =>
      receivableLines
        .map((line) => {
          const raw = quantities[line.order_detail_id];
          const parsed = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
          const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
          return { order_detail_id: line.order_detail_id, quantity };
        })
        .filter((item) => item.quantity > 0),
    [receivableLines, quantities],
  );

  const trimmedNotes = notes.trim();
  const totalToReceive = items.reduce((sum, item) => sum + item.quantity, 0);
  const hasOverReceipt = receivableLines.some((line) => {
    const raw = quantities[line.order_detail_id];
    const parsed = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
    return Number.isFinite(parsed) && parsed > remainingFor(line);
  });
  const isValid = items.length > 0 && trimmedNotes.length > 0;

  function setQty(orderDetailId: number, value: string) {
    setQuantities((current) => ({ ...current, [orderDetailId]: value }));
  }

  async function handleSubmit() {
    if (items.length === 0) {
      toast.error('Enter at least one quantity to receive');
      return;
    }
    if (!trimmedNotes) {
      toast.error('Notes are required for a manual receipt');
      return;
    }

    setSubmitting(true);
    try {
      await createManualStockReceipt(orderId, items, trimmedNotes);
      toast.success('Stock received', {
        description: `${totalToReceive} unit${totalToReceive === 1 ? '' : 's'} received manually`,
      });
      onReceived?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to receive stock';
      toast.error('Could not receive stock', { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            Receive Manually
          </DialogTitle>
          <DialogDescription>
            Check stock in against this internal order without a drafted receipt. Quantities cannot exceed the
            outstanding amount per line.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Outstanding Lines</h3>
            <div className="rounded-md border border-border/50 bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right w-[130px]">Receive</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivableLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        Every line on this order has already been received.
                      </TableCell>
                    </TableRow>
                  ) : (
                    receivableLines.map((line) => {
                      const remaining = remainingFor(line);
                      const raw = quantities[line.order_detail_id];
                      const parsed = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
                      const over = Number.isFinite(parsed) && parsed > remaining;
                      return (
                        <TableRow key={line.order_detail_id}>
                          <TableCell className="text-sm">{line.product_name}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {line.quantity}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {line.received_qty}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums font-medium">{remaining}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              max={remaining}
                              step="1"
                              className={`h-9 text-right tabular-nums ${over ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                              value={quantities[line.order_detail_id] ?? ''}
                              placeholder="0"
                              onChange={(event) => setQty(line.order_detail_id, event.target.value)}
                              onBlur={() => {
                                if ((quantities[line.order_detail_id] ?? '').trim() === '') {
                                  setQty(line.order_detail_id, '0');
                                }
                              }}
                              aria-label={`Quantity to receive for ${line.product_name}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {hasOverReceipt && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600">
                One or more lines exceed the outstanding quantity. Reduce them before receiving.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</h3>
            <div className="space-y-1.5">
              <Label htmlFor="manual-receive-notes" className="text-xs text-muted-foreground">
                Reason / Reference <span className="text-red-600">*</span>
              </Label>
              <Textarea
                id="manual-receive-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Why is stock being received manually? (e.g. delivery note ref, partial drop)"
              />
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-border/50 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || hasOverReceipt || submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Receive Stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

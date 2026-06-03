'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, PackageCheck } from 'lucide-react';
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
  confirmStockReceipt,
  type ReceiptItemInput,
  type StockReceipt,
} from '@/lib/db/internalOrders';

export interface ConfirmReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: StockReceipt;
  productNamesById?: Record<number, string>;
  onConfirmed?: () => void;
}

export function ConfirmReceiptModal({
  open,
  onOpenChange,
  receipt,
  productNamesById,
  onConfirmed,
}: ConfirmReceiptModalProps) {
  const items = useMemo(() => receipt.items ?? [], [receipt.items]);

  // Keyed by order_detail_id so the edited value maps cleanly to the RPC input.
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      const next: Record<number, string> = {};
      for (const item of items) {
        next[item.order_detail_id] = String(item.quantity);
      }
      setQuantities(next);
      setNotes(receipt.notes ?? '');
      setSubmitting(false);
    }
  }, [open, items, receipt.notes]);

  const editedItems: ReceiptItemInput[] = useMemo(
    () =>
      items.map((item) => {
        const raw = quantities[item.order_detail_id];
        const parsed = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
        const quantity = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        return { order_detail_id: item.order_detail_id, quantity };
      }),
    [items, quantities],
  );

  const hasReduction = useMemo(
    () =>
      items.some((item) => {
        const edited = editedItems.find((e) => e.order_detail_id === item.order_detail_id);
        return edited != null && edited.quantity < item.quantity;
      }),
    [items, editedItems],
  );

  const totalToConfirm = editedItems.reduce((sum, e) => sum + e.quantity, 0);
  const isValid = items.length > 0 && totalToConfirm > 0;

  function setQty(orderDetailId: number, value: string) {
    setQuantities((current) => ({ ...current, [orderDetailId]: value }));
  }

  async function handleConfirm() {
    if (!isValid) {
      toast.error('Enter at least one quantity to confirm');
      return;
    }

    setSubmitting(true);
    try {
      await confirmStockReceipt(receipt.stock_receipt_id, editedItems);
      toast.success('Receipt confirmed', {
        description: `${totalToConfirm} unit${totalToConfirm === 1 ? '' : 's'} received into stock`,
      });
      onConfirmed?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to confirm receipt';
      toast.error('Could not confirm receipt', { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  function productName(productId: number, orderDetailId: number): string {
    return productNamesById?.[productId] ?? `Product ${productId} · line ${orderDetailId}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Confirm Receipt
          </DialogTitle>
          <DialogDescription>
            Confirm the quantities received for draft receipt{' '}
            <span className="font-medium text-foreground">{receipt.receipt_number}</span>. Adjust any line that arrived
            short.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lines</h3>
            <div className="rounded-md border border-border/50 bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Drafted</TableHead>
                    <TableHead className="text-right w-[140px]">Receive</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        This draft has no items to confirm.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => (
                      <TableRow key={item.order_detail_id}>
                        <TableCell className="text-sm">
                          {productName(item.product_id, item.order_detail_id)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            className="h-9 text-right tabular-nums"
                            value={quantities[item.order_detail_id] ?? ''}
                            placeholder="0"
                            onChange={(event) => setQty(item.order_detail_id, event.target.value)}
                            onBlur={() => {
                              if ((quantities[item.order_detail_id] ?? '').trim() === '') {
                                setQty(item.order_detail_id, '0');
                              }
                            }}
                            aria-label={`Quantity received for ${productName(item.product_id, item.order_detail_id)}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {hasReduction && (
              <p className="rounded-md border border-border/50 bg-background px-3 py-2 text-xs text-muted-foreground">
                Any remaining unconfirmed quantity will re-arm as a new draft receipt so it can be checked in later.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</h3>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-receipt-notes" className="text-xs text-muted-foreground">
                Draft Notes
              </Label>
              <Textarea
                id="confirm-receipt-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="No notes recorded on this draft."
                readOnly
                className="resize-none bg-background text-muted-foreground"
              />
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-border/50 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!isValid || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CreditCard, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import FileDropField from '@/components/features/purchasing/FileDropField';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  recordPurchaseOrderPayment,
  type PaymentMethod,
} from '@/lib/db/purchase-order-invoices';
import type { PurchaseOrderInvoice } from '@/types/purchasing';

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrderId: number;
  invoiceId: string | null;
  suggestedAmount?: number | null;
  initialFile?: File | null;
  onRecorded?: (invoice: PurchaseOrderInvoice) => void;
}

export default function RecordPaymentDialog({
  open,
  onOpenChange,
  purchaseOrderId,
  invoiceId,
  suggestedAmount,
  initialFile,
  onRecorded,
}: RecordPaymentDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [method, setMethod] = useState<PaymentMethod>('eft');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(initialFile ?? null);
      setAmount(suggestedAmount != null ? String(suggestedAmount) : '');
      setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
      setMethod('eft');
      setReference('');
      setNote('');
      setSubmitting(false);
    }
  }, [open, initialFile, suggestedAmount]);

  const handleSubmit = async () => {
    const parsedAmount = Number(amount);
    if (!invoiceId) {
      toast({
        title: 'Missing invoice',
        description: 'This payment card is not linked to an invoice.',
        variant: 'destructive',
      });
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Enter an amount greater than zero.',
        variant: 'destructive',
      });
      return;
    }
    if (!paymentDate) {
      toast({
        title: 'Payment date required',
        description: 'Select the date the payment was made.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const invoice = await recordPurchaseOrderPayment({
        invoiceId,
        purchaseOrderId,
        amountPaid: parsedAmount,
        paymentDate,
        paymentMethod: method,
        paymentReference: reference.trim() || null,
        popFile: file,
        note: note.trim() || null,
      });
      toast({
        title: 'Payment recorded',
        description: 'Payment status moved to Awaiting POP.',
      });
      onRecorded?.(invoice);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to record payment:', error);
      toast({
        title: 'Could not record payment',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record supplier payment</DialogTitle>
          <DialogDescription>
            Capture the payment details and attach the proof of payment when it
            is available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              Payment details
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="payment-amount">Amount paid</Label>
                <Input
                  id="payment-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-date">Payment date</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label id="payment-method-label">Method</Label>
                <Select
                  value={method}
                  onValueChange={(value) => setMethod(value as PaymentMethod)}
                  disabled={submitting}
                >
                  <SelectTrigger aria-labelledby="payment-method-label">
                    <SelectValue placeholder="Payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eft">EFT</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-reference">Reference</Label>
                <Input
                  id="payment-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Bank reference"
                  disabled={submitting}
                />
              </div>
            </div>
          </div>

          <FileDropField
            file={file}
            onFile={setFile}
            hint="Drop proof of payment here or click to browse (optional, max 10MB)"
            disabled={submitting}
          />

          <div className="space-y-1.5">
            <Label htmlFor="payment-note">Note</Label>
            <Textarea
              id="payment-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional internal note"
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!invoiceId || submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

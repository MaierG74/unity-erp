'use client';

import { useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileText, Loader2, UploadCloud, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { useToast } from '@/components/ui/use-toast';
import { recordPurchaseOrderInvoice } from '@/lib/db/purchase-order-invoices';
import type { PurchaseOrderInvoice } from '@/types/purchasing';

interface RecordInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrderId: number;
  /** Pre-fills the amount field (e.g. the finance board's derived estimate). */
  suggestedAmount?: number | null;
  /** When opened from a drag-drop, the already-dropped file. */
  initialFile?: File | null;
  /** Called with the recorded invoice so the caller can invalidate / optimistically update. */
  onRecorded?: (invoice: PurchaseOrderInvoice) => void;
}

export const INVOICE_FILE_ACCEPT = {
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
};

export default function RecordInvoiceDialog({
  open,
  onOpenChange,
  purchaseOrderId,
  suggestedAmount,
  initialFile,
  onRecorded,
}: RecordInvoiceDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset each time the dialog opens; seed from the drop file / suggested amount.
  useEffect(() => {
    if (open) {
      setFile(initialFile ?? null);
      setInvoiceNumber('');
      setInvoiceDate('');
      setAmount(suggestedAmount != null ? String(suggestedAmount) : '');
      setSubmitting(false);
    }
  }, [open, initialFile, suggestedAmount]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted: File[]) => {
      if (accepted.length > 0) setFile(accepted[0]);
    },
    accept: INVOICE_FILE_ACCEPT,
    multiple: false,
    maxSize: 10 * 1024 * 1024,
    disabled: submitting,
  });

  const handleSubmit = async () => {
    if (!file) return;
    const parsedAmount = amount.trim() === '' ? null : Number(amount);
    if (parsedAmount != null && Number.isNaN(parsedAmount)) {
      toast({ title: 'Invalid amount', description: 'Enter a valid number.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const invoice = await recordPurchaseOrderInvoice({
        file,
        purchaseOrderId,
        invoiceNumber: invoiceNumber.trim() || null,
        invoiceDate: invoiceDate || null,
        invoiceAmount: parsedAmount,
      });
      toast({ title: 'Invoice recorded', description: 'Payment status moved to Awaiting payment.' });
      onRecorded?.(invoice);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to record invoice:', error);
      toast({
        title: 'Could not record invoice',
        description: error instanceof Error ? error.message : 'Please try again.',
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record supplier invoice</DialogTitle>
          <DialogDescription>
            Upload the invoice and capture its details. This moves the PO to “Awaiting payment”.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {file ? (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{file.name}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFile(null)}
                disabled={submitting}
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-sm transition-colors ${
                isDragActive ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
              }`}
            >
              <input {...getInputProps()} />
              <UploadCloud className="h-6 w-6 text-muted-foreground" />
              <span className="text-muted-foreground">
                Drop the invoice here or click to browse (PDF, image, doc — max 10MB)
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="invoice-number">Invoice number</Label>
              <Input
                id="invoice-number"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="e.g. INV-10234"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-date">Invoice date</Label>
              <Input
                id="invoice-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-amount">Amount</Label>
              <Input
                id="invoice-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                disabled={submitting}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Invoice number, date and amount are optional but help Accounts pay accurately.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!file || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

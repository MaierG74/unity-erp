'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDropzone } from 'react-dropzone';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Mail,
  ReceiptText,
  UploadCloud,
} from 'lucide-react';

import { useAuth } from '@/components/common/auth-provider';
import RecordInvoiceDialog, {
  INVOICE_FILE_ACCEPT,
} from '@/components/features/purchasing/RecordInvoiceDialog';
import RecordPaymentDialog from '@/components/features/purchasing/RecordPaymentDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { useModuleAccess } from '@/lib/hooks/use-module-access';
import { formatCurrency } from '@/lib/format-utils';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { markPopSent, signOffPayment } from '@/lib/db/purchase-order-invoices';
import type {
  FinancePaymentCard,
  PurchaseOrderInvoice,
} from '@/types/purchasing';

type FinanceCard = FinancePaymentCard;

type FinanceResponse = {
  groups: Record<FinanceCard['payment_status'], FinanceCard[]>;
  total: number;
  caller_can_authorise: boolean;
};

const QUERY_KEY = ['finance', 'pending-supplier-payments'] as const;

const GROUPS: Array<{
  key: FinanceCard['payment_status'];
  title: string;
  empty: string;
  icon: typeof FileText;
}> = [
  {
    key: 'awaiting_invoice',
    title: 'Awaiting invoice',
    empty: 'No cash-supplier POs are waiting for an invoice.',
    icon: FileText,
  },
  {
    key: 'awaiting_payment',
    title: 'Awaiting payment',
    empty: 'No supplier invoices are waiting for payment.',
    icon: Clock,
  },
  {
    key: 'awaiting_pop',
    title: 'Awaiting POP',
    empty: 'No paid supplier invoices are waiting for proof of payment.',
    icon: ReceiptText,
  },
];

function formatQNumber(qNumber: string | null, purchaseOrderId: number) {
  if (!qNumber) return `PO #${purchaseOrderId}`;
  return qNumber.startsWith('Q') ? qNumber : `Q${qNumber}`;
}

function PendingPaymentCard({ item }: { item: FinanceCard }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <Link
        href={`/purchasing/purchase-orders/${item.purchase_order_id}`}
        className="block transition-colors hover:text-primary"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium leading-none">
              {formatQNumber(item.q_number, item.purchase_order_id)}
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {item.supplier_name}
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {item.age_days}d
          </Badge>
        </div>
      </Link>
      <div className="mt-3 text-lg font-semibold">
        {formatCurrency(item.amount)}
      </div>
    </div>
  );
}

/**
 * Awaiting-invoice cards accept an invoice file dropped straight onto them.
 * noClick/noKeyboard keep the inner Link navigable; only the drag gesture is captured.
 */
function InvoiceDropCard({
  item,
  onDropInvoice,
}: {
  item: FinanceCard;
  onDropInvoice: (item: FinanceCard, file: File) => void;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted: File[]) => {
      if (accepted.length > 0) onDropInvoice(item, accepted[0]);
    },
    accept: INVOICE_FILE_ACCEPT,
    multiple: false,
    maxSize: 10 * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />
      <PendingPaymentCard item={item} />
      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-primary">
          <UploadCloud className="h-5 w-5" />
          Drop invoice to record
        </div>
      )}
    </div>
  );
}

function PaymentDropCard({
  item,
  onRecordPayment,
  onDropPayment,
}: {
  item: FinanceCard;
  onRecordPayment: (item: FinanceCard) => void;
  onDropPayment: (item: FinanceCard, file: File) => void;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted: File[]) => {
      if (accepted.length > 0) onDropPayment(item, accepted[0]);
    },
    accept: INVOICE_FILE_ACCEPT,
    multiple: false,
    maxSize: 10 * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div {...getRootProps()} className="relative rounded-md border bg-card p-3">
      <input {...getInputProps()} />
      <Link
        href={`/purchasing/purchase-orders/${item.purchase_order_id}`}
        className="block transition-colors hover:text-primary"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium leading-none">
              {formatQNumber(item.q_number, item.purchase_order_id)}
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {item.supplier_name}
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {item.age_days}d
          </Badge>
        </div>
      </Link>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-lg font-semibold">
          {formatCurrency(item.amount)}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => onRecordPayment(item)}
          disabled={!item.invoice_id}
        >
          Record payment
        </Button>
      </div>
      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-primary">
          <UploadCloud className="h-5 w-5" />
          Drop POP to record payment
        </div>
      )}
    </div>
  );
}

function AwaitingPopCard({
  item,
  callerCanAuthorise,
  signingOff,
  markingSent,
  sendingPop,
  onSignOff,
  onMarkSent,
  onSendPop,
}: {
  item: FinanceCard;
  callerCanAuthorise: boolean;
  signingOff: boolean;
  markingSent: boolean;
  sendingPop: boolean;
  onSignOff: (item: FinanceCard) => void;
  onMarkSent: (item: FinanceCard) => void;
  onSendPop: (item: FinanceCard) => void;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <Link
        href={`/purchasing/purchase-orders/${item.purchase_order_id}`}
        className="block transition-colors hover:text-primary"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium leading-none">
              {formatQNumber(item.q_number, item.purchase_order_id)}
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {item.supplier_name}
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0">
            {item.age_days}d
          </Badge>
        </div>
      </Link>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-lg font-semibold">
          {formatCurrency(item.amount)}
        </div>
        <Badge
          variant={item.signed_off_at ? 'default' : 'outline'}
          className="shrink-0 gap-1"
        >
          {item.signed_off_at && <CheckCircle2 className="h-3 w-3" />}
          {item.signed_off_at ? 'Signed off' : 'Awaiting sign-off'}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {callerCanAuthorise && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onSignOff(item)}
            disabled={
              !item.invoice_id || Boolean(item.signed_off_at) || signingOff
            }
          >
            {signingOff && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign off
          </Button>
        )}
        {item.pop_attachment_id && (
          <Button
            type="button"
            size="sm"
            onClick={() => onSendPop(item)}
            disabled={!item.invoice_id || sendingPop || markingSent}
          >
            {sendingPop ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Mail className="mr-2 h-4 w-4" />
            )}
            Send POP
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant={item.pop_attachment_id ? 'outline' : 'default'}
          onClick={() => onMarkSent(item)}
          disabled={!item.invoice_id || markingSent || sendingPop}
        >
          {markingSent && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Mark sent
        </Button>
      </div>
    </div>
  );
}

function MarkSentDialog({
  item,
  open,
  submitting,
  onOpenChange,
  onConfirm,
}: {
  item: FinanceCard | null;
  open: boolean;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  const noteRequired = !item?.pop_attachment_id;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark POP sent</DialogTitle>
          <DialogDescription>
            {noteRequired
              ? 'Add a note explaining why this payment is being closed without a POP attachment.'
              : 'Add an optional note before closing this payment.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="mark-pop-sent-note">Note</Label>
          <Textarea
            id="mark-pop-sent-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              noteRequired ? 'Reason required' : 'Optional internal note'
            }
            disabled={submitting}
          />
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
            onClick={() => onConfirm(note)}
            disabled={submitting || (noteRequired && !note.trim())}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Mark sent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function fetchPendingSupplierPayments(): Promise<FinanceResponse> {
  const response = await authorizedFetch(
    '/api/finance/pending-supplier-payments',
    {
      headers: { Accept: 'application/json' },
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.error ?? 'Failed to load pending supplier payments',
    );
  }

  return response.json();
}

export default function FinancePage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: financeAccess, isLoading: financeAccessLoading } =
    useModuleAccess(MODULE_KEYS.FINANCE);
  const [dialogState, setDialogState] = useState<{
    item: FinanceCard | null;
    file: File | null;
  }>({
    item: null,
    file: null,
  });
  const [paymentDialogState, setPaymentDialogState] = useState<{
    item: FinanceCard | null;
    file: File | null;
  }>({ item: null, file: null });
  const [markSentItem, setMarkSentItem] = useState<FinanceCard | null>(null);
  const [signingOffInvoiceId, setSigningOffInvoiceId] = useState<string | null>(
    null,
  );
  const [markingSentInvoiceId, setMarkingSentInvoiceId] = useState<
    string | null
  >(null);
  const [sendingPopInvoiceId, setSendingPopInvoiceId] = useState<string | null>(
    null,
  );

  const { data, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPendingSupplierPayments,
    enabled: !!user && financeAccess?.allowed === true,
    staleTime: 30_000,
  });

  // Move the card awaiting_invoice -> awaiting_payment the instant the record succeeds,
  // then invalidate so the server view reconciles. (The dialog is modal and awaits the
  // write, so a pre-success optimistic move would not be visible behind it.)
  const handleRecorded = (item: FinanceCard, invoice: PurchaseOrderInvoice) => {
    queryClient.setQueryData<FinanceResponse>(QUERY_KEY, (prev) => {
      if (!prev) return prev;
      const moved: FinanceCard = {
        ...item,
        payment_status: 'awaiting_payment',
        amount:
          invoice.invoice_amount != null
            ? Number(invoice.invoice_amount)
            : item.amount,
      };
      return {
        ...prev,
        groups: {
          ...prev.groups,
          awaiting_invoice: prev.groups.awaiting_invoice.filter(
            (card) => card.purchase_order_id !== item.purchase_order_id,
          ),
          awaiting_payment: [moved, ...prev.groups.awaiting_payment],
        },
      };
    });
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const handlePaymentRecorded = (
    item: FinanceCard,
    invoice: PurchaseOrderInvoice,
  ) => {
    queryClient.setQueryData<FinanceResponse>(QUERY_KEY, (prev) => {
      if (!prev) return prev;
      const moved: FinanceCard = {
        ...item,
        invoice_id: invoice.id,
        payment_status: 'awaiting_pop',
        amount:
          invoice.amount_paid != null
            ? Number(invoice.amount_paid)
            : item.amount,
        paid_at: invoice.paid_at,
        signed_off_at: invoice.signed_off_at,
        pop_attachment_id: invoice.pop_attachment_id,
      };
      return {
        ...prev,
        groups: {
          ...prev.groups,
          awaiting_payment: prev.groups.awaiting_payment.filter(
            (card) => card.purchase_order_id !== item.purchase_order_id,
          ),
          awaiting_pop: [moved, ...prev.groups.awaiting_pop],
        },
      };
    });
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const updateAwaitingPopCard = (invoice: PurchaseOrderInvoice) => {
    queryClient.setQueryData<FinanceResponse>(QUERY_KEY, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        groups: {
          ...prev.groups,
          awaiting_pop: prev.groups.awaiting_pop.map((card) =>
            card.invoice_id === invoice.id
              ? {
                  ...card,
                  paid_at: invoice.paid_at,
                  signed_off_at: invoice.signed_off_at,
                  pop_attachment_id: invoice.pop_attachment_id,
                }
              : card,
          ),
        },
      };
    });
  };

  const handleSignOff = async (item: FinanceCard) => {
    if (!item.invoice_id) return;
    setSigningOffInvoiceId(item.invoice_id);
    try {
      const invoice = await signOffPayment(item.invoice_id, null);
      updateAwaitingPopCard(invoice);
      toast({
        title: 'Payment signed off',
        description: 'The owner/admin sign-off is recorded.',
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (error) {
      console.error('Failed to sign off payment:', error);
      toast({
        title: 'Could not sign off payment',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSigningOffInvoiceId(null);
    }
  };

  const closeAwaitingPopCard = (item: FinanceCard) => {
    queryClient.setQueryData<FinanceResponse>(QUERY_KEY, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        total: Math.max(0, prev.total - 1),
        groups: {
          ...prev.groups,
          awaiting_pop: prev.groups.awaiting_pop.filter(
            (card) => card.invoice_id !== item.invoice_id,
          ),
        },
      };
    });
  };

  const handleSendPop = async (item: FinanceCard) => {
    if (!item.invoice_id || !item.pop_attachment_id) return;
    setSendingPopInvoiceId(item.invoice_id);
    try {
      const response = await authorizedFetch('/api/send-pop-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          purchase_order_id: item.purchase_order_id,
          invoice_id: item.invoice_id,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to send POP email');
      }

      // The supplier email is out the door from here on. If closing fails,
      // do NOT invite a retry of the send — that would email a duplicate.
      try {
        await markPopSent(item.invoice_id, item.pop_attachment_id, null);
      } catch (closeError) {
        console.error('POP email sent but closing failed:', closeError);
        toast({
          title: 'POP emailed, but closing failed',
          description:
            'The supplier HAS received the email — do not send again. Use "Mark sent" to close the card.',
          variant: 'destructive',
        });
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        return;
      }
      closeAwaitingPopCard(item);
      toast({
        title: 'POP sent',
        description: 'The supplier has been emailed and the payment is closed.',
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (error) {
      console.error('Failed to send POP email:', error);
      toast({
        title: 'Could not send POP',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSendingPopInvoiceId(null);
    }
  };

  const handleMarkSent = async (item: FinanceCard, note: string | null) => {
    if (!item.invoice_id) return;
    setMarkingSentInvoiceId(item.invoice_id);
    try {
      await markPopSent(item.invoice_id, item.pop_attachment_id, note);
      closeAwaitingPopCard(item);
      toast({
        title: 'POP marked sent',
        description: 'The payment is closed and removed from the board.',
      });
      setMarkSentItem(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (error) {
      console.error('Failed to mark POP sent:', error);
      toast({
        title: 'Could not mark POP sent',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setMarkingSentInvoiceId(null);
    }
  };

  if (loading) return null;
  if (!user) return null;

  if (financeAccessLoading) {
    return (
      <div className="space-y-5 p-6 pt-5">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <Skeleton className="h-5 w-36" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!financeAccess?.allowed) {
    return (
      <div className="p-6 pt-5">
        <div className="rounded-md border border-dashed p-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Finance unavailable
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            The finance module is not enabled for your organization. Supplier
            payment workflows stay hidden until this tenant is entitled.
          </p>
        </div>
      </div>
    );
  }

  const groups = data?.groups;

  return (
    <div className="space-y-5 p-6 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Finance — Pending supplier payments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cash supplier POs grouped by invoice and payment state. Drop
            invoices or POP files onto matching cards to record the next step.
          </p>
        </div>
        <Badge variant="outline">{data?.total ?? 0} open</Badge>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load finance queue</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : 'Please try again.'}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {GROUPS.map((group) => {
          const Icon = group.icon;
          const items = groups?.[group.key] ?? [];

          return (
            <Card key={group.key}>
              <CardHeader className="space-y-0 pb-3">
                <CardTitle className="flex items-center justify-between gap-3 text-base">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {group.title}
                  </span>
                  <Badge variant="secondary">{items.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="rounded-md border bg-card p-3">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="mt-2 h-4 w-36" />
                      <Skeleton className="mt-3 h-6 w-20" />
                    </div>
                  ))
                ) : items.length > 0 ? (
                  items.map((item) =>
                    group.key === 'awaiting_invoice' ? (
                      <InvoiceDropCard
                        key={item.purchase_order_id}
                        item={item}
                        onDropInvoice={(card, file) =>
                          setDialogState({ item: card, file })
                        }
                      />
                    ) : group.key === 'awaiting_payment' ? (
                      <PaymentDropCard
                        key={item.purchase_order_id}
                        item={item}
                        onRecordPayment={(card) =>
                          setPaymentDialogState({ item: card, file: null })
                        }
                        onDropPayment={(card, file) =>
                          setPaymentDialogState({ item: card, file })
                        }
                      />
                    ) : group.key === 'awaiting_pop' ? (
                      <AwaitingPopCard
                        key={item.purchase_order_id}
                        item={item}
                        callerCanAuthorise={Boolean(data?.caller_can_authorise)}
                        signingOff={signingOffInvoiceId === item.invoice_id}
                        markingSent={markingSentInvoiceId === item.invoice_id}
                        sendingPop={sendingPopInvoiceId === item.invoice_id}
                        onSignOff={handleSignOff}
                        onSendPop={handleSendPop}
                        onMarkSent={(card) => {
                          if (card.pop_attachment_id) {
                            handleMarkSent(card, null);
                          } else {
                            setMarkSentItem(card);
                          }
                        }}
                      />
                    ) : (
                      <PendingPaymentCard
                        key={item.purchase_order_id}
                        item={item}
                      />
                    ),
                  )
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    {group.empty}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <RecordInvoiceDialog
        open={dialogState.item !== null}
        onOpenChange={(next) => {
          if (!next) setDialogState({ item: null, file: null });
        }}
        purchaseOrderId={dialogState.item?.purchase_order_id ?? 0}
        suggestedAmount={dialogState.item?.amount ?? null}
        initialFile={dialogState.file}
        onRecorded={(invoice) => {
          if (dialogState.item) handleRecorded(dialogState.item, invoice);
        }}
      />
      <RecordPaymentDialog
        open={paymentDialogState.item !== null}
        onOpenChange={(next) => {
          if (!next) setPaymentDialogState({ item: null, file: null });
        }}
        purchaseOrderId={paymentDialogState.item?.purchase_order_id ?? 0}
        invoiceId={paymentDialogState.item?.invoice_id ?? null}
        suggestedAmount={paymentDialogState.item?.amount ?? null}
        initialFile={paymentDialogState.file}
        onRecorded={(invoice) => {
          if (paymentDialogState.item)
            handlePaymentRecorded(paymentDialogState.item, invoice);
        }}
      />
      <MarkSentDialog
        item={markSentItem}
        open={markSentItem !== null}
        submitting={markingSentInvoiceId === markSentItem?.invoice_id}
        onOpenChange={(next) => {
          if (!next) setMarkSentItem(null);
        }}
        onConfirm={(note) => {
          if (markSentItem) handleMarkSent(markSentItem, note.trim() || null);
        }}
      />
    </div>
  );
}

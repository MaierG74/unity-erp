'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  FileInput,
  Printer,
  PenLine,
  Ban,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  fetchDeliveryNotes,
  markDeliveryNoteSigned,
  cancelDeliveryNote,
  type OrderDeliveryNote,
  type DeliveryNoteStatus,
  type OrderType,
} from '@/lib/db/internalOrders';
import {
  CreateDeliveryNoteModal,
  openDeliveryNotePdf,
  type DeliveryOrderDetail,
} from './CreateDeliveryNoteModal';
import { RecordPastelDeliveryModal } from './RecordPastelDeliveryModal';

export interface DeliveryNotesTabProps {
  orderId: number;
  orderType: OrderType;
}

interface OrderDetailRow {
  order_detail_id: number;
  product_id: number;
  quantity: number;
  product_code: string | null;
  product_name: string;
}

const STATUS_BADGE: Record<DeliveryNoteStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'destructive' | 'outline' }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  printed: { label: 'Printed', variant: 'default' },
  signed: { label: 'Signed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

function formatQty(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.001) return Math.round(value).toString();
  return value.toFixed(2);
}

function formatDateDisplay(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: '2-digit' });
}

function noteSourceLabel(note: OrderDeliveryNote): string {
  if (note.source === 'pastel') {
    return `External (Pastel: ${note.external_reference ?? '—'})`;
  }
  return note.note_number ?? `DN-${note.order_delivery_note_id}`;
}

async function fetchOrderDetailRows(orderId: number): Promise<OrderDetailRow[]> {
  const { data, error } = await supabase
    .from('order_details')
    .select('order_detail_id, product_id, quantity, products(internal_code, name)')
    .eq('order_id', orderId)
    .order('order_detail_id', { ascending: true });
  if (error) throw error;
  return ((data as any[]) ?? []).map((row) => {
    // Nested relations can be null under RLS — never assume the embedded product exists.
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      order_detail_id: row.order_detail_id as number,
      product_id: row.product_id as number,
      quantity: Number(row.quantity ?? 0),
      product_code: (product?.internal_code as string) ?? null,
      product_name: (product?.name as string) ?? `Product ${row.product_id}`,
    } satisfies OrderDetailRow;
  });
}

export function DeliveryNotesTab({ orderId, orderType }: DeliveryNotesTabProps) {
  const queryClient = useQueryClient();
  const isCustomerOrder = orderType === 'customer';

  const [createOpen, setCreateOpen] = useState(false);
  const [pastelOpen, setPastelOpen] = useState(false);

  // Sign dialog state
  const [signNote, setSignNote] = useState<OrderDeliveryNote | null>(null);
  const [signedBy, setSignedBy] = useState('');
  const [signing, setSigning] = useState(false);

  // Cancel dialog state
  const [cancelNote, setCancelNote] = useState<OrderDeliveryNote | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const [printingId, setPrintingId] = useState<number | null>(null);

  const notesQueryKey = ['delivery-notes', orderId] as const;
  const detailsQueryKey = ['order-delivery-details', orderId] as const;

  const {
    data: notes = [],
    isLoading: notesLoading,
    isError: notesError,
  } = useQuery({
    queryKey: notesQueryKey,
    queryFn: () => fetchDeliveryNotes(orderId),
    enabled: !!orderId,
  });

  const { data: detailRows = [] } = useQuery({
    queryKey: detailsQueryKey,
    queryFn: () => fetchOrderDetailRows(orderId),
    enabled: !!orderId,
  });

  // Quantity already committed to non-cancelled delivery notes, per order detail.
  const allocatedByDetail = useMemo(() => {
    const map = new Map<number, number>();
    for (const note of notes) {
      if (note.status === 'cancelled') continue;
      for (const item of note.items ?? []) {
        map.set(item.order_detail_id, (map.get(item.order_detail_id) ?? 0) + Number(item.quantity || 0));
      }
    }
    return map;
  }, [notes]);

  // Build the DeliveryOrderDetail[] the modals + PDF expect. ready_qty defaults to the
  // ordered quantity (no separate production-ready view exists yet in this module).
  const orderDetails: DeliveryOrderDetail[] = useMemo(
    () =>
      detailRows.map((row) => ({
        order_detail_id: row.order_detail_id,
        product_code: row.product_code,
        product_name: row.product_name,
        quantity: row.quantity,
        ready_qty: row.quantity,
        allocated_delivery_qty: allocatedByDetail.get(row.order_detail_id) ?? 0,
      })),
    [detailRows, allocatedByDetail]
  );

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: notesQueryKey });
    queryClient.invalidateQueries({ queryKey: detailsQueryKey });
  };

  const handlePrint = async (note: OrderDeliveryNote) => {
    setPrintingId(note.order_delivery_note_id);
    try {
      await openDeliveryNotePdf({ orderId, note, orderDetails });
      toast.success('Delivery note opened.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate the PDF.';
      toast.error(message);
    } finally {
      setPrintingId(null);
    }
  };

  const openSignDialog = (note: OrderDeliveryNote) => {
    setSignNote(note);
    setSignedBy(note.signed_by ?? '');
  };

  const handleSign = async () => {
    if (!signNote) return;
    if (!signedBy.trim()) {
      toast.error('Enter who signed for the delivery.');
      return;
    }
    setSigning(true);
    try {
      await markDeliveryNoteSigned(signNote.order_delivery_note_id, signedBy.trim());
      toast.success('Delivery note marked as signed.');
      setSignNote(null);
      setSignedBy('');
      refetchAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark as signed.';
      toast.error(message);
    } finally {
      setSigning(false);
    }
  };

  const openCancelDialog = (note: OrderDeliveryNote) => {
    setCancelNote(note);
    setCancelReason('');
  };

  const handleCancel = async () => {
    if (!cancelNote) return;
    const reasonRequired = cancelNote.status === 'signed';
    if (reasonRequired && !cancelReason.trim()) {
      toast.error('A reason is required to cancel a signed delivery note.');
      return;
    }
    setCancelling(true);
    try {
      await cancelDeliveryNote(cancelNote.order_delivery_note_id, cancelReason.trim() || null);
      toast.success('Delivery note cancelled.');
      setCancelNote(null);
      setCancelReason('');
      refetchAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel the delivery note.';
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Delivery notes</h2>
          <p className="text-sm text-muted-foreground">
            {isCustomerOrder
              ? 'Generate Unity delivery notes or record deliveries raised in Pastel.'
              : 'Delivery notes apply to customer orders.'}
          </p>
        </div>
        {isCustomerOrder ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPastelOpen(true)}>
              <FileInput className="mr-2 h-4 w-4" />
              Record external delivery
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create delivery note
            </Button>
          </div>
        ) : null}
      </div>

      {/* List */}
      {notesLoading ? (
        <div className="flex items-center justify-center rounded-lg border border-border/50 py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading delivery notes…
        </div>
      ) : notesError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load delivery notes.
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-12 text-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No delivery notes yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => {
            const badge = STATUS_BADGE[note.status] ?? STATUS_BADGE.draft;
            const itemCount = note.items?.length ?? 0;
            const totalQty = (note.items ?? []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            const isCancelled = note.status === 'cancelled';
            const isUnity = note.source === 'unity';
            const isPrinting = printingId === note.order_delivery_note_id;
            return (
              <li
                key={note.order_delivery_note_id}
                className="flex flex-col gap-3 rounded-lg border border-border/50 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/orders/${orderId}/delivery-notes/${note.order_delivery_note_id}`}
                      className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    >
                      {note.source === 'pastel' ? (
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {noteSourceLabel(note)}
                    </Link>
                    <Badge variant={badge.variant} className="text-xs">
                      {badge.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDateDisplay(note.delivery_date)} · {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
                    {formatQty(totalQty)} units
                    {note.signed_by ? ` · signed by ${note.signed_by}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isUnity ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePrint(note)}
                      disabled={isPrinting || isCancelled}
                    >
                      {isPrinting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Printer className="mr-2 h-4 w-4" />
                      )}
                      Print
                    </Button>
                  ) : null}
                  {!isCancelled && note.status !== 'signed' ? (
                    <Button size="sm" variant="outline" onClick={() => openSignDialog(note)}>
                      <PenLine className="mr-2 h-4 w-4" />
                      Mark signed
                    </Button>
                  ) : null}
                  {!isCancelled ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => openCancelDialog(note)}
                    >
                      <Ban className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modals */}
      {isCustomerOrder ? (
        <>
          <CreateDeliveryNoteModal
            open={createOpen}
            onOpenChange={setCreateOpen}
            orderId={orderId}
            orderDetails={orderDetails}
            onCreated={refetchAll}
          />
          <RecordPastelDeliveryModal
            open={pastelOpen}
            onOpenChange={setPastelOpen}
            orderId={orderId}
            orderDetails={orderDetails}
            onRecorded={refetchAll}
          />
        </>
      ) : null}

      {/* Mark signed dialog */}
      <Dialog open={!!signNote} onOpenChange={(open) => (!open ? setSignNote(null) : undefined)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-base">Mark delivery note signed</DialogTitle>
            <DialogDescription className="text-sm">
              Record who signed for {signNote ? noteSourceLabel(signNote) : 'this delivery'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="dn-signed-by" className="text-xs text-muted-foreground">
              Signed by
            </Label>
            <Input
              id="dn-signed-by"
              value={signedBy}
              onChange={(e) => setSignedBy(e.target.value)}
              placeholder="Recipient name"
              className="h-9"
            />
          </div>
          <DialogFooter className="gap-2 pt-4 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setSignNote(null)} disabled={signing}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSign} disabled={signing || !signedBy.trim()}>
              {signing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
              {signing ? 'Saving…' : 'Mark signed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={!!cancelNote} onOpenChange={(open) => (!open ? setCancelNote(null) : undefined)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-base">Cancel delivery note</DialogTitle>
            <DialogDescription className="text-sm">
              {cancelNote?.status === 'signed'
                ? 'This note is signed — a reason is required to cancel it.'
                : 'This will void the delivery note and release its quantities.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="dn-cancel-reason" className="text-xs text-muted-foreground">
              Reason {cancelNote?.status === 'signed' ? '(required)' : '(optional)'}
            </Label>
            <Textarea
              id="dn-cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Why is this delivery note being cancelled?"
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2 pt-4 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setCancelNote(null)} disabled={cancelling}>
              Keep note
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleCancel}
              disabled={cancelling || (cancelNote?.status === 'signed' && !cancelReason.trim())}
            >
              {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
              {cancelling ? 'Cancelling…' : 'Cancel delivery note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DeliveryNotesTab;

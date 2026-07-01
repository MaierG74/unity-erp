'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, FileText, Printer } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import {
  createUnityDeliveryNote,
  markDeliveryNotePrinted,
  fetchDeliveryNote,
  type OrderDeliveryNote,
} from '@/lib/db/internalOrders';
import type { DeliveryNotePDFCompanyInfo, DeliveryNotePDFLineItem } from './DeliveryNotePDFDocument';

export interface DeliveryOrderDetail {
  order_detail_id: number;
  product_code: string | null;
  product_name: string;
  quantity: number;
  ready_qty: number;
  allocated_delivery_qty: number;
}

/**
 * Resolve the org letterhead / company block from company settings.
 * Failures are non-fatal — the PDF still renders with the "Unity" default.
 */
export async function resolveDeliveryNoteCompanyInfo(): Promise<DeliveryNotePDFCompanyInfo> {
  try {
    const res = await fetch('/api/settings', { headers: { Accept: 'application/json' } });
    if (!res.ok) return {};
    const json = await res.json();
    const s = json?.settings;
    if (!s) return {};

    let logoUrl: string | null = null;
    if (s.company_logo_path) {
      const { data } = supabase.storage.from('QButton').getPublicUrl(s.company_logo_path);
      logoUrl = data?.publicUrl ?? null;
    }
    const addressLines = [
      s.address_line1,
      s.address_line2,
      `${s.city ?? ''} ${s.postal_code ?? ''}`.trim(),
      s.country,
    ].filter((part): part is string => !!part && part.trim().length > 0);

    return {
      name: s.company_name || undefined,
      addressLines,
      phone: s.phone || undefined,
      email: s.email || undefined,
      logoUrl,
    };
  } catch {
    return {};
  }
}

/**
 * Lazily import @react-pdf/renderer + the document component (kept out of the page
 * bundle to avoid build timeouts), render the note to a blob, and open it in a new tab.
 */
export async function openDeliveryNotePdf(params: {
  orderId: number;
  note: OrderDeliveryNote;
  orderDetails: DeliveryOrderDetail[];
}): Promise<void> {
  const { orderId, note, orderDetails } = params;
  const detailById = new Map(orderDetails.map((d) => [d.order_detail_id, d]));

  const items: DeliveryNotePDFLineItem[] = (note.items ?? []).map((item) => {
    const detail = detailById.get(item.order_detail_id);
    return {
      product_code: detail?.product_code ?? null,
      product_name: detail?.product_name ?? `Item #${item.order_detail_id}`,
      quantity: Number(item.quantity || 0),
    };
  });

  const company = await resolveDeliveryNoteCompanyInfo();

  const [{ pdf }, { default: DeliveryNotePDFDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./DeliveryNotePDFDocument'),
  ]);

  const noteNumber =
    note.source === 'pastel'
      ? `Pastel: ${note.external_reference ?? '—'}`
      : note.note_number ?? `DN-${note.order_delivery_note_id}`;

  const blob = await pdf(
    <DeliveryNotePDFDocument
      company={company}
      noteNumber={noteNumber}
      orderReference={`Order #${orderId}`}
      deliveryDate={note.delivery_date}
      items={items}
      notes={note.notes}
      signedBy={note.signed_by}
    />
  ).toBlob();

  const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

interface SelectableLine {
  order_detail_id: number;
  selected: boolean;
  /** Controlled input string so the field can be cleared (House style numeric UX). */
  quantity: string;
}

export interface CreateDeliveryNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderDetails: DeliveryOrderDetail[];
  onCreated?: (noteId: number) => void;
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

export function CreateDeliveryNoteModal({
  open,
  onOpenChange,
  orderId,
  orderDetails,
  onCreated,
}: CreateDeliveryNoteModalProps) {
  const [lines, setLines] = useState<Record<number, SelectableLine>>({});
  const [notes, setNotes] = useState('');
  const [deliveryDate, setDeliveryDate] = useState<string>(todayInputValue());
  const [submitting, setSubmitting] = useState(false);
  const [createdNoteId, setCreatedNoteId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);

  // Reset form whenever the dialog (re)opens.
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
    setNotes('');
    setDeliveryDate(todayInputValue());
    setCreatedNoteId(null);
    setPrinting(false);
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

  const handleGenerate = async () => {
    if (!hasSelection) {
      toast.error('Select at least one line with a quantity to deliver.');
      return;
    }
    setSubmitting(true);
    try {
      const noteId = await createUnityDeliveryNote(
        orderId,
        selectedItems,
        deliveryDate || null,
        notes.trim() ? notes.trim() : null
      );
      setCreatedNoteId(noteId);
      toast.success('Delivery note created.');
      onCreated?.(noteId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create delivery note.';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = async () => {
    if (createdNoteId == null) return;
    setPrinting(true);
    try {
      const note = await fetchDeliveryNote(createdNoteId);
      if (!note) {
        toast.error('Could not load the delivery note for printing.');
        return;
      }
      await openDeliveryNotePdf({ orderId, note, orderDetails });
      await markDeliveryNotePrinted(createdNoteId);
      toast.success('Delivery note opened for printing.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate the PDF.';
      toast.error(message);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Create delivery note</DialogTitle>
          <DialogDescription className="text-sm">
            Select the items leaving the factory and generate a Unity delivery note.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* ITEMS */}
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Items to deliver
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
                          htmlFor={`dn-qty-${detail.order_detail_id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Qty
                        </Label>
                        <Input
                          id={`dn-qty-${detail.order_detail_id}`}
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

          {/* DETAILS */}
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Delivery details
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="dn-date" className="text-xs text-muted-foreground">
                Delivery date
              </Label>
              <Input
                id="dn-date"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dn-notes" className="text-xs text-muted-foreground">
                Notes (optional)
              </Label>
              <Textarea
                id="dn-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special handling, recipient instructions, etc."
                rows={3}
              />
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 pt-4 sm:gap-2">
          {createdNoteId == null ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleGenerate} disabled={submitting || !hasSelection}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                {submitting ? 'Generating…' : 'Generate'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Button size="sm" onClick={handlePrint} disabled={printing}>
                {printing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                {printing ? 'Preparing…' : 'Print PDF'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateDeliveryNoteModal;

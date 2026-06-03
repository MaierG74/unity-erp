'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEFAULT_DELIVERY_NOTE_PREFIX = 'DN-';
const DEFAULT_STOCK_RECEIPT_PREFIX = 'SR-';

interface NumberingSettings {
  deliveryNoteStartingNumber: number;
  deliveryNotePrefix: string;
  stockReceiptStartingNumber: number;
  stockReceiptPrefix: string;
  deliveryNotePdfLetterheadUrl: string;
}

const EMPTY_SETTINGS: NumberingSettings = {
  deliveryNoteStartingNumber: 0,
  deliveryNotePrefix: DEFAULT_DELIVERY_NOTE_PREFIX,
  stockReceiptStartingNumber: 0,
  stockReceiptPrefix: DEFAULT_STOCK_RECEIPT_PREFIX,
  deliveryNotePdfLetterheadUrl: '',
};

/** Parse a starting-number field: empty becomes 0, otherwise a non-negative integer. */
function parseStartingNumber(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export default function NumberingSettingsForm() {
  const { user, loading: authLoading } = useAuth();
  const orgId = getOrgId(user);

  const [settings, setSettings] = useState<NumberingSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!orgId) {
      setLoading(false);
      return;
    }

    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select(
            'delivery_note_starting_number, delivery_note_prefix, stock_receipt_starting_number, stock_receipt_prefix, delivery_note_pdf_letterhead_url',
          )
          .eq('id', orgId)
          .single();

        if (error) throw error;
        if (!active) return;

        setSettings({
          deliveryNoteStartingNumber: Number(data?.delivery_note_starting_number) || 0,
          deliveryNotePrefix: data?.delivery_note_prefix ?? DEFAULT_DELIVERY_NOTE_PREFIX,
          stockReceiptStartingNumber: Number(data?.stock_receipt_starting_number) || 0,
          stockReceiptPrefix: data?.stock_receipt_prefix ?? DEFAULT_STOCK_RECEIPT_PREFIX,
          deliveryNotePdfLetterheadUrl: data?.delivery_note_pdf_letterhead_url ?? '',
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to load numbering settings';
        toast.error(message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [orgId, authLoading]);

  function update<K extends keyof NumberingSettings>(key: K, value: NumberingSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!orgId) {
      toast.error('No organization is associated with your account.');
      return;
    }

    setSaving(true);
    try {
      const letterhead = settings.deliveryNotePdfLetterheadUrl.trim();
      const { error } = await supabase
        .from('organizations')
        .update({
          delivery_note_starting_number: settings.deliveryNoteStartingNumber,
          delivery_note_prefix: settings.deliveryNotePrefix.trim() || DEFAULT_DELIVERY_NOTE_PREFIX,
          stock_receipt_starting_number: settings.stockReceiptStartingNumber,
          stock_receipt_prefix: settings.stockReceiptPrefix.trim() || DEFAULT_STOCK_RECEIPT_PREFIX,
          delivery_note_pdf_letterhead_url: letterhead || null,
        })
        .eq('id', orgId);

      if (error) throw error;
      toast.success('Numbering settings saved');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save numbering settings';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return <div className="animate-pulse py-8 text-muted-foreground">Loading numbering settings...</div>;
  }

  if (!orgId) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        No organization is associated with your account. Numbering settings are unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Numbering &amp; Letterhead</h1>
        <p className="text-sm text-muted-foreground">
          Control how delivery note and stock receipt numbers are generated, and the letterhead used on printed documents.
        </p>
      </div>

      {/* Delivery Notes */}
      <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delivery Notes</h2>
        <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="delivery-note-starting-number" className="text-xs text-muted-foreground">
              Delivery note starting number
            </Label>
            <Input
              id="delivery-note-starting-number"
              type="number"
              min="0"
              step="1"
              value={settings.deliveryNoteStartingNumber || ''}
              placeholder="0"
              onChange={(e) => update('deliveryNoteStartingNumber', parseStartingNumber(e.target.value))}
              onBlur={(e) => update('deliveryNoteStartingNumber', parseStartingNumber(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery-note-prefix" className="text-xs text-muted-foreground">
              Delivery note prefix
            </Label>
            <Input
              id="delivery-note-prefix"
              value={settings.deliveryNotePrefix}
              placeholder={DEFAULT_DELIVERY_NOTE_PREFIX}
              onChange={(e) => update('deliveryNotePrefix', e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Stock Receipts */}
      <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stock Receipts</h2>
        <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="stock-receipt-starting-number" className="text-xs text-muted-foreground">
              Stock receipt starting number
            </Label>
            <Input
              id="stock-receipt-starting-number"
              type="number"
              min="0"
              step="1"
              value={settings.stockReceiptStartingNumber || ''}
              placeholder="0"
              onChange={(e) => update('stockReceiptStartingNumber', parseStartingNumber(e.target.value))}
              onBlur={(e) => update('stockReceiptStartingNumber', parseStartingNumber(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock-receipt-prefix" className="text-xs text-muted-foreground">
              Stock receipt prefix
            </Label>
            <Input
              id="stock-receipt-prefix"
              value={settings.stockReceiptPrefix}
              placeholder={DEFAULT_STOCK_RECEIPT_PREFIX}
              onChange={(e) => update('stockReceiptPrefix', e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Documents */}
      <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents</h2>
        <div className="space-y-1.5">
          <Label htmlFor="delivery-note-letterhead-url" className="text-xs text-muted-foreground">
            Delivery note letterhead URL
          </Label>
          <Input
            id="delivery-note-letterhead-url"
            type="url"
            value={settings.deliveryNotePdfLetterheadUrl}
            placeholder="https://example.com/letterhead.png"
            onChange={(e) => update('deliveryNotePdfLetterheadUrl', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Public URL to the image used as the letterhead on printed delivery notes. Direct file upload is planned for a
            later version &mdash; for now, paste a hosted image URL.
          </p>
        </div>
      </section>

      <div className="flex justify-end border-t border-border/50 pt-4">
        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}

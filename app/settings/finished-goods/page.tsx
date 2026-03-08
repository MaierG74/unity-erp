'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export default function FinishedGoodsSettingsPage() {
  const [autoConsume, setAutoConsume] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/settings', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setAutoConsume(Boolean(json.settings?.fg_auto_consume_on_add));
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to load settings';
        toast.error(message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fg_auto_consume_on_add: autoConsume }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Finished goods settings saved');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save settings';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse text-muted-foreground py-8">Loading settings...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Finished Goods</h1>
        <p className="text-sm text-muted-foreground">
          Inventory behavior for finished goods
        </p>
      </div>

      <div className="flex items-start gap-3">
        <input
          id="fg-auto-consume"
          type="checkbox"
          className="mt-1"
          checked={autoConsume}
          onChange={(e) => setAutoConsume(e.target.checked)}
        />
        <label htmlFor="fg-auto-consume" className="text-sm">
          Consume reservations automatically when FG is added
          <div className="text-xs text-muted-foreground">
            When on, newly added finished goods will be allocated to existing reservations (FIFO)
            and deducted from on-hand immediately. When off (default), consumption occurs at shipping.
          </div>
        </label>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}

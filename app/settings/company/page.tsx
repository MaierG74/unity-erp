'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface Settings {
  setting_id: number;
  company_name: string;
  company_logo_path: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  vat_number: string | null;
  bank_details: string | null;
  terms_conditions: string | null;
  fg_auto_consume_on_add?: boolean;
  po_default_cc_email?: string | null;
}

export default function CompanySettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/settings', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setSettings(json.settings as Settings);
        if (json.settings?.company_logo_path) {
          const { data } = supabase.storage
            .from('QButton')
            .getPublicUrl(json.settings.company_logo_path);
          setLogoUrl(data.publicUrl);
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to load settings';
        toast.error(message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onChange = (k: keyof Settings, v: string | boolean | null) => {
    if (!settings) return;
    setSettings({ ...settings, [k]: v });
  };

  const uploadLogo = async (file: File) => {
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `logos/company-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('QButton').upload(path, file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('QButton').getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      // Persist path to settings
      await save({ company_logo_path: path });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to upload logo';
      toast.error(message);
    }
  };

  const save = async (partial?: Partial<Settings>) => {
    if (!settings) return;
    setSaving(true);
    try {
      const body = { ...settings, ...(partial || {}) } as Partial<Settings>;
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSettings(json.settings as Settings);
      toast.success('Settings saved');
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

  if (!settings) {
    return (
      <div className="text-red-600 py-8">Unable to load settings.</div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-card shadow rounded-lg">
        <div className="px-6 py-4 border-b">
          <h1 className="text-lg font-semibold">Company Details</h1>
          <p className="text-sm text-muted-foreground">Branding and details used in quotes and emails</p>
        </div>
        <div className="p-6 space-y-6">
          {/* Logo */}
          <div>
            <label className="block text-sm font-medium mb-2">Company Logo</label>
            <div className="flex items-center gap-4">
              <div className="w-28 h-28 rounded bg-muted flex items-center justify-center overflow-hidden">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Company logo" className="object-contain w-full h-full" />
                ) : (
                  <span className="text-xs text-muted-foreground">No logo</span>
                )}
              </div>
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                  }}
                />
                {settings.company_logo_path && (
                  <div className="text-xs text-muted-foreground mt-1">Stored at: {settings.company_logo_path}</div>
                )}
              </div>
            </div>
          </div>

          {/* Basics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Company Name</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.company_name || ''} onChange={(e) => onChange('company_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.phone || ''} onChange={(e) => onChange('phone', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.email || ''} onChange={(e) => onChange('email', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Website</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.website || ''} onChange={(e) => onChange('website', e.target.value)} />
            </div>
          </div>

          {/* Address */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Address line 1</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.address_line1 || ''} onChange={(e) => onChange('address_line1', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Address line 2</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.address_line2 || ''} onChange={(e) => onChange('address_line2', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.city || ''} onChange={(e) => onChange('city', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Postal Code</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.postal_code || ''} onChange={(e) => onChange('postal_code', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Country</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.country || ''} onChange={(e) => onChange('country', e.target.value)} />
            </div>
          </div>

          {/* Tax & Bank */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">VAT Number</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.vat_number || ''} onChange={(e) => onChange('vat_number', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Bank Details</label>
              <input className="w-full px-3 py-2 rounded border bg-background" value={settings.bank_details || ''} onChange={(e) => onChange('bank_details', e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={() => save()} disabled={saving} className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

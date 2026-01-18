'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DocumentTemplate, POContactInfo } from '@/types/templates';
import { parsePOContactInfo } from '@/lib/templates';
import { ChevronDown, ChevronRight, FileText, Mail, ShoppingCart } from 'lucide-react';

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
}

interface TemplateState {
  quote_default_terms: string;
  po_email_notice: string;
  po_contact_name: string;
  po_contact_email: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Template state
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templateEdits, setTemplateEdits] = useState<TemplateState>({
    quote_default_terms: '',
    po_email_notice: '',
    po_contact_name: '',
    po_contact_email: '',
  });
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [templatesExpanded, setTemplatesExpanded] = useState(true);
  const [quoteExpanded, setQuoteExpanded] = useState(true);
  const [poExpanded, setPoExpanded] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch company settings
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

        // Fetch document templates
        const templatesRes = await fetch('/api/document-templates', { headers: { Accept: 'application/json' } });
        if (templatesRes.ok) {
          const templatesJson = await templatesRes.json();
          const loadedTemplates = templatesJson.templates as DocumentTemplate[];
          setTemplates(loadedTemplates);

          // Initialize template edits from loaded data
          const quoteTerms = loadedTemplates.find(t => t.template_type === 'quote_default_terms');
          const poNotice = loadedTemplates.find(t => t.template_type === 'po_email_notice');
          const poContact = loadedTemplates.find(t => t.template_type === 'po_contact_info');
          const contactInfo = poContact ? parsePOContactInfo(poContact.content) : { name: '', email: '' };

          setTemplateEdits({
            quote_default_terms: quoteTerms?.content || '',
            po_email_notice: poNotice?.content || '',
            po_contact_name: contactInfo.name,
            po_contact_email: contactInfo.email,
          });
        }
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onChange = (k: keyof Settings, v: any) => {
    if (!settings) return;
    setSettings({ ...settings, [k]: v });
  };

  const uploadLogo = async (file: File) => {
    try {
      setError(null);
      const ext = file.name.split('.').pop() || 'png';
      const path = `logos/company-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('QButton').upload(path, file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('QButton').getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      // Persist path to settings
      await save({ company_logo_path: path });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to upload logo');
    }
  };

  const save = async (partial?: Partial<Settings>) => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
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
      setSuccess('Settings saved');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const saveTemplates = async () => {
    setSavingTemplates(true);
    setError(null);
    setSuccess(null);
    try {
      // Save quote default terms
      await fetch('/api/document-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_type: 'quote_default_terms',
          content: templateEdits.quote_default_terms,
        }),
      });

      // Save PO email notice
      await fetch('/api/document-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_type: 'po_email_notice',
          content: templateEdits.po_email_notice,
        }),
      });

      // Save PO contact info as JSON
      await fetch('/api/document-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_type: 'po_contact_info',
          content: JSON.stringify({
            name: templateEdits.po_contact_name,
            email: templateEdits.po_contact_email,
          }),
        }),
      });

      setSuccess('Templates saved');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save templates');
    } finally {
      setSavingTemplates(false);
    }
  };

  const onTemplateChange = (key: keyof TemplateState, value: string) => {
    setTemplateEdits({ ...templateEdits, [key]: value });
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse text-muted-foreground">Loading settings…</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-8">
        <div className="text-red-600">Unable to load settings.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-card shadow rounded-lg">
          <div className="px-6 py-4 border-b">
            <h1 className="text-lg font-semibold">Company Settings</h1>
            <p className="text-sm text-muted-foreground">Branding and details used in quotes</p>
          </div>
          <div className="p-6 space-y-6">
            {error && (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
            )}
            {success && (
              <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>
            )}

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

            {/* Document Templates Section */}
            <div className="border-t pt-6">
              <button
                type="button"
                onClick={() => setTemplatesExpanded(!templatesExpanded)}
                className="flex items-center gap-2 w-full text-left"
              >
                {templatesExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                <h2 className="text-base font-semibold">Document Templates</h2>
              </button>
              <p className="text-sm text-muted-foreground mt-1 ml-7">
                Configurable text content for quotes, purchase orders, and emails
              </p>

              {templatesExpanded && (
                <div className="mt-4 space-y-4 ml-7">
                  {/* Quote Templates */}
                  <div className="border rounded-lg">
                    <button
                      type="button"
                      onClick={() => setQuoteExpanded(!quoteExpanded)}
                      className="flex items-center gap-2 w-full text-left px-4 py-3 hover:bg-muted/50 rounded-t-lg"
                    >
                      {quoteExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <FileText className="h-4 w-4 text-blue-500" />
                      <span className="font-medium">Quote Templates</span>
                    </button>

                    {quoteExpanded && (
                      <div className="px-4 pb-4 space-y-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">Default Terms & Conditions</label>
                          <p className="text-xs text-muted-foreground mb-2">
                            Shown on quote PDFs when no quote-specific terms are provided
                          </p>
                          <textarea
                            className="w-full px-3 py-2 rounded border bg-background h-32 font-mono text-sm"
                            value={templateEdits.quote_default_terms}
                            onChange={(e) => onTemplateChange('quote_default_terms', e.target.value)}
                            placeholder="• Payment terms: 30 days from invoice date&#10;• All prices exclude VAT unless otherwise stated"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Purchase Order Templates */}
                  <div className="border rounded-lg">
                    <button
                      type="button"
                      onClick={() => setPoExpanded(!poExpanded)}
                      className="flex items-center gap-2 w-full text-left px-4 py-3 hover:bg-muted/50 rounded-t-lg"
                    >
                      {poExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <ShoppingCart className="h-4 w-4 text-green-500" />
                      <span className="font-medium">Purchase Order Templates</span>
                    </button>

                    {poExpanded && (
                      <div className="px-4 pb-4 space-y-4">
                        {/* Contact Information */}
                        <div>
                          <label className="block text-sm font-medium mb-1">Contact Information</label>
                          <p className="text-xs text-muted-foreground mb-2">
                            Contact details shown in the Important Notice section of PO emails
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1">Contact Name</label>
                              <input
                                className="w-full px-3 py-2 rounded border bg-background"
                                value={templateEdits.po_contact_name}
                                onChange={(e) => onTemplateChange('po_contact_name', e.target.value)}
                                placeholder="e.g., Mignon"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1">Contact Email</label>
                              <input
                                type="email"
                                className="w-full px-3 py-2 rounded border bg-background"
                                value={templateEdits.po_contact_email}
                                onChange={(e) => onTemplateChange('po_contact_email', e.target.value)}
                                placeholder="e.g., orders@company.com"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Important Notice */}
                        <div>
                          <label className="block text-sm font-medium mb-1">Important Notice Text</label>
                          <p className="text-xs text-muted-foreground mb-2">
                            Yellow notice box in PO emails to suppliers. Use <code className="bg-muted px-1 rounded">{'{{contact_name}}'}</code> and <code className="bg-muted px-1 rounded">{'{{contact_email}}'}</code> as placeholders.
                          </p>
                          <textarea
                            className="w-full px-3 py-2 rounded border bg-background h-24 font-mono text-sm"
                            value={templateEdits.po_email_notice}
                            onChange={(e) => onTemplateChange('po_email_notice', e.target.value)}
                            placeholder="Please verify all quantities, pricing, and specifications before processing this order..."
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={saveTemplates}
                      disabled={savingTemplates}
                      className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
                    >
                      {savingTemplates ? 'Saving…' : 'Save Templates'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Inventory & Finished Goods */}
            <div className="border-t pt-6">
              <h2 className="text-base font-semibold mb-2">Inventory & Finished Goods</h2>
              <div className="flex items-start gap-3">
                <input
                  id="fg-auto-consume"
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(settings.fg_auto_consume_on_add)}
                  onChange={(e) => onChange('fg_auto_consume_on_add', e.target.checked)}
                />
                <label htmlFor="fg-auto-consume" className="text-sm">
                  Consume reservations automatically when FG is added
                  <div className="text-xs text-muted-foreground">
                    When on, newly added finished goods will be allocated to existing reservations (FIFO) and deducted from on‑hand immediately.
                    When off (default), consumption occurs at shipping.
                  </div>
                </label>
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={() => save()} disabled={saving} className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

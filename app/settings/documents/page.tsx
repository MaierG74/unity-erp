'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  ShoppingCart,
  Plus,
  Trash2,
} from 'lucide-react';
import type { DocumentTemplate, POContactInfo } from '@/types/templates';
import { parsePOContactInfo, DEFAULT_TEMPLATES } from '@/lib/templates';

interface TemplateState {
  quote_default_terms: string;
  po_email_notice: string;
  po_contact_name: string;
  po_contact_email: string;
}

interface QuoteTermsTemplate {
  template_id: number;
  name: string;
  content: string;
}

export default function DocumentTemplatesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<TemplateState>({
    quote_default_terms: '',
    po_email_notice: '',
    po_contact_name: '',
    po_contact_email: '',
  });
  const [poDefaultCcEmail, setPoDefaultCcEmail] = useState('');
  const [quoteTermsTemplates, setQuoteTermsTemplates] = useState<QuoteTermsTemplate[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [quoteExpanded, setQuoteExpanded] = useState(true);
  const [poExpanded, setPoExpanded] = useState(true);

  // Debounce timers for individual quote terms auto-save
  const debounceTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [templatesRes, settingsRes] = await Promise.all([
          fetch('/api/document-templates', { headers: { Accept: 'application/json' } }),
          fetch('/api/settings', { headers: { Accept: 'application/json' } }),
        ]);

        if (!templatesRes.ok) throw new Error(`Templates HTTP ${templatesRes.status}`);
        if (!settingsRes.ok) throw new Error(`Settings HTTP ${settingsRes.status}`);

        const templatesJson = await templatesRes.json();
        const settingsJson = await settingsRes.json();

        const allTemplates: DocumentTemplate[] = templatesJson.templates || [];

        // Find core templates
        const quoteDefault = allTemplates.find((t) => t.template_type === 'quote_default_terms');
        const poNotice = allTemplates.find((t) => t.template_type === 'po_email_notice');
        const poContact = allTemplates.find((t) => t.template_type === 'po_contact_info');

        const contactInfo: POContactInfo = poContact
          ? parsePOContactInfo(poContact.content)
          : parsePOContactInfo(DEFAULT_TEMPLATES.po_contact_info);

        setTemplates({
          quote_default_terms:
            quoteDefault?.content ?? DEFAULT_TEMPLATES.quote_default_terms,
          po_email_notice:
            poNotice?.content ?? DEFAULT_TEMPLATES.po_email_notice,
          po_contact_name: contactInfo.name,
          po_contact_email: contactInfo.email,
        });

        // Additional quote terms templates
        const additionalQuoteTerms = allTemplates
          .filter((t) => t.template_type === 'quote_terms')
          .map((t) => ({
            template_id: t.template_id,
            name: t.name,
            content: t.content,
          }));
        setQuoteTermsTemplates(additionalQuoteTerms);

        // PO default CC email from company settings
        setPoDefaultCcEmail(settingsJson.settings?.po_default_cc_email || '');
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Failed to load templates';
        toast.error(message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  const debouncedSaveQuoteTerm = useCallback(
    (templateId: number, name: string, content: string) => {
      if (debounceTimers.current[templateId]) {
        clearTimeout(debounceTimers.current[templateId]);
      }
      debounceTimers.current[templateId] = setTimeout(async () => {
        try {
          const res = await fetch('/api/document-templates', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: templateId, content, name }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch {
          toast.error('Failed to auto-save template');
        }
      }, 800);
    },
    []
  );

  const updateQuoteTerm = (
    templateId: number,
    field: 'name' | 'content',
    value: string
  ) => {
    setQuoteTermsTemplates((prev) => {
      const updated = prev.map((t) =>
        t.template_id === templateId ? { ...t, [field]: value } : t
      );
      const template = updated.find((t) => t.template_id === templateId);
      if (template) {
        debouncedSaveQuoteTerm(templateId, template.name, template.content);
      }
      return updated;
    });
  };

  const addQuoteTermsTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) {
      toast.error('Please enter a template name');
      return;
    }

    try {
      const res = await fetch('/api/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          content: '',
          template_type: 'quote_terms',
          template_category: 'quote',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setQuoteTermsTemplates((prev) => [
        ...prev,
        {
          template_id: json.template.template_id,
          name: json.template.name,
          content: json.template.content,
        },
      ]);
      setNewTemplateName('');
      toast.success('Template added');
    } catch {
      toast.error('Failed to add template');
    }
  };

  const deleteQuoteTermsTemplate = async (templateId: number) => {
    try {
      const res = await fetch(`/api/document-templates?id=${templateId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Clear any pending debounce timer
      if (debounceTimers.current[templateId]) {
        clearTimeout(debounceTimers.current[templateId]);
        delete debounceTimers.current[templateId];
      }
      setQuoteTermsTemplates((prev) =>
        prev.filter((t) => t.template_id !== templateId)
      );
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  const saveTemplates = async () => {
    setSaving(true);
    try {
      const putTemplate = (
        template_type: string,
        content: string,
        name?: string
      ) =>
        fetch('/api/document-templates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_type, content, ...(name ? { name } : {}) }),
        });

      const results = await Promise.all([
        putTemplate('quote_default_terms', templates.quote_default_terms),
        putTemplate('po_email_notice', templates.po_email_notice),
        putTemplate(
          'po_contact_info',
          JSON.stringify({
            name: templates.po_contact_name,
            email: templates.po_contact_email,
          })
        ),
        fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ po_default_cc_email: poDefaultCcEmail }),
        }),
      ]);

      const allOk = results.every((r) => r.ok);
      if (!allOk) throw new Error('One or more saves failed');

      toast.success('Templates saved');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save templates';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse text-muted-foreground py-8">
        Loading templates...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-card shadow rounded-lg">
        <div className="px-6 py-4 border-b">
          <h1 className="text-lg font-semibold">Document Templates</h1>
          <p className="text-sm text-muted-foreground">
            Manage templates used in quotes, purchase orders, and emails
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* ── Quote Templates ── */}
          <div>
            <button
              type="button"
              onClick={() => setQuoteExpanded((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold mb-3 hover:text-foreground transition-colors"
            >
              {quoteExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <FileText className="h-4 w-4" />
              Quote Templates
            </button>

            {quoteExpanded && (
              <div className="space-y-4 pl-6">
                {/* Default Terms */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Default Terms &amp; Conditions
                  </label>
                  <textarea
                    className="w-full px-3 py-2 rounded border bg-background h-32 font-mono text-sm"
                    value={templates.quote_default_terms}
                    onChange={(e) =>
                      setTemplates((prev) => ({
                        ...prev,
                        quote_default_terms: e.target.value,
                      }))
                    }
                  />
                </div>

                {/* Additional quote terms templates */}
                {quoteTermsTemplates.map((qt) => (
                  <div key={qt.template_id} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        value={qt.name}
                        onChange={(e) =>
                          updateQuoteTerm(qt.template_id, 'name', e.target.value)
                        }
                        placeholder="Template name"
                      />
                      <button
                        type="button"
                        onClick={() => deleteQuoteTermsTemplate(qt.template_id)}
                        className="p-2 rounded hover:bg-destructive/10 text-destructive transition-colors"
                        title="Delete template"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <textarea
                      className="w-full px-3 py-2 rounded border bg-background h-28 font-mono text-sm"
                      value={qt.content}
                      onChange={(e) =>
                        updateQuoteTerm(
                          qt.template_id,
                          'content',
                          e.target.value
                        )
                      }
                      placeholder="Template content"
                    />
                  </div>
                ))}

                {/* Add template row */}
                <div className="flex items-center gap-2">
                  <Input
                    className="flex-1"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="New template name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addQuoteTermsTemplate();
                    }}
                  />
                  <button
                    type="button"
                    onClick={addQuoteTermsTemplate}
                    className="flex items-center gap-1 px-3 py-2 rounded border text-sm hover:bg-muted transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Purchase Order Templates ── */}
          <div>
            <button
              type="button"
              onClick={() => setPoExpanded((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold mb-3 hover:text-foreground transition-colors"
            >
              {poExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <ShoppingCart className="h-4 w-4" />
              Purchase Order Templates
            </button>

            {poExpanded && (
              <div className="space-y-4 pl-6">
                {/* Contact Information */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Contact Information
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        Contact Name
                      </label>
                      <Input
                        value={templates.po_contact_name}
                        onChange={(e) =>
                          setTemplates((prev) => ({
                            ...prev,
                            po_contact_name: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        Contact Email
                      </label>
                      <Input
                        value={templates.po_contact_email}
                        onChange={(e) =>
                          setTemplates((prev) => ({
                            ...prev,
                            po_contact_email: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Important Notice */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Important Notice Text
                  </label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Use {'{{contact_name}}'} and {'{{contact_email}}'} as
                    placeholders
                  </p>
                  <textarea
                    className="w-full px-3 py-2 rounded border bg-background h-24 font-mono text-sm"
                    value={templates.po_email_notice}
                    onChange={(e) =>
                      setTemplates((prev) => ({
                        ...prev,
                        po_email_notice: e.target.value,
                      }))
                    }
                  />
                </div>

                {/* Default CC Email */}
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Default CC Email for Purchase Orders
                  </label>
                  <Input
                    type="email"
                    value={poDefaultCcEmail}
                    onChange={(e) => setPoDefaultCcEmail(e.target.value)}
                    placeholder="e.g. purchasing@company.com"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={saveTemplates}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Templates'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

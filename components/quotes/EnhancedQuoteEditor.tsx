'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Quote, QuoteItem, QuoteAttachment, fetchQuote, updateQuote, fetchAllQuoteAttachments } from '@/lib/db/quotes';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import RichTextEditor from '@/components/ui/rich-text-editor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import QuoteAttachmentManager from './QuoteAttachmentManager';
import { QuotePDFDownload } from './QuotePDF';
import QuoteItemsTable from '@/components/features/quotes/QuoteItemsTable';
import QuoteProfitabilityCard from '@/components/features/quotes/QuoteProfitabilityCard';
import QuoteReportsTab from '@/components/features/quotes/QuoteReportsTab';
import EmailQuoteDialog from '@/components/features/quotes/EmailQuoteDialog';
import { EmailActivityCard } from '@/components/features/emails/EmailActivityCard';
import { useToast } from '@/components/ui/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  QUOTE_STATUSES,
  getQuoteStatusBadgeVariant,
  getQuoteStatusLabel,
} from '@/lib/quotes/status';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import {
  Save,
  Image as ImageIcon,
  Calculator,
  Mail,
  Paperclip,
} from 'lucide-react';

interface EnhancedQuoteEditorProps {
  quoteId: string;
}

export default function EnhancedQuoteEditor({ quoteId }: EnhancedQuoteEditorProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([]);
  // Bump this whenever attachments array changes so children can react
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [autoExpandItemId, setAutoExpandItemId] = useState<string | null>(null);
  const [showItemAttachmentSections, setShowItemAttachmentSections] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const { toast } = useToast();

  // Company info for PDF (loaded from settings if available)
  const defaultCompanyInfo = {
    name: 'Unity ERP Solutions',
    address: 'Your Business Address\nCity, Postal Code',
    phone: '+27 XX XXX XXXX',
    email: 'info@unity-erp.com',
  };
  const [settingsCompanyInfo, setSettingsCompanyInfo] = useState<any | null>(null);
  const [defaultTermsTemplate, setDefaultTermsTemplate] = useState<string | undefined>(undefined);
  const [termsTemplates, setTermsTemplates] = useState<Array<{ template_id: number; name: string; content: string }>>([]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/settings', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;
        const json = await res.json();
        const s = json?.settings;
        if (!s) return;
        // Build public logo URL if path exists
        let logoUrl: string | undefined = undefined;
        if (s.company_logo_path) {
          const { data } = supabase.storage.from('QButton').getPublicUrl(s.company_logo_path);
          logoUrl = data.publicUrl;
        }
        const addressLines = [s.address_line1, s.address_line2, `${s.city ?? ''} ${s.postal_code ?? ''}`.trim(), s.country]
          .filter(Boolean)
          .join('\n');
        setSettingsCompanyInfo({
          name: s.company_name || undefined,
          address: addressLines || undefined,
          phone: s.phone || undefined,
          email: s.email || undefined,
          logo: logoUrl,
        });
      } catch (e) {
        // Non-fatal; PDF will use defaults
        console.warn('Failed to load company settings for PDF');
      }
    };

    const loadTemplates = async () => {
      try {
        const res = await fetch('/api/document-templates?category=quote', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;
        const json = await res.json();
        const allTemplates = json?.templates ?? [];
        // Set the default terms template
        const defaultTemplate = allTemplates.find((t: any) => t.template_type === 'quote_default_terms');
        if (defaultTemplate?.content) {
          setDefaultTermsTemplate(defaultTemplate.content);
        }
        // Collect all selectable templates (default + extras)
        const selectable: Array<{ template_id: number; name: string; content: string }> = [];
        if (defaultTemplate) {
          selectable.push({ template_id: defaultTemplate.template_id, name: 'Default', content: defaultTemplate.content });
        }
        for (const t of allTemplates.filter((t: any) => t.template_type === 'quote_terms')) {
          selectable.push({ template_id: t.template_id, name: t.name, content: t.content });
        }
        setTermsTemplates(selectable);
      } catch (e) {
        console.warn('Failed to load quote terms templates');
      }
    };

    loadSettings();
    loadTemplates();
  }, []);

  const refreshAttachments = React.useCallback(async () => {
    if (!quote?.id) return;
    try {
      const data = await fetchAllQuoteAttachments(quote.id);
      setAttachments(data);
      setAttachmentsVersion((v) => v + 1);
    } catch (e) {
      console.warn('Failed to refresh attachments:', e);
    }
  }, [quote?.id]);

  // Refresh all quote data from the server
  const refreshQuoteData = React.useCallback(async () => {
    if (!quoteId) return;
    try {
      const response = await authorizedFetch(`/api/quotes/${quoteId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch quote');
      }
      const quoteData = await response.json();
      setQuote(quoteData);
      setItems(quoteData.items || []);
      const allAttachments = [
        ...(quoteData.attachments || []),
        ...(quoteData.items || []).flatMap((item: any) => item.attachments || [])
      ];
      setAttachments(allAttachments);
      setAttachmentsVersion((v) => v + 1);
    } catch (error) {
      console.error('Failed to refresh quote:', error);
    }
  }, [quoteId]);

  // Refresh attachments when item count changes (captures auto-attached product images)
  useEffect(() => {
    refreshAttachments();
  }, [refreshAttachments, items.length]);

  useEffect(() => {
    if (quoteId) {
      refreshQuoteData();
    }
  }, [quoteId, refreshQuoteData]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    const item = searchParams.get('item');
    const expand = searchParams.get('expand');
    if (tab) setActiveTab(tab);
    if (item) {
      setExpandedItemId(item);
      if (expand === '1') {
        setAutoExpandItemId(item);
      }
      // Clear the item and expand params from URL after processing
      // This prevents them from re-triggering on every re-render
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete('item');
      newParams.delete('expand');
      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname;
      router.replace(newUrl, { scroll: false });
    }
  }, [searchParams, pathname, router]);

  const handleSave = async () => {
    if (!quote) return;
    setIsSaving(true);
    try {
      const grandTotal = calculateGrandTotal();
      // Only send actual quote columns — strip joined relations
      const { customer, contact, items: _items, attachments: _att, ...quoteColumns } = quote as any;
      await updateQuote(quote.id, {
        ...quoteColumns,
        grand_total: grandTotal
      });
      toast({ title: 'Quote saved' });
    } catch (error) {
      console.error('Save failed:', error);
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const calculateGrandTotal = () => {
    return items.reduce((total, item) => {
      return total + (item.qty * item.unit_price);
    }, 0);
  };

  const calculateVAT = (subtotal: number) => {
    return subtotal * 0.15; // 15% VAT
  };

  // Debounced auto-save: persists quote field changes after 800ms of inactivity
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSave = useCallback(async (updated: any) => {
    try {
      const { customer, contact, items: _i, attachments: _a, ...cols } = updated;
      await updateQuote(updated.id, cols);
    } catch (e) {
      console.error('Auto-save failed:', e);
    }
  }, []);

  const handleQuoteChange = (field: string, value: any) => {
    if (quote) {
      const updated = { ...quote, [field]: value };
      setQuote(updated);
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => autoSave(updated), 800);
    }
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, []);

  const handleItemsChange = (newItems: QuoteItem[]) => {
    setItems(newItems);
  };

  const handleAttachmentsChange = (newAttachments: QuoteAttachment[]) => {
    setAttachments(newAttachments);
    setAttachmentsVersion(v => v + 1);
  };

  const handleItemAttachmentsChange = React.useCallback((itemId: string, itemAttachments: QuoteAttachment[]) => {
    setAttachments(prev => {
      const others = prev.filter(att => att.quote_item_id !== itemId);
      return [...others, ...itemAttachments];
    });
    setAttachmentsVersion(v => v + 1);
  }, []);

  // Stable reference for email dialog to avoid infinite re-render loop
  // Must be before early returns to satisfy Rules of Hooks
  const emailQuote = useMemo(() => {
    if (!quote) return null;
    const itemsWithAttachments = items.map((item: any) => {
      const itemAttachments = attachments.filter(
        (att) => att.scope === 'item' && att.quote_item_id === item.id
      );
      return { ...item, attachments: itemAttachments };
    });
    return {
      ...quote,
      items: itemsWithAttachments,
      attachments: attachments.filter((att) => att.scope === 'quote'),
    };
  }, [quote, items, attachments]) as any;

  if (!quote) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading quote...</p>
        </div>
      </div>
    );
  }

  const subtotal = calculateGrandTotal();
  const vatAmount = calculateVAT(subtotal);
  const total = subtotal + vatAmount;

  // Get reference images (quote-level attachments)
  const referenceImages = attachments.filter(att => 
    att.scope === 'quote' && att.mime_type?.startsWith('image/')
  );

  // Prepare data for PDF
  const pdfQuote = {
    ...quote,
    items: items.map(item => ({
      ...item,
      attachments: attachments.filter(att => att.quote_item_id === item.id)
    })),
    attachments
  };

  return (
    <div className="max-w-7xl mx-auto px-6 pt-4 pb-6 space-y-4">
      {/* Header */}
      <div className="space-y-4">
        {/* Top row: Quote ID + Customer + Status */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <h1 className="text-2xl font-bold text-foreground">
            Quote {quote.quote_number}
          </h1>
          {quote.customer?.name && (
            <>
              <span className="hidden sm:inline text-muted-foreground">•</span>
              <span className="text-lg text-muted-foreground">
                {quote.customer.name}
              </span>
            </>
          )}
          <Badge
            variant={getQuoteStatusBadgeVariant(quote.status)}
            className="w-fit"
          >
            {getQuoteStatusLabel(quote.status)}
          </Badge>
        </div>

        {/* Bottom row: Meta info + Actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Created {new Date(quote.created_at).toLocaleDateString()}</span>
            {quote.customer?.email && (
              <span className="hidden md:inline">{quote.customer.email}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <QuotePDFDownload
              quote={pdfQuote}
              companyInfo={settingsCompanyInfo || defaultCompanyInfo}
              defaultTermsTemplate={defaultTermsTemplate}
              variant="buttons"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEmailDialog(true)}
              disabled={!quote.customer?.email && !quote.customer}
              className="flex items-center gap-2"
            >
              <Mail size={16} />
              <span className="hidden sm:inline">Email Quote</span>
              <span className="sm:hidden">Email</span>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              <Save size={16} className="mr-2" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="details">Quote Details</TabsTrigger>
          <TabsTrigger value="items">Line Items</TabsTrigger>
          <TabsTrigger value="attachments">Attachments</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        {/* Quote Details Tab */}
        <TabsContent value="details" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quote Details</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="quote_number" className="text-xs text-muted-foreground">Quote Number</Label>
                  <Input
                    id="quote_number"
                    value={quote.quote_number}
                    onChange={(e) => handleQuoteChange('quote_number', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status" className="text-xs text-muted-foreground">Status</Label>
                  <Select
                    value={quote.status}
                    onValueChange={(value) => handleQuoteChange('status', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUOTE_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {getQuoteStatusLabel(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {quote.customer?.telephone && (
                <div className="text-sm text-muted-foreground">
                  Tel: {quote.customer.telephone}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Calculator size={14} />
                Quote Summary
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-medium">R {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT (15%):</span>
                  <span className="font-medium">R {vatAmount.toFixed(2)}</span>
                </div>
                <Separator className="!my-3" />
                <div className="flex justify-between text-base font-bold">
                  <span>Total:</span>
                  <span>R {total.toFixed(2)}</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground pt-1">
                <p>{items.length} line item{items.length !== 1 ? 's' : ''}</p>
                <p>{attachments.length} attachment{attachments.length !== 1 ? 's' : ''}</p>
              </div>
            </section>
            <QuoteProfitabilityCard
              items={items}
              onNavigateToReports={() => setActiveTab('reports')}
            />
          </div>

          {/* Notes */}
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</h3>
            <RichTextEditor
              content={(quote as any).notes || ''}
              onUpdate={(html) => handleQuoteChange('notes', html)}
              placeholder="e.g. Goods to be collected from factory, Wrapped for transport…"
            />
            <p className="text-xs text-muted-foreground">
              Notes appear on the PDF below the totals section.
            </p>
          </section>

          {/* Terms & Conditions */}
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terms &amp; Conditions</h3>
            {termsTemplates.length > 0 && (
              <Select
                key={`tc-${(quote as any).terms_conditions?.length ?? 0}`}
                onValueChange={(templateId) => {
                  const t = termsTemplates.find(t => String(t.template_id) === templateId);
                  if (t) {
                    handleQuoteChange('terms_conditions', t.content);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Load from template…" />
                </SelectTrigger>
                <SelectContent>
                  {termsTemplates.map(t => (
                    <SelectItem key={t.template_id} value={String(t.template_id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Textarea
              placeholder="Terms & conditions for this quote…"
              value={(quote as any).terms_conditions || ''}
              onChange={(e) => handleQuoteChange('terms_conditions', e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {(quote as any).terms_conditions
                ? 'Custom terms set for this quote.'
                : 'No custom terms — the default template from Settings will be used.'}
            </p>
          </section>

          {/* Email Activity */}
          <EmailActivityCard type="quote" id={quoteId} />
        </TabsContent>

        {/* Line Items Tab */}
        <TabsContent value="items" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Line Items</CardTitle>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-8 w-8 ${showItemAttachmentSections ? 'text-teal-600' : 'text-muted-foreground'}`}
                      onClick={() => setShowItemAttachmentSections(v => !v)}
                      aria-label="Toggle inline attachment sections"
                    >
                      <Paperclip size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Toggle inline attachment sections</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardHeader>
            <CardContent>
                <QuoteItemsTable
                  items={items}
                  onItemsChange={handleItemsChange}
                  onRefresh={refreshQuoteData}
                  quoteId={quote.id}
                  attachmentsVersion={attachmentsVersion}
                  onItemAttachmentsChange={handleItemAttachmentsChange}
                  expandedItemId={expandedItemId ?? undefined}
                  autoExpandItemId={autoExpandItemId ?? undefined}
                  onAutoExpandHandled={() => {
                    setAutoExpandItemId(null);
                    setExpandedItemId(null);
                  }}
                />
            </CardContent>
          </Card>

          {showItemAttachmentSections && items.map((item, index) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-lg">
                  Item {index + 1}: {item.description}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <QuoteAttachmentManager
                  quoteId={quote.id}
                  quoteItemId={item.id}
                  attachments={attachments}
                  onAttachmentsChange={handleAttachmentsChange}
                  scope="item"
                  title="Item Images & Documents"
                  description="Upload product images and specifications for this line item"
                />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Attachments Tab */}
        <TabsContent value="attachments" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Reference Images */}
            <QuoteAttachmentManager
              quoteId={quote.id}
              attachments={attachments}
              onAttachmentsChange={handleAttachmentsChange}
              scope="quote"
              title="Reference Images"
              description="Upload floorplans, material samples, fabric colors, etc."
            />

            {/* Reference Images Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon size={20} />
                  Reference Images Preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                {referenceImages.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
                    {referenceImages.map((img) => (
                      <div key={img.id} className="space-y-2">
                        <img
                          src={img.file_url}
                          alt={img.original_name || 'Reference'}
                          className="w-full h-32 object-cover rounded border"
                        />
                        <p className="text-xs text-center text-muted-foreground truncate">
                          {img.original_name}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No reference images uploaded yet</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="space-y-4">
          <QuoteReportsTab items={items} />
        </TabsContent>

      </Tabs>

      {/* Email Quote Dialog */}
      <EmailQuoteDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        quote={emailQuote}
        companyInfo={settingsCompanyInfo || defaultCompanyInfo}
        onEmailSent={() => {
          setQuote((current) =>
            current && current.status !== 'ordered'
              ? { ...current, status: 'sent' }
              : current
          );
          toast({
            title: 'Email sent successfully',
            description: `Quote ${quote.quote_number} has been emailed to ${quote.customer?.email || 'the customer'}.`,
          });
        }}
      />
    </div>
  );
}

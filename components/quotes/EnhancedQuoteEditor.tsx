'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Quote, QuoteItem, QuoteAttachment, fetchQuote, updateQuote, fetchAllQuoteAttachments } from '@/lib/db/quotes';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import QuoteAttachmentManager from './QuoteAttachmentManager';
import { QuotePDFDownload } from './QuotePDF';
import QuoteItemsTable from '@/components/features/quotes/QuoteItemsTable';
import EmailQuoteDialog from '@/components/features/quotes/EmailQuoteDialog';
import { EmailActivityCard } from '@/components/features/emails/EmailActivityCard';
import { useToast } from '@/components/ui/use-toast';
import {
  FileText,
  Save,
  Eye,
  Image as ImageIcon,
  Calculator,
  ChevronLeft,
  Mail
} from 'lucide-react';

interface EnhancedQuoteEditorProps {
  quoteId: string;
}

export default function EnhancedQuoteEditor({ quoteId }: EnhancedQuoteEditorProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([]);
  // Bump this whenever attachments array changes so children can react
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [showItemAttachmentSections, setShowItemAttachmentSections] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleBack = () => {
    // Use router.back() to preserve URL params (filters) when returning to quotes list
    router.back();
  };

  // Company info for PDF (loaded from settings if available)
  const defaultCompanyInfo = {
    name: 'Unity ERP Solutions',
    address: 'Your Business Address\nCity, Postal Code',
    phone: '+27 XX XXX XXXX',
    email: 'info@unity-erp.com',
  };
  const [settingsCompanyInfo, setSettingsCompanyInfo] = useState<any | null>(null);
  const [defaultTermsTemplate, setDefaultTermsTemplate] = useState<string | undefined>(undefined);

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
        const res = await fetch('/api/document-templates?type=quote_default_terms', { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;
        const json = await res.json();
        const template = json?.templates?.[0];
        if (template?.content) {
          setDefaultTermsTemplate(template.content);
        }
      } catch (e) {
        console.warn('Failed to load quote terms template');
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

  // Refresh attachments when item count changes (captures auto-attached product images)
  useEffect(() => {
    refreshAttachments();
  }, [refreshAttachments, items.length]);

  useEffect(() => {
    if (quoteId) {
      console.log('Fetching quote with ID:', quoteId);
      
      // Fetch quote data using API route that bypasses RLS
      const fetchQuoteViaAPI = async () => {
        try {
          console.log('Fetching quote via API with ID:', quoteId);
          
          const response = await fetch(`/api/quotes/${quoteId}`);
          
          if (!response.ok) {
            const errorData = await response.json();
            console.error('API error:', errorData);
            throw new Error(errorData.error || 'Failed to fetch quote');
          }
          
          const quoteData = await response.json();
          console.log('Quote data received from API:', quoteData);

          setQuote(quoteData);
          setItems(quoteData.items || []);

          // Flatten attachments from both quote-level and item-level
          const allAttachments = [
            ...(quoteData.attachments || []), // Quote-level attachments
            ...(quoteData.items || []).flatMap((item: any) => item.attachments || []) // Item-level attachments
          ];
          console.log('Flattened attachments:', allAttachments);
          setAttachments(allAttachments);
          
        } catch (error) {
          console.error('Failed to fetch quote via API:', error);
          
          // Fallback to mock data if API fails
          console.log('Falling back to mock data for testing');
          const mockQuote = {
            id: quoteId,
            quote_number: 'DEMO-001',
            customer_id: '134',
            status: 'draft',
            created_at: '2025-01-13T16:09:48.000Z',
            updated_at: '2025-01-13T16:09:48.000Z',
            grand_total: 1500.00,
            subtotal: 1250.00,
            vat_rate: 15,
            vat_amount: 187.50,
            notes: 'Demo quote - API fallback',
            terms: 'Payment due within 30 days'
          };

          const mockItems = [
            {
              id: '1',
              quote_id: quoteId,
              description: 'Premium Widget - High Quality Component',
              qty: 2,
              unit_price: 625.00,
              total: 1250.00
            }
          ];

          const mockAttachments = [
            {
              id: '1',
              quote_id: quoteId,
              quote_item_id: '1',
              scope: 'item' as const,
              file_url: '/placeholder-image.jpg',
              mime_type: 'image/jpeg',
              uploaded_at: '2025-01-13T16:09:48.000Z',
              original_name: 'product-image.jpg',
              display_in_quote: true,
              display_order: 1
            }
          ];

          setQuote(mockQuote);
          setItems(mockItems);
          setAttachments(mockAttachments);
        }
      };

      fetchQuoteViaAPI();
    }
  }, [quoteId]);

  const handleSave = async () => {
    if (!quote) return;
    setIsSaving(true);
    try {
      const grandTotal = calculateGrandTotal();
      await updateQuote(quote.id, { 
        ...quote, 
        grand_total: grandTotal 
      });
      // Show success message
    } catch (error) {
      console.error('Save failed:', error);
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

  const handleQuoteChange = (field: string, value: any) => {
    if (quote) {
      setQuote({ ...quote, [field]: value });
    }
  };

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
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Back control (top-left) */}
      <div>
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={handleBack}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to Quotes
        </Button>
      </div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Quote #{quote.quote_number}</h1>
          <div className="flex items-center gap-4 mt-2">
            <Badge variant={quote.status === 'draft' ? 'secondary' : 'default'}>
              {quote.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Created: {new Date(quote.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <QuotePDFDownload
            quote={pdfQuote}
            companyInfo={settingsCompanyInfo || defaultCompanyInfo}
            defaultTermsTemplate={defaultTermsTemplate}
          />
          <Button
            variant="outline"
            onClick={() => setShowEmailDialog(true)}
            disabled={!quote.customer?.email && !quote.customer}
            className="flex items-center gap-2"
          >
            <Mail size={16} />
            Email Quote
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save size={16} className="mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="details">Quote Details</TabsTrigger>
          <TabsTrigger value="items">Line Items</TabsTrigger>
          <TabsTrigger value="attachments">Attachments</TabsTrigger>
          <TabsTrigger value="preview">PDF Preview</TabsTrigger>
        </TabsList>

        {/* Quote Details Tab */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="quote_number">Quote Number</Label>
                  <Input
                    id="quote_number"
                    value={quote.quote_number}
                    onChange={(e) => handleQuoteChange('quote_number', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="customer_id">Customer ID</Label>
                  <Input
                    id="customer_id"
                    value={quote.customer_id}
                    onChange={(e) => handleQuoteChange('customer_id', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select 
                    value={quote.status} 
                    onValueChange={(value) => handleQuoteChange('status', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="won">Won</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator size={20} />
                  Quote Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-medium">R {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>VAT (15%):</span>
                  <span className="font-medium">R {vatAmount.toFixed(2)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total:</span>
                  <span>R {total.toFixed(2)}</span>
                </div>
                <div className="text-sm text-muted-foreground mt-4">
                  <p>{items.length} line item{items.length !== 1 ? 's' : ''}</p>
                  <p>{attachments.length} attachment{attachments.length !== 1 ? 's' : ''}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Email Activity */}
          <EmailActivityCard type="quote" id={quoteId} />
        </TabsContent>

        {/* Line Items Tab */}
        <TabsContent value="items" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <QuoteItemsTable 
                items={items}
                onItemsChange={handleItemsChange}
                quoteId={quote.id}
                attachmentsVersion={attachmentsVersion}
                onItemAttachmentsChange={handleItemAttachmentsChange}
              />
            </CardContent>
          </Card>

          {/* Optional per-item attachment sections (collapsed by default to save space) */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">Need to edit attachments inline under each item?</div>
            <Button variant="outline" size="sm" onClick={() => setShowItemAttachmentSections(v => !v)}>
              {showItemAttachmentSections ? 'Hide item attachment sections' : 'Show item attachment sections'}
            </Button>
          </div>

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

        {/* PDF Preview Tab */}
        <TabsContent value="preview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye size={20} />
                PDF Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <FileText size={64} className="mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">PDF Preview</h3>
                <p className="text-muted-foreground mb-6">
                  Click the button below to generate and download the PDF quote
                </p>
                <QuotePDFDownload
                  quote={pdfQuote}
                  companyInfo={settingsCompanyInfo || defaultCompanyInfo}
                  defaultTermsTemplate={defaultTermsTemplate}
                />
                <div className="mt-6 p-4 bg-gray-50 rounded-lg text-left">
                  <h4 className="font-medium mb-2">PDF will include:</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Company branding and contact information</li>
                    <li>• Quote details and line items with images</li>
                    <li>• {items.length} line item{items.length !== 1 ? 's' : ''} with product images</li>
                    <li>• {referenceImages.length} reference image{referenceImages.length !== 1 ? 's' : ''}</li>
                    <li>• Pricing breakdown with VAT calculation</li>
                    <li>• Terms and conditions</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Email Quote Dialog */}
      <EmailQuoteDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        quote={(() => {
          console.log('[EnhancedQuoteEditor] Building quote for email dialog');
          console.log('[EnhancedQuoteEditor] Total attachments:', attachments.length);
          console.log('[EnhancedQuoteEditor] All attachments:', attachments);

          const itemsWithAttachments = items.map((item: any) => {
            const itemAttachments = attachments.filter(
              (att) => att.scope === 'item' && att.quote_item_id === item.id
            );
            console.log(`[EnhancedQuoteEditor] Item ${item.description} (${item.id}): found ${itemAttachments.length} attachments`);
            return {
              ...item,
              attachments: itemAttachments,
            };
          });

          return {
            ...quote,
            items: itemsWithAttachments,
            attachments: attachments.filter((att) => att.scope === 'quote'),
          };
        })() as any}
        companyInfo={settingsCompanyInfo || defaultCompanyInfo}
        onEmailSent={() => {
          toast({
            title: 'Email sent successfully',
            description: `Quote ${quote.quote_number} has been emailed to ${quote.customer?.email || 'the customer'}.`,
          });
        }}
        onPreviewPDF={() => {
          // Open PDF in new tab using existing PDF download component logic
          const pdfQuote = {
            ...quote,
            items: items.map((item: any) => ({
              ...item,
              attachments: attachments.filter(
                (att) => att.scope === 'item' && att.quote_item_id === item.id
              ),
            })),
            attachments: attachments.filter((att) => att.scope === 'quote'),
            customer: quote.customer,
          };
          // This is a simplified preview - in production you might want to generate and open the PDF
          console.log('Preview PDF clicked', pdfQuote);
        }}
      />
    </div>
  );
}

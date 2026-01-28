'use client';

import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Mail, Loader2, Eye, Plus, X, UserCheck } from 'lucide-react';
import { Quote } from '@/lib/db/quotes';
import { preprocessQuoteImages } from '@/lib/quotes/compositeImage';
import { useQuery } from '@tanstack/react-query';
import { fetchContactsByCustomerId } from '@/lib/db/customer-contacts';
import type { CustomerContact } from '@/types/customers';

interface EmailQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: Quote & {
    customer?: { id: number; name: string; email?: string | null; telephone?: string | null };
    contact?: { id: number; name: string; email: string | null; phone: string | null } | null;
  };
  companyInfo?: any;
  onEmailSent?: () => void;
  onPreviewPDF?: () => void;
}

export default function EmailQuoteDialog({
  open,
  onOpenChange,
  quote,
  companyInfo,
  onEmailSent,
  onPreviewPDF,
}: EmailQuoteDialogProps) {
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set());
  const [manualEmails, setManualEmails] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch contacts for this customer
  const { data: contacts = [] } = useQuery<CustomerContact[]>({
    queryKey: ['customerContacts', quote.customer?.id],
    queryFn: () => fetchContactsByCustomerId(quote.customer!.id),
    enabled: open && !!quote.customer?.id,
  });

  // Contacts that have an email address
  const emailContacts = useMemo(
    () => contacts.filter(c => c.email),
    [contacts]
  );

  // Build the final recipient list
  const allRecipients = useMemo(() => {
    const emails: string[] = [];
    for (const c of emailContacts) {
      if (selectedContactIds.has(c.id)) {
        emails.push(c.email!);
      }
    }
    for (const e of manualEmails) {
      if (!emails.includes(e)) emails.push(e);
    }
    return emails;
  }, [emailContacts, selectedContactIds, manualEmails]);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      // Pre-select the quote's contact, or the primary contact, or the first contact with email
      const preselect = new Set<number>();
      if (quote.contact?.id && emailContacts.find(c => c.id === quote.contact!.id)) {
        preselect.add(quote.contact.id);
      } else {
        const primary = emailContacts.find(c => c.is_primary);
        if (primary) preselect.add(primary.id);
        else if (emailContacts.length > 0) preselect.add(emailContacts[0].id);
      }
      setSelectedContactIds(preselect);
      setManualEmails([]);
      setManualInput('');
      setCustomMessage('');
      setError(null);
    }
  }, [open, quote, emailContacts]);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const toggleContact = (contactId: number) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const addManualEmail = () => {
    const email = manualInput.trim();
    if (!email) return;
    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }
    if (manualEmails.includes(email) || emailContacts.some(c => c.email === email && selectedContactIds.has(c.id))) {
      setError('This email is already added');
      return;
    }
    setManualEmails(prev => [...prev, email]);
    setManualInput('');
    setError(null);
  };

  const removeManualEmail = (email: string) => {
    setManualEmails(prev => prev.filter(e => e !== email));
  };

  const handleManualKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addManualEmail();
    }
  };

  // Helper function to convert image URL to base64
  const imageUrlToBase64 = async (url: string): Promise<string> => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Failed to convert image to base64:', url, error);
      return url;
    }
  };

  const handleSend = async () => {
    setError(null);

    if (allRecipients.length === 0) {
      setError('Please select at least one recipient');
      return;
    }

    const invalid = allRecipients.find(e => !validateEmail(e));
    if (invalid) {
      setError(`Invalid email address: ${invalid}`);
      return;
    }

    setIsSending(true);

    try {
      // Prefetch and convert all images to base64
      const quoteWithBase64Images = JSON.parse(JSON.stringify(quote));

      if (quoteWithBase64Images.items && Array.isArray(quoteWithBase64Images.items)) {
        for (const item of quoteWithBase64Images.items) {
          if (item.attachments && Array.isArray(item.attachments)) {
            for (const attachment of item.attachments) {
              if (attachment.file_url && attachment.mime_type?.startsWith('image/')) {
                const base64 = await imageUrlToBase64(attachment.file_url);
                attachment.file_url = base64;
              }
            }
          }
        }
      }

      if (quoteWithBase64Images.attachments && Array.isArray(quoteWithBase64Images.attachments)) {
        for (const attachment of quoteWithBase64Images.attachments) {
          if (attachment.file_url && attachment.mime_type?.startsWith('image/')) {
            const base64 = await imageUrlToBase64(attachment.file_url);
            attachment.file_url = base64;
          }
        }
      }

      // Fetch default terms template
      let defaultTermsTemplate: string | undefined;
      try {
        const templatesRes = await fetch('/api/document-templates?type=quote_default_terms', {
          headers: { Accept: 'application/json' },
        });
        if (templatesRes.ok) {
          const templatesJson = await templatesRes.json();
          defaultTermsTemplate = templatesJson?.templates?.[0]?.content;
        }
      } catch (e) {
        console.warn('Failed to load quote terms template for email PDF');
      }

      // Lazy-load PDF dependencies
      const [{ pdf }, { default: QuotePDFDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/quotes/QuotePDF'),
      ]);

      const processedQuote = await preprocessQuoteImages(quoteWithBase64Images as any);
      const pdfBlob = await pdf(
        <QuotePDFDocument quote={processedQuote} companyInfo={companyInfo} defaultTermsTemplate={defaultTermsTemplate} />
      ).toBlob();

      const pdfBuffer = await pdfBlob.arrayBuffer();
      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

      const date = new Date(quote.created_at);
      const y = date.getFullYear();
      const m = `${date.getMonth() + 1}`.padStart(2, '0');
      const d = `${date.getDate()}`.padStart(2, '0');
      const pdfFilename = `Quote-${quote.quote_number}-${y}${m}${d}.pdf`;

      const response = await fetch(`/api/quotes/${quote.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmails: allRecipients,
          customMessage: customMessage.trim() || undefined,
          pdfBase64,
          pdfFilename,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      onEmailSent?.();
      onOpenChange(false);

    } catch (err: any) {
      console.error('Error sending quote email:', err);
      setError(err.message || 'Failed to send email. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Quote
          </DialogTitle>
          <DialogDescription>
            Send quote {quote.quote_number} to your customer as a PDF attachment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Contact selection */}
          {emailContacts.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <UserCheck className="h-4 w-4" />
                Select Recipients
              </Label>
              <div className="flex flex-wrap gap-2">
                {emailContacts.map((c) => {
                  const isSelected = selectedContactIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleContact(c.id)}
                      disabled={isSending}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className={`text-xs ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground/70'}`}>
                        {c.email}
                      </span>
                      {c.is_primary && (
                        <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : ''}`}>
                          Primary
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Manual email input */}
          <div className="space-y-2">
            <Label htmlFor="manual-email">
              {emailContacts.length > 0 ? 'Additional Email' : 'Recipient Email'}{' '}
              {emailContacts.length === 0 && <span className="text-red-500">*</span>}
            </Label>
            <div className="flex gap-2">
              <Input
                id="manual-email"
                type="email"
                placeholder="email@example.com"
                value={manualInput}
                onChange={(e) => { setManualInput(e.target.value); setError(null); }}
                onKeyDown={handleManualKeyDown}
                disabled={isSending}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addManualEmail}
                disabled={isSending || !manualInput.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {manualEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {manualEmails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-sm"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => removeManualEmail(email)}
                      disabled={isSending}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Summary of recipients */}
          {allRecipients.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Sending to {allRecipients.length} recipient{allRecipients.length !== 1 ? 's' : ''}
            </p>
          )}

          {/* Custom Message */}
          <div className="space-y-2">
            <Label htmlFor="custom-message">
              Custom Message <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="custom-message"
              placeholder="Add a personal message to include in the email..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              disabled={isSending}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This message will be included in the email body before the quote summary.
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Info */}
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
            <p className="text-xs text-blue-800">
              The quote PDF will be automatically attached to the email.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {onPreviewPDF && (
            <Button
              type="button"
              variant="outline"
              onClick={onPreviewPDF}
              disabled={isSending}
              className="flex items-center gap-2"
            >
              <Eye size={16} />
              Preview PDF
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSend}
            disabled={isSending || allRecipients.length === 0}
            className="flex items-center gap-2"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4" />
                Send{allRecipients.length > 1 ? ` to ${allRecipients.length}` : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

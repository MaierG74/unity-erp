'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Mail, Loader2, Eye } from 'lucide-react';
import { Quote } from '@/lib/db/quotes';

interface EmailQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: Quote & {
    customer?: { id: number; name: string; email?: string | null; telephone?: string | null };
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
  const [recipientEmail, setRecipientEmail] = useState(quote.customer?.email || '');
  const [customMessage, setCustomMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setRecipientEmail(quote.customer?.email || '');
      setCustomMessage('');
      setError(null);
    }
  }, [open, quote]);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
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
      return url; // Fallback to original URL
    }
  };

  const handleSend = async () => {
    setError(null);

    // Validation
    if (!recipientEmail) {
      setError('Recipient email is required');
      return;
    }

    if (!validateEmail(recipientEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsSending(true);

    try {
      // Prefetch and convert all images to base64
      const quoteWithBase64Images = JSON.parse(JSON.stringify(quote)); // Deep clone

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

      // Also convert quote-level reference images
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

      // Lazy-load PDF dependencies to avoid build-time network issues
      const [{ pdf }, { default: QuotePDFDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/quotes/QuotePDF'),
      ]);

      // Generate PDF client-side with base64 images
      const pdfBlob = await pdf(
        <QuotePDFDocument quote={quoteWithBase64Images as any} companyInfo={companyInfo} defaultTermsTemplate={defaultTermsTemplate} />
      ).toBlob();

      // Convert PDF blob to base64
      const pdfBuffer = await pdfBlob.arrayBuffer();
      const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

      // Generate filename
      const date = new Date(quote.created_at);
      const y = date.getFullYear();
      const m = `${date.getMonth() + 1}`.padStart(2, '0');
      const d = `${date.getDate()}`.padStart(2, '0');
      const pdfFilename = `Quote-${quote.quote_number}-${y}${m}${d}.pdf`;

      const response = await fetch(`/api/quotes/${quote.id}/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipientEmail: recipientEmail !== quote.customer?.email ? recipientEmail : undefined,
          customMessage: customMessage.trim() || undefined,
          pdfBase64,
          pdfFilename,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      // Success!
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
          {/* Recipient Email */}
          <div className="space-y-2">
            <Label htmlFor="recipient-email">
              To <span className="text-red-500">*</span>
            </Label>
            <Input
              id="recipient-email"
              type="email"
              placeholder="customer@example.com"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              disabled={isSending}
              className={error && !recipientEmail ? 'border-red-500' : ''}
            />
            {quote.customer?.email && recipientEmail === quote.customer.email && (
              <p className="text-xs text-muted-foreground">
                Using customer email from database
              </p>
            )}
          </div>

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
              📎 The quote PDF will be automatically attached to the email.
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
            disabled={isSending || !recipientEmail}
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
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

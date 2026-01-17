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
      console.log('[EmailQuoteDialog] Dialog opened with quote:', quote);
      console.log('[EmailQuoteDialog] Quote has', quote.items?.length || 0, 'items');
      if (quote.items && quote.items.length > 0) {
        quote.items.forEach((item: any, index: number) => {
          console.log(`[EmailQuoteDialog] Item ${index} (${item.description}):`, {
            id: item.id,
            attachments: item.attachments,
            attachmentCount: item.attachments?.length || 0
          });
        });
      }
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
      console.log('[EmailQuoteDialog] Starting image conversion...');
      console.log('[EmailQuoteDialog] Quote items:', quote.items);

      const quoteWithBase64Images = JSON.parse(JSON.stringify(quote)); // Deep clone

      let imageCount = 0;
      let convertedCount = 0;

      if (quoteWithBase64Images.items && Array.isArray(quoteWithBase64Images.items)) {
        for (const item of quoteWithBase64Images.items) {
          if (item.attachments && Array.isArray(item.attachments)) {
            console.log(`[EmailQuoteDialog] Item "${item.description}" has ${item.attachments.length} attachments`);
            for (const attachment of item.attachments) {
              if (attachment.file_url && attachment.mime_type?.startsWith('image/')) {
                imageCount++;
                console.log(`[EmailQuoteDialog] Converting image ${imageCount}: ${attachment.file_url}`);
                const base64 = await imageUrlToBase64(attachment.file_url);
                if (base64 !== attachment.file_url) {
                  convertedCount++;
                  console.log(`[EmailQuoteDialog] Successfully converted image ${convertedCount}`);
                }
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
            imageCount++;
            console.log(`[EmailQuoteDialog] Converting quote-level image: ${attachment.file_url}`);
            const base64 = await imageUrlToBase64(attachment.file_url);
            if (base64 !== attachment.file_url) {
              convertedCount++;
            }
            attachment.file_url = base64;
          }
        }
      }

      console.log(`[EmailQuoteDialog] Converted ${convertedCount} of ${imageCount} images to base64`);

      // Lazy-load PDF dependencies to avoid build-time network issues
      const [{ pdf }, { default: QuotePDFDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/quotes/QuotePDF'),
      ]);

      // Generate PDF client-side with base64 images
      console.log('[EmailQuoteDialog] Generating PDF...');
      const pdfBlob = await pdf(
        <QuotePDFDocument quote={quoteWithBase64Images as any} companyInfo={companyInfo} />
      ).toBlob();
      console.log('[EmailQuoteDialog] PDF generated, size:', pdfBlob.size);

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

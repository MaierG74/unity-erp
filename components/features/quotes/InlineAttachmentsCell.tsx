'use client';

import React from 'react';
import { QuoteAttachment, fetchQuoteItemAttachments } from '@/lib/db/quotes';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Paperclip, EyeOff } from 'lucide-react';
import QuoteAttachmentManager from '@/components/quotes/QuoteAttachmentManager';

interface InlineAttachmentsCellProps {
  quoteId: string;
  itemId: string;
  version?: number;
  onItemAttachmentsChange?: (itemId: string, attachments: QuoteAttachment[]) => void;
}

export default function InlineAttachmentsCell({ quoteId, itemId, version, onItemAttachmentsChange }: InlineAttachmentsCellProps) {
  const [attachments, setAttachments] = React.useState<QuoteAttachment[]>([]);
  const [open, setOpen] = React.useState(false);
  const isImage = (m?: string) => !!m && m.startsWith('image/');

  const refresh = React.useCallback(async () => {
    try {
      const data = await fetchQuoteItemAttachments(quoteId, itemId);
      setAttachments(data);
    } catch (e) {
      console.error('Failed to fetch attachments:', e);
    }
  }, [quoteId, itemId]);

  React.useEffect(() => { refresh(); }, [refresh, version]);

  const handleManagerChange = React.useCallback((next: QuoteAttachment[]) => {
    setAttachments(next);
    onItemAttachmentsChange?.(itemId, next);
  }, [itemId, onItemAttachmentsChange]);

  // Build thumbs: up to 2 images, else doc icon
  const imageThumbs = attachments.filter(a => isImage(a.mime_type));
  const nonImages = attachments.filter(a => !isImage(a.mime_type));
  const shown = imageThumbs.slice(0, 2);
  const remaining = attachments.length - shown.length;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 inline-flex items-center justify-center gap-1 w-full"
        onClick={() => setOpen(true)}
        title="Manage attachments"
        aria-label="Manage attachments"
      >
        {shown.length === 0 ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip className="h-4 w-4 opacity-80" />
            <span className="text-xs text-muted-foreground">({attachments.length})</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            {shown.map((att) => (
              <span key={att.id} className="relative w-7 h-7 rounded-md border border-input bg-card overflow-hidden">
                <img src={att.file_url} alt={att.original_name || 'Attachment'} className="w-full h-full object-contain" />
                {att.display_in_quote === false && (
                  <EyeOff className="absolute top-0.5 right-0.5 h-3 w-3 bg-background/70 rounded p-[1px]" />
                )}
              </span>
            ))}
            {remaining > 0 && (
              <span className="h-7 min-w-7 px-1 inline-flex items-center justify-center rounded-md border border-input bg-muted/40 text-xs text-muted-foreground">
                +{remaining}
              </span>
            )}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Item Images & Documents</DialogTitle>
          </DialogHeader>
          <QuoteAttachmentManager
            quoteId={quoteId}
            quoteItemId={itemId}
            attachments={attachments}
            onAttachmentsChange={handleManagerChange}
            scope="item"
            title="Item Images & Documents"
            description="Upload product images and specifications for this line item"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

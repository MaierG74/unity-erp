'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

interface CopyQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceQuote: {
    id: string;
    quote_number: string;
  };
  onCopyComplete?: (newQuote: { id: string; quote_number: string }) => void;
}

export function CopyQuoteDialog({
  open,
  onOpenChange,
  sourceQuote,
  onCopyComplete,
}: CopyQuoteDialogProps) {
  const [newQuoteName, setNewQuoteName] = useState('');
  const [copying, setCopying] = useState(false);
  const { toast } = useToast();

  // Initialize with source name + " (Copy)" when dialog opens
  useEffect(() => {
    if (open) {
      setNewQuoteName(`${sourceQuote.quote_number} (Copy)`);
    } else {
      setNewQuoteName('');
    }
  }, [open, sourceQuote.quote_number]);

  const handleCopy = async () => {
    if (!newQuoteName.trim()) {
      toast({
        title: 'Name required',
        description: 'Please enter a name for the new quote.',
        variant: 'destructive',
      });
      return;
    }

    setCopying(true);
    try {
      const res = await fetch(`/api/quotes/${sourceQuote.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_number: newQuoteName.trim() }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.details || 'Failed to copy quote');
      }

      const data = await res.json();
      toast({
        title: 'Quote copied',
        description: `Created "${newQuoteName.trim()}" successfully.`,
      });

      onOpenChange(false);
      onCopyComplete?.(data.quote);
    } catch (err: any) {
      console.error('Copy quote failed:', err);
      toast({
        title: 'Copy failed',
        description: err.message || 'Could not copy the quote.',
        variant: 'destructive',
      });
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy Quote</DialogTitle>
          <DialogDescription>
            Create a copy of &quot;{sourceQuote.quote_number}&quot; with a new name. All items, pricing, and attachments will be duplicated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="original-name">Original Quote</Label>
            <Input
              id="original-name"
              value={sourceQuote.quote_number}
              disabled
              className="bg-muted"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">New Quote Name</Label>
            <Input
              id="new-name"
              value={newQuoteName}
              onChange={(e) => setNewQuoteName(e.target.value)}
              placeholder="Enter new quote name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !copying) {
                  e.preventDefault();
                  handleCopy();
                }
              }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={copying}
          >
            Cancel
          </Button>
          <Button onClick={handleCopy} disabled={copying || !newQuoteName.trim()}>
            {copying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {copying ? 'Copying...' : 'Copy Quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { Loader2, ChevronsUpDown, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomers } from '@/lib/db/customers';
import type { Customer } from '@/lib/db/customers';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

interface CopyQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceQuote: {
    id: string;
    quote_number: string;
    customer_id?: string | number;
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
  const [customerId, setCustomerId] = useState<string>('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [copying, setCopying] = useState(false);
  const { toast } = useToast();

  // Fetch customers
  const { data: customers, isLoading: customersLoading } = useQuery<Customer[], Error>({
    queryKey: ['customers'],
    queryFn: () => fetchCustomers(),
  });

  const customersSorted = useMemo(
    () => (customers || []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [customers]
  );

  const filteredCustomers = useMemo(
    () => customersSorted.filter(c =>
      c.name.toLowerCase().startsWith(searchTerm.toLowerCase())
    ),
    [customersSorted, searchTerm]
  );

  // Initialize with source name + " (Copy)" and source customer when dialog opens
  useEffect(() => {
    if (open) {
      setNewQuoteName(`${sourceQuote.quote_number} (Copy)`);
      if (sourceQuote.customer_id) {
        setCustomerId(String(sourceQuote.customer_id));
      }
    } else {
      setNewQuoteName('');
      setCustomerId('');
      setSearchTerm('');
    }
  }, [open, sourceQuote.quote_number, sourceQuote.customer_id]);

  const handleCopy = async () => {
    if (!newQuoteName.trim()) {
      toast({
        title: 'Name required',
        description: 'Please enter a name for the new quote.',
        variant: 'destructive',
      });
      return;
    }

    if (!customerId) {
      toast({
        title: 'Customer required',
        description: 'Please select a customer for the new quote.',
        variant: 'destructive',
      });
      return;
    }

    setCopying(true);
    try {
      const res = await fetch(`/api/quotes/${sourceQuote.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote_number: newQuoteName.trim(),
          customer_id: Number(customerId),
        }),
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
            <Label htmlFor="customer">Customer</Label>
            <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="customer"
                  variant="outline"
                  role="combobox"
                  aria-expanded={customerOpen}
                  className="w-full justify-between"
                  disabled={customersLoading || copying}
                >
                  {customerId
                    ? customersSorted.find((c) => String(c.id) === customerId)?.name || 'Select customer...'
                    : 'Select customer...'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0">
                <Command>
                  <CommandInput
                    placeholder="Search customers..."
                    value={searchTerm}
                    onValueChange={setSearchTerm}
                  />
                  <CommandList>
                    <CommandEmpty>No customer found.</CommandEmpty>
                    <CommandGroup>
                      {filteredCustomers.map((customer) => (
                        <CommandItem
                          key={customer.id}
                          value={String(customer.id)}
                          onSelect={(value) => {
                            setCustomerId(value);
                            setCustomerOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              customerId === String(customer.id) ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                          {customer.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">New Quote Name</Label>
            <Input
              id="new-name"
              value={newQuoteName}
              onChange={(e) => setNewQuoteName(e.target.value)}
              placeholder="Enter new quote name"
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
          <Button onClick={handleCopy} disabled={copying || !newQuoteName.trim() || !customerId}>
            {copying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {copying ? 'Copying...' : 'Copy Quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

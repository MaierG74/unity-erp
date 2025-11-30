'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import type { Customer } from '@/lib/db/customers';
import { fetchCustomers } from '@/lib/db/customers';
import { Label } from '@/components/ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function NewQuotePage() {
  const router = useRouter();
  const [quoteNumber, setQuoteNumber] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
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
  const [status, setStatus] = useState<string>('draft');
  const [loading, setLoading] = useState<boolean>(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote_number: quoteNumber,
          customer_id: Number(customerId),
          status,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || 'Failed to create quote');
      }
      const data = await res.json();
      router.push(`/quotes/${data.quote.id}`);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">New Quote</h1>
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">Quote Number</label>
          <Input
            value={quoteNumber}
            onChange={e => setQuoteNumber(e.target.value)}
            placeholder="Enter quote number"
          />
        </div>
        <div>
          <Label htmlFor="customer-select" className="block text-sm font-medium mb-1">Customer</Label>
          <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={customerOpen}
                className="w-full justify-between"
                disabled={customersLoading}
              >
                {customersLoading
                  ? 'Loading...'
                  : (customers?.find((c) => c.id.toString() === customerId)?.name || 'Select a customer')}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
              <div className="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground">
                <div className="flex items-center border-b px-3">
                  <input
                    className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Search customers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="max-h-[300px] overflow-y-auto overflow-x-hidden">
                  {filteredCustomers.length === 0 ? (
                    <div className="py-6 text-center text-sm">No customer found.</div>
                  ) : (
                    <div className="overflow-hidden p-1 text-foreground">
                      {filteredCustomers.map((c) => (
                      <div
                        key={c.id}
                        className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                          console.debug('[NewQuote] customer clicked', { name: c.name, id: c.id });
                          setCustomerId(String(c.id));
                          setCustomerOpen(false);
                          setSearchTerm(''); // Clear search when selecting
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            customerId === c.id.toString() ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        {c.name}
                      </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Status</label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full">
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
      </div>
      <Button onClick={handleCreate} disabled={loading || !quoteNumber || !customerId}>
        {loading ? 'Creating...' : 'Create Quote'}
      </Button>
    </div>
  );
}

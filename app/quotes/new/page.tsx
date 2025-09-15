'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import type { Customer } from '@/lib/db/customers';
import { fetchCustomers } from '@/lib/db/customers';
import { Label } from '@/components/ui/label';

export default function NewQuotePage() {
  const router = useRouter();
  const [quoteNumber, setQuoteNumber] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('');
  const { data: customers, isLoading: customersLoading } = useQuery<Customer[], Error>({
    queryKey: ['customers'],
    queryFn: () => fetchCustomers(),
  });
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
          <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a customer" />
              </SelectTrigger>
              <SelectContent>
                {customersLoading ? (
                  <SelectItem value="loading" disabled>Loading...</SelectItem>
                ) : (
                  customers?.map(c => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
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

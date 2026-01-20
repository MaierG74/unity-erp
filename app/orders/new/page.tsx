'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, ChevronsUpDown, Check } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchQuotes } from '@/lib/db/quotes';
import { fetchCustomers } from '@/lib/db/customers';
import type { Customer } from '@/lib/db/customers';
import { createOrder } from '@/lib/db/orders';
import { useMutation } from '@tanstack/react-query';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Helper functions for South African date format (dd/mm/yyyy)
const formatToSA = (isoDate: string): string => {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
};

const formatToISO = (saDate: string): string => {
  if (!saDate) return '';
  const parts = saDate.split('/');
  if (parts.length !== 3) return '';
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

export default function NewOrderPage() {
  const router = useRouter();
  const { mutateAsync: createOrderMutation, isPending: isCreating } = useMutation({
    mutationFn: (order: Partial<any>) => createOrder(order),
    onSuccess: (order: any) => router.push(`/orders/${order.order_id}`),
  });

  const handleCreateFromQuote = async () => {
    if (!selectedQuote || selectedQuote === 'loading') return;
    // Prefer API that seeds header fields from quote
    const res = await fetch('/api/orders/from-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId: selectedQuote })
    });
    if (!res.ok) {
      // Fallback to basic insert
      await createOrderMutation({ quote_id: selectedQuote });
      return;
    }
    const json = await res.json();
    const order = json?.order;
    if (order?.order_id) router.push(`/orders/${order.order_id}`);
  };

  const [customerId, setCustomerId] = useState<string>('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [orderNumber, setOrderNumber] = useState<string>('');
  const [deliveryDate, setDeliveryDate] = useState<string>('');
  const [deliveryDateDisplay, setDeliveryDateDisplay] = useState<string>('');

  const handleCreateFromScratch = () => {
    const payload: Record<string, any> = {};
    if (customerId) payload.customer_id = Number(customerId);
    if (orderNumber) payload.order_number = orderNumber;
    if (deliveryDate) payload.delivery_date = deliveryDate;
    createOrderMutation(payload);
  };
  const [selectedQuote, setSelectedQuote] = useState<string | undefined>(undefined);
  const { data: quotes, isLoading: quotesLoading } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => fetchQuotes(),
  });

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
      c.name.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [customersSorted, searchTerm]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/orders">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">New Order</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Create New Order</CardTitle>
              <CardDescription>
                This form will be implemented in future iterations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground">Create from Quote</h3>
                  <div>
                    <Label htmlFor="quote-select">Select Quote</Label>
                    <Select value={selectedQuote} onValueChange={setSelectedQuote}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a quote" />
                      </SelectTrigger>
                      <SelectContent>
                        {quotesLoading ? (
                          <SelectItem value="loading" disabled>Loading...</SelectItem>
                        ) : (
                          quotes?.map((q: any) => (
                            <SelectItem key={q.id} value={q.id.toString()}>
                              {q.quote_number} - {q.customer_id}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleCreateFromQuote} disabled={isCreating || !selectedQuote || selectedQuote === 'loading'}>
                    {isCreating ? 'Creating...' : 'Create Order from Quote'}
                  </Button>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground">Create from Scratch</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label htmlFor="customer-select">Customer</Label>
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
                                      setCustomerId(String(c.id));
                                      setCustomerOpen(false);
                                      setSearchTerm('');
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
                      <Label htmlFor="order-number">Order Number (optional)</Label>
                      <Input id="order-number" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="delivery-date">Delivery Date (optional)</Label>
                      <div className="relative flex">
                        <Input
                          id="delivery-date"
                          type="text"
                          placeholder="dd/mm/yyyy"
                          value={deliveryDateDisplay}
                          onChange={(e) => {
                            const value = e.target.value;
                            // Allow typing in dd/mm/yyyy format
                            if (value === '' || /^[\d/]*$/.test(value)) {
                              setDeliveryDateDisplay(value);
                              const iso = formatToISO(value);
                              if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
                                setDeliveryDate(iso);
                              } else if (value === '') {
                                setDeliveryDate('');
                              }
                            }
                          }}
                          className="pr-10"
                        />
                        <input
                          type="date"
                          className="absolute right-0 top-0 h-full w-10 opacity-0 cursor-pointer"
                          value={deliveryDate}
                          onChange={(e) => {
                            setDeliveryDate(e.target.value);
                            setDeliveryDateDisplay(formatToSA(e.target.value));
                          }}
                          aria-label="Open date picker"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                          <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                  <Button variant="secondary" onClick={handleCreateFromScratch} disabled={isCreating || !customerId}>
                    {isCreating ? 'Creating...' : 'Create Empty Order'}
                  </Button>
                </div>

                <div className="md:col-span-2">
                  <Link href="/orders">
                    <Button variant="outline">Back to Orders</Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Order Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Create a new customer order by filling out the required information.
                </p>
                <p>
                  You can add multiple products to a single order and track their status.
                </p>
                <p>
                  All orders can have attachments, such as specifications, requirements, or 
                  any other documents relevant to the order.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
} 
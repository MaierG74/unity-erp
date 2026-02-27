'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, ChevronsUpDown, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchQuotes } from '@/lib/db/quotes';
import { fetchCustomers } from '@/lib/db/customers';
import type { Customer } from '@/lib/db/customers';
import { createOrder } from '@/lib/db/orders';
import { supabase } from '@/lib/supabase';
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

  const [isCreatingFromQuote, setIsCreatingFromQuote] = useState(false);
  const isAnyCreating = isCreating || isCreatingFromQuote;

  const handleCreateFromQuote = async () => {
    if (!selectedQuote || selectedQuote === 'loading') return;
    setIsCreatingFromQuote(true);
    try {
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
    } catch {
      setIsCreatingFromQuote(false);
    }
  };

  const [customerId, setCustomerId] = useState<string>('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [orderNumber, setOrderNumber] = useState<string>('');
  const [deliveryDate, setDeliveryDate] = useState<string>('');
  const [deliveryDateDisplay, setDeliveryDateDisplay] = useState<string>('');
  const datePickerRef = useRef<HTMLInputElement>(null);

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

  // Check for duplicate order_number + customer_id
  const trimmedOrderNumber = orderNumber.trim();
  const { data: duplicateOrders } = useQuery({
    queryKey: ['duplicate-order-check', trimmedOrderNumber, customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('order_id, order_number')
        .eq('order_number', trimmedOrderNumber)
        .eq('customer_id', Number(customerId))
        .limit(1);
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(trimmedOrderNumber && customerId),
  });
  const hasDuplicate = (duplicateOrders?.length ?? 0) > 0;

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
                  <Button onClick={handleCreateFromQuote} disabled={isAnyCreating || !selectedQuote || selectedQuote === 'loading'}>
                    {isCreatingFromQuote && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isCreatingFromQuote ? 'Creating Order...' : 'Create Order from Quote'}
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
                      {hasDuplicate && (
                        <p className="flex items-center gap-1 mt-1 text-xs text-amber-500">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                          An order with number &ldquo;{trimmedOrderNumber}&rdquo; already exists for this customer. You may be creating a duplicate.
                        </p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="delivery-date">Delivery Date (optional)</Label>
                      <div className="relative flex">
                        {/* Mask template layer - shows unfilled portion of dd/mm/yyyy */}
                        <div
                          className="absolute left-0 top-0 h-full flex items-center pointer-events-none px-3 font-mono text-muted-foreground/50 text-sm"
                          aria-hidden="true"
                        >
                          {(() => {
                            const mask = 'dd/mm/yyyy';
                            const digits = deliveryDateDisplay.replace(/\D/g, '');
                            // Build the visible mask: typed digits are invisible (transparent), rest shows the template
                            const digitPositions = [0, 1, 3, 4, 6, 7, 8, 9]; // positions of d, d, m, m, y, y, y, y in mask
                            let digitIndex = 0;
                            return mask.split('').map((ch, i) => {
                              if (digitPositions.includes(i)) {
                                const isTyped = digitIndex < digits.length;
                                digitIndex++;
                                return <span key={i} className={isTyped ? 'invisible' : ''}>{ch}</span>;
                              }
                              return <span key={i}>{ch}</span>;
                            });
                          })()}
                        </div>
                        <Input
                          id="delivery-date"
                          type="text"
                          value={deliveryDateDisplay}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/\D/g, '');
                            // Auto-format: insert slashes after dd and mm
                            let formatted = '';
                            for (let i = 0; i < raw.length && i < 8; i++) {
                              if (i === 2 || i === 4) formatted += '/';
                              formatted += raw[i];
                            }
                            setDeliveryDateDisplay(formatted);
                            const iso = formatToISO(formatted);
                            if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
                              setDeliveryDate(iso);
                            } else {
                              setDeliveryDate('');
                            }
                          }}
                          className="pr-10 font-mono text-sm bg-transparent"
                          maxLength={10}
                        />
                        <input
                          ref={datePickerRef}
                          type="date"
                          className="sr-only"
                          value={deliveryDate}
                          onChange={(e) => {
                            setDeliveryDate(e.target.value);
                            setDeliveryDateDisplay(formatToSA(e.target.value));
                          }}
                          tabIndex={-1}
                          aria-label="Date picker"
                        />
                        <button
                          type="button"
                          className="absolute right-0 top-0 h-full w-10 flex items-center justify-center cursor-pointer hover:bg-accent/50 rounded-r-md transition-colors"
                          onClick={() => datePickerRef.current?.showPicker()}
                          aria-label="Open date picker"
                        >
                          <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <Button variant="secondary" onClick={handleCreateFromScratch} disabled={isAnyCreating || !customerId}>
                    {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isCreating ? 'Creating Order...' : 'Create Empty Order'}
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
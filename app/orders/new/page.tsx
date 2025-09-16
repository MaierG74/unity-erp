'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchQuotes } from '@/lib/db/quotes';
import { createOrder } from '@/lib/db/orders';
import { useMutation } from '@tanstack/react-query';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';

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
  const [orderNumber, setOrderNumber] = useState<string>('');
  const [deliveryDate, setDeliveryDate] = useState<string>('');

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
                      <Label htmlFor="customer-id">Customer ID</Label>
                      <Input id="customer-id" placeholder="e.g. 12" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="order-number">Order Number (optional)</Label>
                      <Input id="order-number" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="delivery-date">Delivery Date (optional)</Label>
                      <Input id="delivery-date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                    </div>
                  </div>
                  <Button variant="secondary" onClick={handleCreateFromScratch} disabled={isCreating}>
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
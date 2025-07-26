'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchQuotes } from '@/lib/db/quotes';
import { createOrder, Order } from '@/lib/db/orders';
import { useMutation } from '@tanstack/react-query';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useRouter } from 'next/navigation';

export default function NewOrderPage() {
  const router = useRouter();
  const { mutateAsync: createOrderMutation, isPending: isCreating } = useMutation({
    mutationFn: (order: Partial<Order>) => createOrder(order),
    onSuccess: order => router.push(`/orders/${order.id}`),
  });

  const handleCreate = () => {
    if (!selectedQuote) return;
    createOrderMutation({ quote_id: selectedQuote });
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
              <div>
                <ul className="list-disc ml-6 space-y-1 text-sm text-muted-foreground">
                  <li>Customer selection</li>
                  <li>Product selection with quantities</li>
                  <li>Delivery date scheduling</li>
                  <li>Order attachments</li>
                  <li>Order notes</li>
                </ul>
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
          quotes?.map(q => (
            <SelectItem key={q.id} value={q.id.toString()}>
              {q.quote_number} - {q.customer_id}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  </div>
  <Button onClick={handleCreate} disabled={isCreating || !selectedQuote || selectedQuote === 'loading'}>
    {isCreating ? 'Creating...' : 'Create Order'}
  </Button>
                <Link href="/orders">
                  <Button variant="outline">Back to Orders</Button>
                </Link>
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
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';

export default function NewOrderPage() {
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
            <CardContent>
              <div className="text-muted-foreground">
                The order creation form will be implemented in future updates. It will include:
                <ul className="list-disc ml-6 mt-2 space-y-1">
                  <li>Customer selection</li>
                  <li>Product selection with quantities</li>
                  <li>Delivery date scheduling</li>
                  <li>Order attachments</li>
                  <li>Order notes</li>
                </ul>
              </div>
              <div className="mt-6">
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
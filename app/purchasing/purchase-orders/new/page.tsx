import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { NewPurchaseOrderForm } from '@/components/purchasing/new-purchase-order-form';

export const metadata = {
  title: 'New Purchase Order | Unity ERP',
};

export default function NewPurchaseOrderPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/purchasing/purchase-orders">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Create Purchase Order</h1>
      </div>

      <div className="rounded-lg border">
        <div className="p-6">
          <NewPurchaseOrderForm />
        </div>
      </div>
      
      <div className="rounded-lg border p-6 space-y-4">
        <h3 className="text-lg font-medium">Purchase Order Instructions</h3>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Create a new purchase order for multiple components from different suppliers.
          </p>
          <p>
            The purchase order will be assigned a Q number by the accounts department once approved.
          </p>
          <ol className="list-decimal pl-5 space-y-1 mt-2">
            <li>Select components to order</li>
            <li>Choose suppliers and specify quantities</li>
            <li>Add notes if needed</li>
            <li>Submit the purchase order for approval</li>
          </ol>
        </div>
      </div>
    </div>
  );
} 
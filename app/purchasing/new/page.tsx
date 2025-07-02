import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { NewOrderForm } from '@/components/features/purchasing/new-order-form';
import { ArrowLeft } from 'lucide-react';

export const metadata = {
  title: 'New Purchase Order | Unity ERP',
};

export default function NewOrderPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/purchasing">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">New Purchase Order</h1>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="rounded-lg border p-6">
            <NewOrderForm />
          </div>
        </div>
        
        <div>
          <div className="rounded-lg border p-6 space-y-4">
            <h3 className="text-lg font-medium">Purchase Order Instructions</h3>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Create a new purchase order by selecting a supplier component and
                specifying the order quantity.
              </p>
              <p>
                The order date defaults to today if not specified.
              </p>
              <p>
                After creating the order, you will be redirected to the order
                detail page where you can record receipts as items arrive.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
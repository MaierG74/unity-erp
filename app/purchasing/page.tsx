import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ClipboardList } from 'lucide-react';

export const metadata = {
  title: 'Purchasing | Unity ERP',
};

export default function PurchasingPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-4 md:flex-row md:justify-between md:items-center">
        <div>
          <h1 className="text-2xl font-bold">Purchasing</h1>
          <p className="text-muted-foreground">
            Manage purchase orders and Q numbers
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/purchasing/purchase-orders">
            <Button>
              <ClipboardList className="h-4 w-4 mr-2" />
              Purchase Orders
            </Button>
          </Link>
        </div>
      </div>
      
      <div className="rounded-lg border p-6 space-y-4">
        <h3 className="text-lg font-medium">Purchase Order System</h3>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            The purchase order system allows you to create orders for multiple components from different suppliers.
          </p>
          <p>
            Purchase orders are assigned Q numbers by the accounts department once approved.
          </p>
          <Link href="/purchasing/purchase-orders">
            <Button variant="outline" className="mt-4">
              <ClipboardList className="h-4 w-4 mr-2" />
              View Purchase Orders
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
} 
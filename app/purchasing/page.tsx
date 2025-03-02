import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PurchasingOrdersList } from '@/components/purchasing/orders-list';
import { PlusCircle, ArrowRightCircle } from 'lucide-react';

export const metadata = {
  title: 'Purchasing | Unity ERP',
};

export default function PurchasingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchasing</h1>
          <p className="text-muted-foreground">
            Manage your supplier orders and receipts
          </p>
        </div>
        <Link href="/purchasing/new">
          <Button className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />
            <span>New Order</span>
          </Button>
        </Link>
      </div>

      <div className="rounded-lg border">
        <PurchasingOrdersList />
      </div>
    </div>
  );
} 
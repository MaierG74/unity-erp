import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { MultiOrderForm } from '@/components/purchasing/multi-order-form';

export const metadata = {
  title: 'Multi-Component Purchase Order | Unity ERP',
};

export default function MultiOrderPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/purchasing">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Multi-Component Purchase Order</h1>
      </div>
      
      <div className="grid grid-cols-1 gap-8">
        <div>
          <div className="rounded-lg border p-6">
            <MultiOrderForm />
          </div>
        </div>
        
        <div>
          <div className="rounded-lg border p-6 space-y-4">
            <h3 className="text-lg font-medium">Multi-Component Order Instructions</h3>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Order multiple components at once by selecting components and suppliers, and specifying quantities.
              </p>
              <p>
                1. Search for and select an internal component (e.g., GTYPIST)
              </p>
              <p>
                2. Choose a supplier for each component and set the quantity
              </p>
              <p>
                3. Add multiple components to your cart
              </p>
              <p>
                4. Review your cart and complete the purchase
              </p>
              <p>
                The system will automatically create separate purchase orders grouped by supplier.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 
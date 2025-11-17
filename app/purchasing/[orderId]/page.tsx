import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { OrderDetail } from '@/components/features/purchasing/order-detail';
import { ArrowLeft } from 'lucide-react';
import { Metadata } from 'next';

type OrderDetailPageProps = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function generateMetadata({ params }: OrderDetailPageProps): Promise<Metadata> {
  const { orderId } = await params;
  return {
    title: `Purchase Order #${orderId} | Unity ERP`,
  };
}

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { orderId: orderIdParam } = await params;
  const orderId = parseInt(orderIdParam, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/purchasing">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          Purchase Order #{orderId}
        </h1>
      </div>

      <OrderDetail orderId={orderId} />
    </div>
  );
} 
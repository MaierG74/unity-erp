import { Metadata } from 'next';
import { redirect } from 'next/navigation';

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
  redirect(`/purchasing/purchase-orders/${orderId}`);
}

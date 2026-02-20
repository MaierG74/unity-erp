'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Link from 'next/link';

interface CustomerOpenOrdersModalProps {
  customerId: number;
  customerName: string;
  open: boolean;
  onClose: () => void;
}

interface OpenOrder {
  order_id: number;
  order_number: string | null;
  order_date: string;
  total_amount: string | null;
  status: { status_id: number; status_name: string } | null;
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return 'R0.00';
  return `R${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CustomerOpenOrdersModal({
  customerId,
  customerName,
  open,
  onClose,
}: CustomerOpenOrdersModalProps) {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['customer-open-orders-list', customerId],
    queryFn: async (): Promise<OpenOrder[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          order_id,
          order_number,
          order_date,
          total_amount,
          status:order_statuses(status_id, status_name)
        `)
        .eq('customer_id', customerId)
        .or('status_id.is.null,status_id.not.in.(30,31)')
        .order('order_date', { ascending: false });

      if (error) throw error;

      return (data || []).map((order: any) => ({
        ...order,
        status: order.status?.[0] || null,
      }));
    },
    enabled: open,
  });

  const totalValue = orders.reduce(
    (sum, o) => sum + parseFloat(o.total_amount || '0'),
    0
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Open Orders &mdash; {customerName}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground animate-pulse">Loading orders...</div>
        ) : orders.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">No open orders.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium text-sm">Order #</th>
                    <th className="text-left p-3 font-medium text-sm">Date</th>
                    <th className="text-left p-3 font-medium text-sm">Status</th>
                    <th className="text-right p-3 font-medium text-sm">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.order_id} className="border-b hover:bg-muted/30">
                      <td className="p-3">
                        <Link
                          href={`/orders/${order.order_id}`}
                          className="text-primary hover:underline font-medium"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {order.order_number || `#${order.order_id}`}
                        </Link>
                      </td>
                      <td className="p-3 text-sm">
                        {new Date(order.order_date).toLocaleDateString('en-ZA', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary">
                          {order.status?.status_name || 'Unknown'}
                        </Badge>
                      </td>
                      <td className="p-3 text-right text-sm font-medium">
                        {formatCurrency(parseFloat(order.total_amount || '0'))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td colSpan={3} className="p-3 text-sm font-medium">
                      Total ({orders.length} order{orders.length !== 1 ? 's' : ''})
                    </td>
                    <td className="p-3 text-right text-sm font-bold">
                      {formatCurrency(totalValue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

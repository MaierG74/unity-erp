'use client';

import { useQuery } from '@tanstack/react-query';
import { getSupplierOpenOrders } from '@/lib/api/suppliers';
import { formatCurrency } from '@/lib/quotes';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Link from 'next/link';

interface OpenOrdersModalProps {
  supplierId: number;
  supplierName: string;
  open: boolean;
  onClose: () => void;
  showOnlyOutstanding?: boolean;
}

export function OpenOrdersModal({
  supplierId,
  supplierName,
  open,
  onClose,
  showOnlyOutstanding = false,
}: OpenOrdersModalProps) {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['supplier-open-orders', supplierId],
    queryFn: () => getSupplierOpenOrders(supplierId),
    enabled: open,
  });

  const filteredOrders = showOnlyOutstanding
    ? orders.filter(order =>
        order.supplier_orders.some(line => (line.order_quantity - line.total_received) > 0)
      )
    : orders;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {showOnlyOutstanding ? 'Outstanding Orders' : 'Open Orders'} &mdash; {supplierName}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground animate-pulse">Loading orders...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            {showOnlyOutstanding ? 'No outstanding orders.' : 'No open orders.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="text-left p-3 font-medium text-sm">Q Number</th>
                  <th className="text-left p-3 font-medium text-sm">Order Date</th>
                  <th className="text-left p-3 font-medium text-sm">Status</th>
                  <th className="text-left p-3 font-medium text-sm">Components</th>
                  <th className="text-left p-3 font-medium text-sm">Who For</th>
                  <th className="text-right p-3 font-medium text-sm">Outstanding</th>
                  <th className="text-right p-3 font-medium text-sm">Value</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const outstandingQty = order.supplier_orders.reduce(
                    (sum, line) => sum + Math.max(0, line.order_quantity - line.total_received), 0
                  );
                  const outstandingValue = order.supplier_orders.reduce(
                    (sum, line) => {
                      const outstanding = Math.max(0, line.order_quantity - line.total_received);
                      return sum + (outstanding * (line.supplier_component?.price || 0));
                    },
                    0
                  );
                  const componentCodes = order.supplier_orders
                    .map(line => line.supplier_component?.component?.internal_code)
                    .filter(Boolean)
                    .join(', ');

                  // Collect unique customer orders across all line items
                  const customerOrderMap = new Map<number, { order_id: number; order_number: string; customer_name: string | null }>();
                  order.supplier_orders.forEach(line => {
                    line.supplier_order_customer_orders?.forEach(link => {
                      if (link.order && !customerOrderMap.has(link.order.order_id)) {
                        customerOrderMap.set(link.order.order_id, {
                          order_id: link.order.order_id,
                          order_number: link.order.order_number,
                          customer_name: link.order.customer?.name || null,
                        });
                      }
                    });
                  });
                  const customerOrders = Array.from(customerOrderMap.values());

                  return (
                    <tr key={order.purchase_order_id} className="border-b hover:bg-muted/30">
                      <td className="p-3">
                        <Link
                          href={`/purchasing/purchase-orders/${order.purchase_order_id}`}
                          className="text-primary hover:underline font-medium"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {order.q_number || `PO-${order.purchase_order_id}`}
                        </Link>
                      </td>
                      <td className="p-3 text-sm">
                        {order.order_date
                          ? format(parseISO(order.order_date), 'dd MMM yyyy')
                          : format(parseISO(order.created_at), 'dd MMM yyyy')}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary">{order.status?.status_name || 'Unknown'}</Badge>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground max-w-[200px] truncate" title={componentCodes}>
                        {componentCodes || '-'}
                      </td>
                      <td className="p-3 text-sm">
                        {customerOrders.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {customerOrders.map(co => (
                              <Link
                                key={co.order_id}
                                href={`/orders/${co.order_id}`}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {co.order_number}
                                {co.customer_name ? ` (${co.customer_name})` : ''}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3 text-right text-sm">{outstandingQty}</td>
                      <td className="p-3 text-right text-sm font-medium">{formatCurrency(outstandingValue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

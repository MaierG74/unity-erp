'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, Package, AlertCircle, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Link from 'next/link';

type ComponentData = {
  component_id: number;
  on_order_quantity?: number;
  required_for_orders?: number;
};

type OrdersTabProps = {
  component: ComponentData;
};

export function OrdersTab({ component }: OrdersTabProps) {
  // Fetch purchase orders
  const { data: purchaseOrders = [], isLoading: isLoadingPO } = useQuery({
    queryKey: ['component', component.component_id, 'purchase-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_orders')
        .select(`
          order_id,
          order_quantity,
          total_received,
          purchase_order_id,
          purchase_order:purchase_orders!inner (
            purchase_order_id,
            q_number
          ),
          status:supplier_order_statuses!inner (
            status_name
          ),
          suppliercomponents!inner (
            component_id,
            supplier_code
          )
        `)
        .eq('suppliercomponents.component_id', component.component_id)
        .in('status.status_name', ['Open', 'In Progress', 'Approved', 'Partially Received', 'Pending Approval']);

      if (error) throw error;
      return data;
    },
  });

  // Calculate distinct purchase orders count
  const distinctPOs = new Set(
    purchaseOrders
      .map((po: any) => po.purchase_order_id)
      .filter(Boolean)
  ).size;

  // Fetch products where this component is used (BOM)
  const { data: products = [], isLoading: isLoadingProducts } = useQuery({
    queryKey: ['component', component.component_id, 'products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billofmaterials')
        .select(`
          quantity_required,
          product:products (
            product_id,
            internal_code,
            name
          )
        `)
        .eq('component_id', component.component_id);

      if (error) throw error;
      return data;
    },
  });

  // Fetch active orders requiring this component
  const { data: activeOrders = [], isLoading: isLoadingOrders } = useQuery({
    queryKey: ['component', component.component_id, 'active-orders'],
    queryFn: async () => {
      // Get products that use this component
      const productIds = products.map((p: any) => p.product?.product_id).filter(Boolean);

      if (productIds.length === 0) return [];

      const { data, error } = await supabase
        .from('order_details')
        .select(`
          quantity,
          order:orders!inner (
            order_id,
            order_number,
            order_date,
            status:order_statuses (
              status_name
            )
          ),
          product:products!inner (
            product_id,
            internal_code,
            name,
            billofmaterials (
              component_id,
              quantity_required
            )
          )
        `)
        .in('product_id', productIds)
        .not('order.status.status_name', 'in', '(Completed,Cancelled)');

      if (error) throw error;

      // Filter to only orders with this specific component
      return data.filter((od: any) => {
        const bom = od.product?.billofmaterials || [];
        return bom.some((b: any) => b.component_id === component.component_id);
      });
    },
    enabled: products.length > 0,
  });

  const isLoading = isLoadingPO || isLoadingProducts || isLoadingOrders;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">On Order</CardTitle>
            <ShoppingCart className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {component.on_order_quantity || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {distinctPOs} purchase order{distinctPOs !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Required</CardTitle>
            <AlertCircle className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {component.required_for_orders || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              For {activeOrders.length} active orders
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Used In</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{products.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Product(s)</p>
          </CardContent>
        </Card>
      </div>

      {/* Purchase Orders */}
      {purchaseOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Purchase Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier Code</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders.map((po: any) => {
                  const pending = (po.order_quantity || 0) - (po.total_received || 0);
                  return (
                    <TableRow key={po.order_id}>
                      <TableCell>
                        <Link
                          href={`/purchasing/purchase-orders/${po.purchase_order_id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {po.purchase_order?.q_number || `PO #${po.purchase_order_id}`}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {po.suppliercomponents?.supplier_code || '-'}
                      </TableCell>
                      <TableCell className="text-right">{po.order_quantity || 0}</TableCell>
                      <TableCell className="text-right">{po.total_received || 0}</TableCell>
                      <TableCell className="text-right font-semibold text-blue-600">
                        {pending}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{po.status?.status_name || 'Unknown'}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Products Using This Component */}
      {products.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bill of Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product Code</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead className="text-right">Qty Required per Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((bom: any, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono">
                      {bom.product?.internal_code || '-'}
                    </TableCell>
                    <TableCell>{bom.product?.name || '-'}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {bom.quantity_required}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Active Orders Requiring This Component */}
      {activeOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Number</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Order Qty</TableHead>
                  <TableHead className="text-right">Components Needed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeOrders.map((orderDetail: any, index: number) => {
                  const bom = orderDetail.product?.billofmaterials?.find(
                    (b: any) => b.component_id === component.component_id
                  );
                  const needed = (orderDetail.quantity || 0) * (bom?.quantity_required || 0);

                  return (
                    <TableRow key={`${orderDetail.order?.order_id}-${orderDetail.product?.product_id}-${index}`}>
                      <TableCell>
                        <Link
                          href={`/orders/${orderDetail.order?.order_id}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {orderDetail.order?.order_number || 'N/A'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {orderDetail.product?.internal_code} - {orderDetail.product?.name}
                      </TableCell>
                      <TableCell className="text-right">{orderDetail.quantity}</TableCell>
                      <TableCell className="text-right font-semibold text-purple-600">
                        {needed}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {orderDetail.order?.status?.status_name || 'Unknown'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {purchaseOrders.length === 0 &&
        products.length === 0 &&
        activeOrders.length === 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center text-muted-foreground py-8">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No orders or products associated with this component.</p>
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );
}


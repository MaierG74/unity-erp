'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Loader2, Edit, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { OverviewTab } from '@/components/features/inventory/component-detail/OverviewTab';
import { SuppliersTab } from '@/components/features/inventory/component-detail/SuppliersTab';
import { TransactionsTab as ComponentTransactionsTab } from '@/components/features/inventory/component-detail/TransactionsTab';
import { OrdersTab } from '@/components/features/inventory/component-detail/OrdersTab';
import { AnalyticsTab } from '@/components/features/inventory/component-detail/AnalyticsTab';
import { EditComponentDialog } from '@/components/features/inventory/component-detail/EditComponentDialog';
import { DeleteComponentDialog } from '@/components/features/inventory/component-detail/DeleteComponentDialog';

export default function ComponentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const componentId = parseInt(params.id as string);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch component data
  const { data: component, isLoading, error } = useQuery({
    queryKey: ['component', componentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select(`
          *,
          category:component_categories (
            cat_id,
            categoryname
          ),
          unit:unitsofmeasure (
            unit_id,
            unit_code,
            unit_name
          ),
          inventory:inventory (
            inventory_id,
            quantity_on_hand,
            location,
            reorder_level
          ),
          supplierComponents:suppliercomponents (
            supplier_component_id,
            supplier_id,
            supplier_code,
            price,
            supplier:suppliers (
              supplier_id,
              name
            )
          )
        `)
        .eq('component_id', componentId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !isNaN(componentId),
  });

  // Fetch on-order quantity (only from purchase orders)
  const { data: onOrderData } = useQuery({
    queryKey: ['component', componentId, 'on-order'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_orders')
        .select(`
          order_quantity,
          total_received,
          purchase_order_id,
          purchase_order:purchase_orders!inner (
            purchase_order_id
          ),
          suppliercomponents!inner (
            component_id
          ),
          status:supplier_order_statuses!inner (
            status_name
          )
        `)
        .eq('suppliercomponents.component_id', componentId)
        .in('status.status_name', ['Open', 'In Progress', 'Approved', 'Partially Received', 'Pending Approval']);

      if (error) throw error;

      const total = (data || []).reduce((sum, order) => {
        return sum + ((order.order_quantity || 0) - (order.total_received || 0));
      }, 0);

      return total;
    },
    enabled: !isNaN(componentId),
  });

  // Fetch required for orders
  const { data: requiredForOrdersData } = useQuery({
    queryKey: ['component', componentId, 'required'],
    queryFn: async () => {
      const { data: activeOrders } = await supabase
        .from('orders')
        .select(`
          order_id,
          status:order_statuses!inner (status_name)
        `)
        .not('status.status_name', 'in', '(Completed,Cancelled)');

      const activeOrderIds = activeOrders?.map(o => o.order_id) || [];

      if (activeOrderIds.length === 0) return 0;

      const { data: bomData } = await supabase
        .from('order_details')
        .select(`
          quantity,
          product:products!inner (
            billofmaterials!inner (
              component_id,
              quantity_required
            )
          )
        `)
        .in('order_id', activeOrderIds);

      let totalRequired = 0;
      (bomData || []).forEach((od: any) => {
        const orderQty = Number(od.quantity || 0);
        const bomRows = od.product?.billofmaterials || [];
        bomRows.forEach((bom: any) => {
          if (bom.component_id === componentId) {
            totalRequired += orderQty * Number(bom.quantity_required || 0);
          }
        });
      });

      return totalRequired;
    },
    enabled: !isNaN(componentId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !component) {
    return (
      <div className="container mx-auto py-6">
        <Button
          variant="ghost"
          onClick={() => router.push('/inventory')}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Inventory
        </Button>
        <div className="text-center text-destructive">
          Component not found or error loading data.
        </div>
      </div>
    );
  }

  // Normalize inventory from array to single object (one-to-one relationship)
  const inventoryRecord = Array.isArray(component.inventory) 
    ? component.inventory[0] || null 
    : component.inventory;

  const componentData = {
    ...component,
    inventory: inventoryRecord,
    on_order_quantity: onOrderData || 0,
    required_for_orders: requiredForOrdersData || 0,
  };

  return (
    <div className="max-w-7xl space-y-4">
      {/* Header - Customer page style */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="icon" asChild>
            <Link href="/inventory">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-3xl font-bold">{component.internal_code}</h1>
        </div>
        
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => setEditDialogOpen(true)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Tabs - Reduced to 5 */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab component={componentData} />
        </TabsContent>

        <TabsContent value="suppliers">
          <SuppliersTab component={componentData} />
        </TabsContent>

        <TabsContent value="transactions">
          <ComponentTransactionsTab 
            componentId={componentId} 
            componentName={component.internal_code}
            reorderLevel={inventoryRecord?.reorder_level ?? 0}
          />
        </TabsContent>

        <TabsContent value="orders">
          <OrdersTab component={componentData} />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTab component={componentData} />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <EditComponentDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        component={componentData}
      />
      <DeleteComponentDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        componentId={componentId}
        componentName={component.internal_code}
      />
    </div>
  );
}


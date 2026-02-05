'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupplier, updateSupplier, deleteSupplier } from '@/lib/api/suppliers';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/quotes';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, DollarSign, Clock, Layers, AlertCircle, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { Suspense, lazy, useMemo, useState } from 'react';
import type { SupplierPurchaseOrder } from '@/types/suppliers';

// Lazy load tab components
const SupplierForm = lazy(() => import('@/components/features/suppliers/supplier-form').then(m => ({ default: m.SupplierForm })));
const SupplierEmails = lazy(() => import('@/components/features/suppliers/supplier-emails').then(m => ({ default: m.SupplierEmails })));
const SupplierComponents = lazy(() => import('@/components/features/suppliers/supplier-components').then(m => ({ default: m.SupplierComponents })));
const SupplierPricelists = lazy(() => import('@/components/features/suppliers/supplier-pricelists').then(m => ({ default: m.SupplierPricelists })));
const SupplierOrders = lazy(() => import('@/components/features/suppliers/supplier-orders').then(m => ({ default: m.SupplierOrders })));
const SupplierReports = lazy(() => import('@/components/features/suppliers/supplier-reports').then(m => ({ default: m.SupplierReports })));

// Loading skeleton for tabs
const TabSkeleton = () => (
  <div className="space-y-4">
    <div className="border rounded-lg p-6 bg-card">
      <div className="space-y-4">
        <div className="h-4 bg-muted animate-pulse rounded w-1/4" />
        <div className="h-10 bg-muted animate-pulse rounded" />
        <div className="h-4 bg-muted animate-pulse rounded w-1/3" />
        <div className="h-10 bg-muted animate-pulse rounded" />
      </div>
    </div>
  </div>
);

// Metric card component
interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
  isLoading?: boolean;
}

function MetricCard({ title, value, icon, subtitle, isLoading }: MetricCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
              <div className="h-7 w-24 bg-muted animate-pulse rounded" />
            </div>
            <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const supplierId = Number(params.id);
  const tabParam = searchParams?.get('tab');
  const allowedTabs = new Set(['details', 'components', 'pricelists', 'orders', 'reports']);
  const activeTab = allowedTabs.has(tabParam || '') ? (tabParam as string) : 'details';

  const { data: supplier, isLoading, error } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: () => getSupplier(supplierId),
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateSupplier>[1]) =>
      updateSupplier(supplierId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSupplier(supplierId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      router.push('/suppliers');
    },
    onError: (error: Error) => {
      setDeleteDialogOpen(false);
      toast({ title: 'Cannot delete supplier', description: error.message, variant: 'destructive' });
    },
  });

  // Fetch purchase orders for metrics
  const { data: purchaseOrders = [], isLoading: isLoadingOrders } = useQuery({
    queryKey: ['supplier-purchase-orders-metrics', supplierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          purchase_order_id,
          order_date,
          created_at,
          status:supplier_order_statuses!purchase_orders_status_id_fkey(status_name),
          supplier_orders!inner(
            order_id,
            order_quantity,
            total_received,
            supplier_component:suppliercomponents!inner(
              supplier_component_id,
              price,
              supplier_id
            )
          )
        `)
        .eq('supplier_orders.suppliercomponents.supplier_id', supplierId);

      if (error) throw error;
      return (data || []) as SupplierPurchaseOrder[];
    },
    enabled: !!supplierId,
  });

  // Fetch component count for metrics
  const { data: componentCount = 0, isLoading: isLoadingComponents } = useQuery({
    queryKey: ['supplier-component-count', supplierId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('suppliercomponents')
        .select('*', { count: 'exact', head: true })
        .eq('supplier_id', supplierId);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!supplierId,
  });

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalOrders = purchaseOrders.length;

    // Calculate total spend
    const totalSpend = purchaseOrders.reduce((sum, order) => {
      return sum + order.supplier_orders.reduce((lineSum, line) => {
        return lineSum + (line.order_quantity * (line.supplier_component?.price || 0));
      }, 0);
    }, 0);

    // Calculate outstanding orders (orders with items not fully received)
    let outstandingOrders = 0;
    let outstandingValue = 0;

    purchaseOrders.forEach(order => {
      const statusName = order.status?.status_name?.toLowerCase() || '';
      // Only count as outstanding if not fully received or cancelled
      if (statusName !== 'fully received' && statusName !== 'cancelled') {
        const hasOutstanding = order.supplier_orders.some(line => line.total_received < line.order_quantity);
        if (hasOutstanding) {
          outstandingOrders++;
          order.supplier_orders.forEach(line => {
            const outstandingQty = line.order_quantity - line.total_received;
            if (outstandingQty > 0) {
              outstandingValue += outstandingQty * (line.supplier_component?.price || 0);
            }
          });
        }
      }
    });

    // Get last order date
    const lastOrderDate = purchaseOrders.length > 0
      ? new Date(purchaseOrders[0].order_date || purchaseOrders[0].created_at)
      : null;

    return {
      totalOrders,
      totalSpend,
      outstandingOrders,
      outstandingValue,
      lastOrderDate,
    };
  }, [purchaseOrders]);

  const isLoadingMetrics = isLoadingOrders || isLoadingComponents;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-10 w-32 bg-muted animate-pulse rounded" />
        </div>
        <div>
          <div className="h-9 w-64 bg-muted animate-pulse rounded mb-2" />
        </div>
        {/* Metrics skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <MetricCard key={i} title="" value="" icon={null} isLoading={true} />
          ))}
        </div>
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="h-10 w-24 bg-muted animate-pulse rounded" />
            <div className="h-10 w-24 bg-muted animate-pulse rounded" />
            <div className="h-10 w-32 bg-muted animate-pulse rounded" />
            <div className="h-10 w-32 bg-muted animate-pulse rounded" />
          </div>
          <TabSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
          </Button>
        </div>
        <div className="border border-destructive/50 rounded-lg p-6 bg-destructive/10">
          <h2 className="text-lg font-semibold text-destructive mb-2">Error loading supplier</h2>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
          </Button>
        </div>
        <div className="border rounded-lg p-6 bg-card">
          <h2 className="text-lg font-semibold mb-2">Supplier not found</h2>
          <p className="text-sm text-muted-foreground">The supplier you're looking for doesn't exist or has been deleted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/suppliers" aria-label="Back to Suppliers">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Suppliers
          </Link>
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{supplier.name}</h1>
          {!supplier.is_active && (
            <Badge variant="secondary" className="text-xs">Inactive</Badge>
          )}
          <div className="flex items-center gap-2 ml-4">
            <Switch
              checked={supplier.is_active}
              onCheckedChange={(checked) => {
                updateMutation.mutate({ is_active: checked });
              }}
              disabled={updateMutation.isPending}
            />
            <span className="text-sm text-muted-foreground">
              {supplier.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleteDialogOpen(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Supplier
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total Orders"
          value={metrics.totalOrders.toString()}
          icon={<Package className="h-5 w-5" />}
          isLoading={isLoadingMetrics}
        />
        <MetricCard
          title="Total Spend"
          value={formatCurrency(metrics.totalSpend)}
          icon={<DollarSign className="h-5 w-5" />}
          isLoading={isLoadingMetrics}
        />
        <MetricCard
          title="Outstanding"
          value={metrics.outstandingOrders.toString()}
          icon={<AlertCircle className="h-5 w-5" />}
          subtitle={metrics.outstandingValue > 0 ? formatCurrency(metrics.outstandingValue) : undefined}
          isLoading={isLoadingMetrics}
        />
        <MetricCard
          title="Components"
          value={componentCount.toString()}
          icon={<Layers className="h-5 w-5" />}
          isLoading={isLoadingMetrics}
        />
        <MetricCard
          title="Last Order"
          value={metrics.lastOrderDate
            ? metrics.lastOrderDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'Never'}
          icon={<Clock className="h-5 w-5" />}
          isLoading={isLoadingMetrics}
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          router.push(`/suppliers/${supplierId}?tab=${value}`);
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="pricelists">Price Lists</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <div className="border rounded-lg p-6 bg-card">
              <SupplierForm
                supplier={supplier}
                onSubmit={async (data) => {
                  const { emails, ...supplierData } = data;
                  await updateMutation.mutateAsync(supplierData);
                }}
              />
            </div>
            <div className="border rounded-lg p-6 bg-card">
              <h2 className="text-lg font-semibold mb-4">Emails</h2>
              <SupplierEmails supplier={supplier} />
            </div>
          </Suspense>
        </TabsContent>

        <TabsContent value="components" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierComponents supplier={supplier} />
          </Suspense>
        </TabsContent>

        <TabsContent value="pricelists" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierPricelists supplier={supplier} />
          </Suspense>
        </TabsContent>

        <TabsContent value="orders" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierOrders supplier={supplier} />
          </Suspense>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Suspense fallback={<TabSkeleton />}>
            <SupplierReports supplier={supplier} />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{supplier.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

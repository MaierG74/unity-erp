'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  Calendar,
  DollarSign,
  Loader2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type ComponentData = {
  component_id: number;
  internal_code: string;
  inventory: Array<{
    quantity_on_hand: number;
    reorder_level: number | null;
  }> | null;
  supplierComponents: Array<{
    price: number;
  }>;
  on_order_quantity?: number;
  required_for_orders?: number;
};

type AnalyticsTabProps = {
  component: ComponentData;
};

export function AnalyticsTab({ component }: AnalyticsTabProps) {
  const inventory = Array.isArray(component.inventory) ? component.inventory[0] : component.inventory;
  const currentStock = inventory?.quantity_on_hand || 0;
  const reorderLevel = inventory?.reorder_level || 0;
  const onOrder = component.on_order_quantity || 0;
  const required = component.required_for_orders || 0;

  // Fetch transaction statistics
  const { data: transactionStats, isLoading: isLoadingTransactions } = useQuery({
    queryKey: ['component', component.component_id, 'transaction-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('quantity, transaction_date')
        .eq('component_id', component.component_id);

      if (error) throw error;

      const additions = data.filter((t) => (t.quantity || 0) > 0);
      const deductions = data.filter((t) => (t.quantity || 0) < 0);

      const totalAdded = additions.reduce((sum, t) => sum + (t.quantity || 0), 0);
      const totalRemoved = Math.abs(
        deductions.reduce((sum, t) => sum + (t.quantity || 0), 0)
      );

      // Last 30 days activity
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentTransactions = data.filter(
        (t) => new Date(t.transaction_date) >= thirtyDaysAgo
      );

      const lastTransaction = data.length > 0 ? data[data.length - 1] : null;

      return {
        totalTransactions: data.length,
        totalAdded,
        totalRemoved,
        recentActivity: recentTransactions.length,
        lastTransaction: lastTransaction?.transaction_date,
      };
    },
  });

  // Fetch usage rate statistics
  const { data: usageStats } = useQuery({
    queryKey: ['component', component.component_id, 'usage-stats'],
    queryFn: async () => {
      // Get OUT transactions from last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('quantity, transaction_date')
        .eq('component_id', component.component_id)
        .lt('quantity', 0) // Only OUT transactions
        .gte('transaction_date', ninetyDaysAgo.toISOString());

      if (error) throw error;

      const totalUsed = Math.abs((data || []).reduce((sum, t) => sum + (t.quantity || 0), 0));
      const avgDailyUsage = totalUsed / 90;
      const avgWeeklyUsage = avgDailyUsage * 7;

      return { totalUsed, avgDailyUsage, avgWeeklyUsage };
    },
  });

  // Fetch order breakdown
  const { data: orderBreakdown } = useQuery({
    queryKey: ['component', component.component_id, 'order-breakdown'],
    queryFn: async () => {
      // Get products that use this component
      const { data: bomData, error: bomError } = await supabase
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

      if (bomError) throw bomError;

      const productIds = (bomData || [])
        .map((b: any) => b.product?.product_id)
        .filter(Boolean);

      if (productIds.length === 0) return [];

      const { data: orderDetails, error: ordersError } = await supabase
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

      if (ordersError) throw ordersError;

      // Calculate component needs per order
      return (orderDetails || [])
        .filter((od: any) => {
          const bom = od.product?.billofmaterials || [];
          return bom.some((b: any) => b.component_id === component.component_id);
        })
        .map((od: any) => {
          const bom = od.product?.billofmaterials?.find(
            (b: any) => b.component_id === component.component_id
          );
          const needed = (od.quantity || 0) * (bom?.quantity_required || 0);

          return {
            order_id: od.order?.order_id,
            order_number: od.order?.order_number,
            order_date: od.order?.order_date,
            status: od.order?.status?.status_name,
            product_code: od.product?.internal_code,
            product_name: od.product?.name,
            order_quantity: od.quantity,
            component_needed: needed,
          };
        });
    },
  });

  // Calculate stock health metrics with demand consideration
  const stockHealth = () => {
    // Priority 1: Out of stock
    if (currentStock <= 0) return 'critical';
    
    // Priority 2: Insufficient even with incoming orders
    if (currentStock + onOrder < required) return 'insufficient';
    
    // Priority 3: Low stock (below reorder level)
    if (currentStock <= reorderLevel) return 'low';
    
    // Priority 4: High but needed for orders
    if (currentStock > reorderLevel * 3 && required > currentStock) return 'highButNeeded';
    
    // Priority 5: Overstocked (high and not needed)
    if (currentStock > reorderLevel * 3) return 'excess';
    
    // Default: Healthy
    return 'healthy';
  };

  const health = stockHealth();

  const healthConfig = {
    critical: {
      label: 'Critical',
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      description: 'Out of stock - immediate action required',
    },
    insufficient: {
      label: 'Insufficient',
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      description: 'Stock + incoming orders insufficient to meet demand',
    },
    low: {
      label: 'Low Stock',
      color: 'text-amber-600',
      bgColor: 'bg-amber-100',
      description: 'Below reorder level - replenish soon',
    },
    highButNeeded: {
      label: 'High but Needed',
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
      description: 'Stock is high but required for active orders',
    },
    healthy: {
      label: 'Healthy',
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      description: 'Stock levels are optimal',
    },
    excess: {
      label: 'Overstocked',
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
      description: 'Stock levels are high - consider adjusting orders',
    },
  };

  const currentHealth = healthConfig[health];

  // Calculate turnover and projections
  const projectedStockAfterOrders = currentStock + onOrder - required;
  const isProjectedLow = projectedStockAfterOrders <= reorderLevel;
  const isProjectedNegative = projectedStockAfterOrders < 0;
  const isInsufficientForOrders = currentStock < required;

  // Price statistics
  const prices = component.supplierComponents.map((sc) => Number(sc.price));
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const stockValue = currentStock * avgPrice;

  // Cost analysis
  const requiredValue = required * avgPrice;
  const shortfallValue = Math.max(0, required - currentStock - onOrder) * avgPrice;
  const costPerDayStockout = (usageStats?.avgDailyUsage || 0) * avgPrice;

  // Lead time projections
  const daysUntilStockout =
    usageStats?.avgDailyUsage && usageStats.avgDailyUsage > 0
      ? Math.floor(currentStock / usageStats.avgDailyUsage)
      : null;
  const criticalWindow = daysUntilStockout !== null && daysUntilStockout < 30;

  if (isLoadingTransactions) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stock Health */}
      <Card className={cn('border-2', currentHealth.bgColor)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className={cn('h-5 w-5', currentHealth.color)} />
            Stock Health: <span className={currentHealth.color}>{currentHealth.label}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{currentHealth.description}</p>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Current Stock:</span>
              <span className="font-semibold">{currentStock}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Reorder Level:</span>
              <span className="font-semibold">{reorderLevel}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Stock Cushion:</span>
              <span className={cn('font-semibold', currentStock > reorderLevel ? 'text-green-600' : 'text-red-600')}>
                {currentStock - reorderLevel} units
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat('en-ZA', {
                style: 'currency',
                currency: 'ZAR',
              }).format(stockValue)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {currentStock} units @ avg {new Intl.NumberFormat('en-ZA', {
                style: 'currency',
                currency: 'ZAR',
              }).format(avgPrice)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{transactionStats?.totalTransactions || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {transactionStats?.recentActivity || 0} in last 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Added</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {transactionStats?.totalAdded || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Lifetime additions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Removed</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {transactionStats?.totalRemoved || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Lifetime deductions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Daily Usage</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {usageStats?.avgDailyUsage ? usageStats.avgDailyUsage.toFixed(1) : '0.0'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Based on 90 days</p>
          </CardContent>
        </Card>

        <Card className={cn(criticalWindow && 'border-red-500 bg-red-50')}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Days Until Stockout</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn('text-2xl font-bold', criticalWindow && 'text-red-600')}>
              {daysUntilStockout !== null ? daysUntilStockout : '∞'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">At current usage rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Shortfall Value</CardTitle>
            <DollarSign className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {shortfallValue > 0
                ? new Intl.NumberFormat('en-ZA', {
                    style: 'currency',
                    currency: 'ZAR',
                    maximumFractionDigits: 0,
                  }).format(shortfallValue)
                : '-'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Value at risk</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Daily Consumption Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat('en-ZA', {
                style: 'currency',
                currency: 'ZAR',
                maximumFractionDigits: 0,
              }).format(costPerDayStockout)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Avg daily cost</p>
          </CardContent>
        </Card>
      </div>

      {/* Stock Visual Gauge */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Stock Visual
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="h-12 relative bg-muted rounded-lg overflow-hidden">
              {/* Current stock bar */}
              <div
                className={cn(
                  'h-full transition-all',
                  currentStock <= 0
                    ? 'bg-red-500'
                    : currentStock < required
                    ? 'bg-amber-500'
                    : 'bg-green-500'
                )}
                style={{
                  width: `${Math.min(
                    (currentStock / Math.max(required, reorderLevel * 2, 1)) * 100,
                    100
                  )}%`,
                }}
              />
              {/* Reorder level marker */}
              {reorderLevel > 0 && (
                <div
                  className="absolute top-0 h-full border-l-2 border-amber-700"
                  style={{
                    left: `${Math.min(
                      (reorderLevel / Math.max(required, reorderLevel * 2, 1)) * 100,
                      100
                    )}%`,
                  }}
                >
                  <div className="absolute top-0 left-0 transform -translate-x-1/2 -translate-y-full mb-1">
                    <div className="bg-amber-700 text-white text-xs px-1 rounded whitespace-nowrap">
                      Reorder
                    </div>
                  </div>
                </div>
              )}
              {/* Required marker */}
              {required > 0 && (
                <div
                  className="absolute top-0 h-full border-l-2 border-purple-700"
                  style={{
                    left: `${Math.min(
                      (required / Math.max(required, reorderLevel * 2, 1)) * 100,
                      100
                    )}%`,
                  }}
                >
                  <div className="absolute bottom-0 left-0 transform -translate-x-1/2 translate-y-full mt-1">
                    <div className="bg-purple-700 text-white text-xs px-1 rounded whitespace-nowrap">
                      Required
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Current: <span className="font-semibold">{currentStock}</span>
              </span>
              <span>
                Reorder: <span className="font-semibold">{reorderLevel}</span>
              </span>
              <span>
                Required: <span className="font-semibold">{required}</span>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stock Projection */}
      <Card
        className={cn(
          'border-2',
          isInsufficientForOrders && 'border-red-500 bg-red-50',
          !isInsufficientForOrders && isProjectedLow && 'border-amber-500 bg-amber-50'
        )}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Stock Status & Projection
            {isInsufficientForOrders && (
              <Badge variant="destructive" className="ml-auto">
                CURRENT SHORTAGE
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Status Section */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-muted-foreground">Current Status</div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Available Now:</span>
              <Badge variant="outline" className="font-semibold">
                {currentStock}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Required for Active Orders:</span>
              <Badge variant="outline" className="font-semibold text-purple-600">
                {required}
              </Badge>
            </div>
            <div className="border-t pt-2">
              <div className="flex justify-between items-center">
                <span className="font-medium">Current Shortage:</span>
                <Badge
                  className={cn(
                    'font-semibold text-lg',
                    isInsufficientForOrders
                      ? 'bg-red-100 text-red-800 border-red-300'
                      : 'bg-green-100 text-green-800 border-green-300'
                  )}
                >
                  {isInsufficientForOrders ? `-${required - currentStock}` : '0'}
                </Badge>
              </div>
            </div>
          </div>

          {/* Future Projection Section */}
          <div className="space-y-3 pt-3 border-t">
            <div className="text-sm font-semibold text-muted-foreground">After Incoming Stock</div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Incoming (On Order):</span>
              <Badge variant="outline" className="font-semibold text-blue-600">
                +{onOrder}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Available:</span>
              <Badge variant="outline" className="font-semibold">
                {currentStock + onOrder}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Still Needed for Orders:</span>
              <Badge variant="outline" className="font-semibold text-purple-600">
                {required}
              </Badge>
            </div>
            <div className="border-t pt-2">
              <div className="flex justify-between items-center">
                <span className="font-medium">Stock After Orders Fulfilled:</span>
                <Badge
                  className={cn(
                    'font-semibold text-lg',
                    projectedStockAfterOrders < 0
                      ? 'bg-red-100 text-red-800 border-red-300'
                      : projectedStockAfterOrders <= reorderLevel
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-green-100 text-green-800 border-green-300'
                  )}
                >
                  {projectedStockAfterOrders}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Remaining after all active orders are completed
              </p>
            </div>
          </div>

          {/* Warnings */}
          {isInsufficientForOrders && (
            <div className="bg-red-100 border border-red-300 rounded-lg p-4 mt-4">
              <p className="text-sm text-red-800">
                <strong>🚨 IMMEDIATE ACTION REQUIRED:</strong> You are currently short{' '}
                {required - currentStock} units for active orders.
                {onOrder > 0 && (
                  <>
                    {' '}
                    Even with {onOrder} units on order, you'll{' '}
                    {projectedStockAfterOrders < 0
                      ? `still be short ${Math.abs(projectedStockAfterOrders)} units`
                      : `have ${projectedStockAfterOrders} units remaining`}
                    .
                  </>
                )}
              </p>
            </div>
          )}

          {!isInsufficientForOrders && projectedStockAfterOrders < 0 && (
            <div className="bg-red-100 border border-red-300 rounded-lg p-4 mt-4">
              <p className="text-sm text-red-800">
                <strong>⚠️ Future Shortage:</strong> While you have enough now, after incoming
                stock arrives and orders are fulfilled, you'll be short{' '}
                {Math.abs(projectedStockAfterOrders)} units.
              </p>
            </div>
          )}

          {!isInsufficientForOrders &&
            projectedStockAfterOrders >= 0 &&
            projectedStockAfterOrders <= reorderLevel && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-4">
                <p className="text-sm text-amber-800">
                  <strong>⚠️ Low Stock Warning:</strong> After fulfilling orders, you'll have{' '}
                  {projectedStockAfterOrders} units remaining, which is at or below your reorder
                  level of {reorderLevel}. Consider placing additional orders.
                </p>
              </div>
            )}
        </CardContent>
      </Card>

      {/* Order Breakdown */}
      {orderBreakdown && orderBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Order Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Detailed breakdown of which orders require this component
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Number</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Order Qty</TableHead>
                  <TableHead className="text-right">Component Needed</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderBreakdown.map((order: any, index: number) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Link
                        href={`/orders/${order.order_id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {order.order_number || 'N/A'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-mono text-sm">{order.product_code}</div>
                        <div className="text-xs text-muted-foreground">{order.product_name}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{order.order_quantity}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="font-semibold text-purple-600">
                        {order.component_needed}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {order.order_date
                        ? new Date(order.order_date).toLocaleDateString()
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{order.status || 'Unknown'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Total Component Requirement:</span>
                <span className="font-bold text-purple-600">
                  {orderBreakdown.reduce((sum: number, order: any) => sum + order.component_needed, 0)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Last Activity:</span>
            <span className="text-sm font-medium">
              {transactionStats?.lastTransaction
                ? new Date(transactionStats.lastTransaction).toLocaleDateString()
                : 'No activity'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Suppliers:</span>
            <span className="text-sm font-medium">{component.supplierComponents.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Avg Unit Price:</span>
            <span className="text-sm font-medium">
              {new Intl.NumberFormat('en-ZA', {
                style: 'currency',
                currency: 'ZAR',
              }).format(avgPrice)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


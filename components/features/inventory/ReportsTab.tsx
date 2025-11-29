'use client';

import { useMemo, useState, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, AlertTriangle, Package, TrendingDown, BarChart3, ChevronDown, ChevronRight, Clock, Mail, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AffectedOrders } from './AffectedOrders';

type Component = {
  component_id: number;
  internal_code: string;
  description: string | null;
  category: {
    categoryname: string;
  } | null;
  inventory: Array<{
    quantity_on_hand: number;
    reorder_level: number | null;
  }> | null;
};

type CriticalComponent = {
  component_id: number;
  internal_code: string;
  description: string | null;
  currentStock: number;
  onOrder: number;
  required: number;
  immediateShortage: number;
  projectedShortage: number;
  severity: 'critical' | 'immediate';
  affectedOrders: string[]; // order numbers
  isCoveredByOrder?: boolean;
  draftPOQuantity: number;
};

export function ReportsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expandedComponentId, setExpandedComponentId] = useState<number | null>(null);
  const [expandedOnOrderId, setExpandedOnOrderId] = useState<number | null>(null);
  const [sendingFollowUp, setSendingFollowUp] = useState<number | null>(null);

  const sendFollowUpEmail = async (componentId: number, componentCode: string) => {
    setSendingFollowUp(componentId);
    try {
      const response = await fetch('/api/send-follow-up-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ componentId }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: 'Follow-up sent',
          description: result.message,
        });
        // Refresh the follow-up history
        queryClient.invalidateQueries({ queryKey: ['inventory', 'component-follow-ups', componentId] });
      } else {
        toast({
          title: 'Failed to send',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send follow-up email',
        variant: 'destructive',
      });
    } finally {
      setSendingFollowUp(null);
    }
  };

  const toggleExpand = (componentId: number) => {
    setExpandedComponentId(expandedComponentId === componentId ? null : componentId);
  };

  const toggleOnOrderExpand = (componentId: number) => {
    setExpandedOnOrderId(expandedOnOrderId === componentId ? null : componentId);
  };

  // Fetch all components with inventory
  const { data: components = [], isLoading, error } = useQuery({
    queryKey: ['inventory', 'components', 'reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select(`
          component_id,
          internal_code,
          description,
          category:component_categories (
            categoryname
          ),
          inventory:inventory (
            quantity_on_hand,
            reorder_level
          )
        `)
        .order('internal_code');

      if (error) {
        console.error('Error fetching components:', error);
        throw error;
      }

      return data as Component[];
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Calculate stock status
  const stockStatus = useMemo(() => {
    const outOfStock: Component[] = [];
    const lowStock: Component[] = [];
    const inStock: Component[] = [];

    components.forEach((component) => {
      const quantity = component.inventory?.[0]?.quantity_on_hand || 0;
      const reorderLevel = component.inventory?.[0]?.reorder_level || 0;

      if (quantity <= 0) {
        outOfStock.push(component);
      } else if (quantity <= reorderLevel) {
        lowStock.push(component);
      } else {
        inStock.push(component);
      }
    });

    return { outOfStock, lowStock, inStock };
  }, [components]);

  // Fetch critical components data using RPC that accounts for FG coverage
  const { data: criticalData = { toOrder: [], onOrderFollowUp: [] }, isLoading: isLoadingCritical } = useQuery({
    queryKey: ['inventory', 'critical-components'],
    queryFn: async () => {
      try {
        // Use the RPC function that properly accounts for FG reservations and calculates global shortfalls
        const { data, error } = await supabase.rpc('get_global_component_requirements');

        if (error) {
          console.error('Error fetching critical components:', error);
          throw error;
        }

        if (!data || data.length === 0) return { toOrder: [], onOrderFollowUp: [] };

        // Map all components with shortfalls
        const allCritical: CriticalComponent[] = (data || [])
          .filter((item: any) => {
            const globalShortfall = Number(item.global_real_shortfall || 0);
            const apparentShortfall = Number(item.global_apparent_shortfall || 0);
            // Include if there's any shortfall (apparent or real)
            return apparentShortfall > 0 || globalShortfall > 0;
          })
          .map((item: any) => {
            const globalShortfall = Number(item.global_real_shortfall || 0);
            const apparentShortfall = Number(item.global_apparent_shortfall || 0);
            const currentStock = Number(item.in_stock || 0);
            const onOrder = Number(item.on_order || 0);
            const required = Number(item.total_required || 0);
            
            // Determine if already covered by existing orders
            const isCoveredByOrder = (currentStock + onOrder) >= required;

            return {
              component_id: item.component_id,
              internal_code: item.internal_code,
              description: item.description,
              currentStock,
              onOrder,
              required,
              immediateShortage: apparentShortfall,
              projectedShortage: globalShortfall,
              severity: (globalShortfall > 0 ? 'critical' : 'immediate') as 'critical' | 'immediate',
              affectedOrders: [],
              isCoveredByOrder,
              draftPOQuantity: Number(item.draft_po_quantity || 0)
            };
          });

        // Split into two categories:
        // 1. Need to order: not covered by existing orders
        // 2. On order (follow up): covered by existing orders but not yet received
        const toOrder = allCritical.filter(c => !c.isCoveredByOrder);
        const onOrderFollowUp = allCritical.filter(c => c.isCoveredByOrder && c.onOrder > 0);

        // Sort: critical first, then by shortage amount
        toOrder.sort((a, b) => {
          if (a.severity !== b.severity) {
            return a.severity === 'critical' ? -1 : 1;
          }
          return b.projectedShortage - a.projectedShortage || b.immediateShortage - a.immediateShortage;
        });

        onOrderFollowUp.sort((a, b) => b.onOrder - a.onOrder);

        return { toOrder, onOrderFollowUp };
      } catch (error) {
        console.error('Error fetching critical components:', error);
        throw error;
      }
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'components', 'reports'] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'critical-components'] });
    toast({
      title: 'Data refreshed',
      description: 'Reports have been refreshed.',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-lg">Loading reports...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-destructive">Error loading reports: {(error as Error).message}</div>
      </div>
    );
  }

  const totalComponents = components.length;
  const outOfStockPercentage = totalComponents > 0
    ? ((stockStatus.outOfStock.length / totalComponents) * 100).toFixed(1)
    : '0';
  const lowStockPercentage = totalComponents > 0
    ? ((stockStatus.lowStock.length / totalComponents) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Inventory Reports</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Stock status overview and analytics
          </p>
        </div>
        <Button onClick={refreshData} className="h-9" variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stock Status Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">Total Components</p>
          </div>
          <p className="text-2xl font-bold mt-2">{totalComponents}</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-green-600" />
            <p className="text-sm font-medium text-muted-foreground">In Stock</p>
          </div>
          <p className="text-2xl font-bold mt-2 text-green-600">
            {stockStatus.inStock.length}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <p className="text-sm font-medium text-muted-foreground">Low Stock</p>
          </div>
          <p className="text-2xl font-bold mt-2 text-amber-600">
            {stockStatus.lowStock.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{lowStockPercentage}%</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-destructive" />
            <p className="text-sm font-medium text-muted-foreground">Out of Stock</p>
          </div>
          <p className="text-2xl font-bold mt-2 text-destructive">
            {stockStatus.outOfStock.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{outOfStockPercentage}%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low Stock Alert */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Low Stock Alert
            </CardTitle>
            <CardDescription>
              Components at or below reorder level
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stockStatus.lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No components are currently low on stock
              </p>
            ) : (
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Reorder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockStatus.lowStock.map((component) => (
                      <TableRow key={component.component_id}>
                        <TableCell className="font-medium">
                          {component.internal_code}
                        </TableCell>
                        <TableCell className="text-sm">
                          {component.description || '-'}
                        </TableCell>
                        <TableCell className="text-right text-amber-600 font-semibold">
                          {component.inventory?.[0]?.quantity_on_hand || 0}
                        </TableCell>
                        <TableCell className="text-right">
                          {component.inventory?.[0]?.reorder_level || 0}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Out of Stock */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-destructive" />
              Out of Stock
            </CardTitle>
            <CardDescription>
              Components with zero quantity
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stockStatus.outOfStock.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                All components are in stock
              </p>
            ) : (
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockStatus.outOfStock.map((component) => (
                      <TableRow key={component.component_id}>
                        <TableCell className="font-medium">
                          {component.internal_code}
                        </TableCell>
                        <TableCell className="text-sm">
                          {component.description || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {component.category?.categoryname || 'Uncategorized'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Critical Components to Order */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            Critical Components to Order
          </CardTitle>
          <CardDescription>
            Components needed for active orders - not yet ordered or insufficient on order
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingCritical ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">Loading critical components...</div>
            </div>
          ) : criticalData.toOrder.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <Package className="h-12 w-12 text-green-600 mx-auto mb-2" />
                <p className="text-sm font-medium text-green-600">All Good!</p>
                <p className="text-xs text-muted-foreground mt-1">
                  No components need ordering - all shortfalls are covered by existing orders
                </p>
              </div>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">On Order</TableHead>
                    <TableHead className="text-right">Draft PO</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead className="text-right">Shortage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {criticalData.toOrder.map((component) => {
                    const shortage = component.severity === 'critical'
                      ? component.projectedShortage
                      : component.immediateShortage;
                    const isExpanded = expandedComponentId === component.component_id;

                    return (
                      <Fragment key={component.component_id}>
                        <TableRow
                          className={
                            component.severity === 'critical'
                              ? 'bg-red-50 hover:bg-red-100'
                              : 'bg-amber-50 hover:bg-amber-100'
                          }
                        >
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => toggleExpand(component.component_id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            <a
                              href={`/inventory/components/${component.component_id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {component.internal_code}
                            </a>
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {component.description || '-'}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {component.currentStock}
                          </TableCell>
                          <TableCell className="text-right text-blue-600">
                            {component.onOrder}
                          </TableCell>
                          <TableCell className="text-right">
                            {component.draftPOQuantity > 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                                {component.draftPOQuantity}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-purple-600 font-semibold">
                            {component.required}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={component.severity === 'critical' ? 'destructive' : 'default'}
                              className={
                                component.severity === 'critical'
                                  ? ''
                                  : 'bg-amber-600 hover:bg-amber-700'
                              }
                            >
                              -{shortage}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={8} className="p-4">
                              <AffectedOrders componentId={component.component_id} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Components On Order - Need Follow Up */}
      {criticalData.onOrderFollowUp.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" />
              Components On Order - Follow Up
            </CardTitle>
            <CardDescription>
              Components with shortfall but already covered by existing purchase orders - awaiting delivery
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">On Order</TableHead>
                    <TableHead className="text-right">Draft PO</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-center w-[100px]">Follow Up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {criticalData.onOrderFollowUp.map((component) => {
                    const expectedTotal = component.currentStock + component.onOrder;
                    const surplus = expectedTotal - component.required;
                    const isExpanded = expandedOnOrderId === component.component_id;
                    const isSending = sendingFollowUp === component.component_id;

                    return (
                      <Fragment key={component.component_id}>
                        <TableRow className="bg-blue-50 hover:bg-blue-100">
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => toggleOnOrderExpand(component.component_id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            <a
                              href={`/inventory/components/${component.component_id}`}
                              className="text-blue-600 hover:underline"
                            >
                              {component.internal_code}
                            </a>
                          </TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {component.description || '-'}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {component.currentStock}
                          </TableCell>
                          <TableCell className="text-right text-blue-600 font-semibold">
                            {component.onOrder}
                          </TableCell>
                          <TableCell className="text-right">
                            {component.draftPOQuantity > 0 ? (
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-amber-100 text-amber-800 border border-amber-200">
                                {component.draftPOQuantity}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-purple-600">
                            {component.required}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300">
                              +{surplus} surplus
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-blue-600 border-blue-300 hover:bg-blue-100"
                              onClick={() => sendFollowUpEmail(component.component_id, component.internal_code)}
                              disabled={isSending}
                            >
                              {isSending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Mail className="h-4 w-4 mr-1" />
                                  Email
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={9} className="p-4">
                              <AffectedOrders componentId={component.component_id} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

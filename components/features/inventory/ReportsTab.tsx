'use client';

import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, AlertTriangle, Package, TrendingDown, BarChart3 } from 'lucide-react';
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

export function ReportsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  // Calculate category distribution
  const categoryDistribution = useMemo(() => {
    const distribution = new Map<string, number>();

    components.forEach((component) => {
      const categoryName = component.category?.categoryname || 'Uncategorized';
      distribution.set(categoryName, (distribution.get(categoryName) || 0) + 1);
    });

    return Array.from(distribution.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [components]);

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'components', 'reports'] });
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

      {/* Category Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Category Distribution
          </CardTitle>
          <CardDescription>
            Number of components by category
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {categoryDistribution.map((item) => {
              const percentage = totalComponents > 0
                ? ((item.count / totalComponents) * 100).toFixed(1)
                : '0';

              return (
                <div key={item.name} className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{item.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {item.count} ({percentage}%)
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


'use client';

import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/common/auth-provider';
import { Package, AlertTriangle, TrendingDown, Loader2 } from 'lucide-react';
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

export function ReportsOverviewTab() {
  const { user } = useAuth();

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
    enabled: !!user,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const stockStatus = useMemo(() => {
    const outOfStock: Component[] = [];
    const lowStock: Component[] = [];
    const inStock: Component[] = [];

    components.forEach((component) => {
      const inv = Array.isArray(component.inventory)
        ? component.inventory[0]
        : component.inventory;
      const quantity = inv?.quantity_on_hand || 0;
      const reorderLevel = inv?.reorder_level || 0;

      if (quantity <= 0) {
        outOfStock.push(component);
      } else if (reorderLevel > 0 && quantity <= reorderLevel) {
        lowStock.push(component);
      } else if (quantity > 0) {
        inStock.push(component);
      }
    });

    return { outOfStock, lowStock, inStock };
  }, [components]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
    <div className="space-y-4">
      {/* Stock Status Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">Total Components</p>
          </div>
          <p className="text-2xl font-bold mt-2">{totalComponents}</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-green-600" />
            <p className="text-sm font-medium text-muted-foreground">In Stock</p>
          </div>
          <p className="text-2xl font-bold mt-2 text-green-600">
            {stockStatus.inStock.length}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <p className="text-sm font-medium text-muted-foreground">Low Stock</p>
          </div>
          <p className="text-2xl font-bold mt-2 text-amber-600">
            {stockStatus.lowStock.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{lowStockPercentage}%</p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
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
                    {stockStatus.lowStock.map((component) => {
                      const inv = Array.isArray(component.inventory)
                        ? component.inventory[0]
                        : component.inventory;
                      return (
                        <TableRow key={component.component_id}>
                          <TableCell className="font-medium">
                            {component.internal_code}
                          </TableCell>
                          <TableCell className="text-sm">
                            {component.description || '-'}
                          </TableCell>
                          <TableCell className="text-right text-amber-600 dark:text-amber-400 font-semibold">
                            {inv?.quantity_on_hand || 0}
                          </TableCell>
                          <TableCell className="text-right">
                            {inv?.reorder_level || 0}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
    </div>
  );
}

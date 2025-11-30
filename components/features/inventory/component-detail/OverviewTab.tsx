'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Package, 
  AlertTriangle, 
  TrendingUp, 
  MapPin, 
  Tag,
  Users,
  ShoppingCart,
  Calendar
} from 'lucide-react';
import { cn } from '@/lib/utils';

type ComponentData = {
  component_id: number;
  internal_code: string;
  description: string | null;
  image_url: string | null;
  category: {
    cat_id: number;
    categoryname: string;
  } | null;
  unit: {
    unit_id: number;
    unit_code: string;
    unit_name: string;
  } | null;
  inventory: Array<{
    inventory_id: number;
    quantity_on_hand: number;
    location: string | null;
    reorder_level: number | null;
  }> | null;
  supplierComponents: Array<{
    supplier_component_id: number;
    supplier_id: number;
    supplier_code: string;
    price: number;
    supplier: {
      supplier_id: number;
      name: string;
    };
  }>;
  on_order_quantity?: number;
  required_for_orders?: number;
};

type OverviewTabProps = {
  component: ComponentData;
};

export function OverviewTab({ component }: OverviewTabProps) {
  const inventory = component.inventory?.[0];
  const quantityOnHand = inventory?.quantity_on_hand || 0;
  const reorderLevel = inventory?.reorder_level || 0;
  const location = inventory?.location || 'Not set';
  const onOrder = component.on_order_quantity || 0;
  const requiredForOrders = component.required_for_orders || 0;

  const isOutOfStock = quantityOnHand <= 0;
  const isLowStock = quantityOnHand > 0 && quantityOnHand <= reorderLevel;
  const isInStock = quantityOnHand > reorderLevel;

  const stockStatus = isOutOfStock
    ? 'Out of Stock'
    : isLowStock
    ? 'Low Stock'
    : 'In Stock';

  const stockStatusColor = isOutOfStock
    ? 'destructive'
    : isLowStock
    ? 'default'
    : 'default';

  // Calculate average price from suppliers
  const avgPrice =
    component.supplierComponents.length > 0
      ? component.supplierComponents.reduce((sum, sc) => sum + Number(sc.price || 0), 0) /
        component.supplierComponents.length
      : 0;

  return (
    <div className="space-y-6">
      {/* Main Info Card with Image */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-6">
            {/* Image */}
            <div className="flex-shrink-0">
              <Avatar className="h-32 w-32 rounded-lg">
                <AvatarImage 
                  src={component.image_url || undefined} 
                  className="object-cover"
                />
                <AvatarFallback className="rounded-lg text-2xl">
                  {component.internal_code.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>

            {/* Details */}
            <div className="flex-1 space-y-4">
              <div>
                <h2 className="text-2xl font-bold">{component.internal_code}</h2>
                <p className="text-muted-foreground mt-1">
                  {component.description || 'No description available'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge 
                  variant={stockStatusColor}
                  className={cn(
                    isInStock && 'bg-green-100 text-green-800 border-green-300 hover:bg-green-100',
                    isLowStock && 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100'
                  )}
                >
                  {stockStatus}
                </Badge>
                <Badge variant="outline">
                  <Tag className="h-3 w-3 mr-1" />
                  {component.category?.categoryname || 'Uncategorized'}
                </Badge>
                <Badge variant="outline">
                  {component.unit?.unit_name || 'N/A'}
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-medium flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {location}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Suppliers</p>
                  <p className="font-medium flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {component.supplierComponents.length}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Price</p>
                  <p className="font-medium">
                    {avgPrice > 0
                      ? new Intl.NumberFormat('en-ZA', {
                          style: 'currency',
                          currency: 'ZAR',
                        }).format(avgPrice)
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Unit</p>
                  <p className="font-medium">{component.unit?.unit_name || 'N/A'}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stock Information Grid - with subtle gradients */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Current Stock */}
        <Card className={cn(
          isOutOfStock && 'bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/30 dark:to-red-900/20 border-red-200 dark:border-red-800',
          isLowStock && 'bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/20 border-amber-200 dark:border-amber-800',
          isInStock && 'bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950/30 dark:to-green-900/20 border-green-200 dark:border-green-800'
        )}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Stock</CardTitle>
            <Package className={cn(
              "h-4 w-4",
              isOutOfStock && 'text-red-600',
              isLowStock && 'text-amber-600',
              isInStock && 'text-green-600'
            )} />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              <span
                className={cn(
                  isOutOfStock && 'text-red-700 dark:text-red-400',
                  isLowStock && 'text-amber-700 dark:text-amber-400',
                  isInStock && 'text-green-700 dark:text-green-400'
                )}
              >
                {quantityOnHand}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {component.unit?.unit_name || 'units'}
            </p>
          </CardContent>
        </Card>

        {/* Reorder Level */}
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/30 dark:to-slate-900/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reorder Level</CardTitle>
            <AlertTriangle className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{reorderLevel}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {quantityOnHand <= reorderLevel && quantityOnHand > 0
                ? 'Below threshold'
                : quantityOnHand <= 0
                ? 'Out of stock'
                : 'Stock OK'}
            </p>
          </CardContent>
        </Card>

        {/* On Order */}
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200 dark:border-blue-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">On Order</CardTitle>
            <ShoppingCart className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-700 dark:text-blue-400">{onOrder}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {onOrder > 0 ? 'Incoming stock' : 'No orders pending'}
            </p>
          </CardContent>
        </Card>

        {/* Required for Orders */}
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border-purple-200 dark:border-purple-800">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Required</CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-700 dark:text-purple-400">
              {requiredForOrders}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {requiredForOrders > 0 ? 'For active orders' : 'No demand'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Suppliers List */}
      {component.supplierComponents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Suppliers ({component.supplierComponents.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {component.supplierComponents.map((sc) => (
                <div
                  key={sc.supplier_component_id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-medium">{sc.supplier.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Code: {sc.supplier_code}
                    </p>
                  </div>
                  <Badge variant="outline" className="font-semibold">
                    {new Intl.NumberFormat('en-ZA', {
                      style: 'currency',
                      currency: 'ZAR',
                    }).format(Number(sc.price) || 0)}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stock Alert */}
      {(isOutOfStock || isLowStock || quantityOnHand + onOrder < requiredForOrders) && (
        <Card
          className={cn(
            'border-2',
            quantityOnHand + onOrder < requiredForOrders
              ? 'border-red-500 bg-red-50'
              : 'border-amber-200 bg-amber-50'
          )}
        >
          <CardHeader>
            <CardTitle
              className={cn(
                'flex items-center gap-2',
                quantityOnHand + onOrder < requiredForOrders ? 'text-red-800' : 'text-amber-800'
              )}
            >
              <AlertTriangle className="h-5 w-5" />
              {quantityOnHand + onOrder < requiredForOrders ? 'Critical Shortage' : 'Stock Alert'}
            </CardTitle>
          </CardHeader>
          <CardContent
            className={cn(
              quantityOnHand + onOrder < requiredForOrders ? 'text-red-800' : 'text-amber-800'
            )}
          >
            {quantityOnHand + onOrder < requiredForOrders && (
              <div className="space-y-2">
                <p className="font-semibold">
                  🚨 CRITICAL: Shortage of{' '}
                  {requiredForOrders - quantityOnHand - onOrder} units needed even with incoming
                  orders!
                </p>
                <div className="bg-red-100 border border-red-300 rounded p-3 mt-2">
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span>Required for Orders:</span>
                      <span className="font-semibold">{requiredForOrders}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Current Stock:</span>
                      <span className="font-semibold">{quantityOnHand}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>On Order:</span>
                      <span className="font-semibold">{onOrder}</span>
                    </div>
                    <div className="flex justify-between border-t border-red-400 pt-1 mt-1">
                      <span className="font-bold">Shortage:</span>
                      <span className="font-bold text-red-900">
                        {requiredForOrders - quantityOnHand - onOrder}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mt-2">
                  <strong>Action Required:</strong> Place immediate purchase order to avoid
                  production delays.
                </p>
              </div>
            )}

            {quantityOnHand + onOrder >= requiredForOrders && isOutOfStock && (
              <p>
                This component is <strong>out of stock</strong>. Consider placing a purchase order
                if required for upcoming orders.
              </p>
            )}

            {quantityOnHand + onOrder >= requiredForOrders && !isOutOfStock && isLowStock && (
              <p>
                Current stock ({quantityOnHand}) is at or below the reorder level ({reorderLevel}).
                Consider replenishing stock soon.
              </p>
            )}

            {quantityOnHand + onOrder >= requiredForOrders && onOrder > 0 && (
              <p className="mt-2">
                {onOrder} units are currently on order and will replenish stock when received.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}


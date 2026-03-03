'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Package,
  AlertTriangle,
  ShoppingCart,
  Users,
  Pencil,
  ArrowRightLeft,
  ClipboardList,
  BarChart3,
  Truck,
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
  inventory: {
    inventory_id: number;
    quantity_on_hand: number;
    location: string | null;
    reorder_level: number | null;
  } | null;
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

interface ComponentSidebarProps {
  component: ComponentData;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onEdit: () => void;
}

export function ComponentSidebar({ component, activeTab, onTabChange, onEdit }: ComponentSidebarProps) {
  const quantityOnHand = component.inventory?.quantity_on_hand ?? 0;
  const reorderLevel = component.inventory?.reorder_level ?? 0;
  const onOrder = component.on_order_quantity ?? 0;
  const requiredForOrders = component.required_for_orders ?? 0;
  const shortfall = Math.max(0, requiredForOrders - quantityOnHand - onOrder);

  const isOutOfStock = quantityOnHand <= 0;
  const isLowStock = quantityOnHand > 0 && quantityOnHand <= reorderLevel;

  if (activeTab === 'overview') {
    return (
      <div className="space-y-4">
        {/* Stock Summary */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Stock Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">In Stock</span>
              <span
                className={cn(
                  'font-medium',
                  isOutOfStock && 'text-red-600',
                  isLowStock && 'text-amber-600',
                  !isOutOfStock && !isLowStock && 'text-green-600'
                )}
              >
                {quantityOnHand}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Reorder Level</span>
              <span className="font-medium">{reorderLevel}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">On Order</span>
              <span className={cn('font-medium', onOrder > 0 ? 'text-blue-600' : 'text-muted-foreground')}>
                {onOrder}
              </span>
            </div>
            {shortfall > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Shortfall</span>
                <span className="font-medium text-red-600">{shortfall}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Suppliers */}
        {component.supplierComponents.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                Suppliers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {component.supplierComponents.slice(0, 3).map((sc) => (
                <Link
                  key={sc.supplier_component_id}
                  href={`/purchasing/suppliers/${sc.supplier_id}`}
                  className="block text-sm text-blue-600 hover:underline truncate"
                >
                  {sc.supplier.name}
                </Link>
              ))}
              {component.supplierComponents.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs mt-1"
                  onClick={() => onTabChange('suppliers')}
                >
                  View all {component.supplierComponents.length} suppliers
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" />
              Edit Component
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => onTabChange('transactions')}
            >
              <ArrowRightLeft className="h-4 w-4" />
              View Transactions
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => onTabChange('orders')}
            >
              <ClipboardList className="h-4 w-4" />
              View Orders
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeTab === 'orders') {
    return (
      <div className="space-y-4">
        {/* Stock Position */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Stock Position
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">In Stock</span>
              <span
                className={cn(
                  'font-medium',
                  isOutOfStock && 'text-red-600',
                  isLowStock && 'text-amber-600',
                  !isOutOfStock && !isLowStock && 'text-green-600'
                )}
              >
                {quantityOnHand}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">On Order</span>
              <span className={cn('font-medium', onOrder > 0 ? 'text-blue-600' : 'text-muted-foreground')}>
                {onOrder}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Required</span>
              <span className="font-medium">{requiredForOrders}</span>
            </div>
            {shortfall > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Shortfall</span>
                <span className="font-medium text-red-600">{shortfall}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => onTabChange('suppliers')}
            >
              <Users className="h-4 w-4" />
              View Suppliers
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => onTabChange('analytics')}
            >
              <BarChart3 className="h-4 w-4" />
              View Analytics
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

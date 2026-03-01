'use client';

import React from 'react';
import { Package, Layers, AlertCircle, CheckCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatCurrency, formatQuantity } from '@/lib/format-utils';

interface OrderSlideOutPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProduct: any | null;
  bomComponents: any[];
  coverage: { ordered: number; reserved: number; remain: number; factor: number } | null;
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
}

export function OrderSlideOutPanel({
  open,
  onOpenChange,
  selectedProduct,
  bomComponents,
  coverage,
  computeComponentMetrics,
  showGlobalContext,
}: OrderSlideOutPanelProps) {
  if (!selectedProduct) return null;

  const productId = selectedProduct.product_id;
  const productName = selectedProduct.product?.name || 'Unknown Product';
  const productDesc = selectedProduct.product?.description || '';

  const shortfallCount = bomComponents.filter((comp) => {
    const metrics = computeComponentMetrics(comp, productId);
    return metrics.real > 0.0001;
  }).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {productName}
          </SheetTitle>
          <SheetDescription>{productDesc}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Coverage summary */}
          {coverage && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold">{formatQuantity(coverage.ordered)}</div>
                <div className="text-xs text-muted-foreground">Ordered</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className={cn('text-2xl font-bold', coverage.reserved > 0 && 'text-blue-600')}>
                  {formatQuantity(coverage.reserved)}
                </div>
                <div className="text-xs text-muted-foreground">Reserved</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className={cn('text-2xl font-bold', coverage.remain > 0 && 'text-amber-600')}>
                  {formatQuantity(coverage.remain)}
                </div>
                <div className="text-xs text-muted-foreground">To Build</div>
              </div>
            </div>
          )}

          {/* BOM breakdown */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Bill of Materials
              </h3>
              {shortfallCount > 0 ? (
                <Badge variant="destructive" className="text-xs">
                  {shortfallCount} shortfall{shortfallCount !== 1 ? 's' : ''}
                </Badge>
              ) : bomComponents.length > 0 ? (
                <div className="flex items-center gap-1 text-green-600 text-xs font-medium">
                  <CheckCircle className="h-3.5 w-3.5" />
                  All in stock
                </div>
              ) : null}
            </div>

            {bomComponents.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">
                No bill of materials defined for this product
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead className="text-right">In Stock</TableHead>
                    <TableHead className="text-right">On Order</TableHead>
                    <TableHead className="text-right">Shortfall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bomComponents.map((component: any, idx: number) => {
                    const metrics = computeComponentMetrics(component, productId);
                    const hasShortfall = metrics.real > 0.0001;

                    return (
                      <TableRow
                        key={component.component_id || `slide-comp-${idx}`}
                        className={cn(hasShortfall && 'bg-destructive/5')}
                      >
                        <TableCell>
                          <div className="font-medium text-sm">
                            {component.internal_code || 'Unknown'}
                          </div>
                          <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                            {component.description || ''}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatQuantity(metrics.required)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatQuantity(metrics.inStock)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatQuantity(metrics.onOrder)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={cn(
                              'font-medium',
                              hasShortfall ? 'text-red-600' : 'text-green-600'
                            )}
                          >
                            {formatQuantity(metrics.real)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Line total */}
          <div className="flex justify-between items-center border-t pt-4">
            <span className="text-sm text-muted-foreground">Line Total</span>
            <span className="font-bold text-lg">
              {formatCurrency(
                (selectedProduct.quantity || 0) * (selectedProduct.unit_price || 0)
              )}
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

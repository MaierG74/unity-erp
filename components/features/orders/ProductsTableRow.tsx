'use client';

import React from 'react';
import { ChevronRight, ChevronDown, Edit, Trash, Check, X, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatCurrency, formatQuantity } from '@/lib/format-utils';

interface ProductsTableRowProps {
  detail: any;
  coverage: { ordered: number; reserved: number; remain: number; factor: number };
  isEditing: boolean;
  editQuantity: string;
  editUnitPrice: string;
  isExpanded: boolean;
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onQuantityChange: (value: string) => void;
  onUnitPriceChange: (value: string) => void;
  updatePending: boolean;
  deletePending: boolean;
  onProductClick?: () => void;
}

export function ProductsTableRow({
  detail,
  coverage,
  isEditing,
  editQuantity,
  editUnitPrice,
  isExpanded,
  bomComponents,
  computeComponentMetrics,
  showGlobalContext,
  onToggleExpand,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onQuantityChange,
  onUnitPriceChange,
  updatePending,
  deletePending,
  onProductClick,
}: ProductsTableRowProps) {
  const hasShortfall = bomComponents.some((comp) => {
    const metrics = computeComponentMetrics(comp, detail.product_id);
    return metrics.real > 0.0001;
  });

  return (
    <>
      {/* Main product row */}
      <TableRow className={cn(hasShortfall && 'bg-destructive/5')}>
        {/* Expand toggle + product name */}
        <TableCell>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleExpand}
              className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <div className="min-w-0">
              <button
                onClick={onProductClick}
                className="font-medium hover:underline text-left cursor-pointer"
              >
                {detail.product?.name}
              </button>
              <p className="text-sm text-muted-foreground truncate max-w-md">
                {detail.product?.description || 'No description available'}
              </p>
              {hasShortfall && (
                <Badge variant="destructive" className="mt-0.5 text-[10px] h-4">
                  Shortfall
                </Badge>
              )}
            </div>
          </div>
        </TableCell>

        {/* Qty */}
        <TableCell className="text-right">
          {isEditing ? (
            <Input
              type="number"
              value={editQuantity}
              onChange={(e) => onQuantityChange(e.target.value)}
              className="w-24 text-right"
              min="0"
              step="0.01"
            />
          ) : (
            formatQuantity(coverage.ordered)
          )}
        </TableCell>

        {/* Reserved */}
        <TableCell className="text-right">{formatQuantity(coverage.reserved)}</TableCell>

        {/* To Build */}
        <TableCell className="text-right">{formatQuantity(coverage.remain)}</TableCell>

        {/* Unit Price */}
        <TableCell className="text-right">
          {isEditing ? (
            <Input
              type="number"
              value={editUnitPrice}
              onChange={(e) => onUnitPriceChange(e.target.value)}
              className="w-28 text-right"
              min="0"
              step="0.01"
            />
          ) : (
            formatCurrency(detail.unit_price || 0)
          )}
        </TableCell>

        {/* Total */}
        <TableCell className="text-right">
          {isEditing
            ? formatCurrency(
                parseFloat(editQuantity || '0') * parseFloat(editUnitPrice || '0')
              )
            : formatCurrency((detail.quantity || 0) * (detail.unit_price || 0))}
        </TableCell>

        {/* Actions */}
        <TableCell className="text-right">
          {isEditing ? (
            <div className="flex gap-1 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={onSaveEdit}
                disabled={updatePending}
              >
                {updatePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelEdit}
                disabled={updatePending}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="ghost" onClick={onStartEdit}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                disabled={deletePending}
              >
                {deletePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>

      {/* Expanded BOM rows */}
      {isExpanded && bomComponents.length > 0 && (
        <>
          {/* BOM header row */}
          <TableRow className="bg-muted/30">
            <TableCell colSpan={7} className="py-1.5 px-4 pl-12">
              <div className="flex items-center gap-6 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <span className="min-w-[200px]">Component</span>
                <span className="w-20 text-right">Required</span>
                <span className="w-20 text-right">In Stock</span>
                <span className="w-20 text-right">On Order</span>
                <span className="w-20 text-right">Shortfall</span>
                {showGlobalContext && (
                  <span className="w-20 text-right">Global</span>
                )}
              </div>
            </TableCell>
          </TableRow>

          {/* BOM component rows */}
          {bomComponents.map((component: any, idx: number) => {
            const metrics = computeComponentMetrics(component, detail.product_id);
            const globalShortfall = Number(component.global_real_shortfall ?? 0);

            return (
              <TableRow
                key={component.component_id || `bom-${idx}`}
                className={cn(
                  'bg-muted/10 border-l-2 border-l-muted',
                  idx % 2 === 0 ? 'bg-muted/5' : 'bg-muted/15'
                )}
              >
                <TableCell colSpan={7} className="py-1.5 px-4 pl-12">
                  <div className="flex items-center gap-6 text-sm">
                    <div className="min-w-[200px]">
                      <span className="font-medium">
                        {component.internal_code || 'Unknown'}
                      </span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {component.description || ''}
                      </span>
                    </div>
                    <span className="w-20 text-right font-medium">
                      {formatQuantity(metrics.required)}
                    </span>
                    <span className="w-20 text-right">
                      {formatQuantity(metrics.inStock)}
                    </span>
                    <span className="w-20 text-right">
                      {formatQuantity(metrics.onOrder)}
                    </span>
                    <span
                      className={cn(
                        'w-20 text-right font-medium',
                        metrics.real > 0 ? 'text-red-600' : 'text-green-600'
                      )}
                    >
                      {formatQuantity(metrics.real)}
                    </span>
                    {showGlobalContext && (
                      <span
                        className={cn(
                          'w-20 text-right font-medium',
                          globalShortfall > 0 ? 'text-red-600' : 'text-green-600'
                        )}
                      >
                        {formatQuantity(globalShortfall)}
                      </span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </>
      )}
    </>
  );
}

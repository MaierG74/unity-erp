'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronDown, Edit, Trash, Check, X, Loader2, Replace, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatCurrency, formatQuantity } from '@/lib/format-utils';
import { CutlistMaterialDialog } from '@/components/features/shared/CutlistMaterialDialog';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';

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
  onSwapBomEntry: (entry: BomSnapshotEntry) => void;
  onApplyCutlistMaterial: (value: {
    cutlist_primary_material_id: number | null;
    cutlist_primary_backer_material_id: number | null;
    cutlist_primary_edging_id: number | null;
    cutlist_part_overrides: unknown[];
    cutlist_surcharge_kind: 'fixed' | 'percentage';
    cutlist_surcharge_value: number;
    cutlist_surcharge_label: string | null;
  }) => void;
  onQuantityChange: (value: string) => void;
  onUnitPriceChange: (value: string) => void;
  updatePending: boolean;
  deletePending: boolean;
  onProductClick?: () => void;
}

function ComponentDescription({ description }: { description: string | null | undefined }) {
  const text = description?.trim();
  if (!text) return null;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate text-xs text-muted-foreground">
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-xs leading-relaxed" side="top" align="start">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
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
  onSwapBomEntry,
  onApplyCutlistMaterial,
  onQuantityChange,
  onUnitPriceChange,
  updatePending,
  deletePending,
  onProductClick,
}: ProductsTableRowProps) {
  const [cutlistDialogOpen, setCutlistDialogOpen] = React.useState(false);
  const hasShortfall = bomComponents.some((comp) => {
    const metrics = computeComponentMetrics(comp, detail.product_id);
    return metrics.real > 0.0001;
  });
  const bomGridClass = showGlobalContext
    ? 'grid grid-cols-[minmax(180px,1fr)_65px_65px_65px_65px_65px_65px_65px_44px] items-center gap-x-4'
    : 'grid grid-cols-[minmax(180px,1fr)_65px_65px_65px_65px_65px_65px_44px] items-center gap-x-4';
  const snapshotEntries = Array.isArray(detail.bom_snapshot)
    ? (detail.bom_snapshot as BomSnapshotEntry[])
    : [];
  const surchargeRows = snapshotEntries.filter((entry) =>
    entry.swap_kind !== 'default' && Number(entry.surcharge_amount ?? 0) !== 0
  );
  const cutlistParts = Array.isArray(detail.cutlist_material_snapshot)
    ? detail.cutlist_material_snapshot.flatMap((group: any) => Array.isArray(group.parts) ? group.parts : [])
    : [];
  const cutlistOverrideCount = Array.isArray(detail.cutlist_part_overrides)
    ? detail.cutlist_part_overrides.length
    : 0;
  const cutlistSurcharge = Number(detail.cutlist_surcharge_resolved ?? 0);
  const hasCutlistMaterials = cutlistParts.length > 0;
  const findSnapshotEntry = (component: any) => {
    const componentId = Number(component.component_id);
    return snapshotEntries.find((entry) =>
      Number(entry.effective_component_id) === componentId ||
      Number(entry.component_id) === componentId ||
      Number(entry.default_component_id) === componentId
    ) ?? null;
  };

  return (
    <>
      {/* Main product row */}
      <TableRow className={cn('bg-muted/40', hasShortfall && 'bg-destructive/5')}>
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
              {hasCutlistMaterials && (
                <div className="mt-1 flex max-w-full flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setCutlistDialogOpen(true)}
                  >
                    <Palette className="mr-1 h-3 w-3" />
                    Cutlist material
                  </Button>
                  {(cutlistOverrideCount > 0 || cutlistSurcharge !== 0) && (
                    <Badge variant="secondary" className="h-5 max-w-full px-1.5 text-[10px] leading-none">
                      {cutlistOverrideCount > 0 ? `${cutlistOverrideCount} override${cutlistOverrideCount === 1 ? '' : 's'}` : null}
                      {cutlistOverrideCount > 0 && cutlistSurcharge !== 0 ? ' / ' : null}
                      {cutlistSurcharge !== 0 ? `${cutlistSurcharge > 0 ? '+' : '-'}${formatCurrency(Math.abs(cutlistSurcharge))}` : null}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
        </TableCell>

        {/* Qty */}
        <TableCell className="whitespace-nowrap text-right tabular-nums">
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
        <TableCell className="text-right tabular-nums">{formatQuantity(coverage.reserved)}</TableCell>

        {/* To Build */}
        <TableCell className="text-right tabular-nums">{formatQuantity(coverage.remain)}</TableCell>

        {/* Unit Price */}
        <TableCell className="whitespace-nowrap text-right tabular-nums">
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
        <TableCell className="whitespace-nowrap text-right tabular-nums">
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

      {surchargeRows.map((entry) => {
        const amount = Number(entry.surcharge_amount ?? 0);
        const lineAmount = amount * Number(detail.quantity ?? 0);
        const removed = entry.swap_kind === 'removed' || entry.is_removed;
        const prefix = removed ? '-' : '+';
        const label = entry.surcharge_label || entry.effective_component_code || entry.component_code || 'Swap surcharge';

        return (
          <TableRow
            key={`swap-${detail.order_detail_id}-${entry.source_bom_id}`}
            className="bg-background hover:bg-muted/20"
          >
            <TableCell className="py-1 pl-16 text-sm text-muted-foreground" colSpan={5}>
              <span className="mr-2 font-medium text-foreground">{prefix}</span>
              {label}
            </TableCell>
            <TableCell className="whitespace-nowrap py-1 text-right text-sm tabular-nums">
              {formatCurrency(lineAmount)}
            </TableCell>
            <TableCell />
          </TableRow>
        );
      })}

      {cutlistSurcharge !== 0 && (
        <TableRow className="bg-background hover:bg-muted/20">
          <TableCell className="py-1 pl-16 text-sm text-muted-foreground" colSpan={5}>
            <span className={cn('mr-2 font-medium', cutlistSurcharge < 0 ? 'text-green-600' : 'text-foreground')}>
              {cutlistSurcharge > 0 ? '+' : '-'}
            </span>
            {detail.cutlist_surcharge_label || 'Cutlist material surcharge'}
          </TableCell>
          <TableCell className={cn('whitespace-nowrap py-1 text-right text-sm tabular-nums', cutlistSurcharge < 0 && 'text-green-600')}>
            {cutlistSurcharge > 0 ? '+' : '-'}{formatCurrency(Math.abs(cutlistSurcharge))}
          </TableCell>
          <TableCell />
        </TableRow>
      )}

      {/* Expanded BOM rows */}
      {isExpanded && bomComponents.length > 0 && (
        <>
          {/* BOM header row */}
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={7} className="py-1.5 px-4 pl-12 border-l-2 border-l-primary/20">
              <div className={cn(bomGridClass, 'text-xs font-medium text-muted-foreground uppercase tracking-wider')}>
                <span className="min-w-[180px]">Component</span>
                <span className="block text-right tabular-nums">Required</span>
                <span className="block text-right tabular-nums">In Stock</span>
                <span className="block text-right tabular-nums">Reserved</span>
                <span className="block text-right tabular-nums">Available</span>
                <span className="block text-right tabular-nums">On Order</span>
                <span className="block text-right tabular-nums">Shortfall</span>
                {showGlobalContext && (
                  <span className="block text-right tabular-nums">Global</span>
                )}
                <span className="sr-only">Swap</span>
              </div>
            </TableCell>
          </TableRow>

          {/* BOM component rows */}
          {bomComponents.map((component: any, idx: number) => {
            const metrics = computeComponentMetrics(component, detail.product_id);
            const globalShortfall = Number(component.global_real_shortfall ?? 0);
            const snapshotEntry = findSnapshotEntry(component);

            return (
              <TableRow
                key={component.component_id || `bom-${idx}`}
                className={cn(
                  'border-l-2 border-l-primary/20 hover:bg-muted/30',
                  idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/10'
                )}
              >
                <TableCell colSpan={7} className="py-1.5 px-4 pl-12">
                  <div className={cn(bomGridClass, 'text-sm')}>
                    <div className="min-w-0">
                      {component.component_id ? (
                        <Link
                          href={`/inventory/components/${component.component_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-2 hover:underline"
                        >
                          <span className="font-medium">
                            {component.internal_code || 'Unknown'}
                          </span>
                          <ComponentDescription description={component.description} />
                        </Link>
                      ) : (
                        <div className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-2">
                          <span className="font-medium">
                            {component.internal_code || 'Unknown'}
                          </span>
                          <ComponentDescription description={component.description} />
                        </div>
                      )}
                    </div>
                    <span className="block text-right font-medium tabular-nums">
                      {formatQuantity(metrics.required)}
                    </span>
                    <span className="block text-right tabular-nums">
                      {formatQuantity(metrics.inStock)}
                    </span>
                    <span className={cn(
                      'block text-right tabular-nums',
                      (metrics.reservedThisOrder ?? 0) > 0
                        ? 'text-blue-500 font-medium'
                        : 'text-muted-foreground'
                    )}>
                      {formatQuantity(metrics.reservedThisOrder ?? 0)}
                    </span>
                    <span
                      className={cn(
                        'block text-right tabular-nums',
                        (metrics.available ?? metrics.inStock) < metrics.required
                          ? 'text-orange-500 font-medium'
                          : ''
                      )}
                    >
                      {formatQuantity(metrics.available ?? metrics.inStock)}
                    </span>
                    <span className="block text-right tabular-nums">
                      {formatQuantity(metrics.onOrder)}
                    </span>
                    <span
                      className={cn(
                        'block text-right font-medium tabular-nums',
                        metrics.real > 0 ? 'text-red-600' : 'text-green-600'
                      )}
                    >
                      {formatQuantity(metrics.real)}
                    </span>
                    {showGlobalContext && (
                      <span
                        className={cn(
                          'block text-right font-medium tabular-nums',
                          globalShortfall > 0 ? 'text-red-600' : 'text-green-600'
                        )}
                      >
                        {formatQuantity(globalShortfall)}
                      </span>
                    )}
                    <div className="flex justify-end">
                      {snapshotEntry ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-8 px-0"
                          onClick={() => onSwapBomEntry(snapshotEntry)}
                          title="Swap component"
                        >
                          <Replace className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </>
      )}

      <CutlistMaterialDialog
        open={cutlistDialogOpen}
        onOpenChange={setCutlistDialogOpen}
        detail={detail}
        applying={updatePending}
        onApply={(value) => {
          onApplyCutlistMaterial(value);
          setCutlistDialogOpen(false);
        }}
      />
    </>
  );
}

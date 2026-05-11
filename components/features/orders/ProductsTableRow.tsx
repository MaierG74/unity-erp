'use client';

import React from 'react';
import { Edit, Trash, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency, formatQuantity } from '@/lib/format-utils';
import { MaterialChip } from '@/components/features/orders/setup-panel/MaterialChip';
import { resolveMaterialChip } from '@/lib/orders/material-chip-data';

interface ProductsTableRowProps {
  detail: any;
  coverage: { ordered: number; reserved: number; remain: number; factor: number };
  isEditing: boolean;
  editQuantity: string;
  editUnitPrice: string;
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  isSelected: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onQuantityChange: (value: string) => void;
  onUnitPriceChange: (value: string) => void;
  updatePending: boolean;
  deletePending: boolean;
}

export function ProductsTableRow({
  detail,
  coverage,
  isEditing,
  editQuantity,
  editUnitPrice,
  bomComponents,
  computeComponentMetrics,
  isSelected,
  onSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onQuantityChange,
  onUnitPriceChange,
  updatePending,
  deletePending,
}: ProductsTableRowProps) {
  const hasShortfall = bomComponents.some((comp) => {
    const metrics = computeComponentMetrics(comp, detail.product_id);
    return metrics.real > 0.0001;
  });

  const chipState = resolveMaterialChip({
    cutlistMaterialSnapshot: detail.cutlist_material_snapshot ?? null,
    cutlistPrimaryMaterialId: detail.cutlist_primary_material_id ?? null,
    cutlistPartOverrides: detail.cutlist_part_overrides ?? [],
  });

  const handleRowClick = (event: React.MouseEvent) => {
    if (isEditing) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const interactive = target.closest(
      'button, a, input, textarea, select, label, [contenteditable=true], [role="button"], [role="combobox"], [data-row-action]'
    );
    if (interactive) return;
    onSelect();
  };

  return (
    <TableRow
      onClick={handleRowClick}
      className={cn(
        'cursor-pointer transition-colors',
        'bg-muted/40 hover:bg-muted/60',
        hasShortfall && 'bg-destructive/5 hover:bg-destructive/10',
        isSelected && 'bg-primary/5 hover:bg-primary/5 shadow-[inset_2px_0_0_0_var(--color-primary)]'
      )}
    >
      <TableCell>
        <div className="min-w-0">
          <p className="font-medium">{detail.product?.name}</p>
          <p className="text-sm text-muted-foreground truncate max-w-md">
            {detail.product?.description || 'No description available'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <MaterialChip state={chipState} />
            {hasShortfall && (
              <Badge variant="destructive" className="h-4 text-[10px]">
                Shortfall
              </Badge>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {isEditing ? (
          <Input
            type="number"
            value={editQuantity}
            onChange={(e) => onQuantityChange(e.target.value)}
            className="w-24 text-right"
            min="0"
            step="0.01"
            data-row-action
          />
        ) : (
          formatQuantity(coverage.ordered)
        )}
      </TableCell>

      <TableCell className="text-right tabular-nums">{formatQuantity(coverage.reserved)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatQuantity(coverage.remain)}</TableCell>

      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {isEditing ? (
          <Input
            type="number"
            value={editUnitPrice}
            onChange={(e) => onUnitPriceChange(e.target.value)}
            className="w-28 text-right"
            min="0"
            step="0.01"
            data-row-action
          />
        ) : (
          formatCurrency(detail.unit_price || 0)
        )}
      </TableCell>

      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {isEditing
          ? formatCurrency(parseFloat(editQuantity || '0') * parseFloat(editUnitPrice || '0'))
          : formatCurrency((detail.quantity || 0) * (detail.unit_price || 0))}
      </TableCell>

      <TableCell className="text-right" data-row-action>
        {isEditing ? (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="ghost" onClick={onSaveEdit} disabled={updatePending}>
              {updatePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={updatePending}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="ghost" onClick={onStartEdit}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete} disabled={deletePending}>
              {deletePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

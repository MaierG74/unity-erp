'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SubstitutionCombobox } from './SubstitutionCombobox';
import { CutlistSnapshotSummary } from './CutlistSnapshotSummary';
import { formatCurrency } from '@/lib/format-utils';
import type { ComponentOption } from '@/hooks/useComponentsByCategory';
import type { CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';

type SubstitutableBomLine = {
  bom_id: number;
  component_id: number;
  component_code: string;
  component_description: string | null;
  category_id: number | null;
  category_name: string | null;
  quantity_required: number;
  default_price: number;
  supplier_component_id: number | null;
  supplier_name: string | null;
};

type ConfigureProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: {
    product_id: number;
    name: string;
    bomLines: SubstitutableBomLine[];
    cutlistGroups: CutlistSnapshotGroup[];
    defaultMaterialCost: number;
  };
  quantity: number;
  categories: { cat_id: number; categoryname: string }[];
  onConfirm: (config: {
    substitutions: {
      bom_id: number;
      component_id: number;
      supplier_component_id?: number | null;
      note?: string;
    }[];
    cutlistEdits: CutlistSnapshotGroup[] | null;
  }) => void;
};

export function ConfigureProductDialog({
  open,
  onOpenChange,
  product,
  quantity,
  categories,
  onConfirm,
}: ConfigureProductDialogProps) {
  const [selections, setSelections] = useState<Map<number, ComponentOption>>(() => {
    const map = new Map<number, ComponentOption>();
    for (const line of product.bomLines) {
      map.set(line.bom_id, {
        component_id: line.component_id,
        internal_code: line.component_code,
        description: line.component_description,
        category_id: line.category_id,
        category_name: line.category_name,
        cheapest_price: line.default_price,
        cheapest_supplier_component_id: line.supplier_component_id,
        cheapest_supplier_name: line.supplier_name,
      });
    }
    return map;
  });

  function handleSelect(bomId: number, component: ComponentOption) {
    setSelections(prev => new Map(prev).set(bomId, component));
  }

  function buildSubstitutions() {
    return product.bomLines
      .filter(line => {
        const sel = selections.get(line.bom_id);
        return sel != null && sel.component_id !== line.component_id;
      })
      .map(line => {
        const sel = selections.get(line.bom_id)!;
        return {
          bom_id: line.bom_id,
          component_id: sel.component_id,
          supplier_component_id: sel.cheapest_supplier_component_id,
        };
      });
  }

  function handleUseAllDefaults() {
    const defaultSelections = new Map<number, ComponentOption>();
    for (const line of product.bomLines) {
      defaultSelections.set(line.bom_id, {
        component_id: line.component_id,
        internal_code: line.component_code,
        description: line.component_description,
        category_id: line.category_id,
        category_name: line.category_name,
        cheapest_price: line.default_price,
        cheapest_supplier_component_id: line.supplier_component_id,
        cheapest_supplier_name: line.supplier_name,
      });
    }
    setSelections(defaultSelections);
    onConfirm({
      substitutions: [],
      cutlistEdits: product.cutlistGroups.length > 0 ? product.cutlistGroups : null,
    });
  }

  function handleAddToOrder() {
    onConfirm({
      substitutions: buildSubstitutions(),
      cutlistEdits: product.cutlistGroups.length > 0 ? product.cutlistGroups : null,
    });
  }

  const materialCost = product.bomLines.reduce((sum, line) => {
    const selected = selections.get(line.bom_id);
    const price = selected?.cheapest_price ?? line.default_price;
    return sum + price * line.quantity_required;
  }, 0);
  const delta = materialCost - product.defaultMaterialCost;

  const deltaLabel =
    delta === 0
      ? null
      : delta < 0
        ? `(saving ${formatCurrency(Math.abs(delta))})`
        : `(+${formatCurrency(delta)} from defaults)`;

  const deltaClass = delta < 0 ? 'text-green-500' : delta > 0 ? 'text-amber-500' : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle className="text-base">
            Configure: {product.name}
            <span className="ml-2 font-normal text-muted-foreground text-sm">
              qty: {quantity}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* COMPONENTS section */}
          {product.bomLines.length > 0 && (
            <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Components
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleUseAllDefaults}
                >
                  Use all defaults
                </Button>
              </div>

              <div className="space-y-2">
                {product.bomLines.map(line => {
                  const selected = selections.get(line.bom_id);
                  const price = selected?.cheapest_price ?? line.default_price;
                  return (
                    <div key={line.bom_id} className="flex items-center gap-3">
                      <span className="text-sm flex-1 min-w-0 text-muted-foreground">
                        {line.component_description ?? line.component_code}
                      </span>
                      <div className="shrink-0">
                        <SubstitutionCombobox
                          defaultComponentId={line.component_id}
                          defaultComponentCode={line.component_code}
                          defaultCategoryId={line.category_id}
                          defaultCategoryName={line.category_name}
                          selectedComponentId={selected?.component_id ?? line.component_id}
                          onSelect={component => handleSelect(line.bom_id, component)}
                          categories={categories}
                        />
                      </div>
                      <span className="text-sm shrink-0 w-24 text-right tabular-nums font-medium">
                        {formatCurrency(price * line.quantity_required)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* CUTLIST section */}
          {product.cutlistGroups.length > 0 && (
            <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cutlist
              </h3>
              <CutlistSnapshotSummary
                groups={product.cutlistGroups}
                onEdit={() => toast.info('Cutlist editor coming soon')}
              />
            </section>
          )}

          {/* Material cost summary */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
            <span className="text-sm font-medium">Material Cost</span>
            <span className="text-sm tabular-nums font-semibold">
              {formatCurrency(materialCost)}
              {deltaLabel && (
                <span className={`ml-2 text-xs font-normal ${deltaClass}`}>{deltaLabel}</span>
              )}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={handleAddToOrder}>
            Add to Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

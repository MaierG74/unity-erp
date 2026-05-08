'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, Database, Loader2, Search } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  fetchSupplierComponentsBySupplier,
  fetchSuppliersSimple,
  type SupplierComponentWithMaster,
  type SupplierLite,
} from '@/lib/db/quotes';
import { cn } from '@/lib/utils';
import { formatQuantity } from '@/lib/format-utils';

export interface StockSelectableItem {
  component_id: number;
  internal_code: string;
  description: string | null;
  available_quantity: number;
}

interface StockItemSelectionDialogProps {
  open: boolean;
  inventoryItems: StockSelectableItem[];
  selectedComponentIds?: Set<number>;
  onOpenChange: (open: boolean) => void;
  onAddItem: (item: StockSelectableItem, quantity: number) => void;
}

type TabId = 'component' | 'supplier';

function matchesAllTokens(query: string, ...fields: Array<string | null | undefined>): boolean {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = fields.map((field) => field || '').join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function availabilityTone(quantity: number): { label: string; className: string } {
  if (quantity < 0) {
    return {
      label: 'Negative',
      className: 'border-destructive/40 bg-destructive/15 text-destructive',
    };
  }
  if (quantity === 0) {
    return {
      label: 'None',
      className: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
    };
  }
  if (quantity <= 5) {
    return {
      label: 'Low',
      className: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300',
    };
  }
  return {
    label: 'In stock',
    className: 'border-green-500/35 bg-green-500/10 text-green-700 dark:text-green-300',
  };
}

export function StockItemSelectionDialog({
  open,
  inventoryItems,
  selectedComponentIds,
  onOpenChange,
  onAddItem,
}: StockItemSelectionDialogProps) {
  const [tab, setTab] = useState<TabId>('component');
  const [componentQuery, setComponentQuery] = useState('');
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierComponentQuery, setSupplierComponentQuery] = useState('');
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [supplierComponents, setSupplierComponents] = useState<SupplierComponentWithMaster[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [supplierComponentsLoading, setSupplierComponentsLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StockSelectableItem | null>(null);
  const [quantity, setQuantity] = useState('1');

  const componentSearchRef = useRef<HTMLInputElement>(null);
  const supplierSearchRef = useRef<HTMLInputElement>(null);

  const inventoryById = useMemo(() => {
    const map = new Map<number, StockSelectableItem>();
    inventoryItems.forEach((item) => map.set(item.component_id, item));
    return map;
  }, [inventoryItems]);

  const filteredComponents = useMemo(
    () =>
      inventoryItems
        .filter((item) => matchesAllTokens(componentQuery, item.internal_code, item.description))
        .slice(0, 80),
    [componentQuery, inventoryItems],
  );

  const filteredSuppliers = useMemo(
    () => suppliers.filter((supplier) => matchesAllTokens(supplierQuery, supplier.name)),
    [supplierQuery, suppliers],
  );

  const filteredSupplierComponents = useMemo(
    () =>
      supplierComponents.filter((item) =>
        matchesAllTokens(
          supplierComponentQuery,
          item.component?.internal_code,
          item.component?.description,
          item.supplier_code,
          item.description,
        ),
      ),
    [supplierComponentQuery, supplierComponents],
  );

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      if (tab === 'component') componentSearchRef.current?.focus();
      else supplierSearchRef.current?.focus();
    }, 50);
  }, [open, tab]);

  useEffect(() => {
    if (!open || tab !== 'supplier' || suppliers.length > 0) return;
    setSuppliersLoading(true);
    fetchSuppliersSimple()
      .then(setSuppliers)
      .finally(() => setSuppliersLoading(false));
  }, [open, tab, suppliers.length]);

  useEffect(() => {
    if (!open || !selectedSupplierId) return;
    setSupplierComponentsLoading(true);
    fetchSupplierComponentsBySupplier(selectedSupplierId)
      .then(setSupplierComponents)
      .finally(() => setSupplierComponentsLoading(false));
  }, [open, selectedSupplierId]);

  const reset = () => {
    setTab('component');
    setComponentQuery('');
    setSupplierQuery('');
    setSupplierComponentQuery('');
    setSelectedSupplierId(null);
    setSupplierComponents([]);
    setSelectedItem(null);
    setQuantity('1');
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const selectComponent = (item: StockSelectableItem) => {
    setSelectedItem(item);
    setQuantity('1');
  };

  const selectSupplierComponent = (supplierComponent: SupplierComponentWithMaster) => {
    const componentId = Number(supplierComponent.component_id || 0);
    if (!componentId) return;
    const inventoryItem = inventoryById.get(componentId);
    selectComponent({
      component_id: componentId,
      internal_code: inventoryItem?.internal_code || supplierComponent.component?.internal_code || supplierComponent.supplier_code || `Component ${componentId}`,
      description: inventoryItem?.description || supplierComponent.component?.description || supplierComponent.description || null,
      available_quantity: inventoryItem?.available_quantity ?? 0,
    });
  };

  const addSelected = () => {
    if (!selectedItem) return;
    const parsedQuantity = Number(quantity);
    onAddItem(selectedItem, Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1);
    close();
  };

  const selectedSupplierName = suppliers.find((supplier) => supplier.supplier_id === selectedSupplierId)?.name;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-3xl sm:rounded-xl" aria-describedby="stock-item-dialog-description">
        <DialogHeader className="pb-1">
          <DialogTitle>Add Stock Item</DialogTitle>
          <DialogDescription id="stock-item-dialog-description">
            Search inventory by component or supplier, then add it to this order's stock issue.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="component" className="gap-2">
              <Database className="h-4 w-4" />
              Component
            </TabsTrigger>
            <TabsTrigger value="supplier" className="gap-2">
              <Building2 className="h-4 w-4" />
              Supplier
            </TabsTrigger>
          </TabsList>

          <TabsContent value="component" className="space-y-3">
            <div className="flex flex-col overflow-hidden rounded-lg border border-input">
              <div className="border-b p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={componentSearchRef}
                    value={componentQuery}
                    onChange={(event) => setComponentQuery(event.target.value)}
                    placeholder="Search by code or description..."
                    className="h-9 pl-7"
                  />
                </div>
              </div>
              <div className="h-[280px] overflow-auto">
                <StockItemsTable
                  items={componentQuery.trim() ? filteredComponents : []}
                  emptyText={componentQuery.trim() ? 'No components match your search.' : 'Search by component code or description, or use Supplier to browse by supplier.'}
                  selectedComponentIds={selectedComponentIds}
                  onSelect={selectComponent}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="supplier" className="space-y-3">
            <div className="flex h-[330px] overflow-hidden rounded-lg border border-input">
              <div className="flex w-56 shrink-0 flex-col border-r">
                <div className="border-b p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={supplierSearchRef}
                      value={supplierQuery}
                      onChange={(event) => setSupplierQuery(event.target.value)}
                      placeholder="Search suppliers"
                      className="h-9 pl-7"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-auto">
                  {suppliersLoading ? (
                    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading suppliers...
                    </div>
                  ) : filteredSuppliers.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No suppliers found.</div>
                  ) : (
                    filteredSuppliers.map((supplier) => (
                      <button
                        key={supplier.supplier_id}
                        type="button"
                        onClick={() => {
                          setSelectedSupplierId(supplier.supplier_id);
                          setSupplierComponentQuery('');
                          setSelectedItem(null);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40',
                          selectedSupplierId === supplier.supplier_id && 'bg-primary/10 text-primary',
                        )}
                      >
                        <span className="truncate">{supplier.name}</span>
                        {selectedSupplierId === supplier.supplier_id && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                {selectedSupplierId ? (
                  <>
                    <div className="border-b bg-muted/30 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{selectedSupplierName}</span>
                      </div>
                    </div>
                    <div className="border-b p-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={supplierComponentQuery}
                          onChange={(event) => setSupplierComponentQuery(event.target.value)}
                          placeholder="Filter components"
                          className="h-9 pl-7"
                        />
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto">
                      {supplierComponentsLoading ? (
                        <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading components...
                        </div>
                      ) : (
                        <StockSupplierItemsTable
                          items={filteredSupplierComponents}
                          inventoryById={inventoryById}
                          selectedComponentIds={selectedComponentIds}
                          onSelect={selectSupplierComponent}
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    Select a supplier to browse their components.
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {selectedItem && (
          <div className="rounded-lg border bg-primary/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{selectedItem.description || selectedItem.internal_code}</div>
                <div className="text-xs text-muted-foreground">{selectedItem.internal_code}</div>
              </div>
              <AvailabilityBadge quantity={selectedItem.available_quantity} />
            </div>
            <div className="mt-3 max-w-xs">
              <Label htmlFor="stock-issue-quantity">Issue quantity</Label>
              <Input
                id="stock-issue-quantity"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '' || value === '.' || /^\d*\.?\d*$/.test(value)) {
                    setQuantity(value);
                  }
                }}
                onFocus={(event) => event.target.select()}
              />
            </div>
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="button" onClick={addSelected} disabled={!selectedItem}>
            Add Stock Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockItemsTable({
  items,
  emptyText,
  selectedComponentIds,
  onSelect,
}: {
  items: StockSelectableItem[];
  emptyText: string;
  selectedComponentIds?: Set<number>;
  onSelect: (item: StockSelectableItem) => void;
}) {
  if (items.length === 0) {
    return <div className="p-4 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 border-b bg-background text-muted-foreground">
        <tr>
          <th className="p-2 text-left font-medium">Component</th>
          <th className="w-28 p-2 text-right font-medium">Available</th>
          <th className="w-20 p-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const alreadyAdded = selectedComponentIds?.has(item.component_id) ?? false;
          return (
            <tr key={item.component_id} className="border-b hover:bg-muted/40">
              <td className="max-w-0 p-2">
                <div className="truncate font-medium">{item.description || item.internal_code}</div>
                <div className="truncate text-xs text-muted-foreground">{item.internal_code}</div>
              </td>
              <td className="p-2 text-right">
                <AvailabilityBadge quantity={item.available_quantity} />
              </td>
              <td className="p-2 text-right">
                <Button type="button" size="sm" className="h-8" disabled={alreadyAdded} onClick={() => onSelect(item)}>
                  {alreadyAdded ? 'Added' : 'Select'}
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StockSupplierItemsTable({
  items,
  inventoryById,
  selectedComponentIds,
  onSelect,
}: {
  items: SupplierComponentWithMaster[];
  inventoryById: Map<number, StockSelectableItem>;
  selectedComponentIds?: Set<number>;
  onSelect: (item: SupplierComponentWithMaster) => void;
}) {
  if (items.length === 0) {
    return <div className="p-4 text-center text-sm text-muted-foreground">No components found for this supplier.</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 border-b bg-background text-muted-foreground">
        <tr>
          <th className="p-2 text-left font-medium">Component</th>
          <th className="w-28 p-2 text-right font-medium">Available</th>
          <th className="w-20 p-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const componentId = Number(item.component_id || 0);
          const inventoryItem = inventoryById.get(componentId);
          const availability = inventoryItem?.available_quantity ?? 0;
          const alreadyAdded = selectedComponentIds?.has(componentId) ?? false;
          return (
            <tr key={item.supplier_component_id} className="border-b hover:bg-muted/40">
              <td className="max-w-0 p-2">
                <div className="truncate font-medium">
                  {inventoryItem?.description || item.component?.description || item.description || item.supplier_code || `Component ${componentId}`}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[inventoryItem?.internal_code || item.component?.internal_code, item.supplier_code].filter(Boolean).join(' · ')}
                </div>
              </td>
              <td className="p-2 text-right">
                <AvailabilityBadge quantity={availability} />
              </td>
              <td className="p-2 text-right">
                <Button type="button" size="sm" className="h-8" disabled={!componentId || alreadyAdded} onClick={() => onSelect(item)}>
                  {alreadyAdded ? 'Added' : 'Select'}
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AvailabilityBadge({ quantity }: { quantity: number }) {
  const tone = availabilityTone(quantity);
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-mono tabular-nums', tone.className)}>
      {formatQuantity(quantity)} · {tone.label}
    </Badge>
  );
}

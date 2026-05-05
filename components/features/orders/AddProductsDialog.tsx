'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Plus, X, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { type Product } from '@/types/orders';
import { fetchAvailableProducts } from '@/lib/queries/order-queries';
import { formatCurrency } from '@/lib/format-utils';
import { ConfigureProductDialog } from './ConfigureProductDialog';
import type { CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

function splitProductName(full: string): { name: string; dims: string | null } {
  const m = full.match(/^(.*?)\s*[-–—]\s*(\d{2,4}\s*\([hwd]\)\s*[x×].+)$/i);
  return m ? { name: m[1].trim(), dims: m[2].trim() } : { name: full, dims: null };
}

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

type PendingProduct = {
  product_id: number;
  name: string;
  quantity: number;
  unit_price: number;
  substitutions?: {
    bom_id: number;
    component_id: number;
    supplier_component_id?: number | null;
    note?: string;
  }[];
};

type ConfigProductState = {
  product_id: number;
  name: string;
  bomLines: SubstitutableBomLine[];
  cutlistGroups: CutlistSnapshotGroup[];
  defaultMaterialCost: number;
  quantity: number;
  price: number;
};

export function AddProductsDialog({
  orderId,
  onSuccess
}: {
  orderId: number | string;
  onSuccess?: () => void;
}) {
  const [selectedProducts, setSelectedProducts] = useState<Record<number, { quantity: number; price: number }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Configuration flow state
  const [configProduct, setConfigProduct] = useState<ConfigProductState | null>(null);
  const [categories, setCategories] = useState<{ cat_id: number; categoryname: string }[]>([]);
  const [pendingProducts, setPendingProducts] = useState<PendingProduct[]>([]);
  const [configQueue, setConfigQueue] = useState<ConfigProductState[]>([]);

  // Fetch available products
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['availableProducts'],
    queryFn: fetchAvailableProducts,
  });

  // Load categories for SubstitutionCombobox
  useEffect(() => {
    authorizedFetch('/api/components/by-category/all?search=')
      .then(res => res.json())
      .then(json => {
        const cats = new Map<number, string>();
        for (const c of json.components ?? []) {
          if (c.category_id && c.category_name && !cats.has(c.category_id)) {
            cats.set(c.category_id, c.category_name);
          }
        }
        setCategories(Array.from(cats.entries()).map(([cat_id, categoryname]) => ({ cat_id, categoryname })));
      })
      .catch(() => {});
  }, []);

  // Filter products based on search query
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;

    const query = searchQuery.toLowerCase();
    return products.filter((product: any) =>
      (product.name || '').toLowerCase().includes(query) ||
      (product.sku || '').toLowerCase().includes(query) ||
      (product.description || '').toLowerCase().includes(query)
    );
  }, [products, searchQuery]);

  // Toggle product selection
  const toggleProductSelection = (productId: number) => {
    setSelectedProducts((prevState) => {
      const newState = { ...prevState };

      if (newState[productId]) {
        delete newState[productId];
      } else {
        const productAny: any = products.find((p: any) => p.product_id === productId);
        newState[productId] = {
          quantity: 1,
          price: (productAny?.unit_price ?? productAny?.price ?? 0) as number
        };
      }

      return newState;
    });
  };

  // Handle quantity change for a product. Allows temporary 0 while editing —
  // onBlur on the qty input restores to 1.
  const handleQuantityChange = (productId: number, quantity: number) => {
    if (quantity < 0) return;

    setSelectedProducts((prevState) => {
      const newState = { ...prevState };

      if (newState[productId]) {
        newState[productId] = {
          ...newState[productId],
          quantity
        };
      }

      return newState;
    });
  };

  // Handle price change for a product
  const handlePriceChange = (productId: number, price: number) => {
    setSelectedProducts((prevState) => {
      const newState = { ...prevState };

      if (newState[productId]) {
        newState[productId] = {
          ...newState[productId],
          price
        };
      }

      return newState;
    });
  };

  const selectedCount = useMemo(() => {
    return Object.keys(selectedProducts).length;
  }, [selectedProducts]);

  const subtotal = useMemo(() => {
    return Object.values(selectedProducts).reduce((sum, sel) => sum + sel.quantity * sel.price, 0);
  }, [selectedProducts]);

  const hasInvalidQuantity = useMemo(() => {
    return Object.values(selectedProducts).some(sel => !sel.quantity || sel.quantity < 1);
  }, [selectedProducts]);

  // Submit all finalized products to the API
  const submitProducts = useCallback(async (finalProducts: PendingProduct[]) => {
    if (finalProducts.length === 0) return;

    const orderIdNum = typeof orderId === 'string' ? parseInt(orderId, 10) : orderId;
    if (isNaN(orderIdNum)) {
      toast.error(`Invalid order ID: ${orderId}`);
      return;
    }

    const addingToast = toast.loading('Adding products to order...');

    try {
      const response = await authorizedFetch(`/api/orders/${orderIdNum}/add-products`, {
        method: 'POST',
        body: JSON.stringify({
          products: finalProducts.map(p => ({
            product_id: p.product_id,
            quantity: p.quantity,
            unit_price: p.unit_price,
            substitutions: p.substitutions ?? [],
          })),
        }),
      });

      toast.dismiss(addingToast);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to add products');
      }

      const result = await response.json();

      if (result?.success) {
        const productCount = result.insertedDetails?.length || finalProducts.length;
        toast.success(`Added ${productCount} product(s) to the order`);
        onSuccess?.();
        setSelectedProducts({});
        setSearchQuery('');
      } else {
        toast.error('Failed to add products to order');
      }
    } catch (error) {
      toast.dismiss(addingToast);
      const msg = error instanceof Error ? error.message : 'Failed to add products to order';
      toast.error(msg);
    }
  }, [orderId, onSuccess]);

  // Process next product in the config queue
  const processNextConfig = useCallback((
    queue: ConfigProductState[],
    accumulated: PendingProduct[]
  ) => {
    if (queue.length === 0) {
      // All done -- submit everything
      submitProducts(accumulated);
      setPendingProducts([]);
      setConfigQueue([]);
      setIsSubmitting(false);
      return;
    }

    const [next, ...rest] = queue;
    setConfigQueue(rest);
    setPendingProducts(accumulated);
    setConfigProduct(next);
  }, [submitProducts]);

  // Handle configuration dialog confirm
  const handleConfigConfirm = useCallback((config: {
    substitutions: {
      bom_id: number;
      component_id: number;
      supplier_component_id?: number | null;
      note?: string;
    }[];
    cutlistEdits: CutlistSnapshotGroup[] | null;
  }) => {
    if (!configProduct) return;

    const product: PendingProduct = {
      product_id: configProduct.product_id,
      name: configProduct.name,
      quantity: configProduct.quantity,
      unit_price: configProduct.price,
      substitutions: config.substitutions,
    };

    const accumulated = [...pendingProducts, product];
    setConfigProduct(null);

    // Process next in queue
    processNextConfig(configQueue, accumulated);
  }, [configProduct, pendingProducts, configQueue, processNextConfig]);

  const handleSubmit = async () => {
    if (selectedCount === 0) return;

    setIsSubmitting(true);

    try {
      const lineItems = Object.entries(selectedProducts).map(([productId, data]) => {
        const productAny: any = products.find((p: any) => p.product_id === parseInt(productId));
        return {
          product_id: parseInt(productId),
          name: productAny?.name ?? `Product ${productId}`,
          quantity: data.quantity,
          unit_price: parseFloat(data.price.toString()) || 0,
        };
      });

      // For each product, check if it needs configuration
      const needsConfig: ConfigProductState[] = [];
      const directAdd: PendingProduct[] = [];

      for (const item of lineItems) {
        // Fetch BOM lines with is_substitutable = true
        const { data: bomRows } = await supabase
          .from('billofmaterials')
          .select(`
            bom_id,
            component_id,
            quantity_required,
            is_substitutable,
            supplier_component_id,
            components (
              component_id,
              internal_code,
              description,
              category_id,
              component_categories ( cat_id, categoryname )
            ),
            suppliercomponents (
              supplier_component_id,
              price,
              suppliers ( supplier_id, name )
            )
          `)
          .eq('product_id', item.product_id);

        const substitutableLines: SubstitutableBomLine[] = [];
        let defaultMaterialCost = 0;

        for (const row of bomRows ?? []) {
          const comp = row.components as any;
          const sc = row.suppliercomponents as any;
          const price = sc?.price ?? 0;
          const qty = Number(row.quantity_required ?? 0);
          defaultMaterialCost += price * qty;

          if (row.is_substitutable) {
            substitutableLines.push({
              bom_id: row.bom_id,
              component_id: row.component_id ?? 0,
              component_code: comp?.internal_code ?? '',
              component_description: comp?.description ?? null,
              category_id: comp?.category_id ?? null,
              category_name: comp?.component_categories?.categoryname ?? null,
              quantity_required: qty,
              default_price: price,
              supplier_component_id: sc?.supplier_component_id ?? null,
              supplier_name: sc?.suppliers?.name ?? null,
            });
          }
        }

        // Fetch cutlist groups
        const cutlistRes = await authorizedFetch(`/api/products/${item.product_id}/cutlist-groups`);
        const cutlistJson = cutlistRes.ok ? await cutlistRes.json() : { groups: [] };
        const cutlistGroups: CutlistSnapshotGroup[] = (cutlistJson.groups ?? []).map((g: any) => ({
          source_group_id: g.id,
          name: g.name,
          board_type: g.board_type ?? '16mm',
          primary_material_id: g.primary_material_id ?? null,
          primary_material_name: g.primary_material_name ?? null,
          backer_material_id: g.backer_material_id ?? null,
          backer_material_name: g.backer_material_name ?? null,
          parts: g.parts ?? [],
        }));

        if (substitutableLines.length > 0 || cutlistGroups.length > 0) {
          needsConfig.push({
            product_id: item.product_id,
            name: item.name,
            bomLines: substitutableLines,
            cutlistGroups,
            defaultMaterialCost,
            quantity: item.quantity,
            price: item.unit_price,
          });
        } else {
          directAdd.push({
            product_id: item.product_id,
            name: item.name,
            quantity: item.quantity,
            unit_price: item.unit_price,
          });
        }
      }

      if (needsConfig.length === 0) {
        // No products need configuration -- submit directly
        await submitProducts(directAdd);
        setIsSubmitting(false);
      } else {
        // Start configuration flow
        processNextConfig(needsConfig, directAdd);
      }
    } catch (error) {
      console.error('[ERROR] Error preparing products:', error);
      const msg = error instanceof Error ? error.message : 'Failed to add products to order';
      toast.error(msg);
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" className="flex items-center gap-1">
            <Plus className="h-4 w-4" />
            Add Products
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[920px]">
          <DialogHeader>
            <DialogTitle>Add Products to Order</DialogTitle>
            <DialogDescription>
              Select products to add to this order.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search products by name, SKU, or description..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading products...</span>
            </div>
          ) : (
            <div className="grid grid-cols-[1.5fr_1fr] gap-4 h-[440px]">
              {/* Catalog */}
              <div className="overflow-y-auto -mr-2 pr-2">
                {filteredProducts.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No products found.
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {filteredProducts.map((product: any) => {
                      const isSelected = !!selectedProducts[product.product_id];
                      const { name, dims } = splitProductName(product.name ?? '');
                      const price = product.unit_price ?? product.price ?? 0;
                      return (
                        <li
                          key={product.product_id}
                          onClick={() => toggleProductSelection(product.product_id)}
                          className={cn(
                            'relative cursor-pointer rounded-md px-3 py-2.5 transition-colors',
                            isSelected
                              ? 'bg-primary/10 hover:bg-primary/15'
                              : 'hover:bg-muted/50',
                          )}
                        >
                          {isSelected && (
                            <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />
                          )}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-tight">
                                {name}
                                {dims && (
                                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                                    {dims}
                                  </span>
                                )}
                              </p>
                              {product.sku && (
                                <span className="mt-1.5 inline-flex items-center rounded-sm border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  SKU {product.sku}
                                </span>
                              )}
                            </div>
                            <div className="shrink-0 pt-0.5 text-right font-mono text-sm tabular-nums">
                              {price > 0 ? (
                                <>
                                  <span className="mr-0.5 text-xs text-muted-foreground">R</span>
                                  {price.toFixed(2)}
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Cart pane */}
              <div className="flex flex-col overflow-hidden rounded-lg border bg-muted/30 p-3">
                <div className="mb-3 flex items-baseline justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Selected
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {selectedCount}
                  </span>
                </div>

                {selectedCount === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
                    <ShoppingCart className="h-8 w-8 opacity-40" strokeWidth={1.5} />
                    <p className="text-xs">Click a product to add it</p>
                  </div>
                ) : (
                  <>
                    <ul className="-mx-1 flex-1 space-y-2 overflow-y-auto px-1">
                      {Object.entries(selectedProducts).map(([idStr, sel]) => {
                        const productId = parseInt(idStr);
                        const product: any = products.find((p: any) => p.product_id === productId);
                        if (!product) return null;
                        const { name, dims } = splitProductName(product.name ?? '');
                        return (
                          <li
                            key={productId}
                            className={cn(
                              'rounded-md border border-l-2 bg-background p-2.5',
                              sel.quantity > 0 ? 'border-l-primary' : 'border-l-destructive',
                            )}
                          >
                            <div className="mb-1 flex items-start justify-between gap-2">
                              <p className="flex-1 truncate text-xs font-medium">{name}</p>
                              <button
                                type="button"
                                onClick={() => toggleProductSelection(productId)}
                                className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                                aria-label="Remove from selection"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {dims && (
                              <p className="mb-2 font-mono text-[10px] text-muted-foreground">{dims}</p>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center overflow-hidden rounded-md border bg-muted/40">
                                <button
                                  type="button"
                                  onClick={() => handleQuantityChange(productId, Math.max(1, sel.quantity - 1))}
                                  disabled={sel.quantity <= 1}
                                  className="h-7 w-6 text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:opacity-40"
                                  aria-label="Decrease quantity"
                                >
                                  −
                                </button>
                                <Input
                                  type="number"
                                  min={0}
                                  value={sel.quantity || ''}
                                  placeholder="0"
                                  onChange={(e) => handleQuantityChange(productId, parseInt(e.target.value) || 0)}
                                  className="h-7 w-9 rounded-none border-0 bg-transparent px-0 text-center font-mono text-xs ring-offset-0 focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleQuantityChange(productId, sel.quantity + 1)}
                                  className="h-7 w-6 text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                                  aria-label="Increase quantity"
                                >
                                  +
                                </button>
                              </div>
                              <div className="relative">
                                <span className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 font-mono text-xs text-muted-foreground">R</span>
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={sel.price || ''}
                                  placeholder="0.00"
                                  onChange={(e) => handlePriceChange(productId, parseFloat(e.target.value) || 0)}
                                  onBlur={(e) => { if (!e.target.value) handlePriceChange(productId, 0); }}
                                  className="h-7 w-24 bg-muted/40 pl-6 pr-2 text-right font-mono text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                  aria-label="Unit price"
                                />
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="mt-3 flex items-baseline justify-between border-t border-dashed px-1 pt-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Subtotal
                      </span>
                      <span className="font-mono text-base font-semibold tabular-nums">
                        {formatCurrency(subtotal)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex min-w-[24px] items-center justify-center rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-primary">
                {selectedCount}
              </span>
              <span>{selectedCount === 1 ? 'product' : 'products'} selected</span>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={selectedCount === 0 || hasInvalidQuantity || isSubmitting}
              title={hasInvalidQuantity ? 'Quantity must be at least 1 on every selected product' : undefined}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding Products...
                </>
              ) : (
                'Add to Order'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {configProduct && (
        <ConfigureProductDialog
          open={!!configProduct}
          onOpenChange={(open) => {
            if (!open) {
              // User cancelled -- abort the entire config flow
              setConfigProduct(null);
              setConfigQueue([]);
              setPendingProducts([]);
              setIsSubmitting(false);
            }
          }}
          product={configProduct}
          quantity={configProduct.quantity}
          categories={categories}
          onConfirm={handleConfigConfirm}
        />
      )}
    </>
  );
}

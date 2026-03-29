'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Search, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { type Product } from '@/types/orders';
import { fetchAvailableProducts } from '@/lib/queries/order-queries';
import { formatCurrency } from '@/lib/format-utils';
import { ConfigureProductDialog } from './ConfigureProductDialog';
import type { CutlistSnapshotGroup } from '@/lib/orders/snapshot-types';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { supabase } from '@/lib/supabase';

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

  // Handle quantity change for a product
  const handleQuantityChange = (productId: number, quantity: number) => {
    if (quantity < 1) return;

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
        <DialogContent className="sm:max-w-[800px]">
          <DialogHeader>
            <DialogTitle>Add Products to Order</DialogTitle>
            <DialogDescription>
              Select products to add to this order.
            </DialogDescription>
          </DialogHeader>

          {/* Search input */}
          <div className="relative mb-4">
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
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No products found.
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium"></th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Product</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Price</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Quantity</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredProducts.map((product: any) => {
                    const isSelected = !!selectedProducts[product.product_id];
                    return (
                      <tr
                        key={product.product_id}
                        className={isSelected ? 'bg-primary/5' : 'hover:bg-muted/50'}
                      >
                        <td className="px-4 py-3 text-center">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleProductSelection(product.product_id)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {product.sku || 'No SKU'}
                              {product.description && ` • ${product.description.substring(0, 50)}${product.description.length > 50 ? '...' : ''}`}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isSelected ? (
                            <div className="flex items-center justify-end">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={selectedProducts[product.product_id]?.price || 0}
                                onChange={(e) => handlePriceChange(product.product_id, parseFloat(e.target.value) || 0)}
                                className="w-24 h-8 text-right border rounded px-2"
                              />
                            </div>
                          ) : (
                            <span>{formatCurrency(product.unit_price || 0)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right w-32">
                          {isSelected && (
                            <div className="flex items-center justify-end">
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => handleQuantityChange(product.product_id, Math.max(1, (selectedProducts[product.product_id]?.quantity || 1) - 1))}
                                disabled={selectedProducts[product.product_id]?.quantity <= 1}
                              >
                                <span className="sr-only">Decrease quantity</span>
                                <span className="text-xs">-</span>
                              </Button>
                              <input
                                type="number"
                                min="1"
                                value={selectedProducts[product.product_id]?.quantity || 1}
                                onChange={(e) => handleQuantityChange(product.product_id, parseInt(e.target.value) || 1)}
                                className="w-12 h-8 mx-1 text-center border rounded"
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => handleQuantityChange(product.product_id, (selectedProducts[product.product_id]?.quantity || 1) + 1)}
                              >
                                <span className="sr-only">Increase quantity</span>
                                <span className="text-xs">+</span>
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {selectedCount} product{selectedCount !== 1 ? 's' : ''} selected
            </div>
            <Button
              onClick={handleSubmit}
              disabled={selectedCount === 0 || isSubmitting}
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

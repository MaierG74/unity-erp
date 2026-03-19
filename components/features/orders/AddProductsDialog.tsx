'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Search, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { type Product } from '@/types/orders';
import { fetchAvailableProducts, addProductsToOrder } from '@/lib/queries/order-queries';
import { formatCurrency } from '@/lib/format-utils';

export function AddProductsDialog({
  orderId,
  onSuccess
}: {
  orderId: number | string; // Updated type to accept both number and string
  onSuccess?: () => void;
}) {
  const [selectedProducts, setSelectedProducts] = useState<Record<number, { quantity: number; price: number }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch available products
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['availableProducts'],
    queryFn: fetchAvailableProducts,
  });

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
        // Product is already selected, unselect it
        delete newState[productId];
      } else {
        // Product is not selected, select it
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

  const handleSubmit = async () => {
    if (selectedCount === 0) return;

    setIsSubmitting(true);

    try {
      console.log('[DEBUG] Starting product add submission', { selectedProducts });

      // Transform selected products for the API - ensure unit_price is a valid number
      const lineItems = Object.entries(selectedProducts).map(([productId, data]) => ({
        product_id: parseInt(productId),
        quantity: data.quantity,
        unit_price: parseFloat(data.price.toString()) || 0
      }));

      console.log('[DEBUG] Prepared line items for submission:', lineItems);

      // Convert orderId to number if it's a string
      const orderIdNum = typeof orderId === 'string' ? parseInt(orderId, 10) : orderId;

      if (isNaN(orderIdNum)) {
        throw new Error(`Invalid order ID: ${orderId}`);
      }

      console.log('[DEBUG] Converted orderId:', { original: orderId, converted: orderIdNum });

      // Show adding toast
      const addingToast = toast.loading('Adding products to order...');

      try {
        // Add products to order with simple approach
        const result = await addProductsToOrder(orderIdNum, lineItems);

        console.log('[DEBUG] Add products result:', result);

        // Dismiss the loading toast
        toast.dismiss(addingToast);

        if (result && result.success) {
          const productCount = result.insertedDetails?.length || selectedCount;
          toast.success(`Added ${productCount} product(s) to the order`);

          if (onSuccess) {
            // Call the success callback to refresh the order data
            onSuccess();
          }

          // Reset form
          setSelectedProducts({});
          setSearchQuery('');
        } else {
          toast.error('Failed to add products to order');
        }
      } catch (error) {
        // Dismiss the loading toast on error
        toast.dismiss(addingToast);
        throw error; // Re-throw to be caught by the outer catch
      }
    } catch (error) {
      console.error('[ERROR] Error adding products to order:', error);

      // Show a more informative error message
      let errorMessage = 'Failed to add products to order';

      if (error instanceof Error) {
        errorMessage = error.message;
      }

      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
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
  );
}

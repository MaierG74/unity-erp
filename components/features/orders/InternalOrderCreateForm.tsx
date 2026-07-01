'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { getOrgId } from '@/lib/utils';
import { useAuth } from '@/components/common/auth-provider';
import { fetchAvailableProducts } from '@/lib/queries/order-queries';
import { createInternalOrder } from '@/lib/db/internalOrders';
import type { Product } from '@/types/orders';

const REASON_MAX_LENGTH = 200;

export interface InternalOrderPrefillItem {
  product_id: number;
  quantity: number;
}

interface LineItem {
  product_id: number;
  quantity: number;
}

export interface InternalOrderCreateFormProps {
  /** Optional line items to seed the form with (used by ReplenishmentPanel). */
  prefillItems?: InternalOrderPrefillItem[];
}

export function InternalOrderCreateForm({ prefillItems }: InternalOrderCreateFormProps) {
  const router = useRouter();
  const { user } = useAuth();
  const orgId = getOrgId(user);

  const [reason, setReason] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [items, setItems] = useState<LineItem[]>(() =>
    (prefillItems ?? [])
      .filter((it) => it.product_id != null)
      .map((it) => ({
        product_id: it.product_id,
        quantity: it.quantity && it.quantity > 0 ? it.quantity : 1,
      }))
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ['availableProducts'],
    queryFn: fetchAvailableProducts,
  });

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    for (const p of products) {
      map.set(p.product_id, p);
    }
    return map;
  }, [products]);

  const selectedIds = useMemo(
    () => new Set(items.map((it) => it.product_id)),
    [items]
  );

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const base = products.filter((p) => !selectedIds.has(p.product_id));
    if (!query) return base;
    return base.filter(
      (p) =>
        (p.name ?? '').toLowerCase().includes(query) ||
        (p.internal_code ?? '').toLowerCase().includes(query)
    );
  }, [products, selectedIds, search]);

  function addProduct(productId: number) {
    setItems((prev) =>
      prev.some((it) => it.product_id === productId)
        ? prev
        : [...prev, { product_id: productId, quantity: 1 }]
    );
    setPickerOpen(false);
    setSearch('');
  }

  function updateQuantity(productId: number, quantity: number) {
    setItems((prev) =>
      prev.map((it) =>
        it.product_id === productId ? { ...it, quantity } : it
      )
    );
  }

  function removeItem(productId: number) {
    setItems((prev) => prev.filter((it) => it.product_id !== productId));
  }

  const trimmedReason = reason.trim();
  const hasValidItems =
    items.length > 0 && items.every((it) => it.quantity >= 1);
  const canSubmit =
    Boolean(orgId) && trimmedReason.length > 0 && hasValidItems && !submitting;

  async function handleSubmit() {
    if (!orgId) {
      toast.error('No organisation context found. Please sign in again.');
      return;
    }
    if (!trimmedReason) {
      toast.error('A reason is required for an internal order.');
      return;
    }
    if (!hasValidItems) {
      toast.error('Add at least one product with a quantity of 1 or more.');
      return;
    }

    setSubmitting(true);
    try {
      const { order_id } = await createInternalOrder({
        org_id: orgId,
        internal_reason: trimmedReason,
        items: items.map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
        })),
        delivery_date: deliveryDate || null,
      });
      toast.success('Internal order created');
      router.push(`/orders/${order_id}?type=internal`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create internal order';
      toast.error(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => router.push('/orders')}
          aria-label="Back to orders"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">New Internal Order</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Internal Order</CardTitle>
          <CardDescription>
            Internal orders restock finished goods into inventory. They have no
            customer — just a reason and the products to produce.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Details
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="internal-order-reason" className="text-xs text-muted-foreground">
                Reason
              </Label>
              <Textarea
                id="internal-order-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX_LENGTH))}
                maxLength={REASON_MAX_LENGTH}
                rows={2}
                placeholder="e.g. Restock 50 cupboards"
              />
              <p className="text-right text-xs text-muted-foreground">
                {trimmedReason.length}/{REASON_MAX_LENGTH}
              </p>
            </div>
            <div className="space-y-1.5 md:max-w-xs">
              <Label htmlFor="internal-order-delivery-date" className="text-xs text-muted-foreground">
                Target Date (optional)
              </Label>
              <Input
                id="internal-order-delivery-date"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>
          </section>

          <section className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Products
              </h3>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={productsLoading}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add product
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[20rem] p-0" align="end">
                  <div className="flex flex-col overflow-hidden rounded-md bg-popover text-popover-foreground">
                    <div className="border-b px-3">
                      <input
                        className="flex h-11 w-full bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground"
                        placeholder="Search products..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-[18rem] overflow-y-auto p-1">
                      {productsLoading ? (
                        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading products...
                        </div>
                      ) : filteredProducts.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          No products found.
                        </div>
                      ) : (
                        filteredProducts.map((p) => (
                          <button
                            key={p.product_id}
                            type="button"
                            onClick={() => addProduct(p.product_id)}
                            className="flex w-full cursor-pointer select-none items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground"
                          >
                            <Plus className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
                            <span className="flex flex-col">
                              <span className="font-medium">{p.name}</span>
                              {p.internal_code ? (
                                <span className="font-mono text-xs text-muted-foreground">
                                  {p.internal_code}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {items.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
                No products added yet. Use &ldquo;Add product&rdquo; to choose what to restock.
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => {
                  const product = productMap.get(item.product_id);
                  return (
                    <div
                      key={item.product_id}
                      className="flex items-center gap-3 rounded-md border border-border/50 bg-background px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {product?.name ?? `Product #${item.product_id}`}
                        </p>
                        {product?.internal_code ? (
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {product.internal_code}
                          </p>
                        ) : null}
                      </div>
                      <div className="w-24 shrink-0 space-y-1.5">
                        <Label
                          htmlFor={`qty-${item.product_id}`}
                          className="sr-only"
                        >
                          Quantity
                        </Label>
                        <Input
                          id={`qty-${item.product_id}`}
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantity || ''}
                          placeholder="0"
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            updateQuantity(
                              item.product_id,
                              Number.isFinite(next) && next >= 0 ? next : 0
                            );
                          }}
                          onBlur={() => {
                            if (!item.quantity || item.quantity < 1) {
                              updateQuantity(item.product_id, 1);
                            }
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(item.product_id)}
                        aria-label="Remove product"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/orders')}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? 'Creating...' : 'Create Internal Order'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default InternalOrderCreateForm;

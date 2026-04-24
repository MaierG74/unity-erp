'use client';

import { useState, useMemo, use, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Package, Edit, Plus, Trash2, Save, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import React from 'react';
import { ImageGallery } from '@/components/features/products/image-gallery';
import { CategoryDialog } from '@/components/features/products/category-dialog';
import ProductCosting from '@/components/features/products/product-costing';
import { ProductOptionsTab } from '@/components/features/products/ProductOptionsTab';
import { ProductCutlistTab } from '@/components/features/products/ProductCutlistTab';
import { useToast } from '@/components/ui/use-toast';
import { ProductTransactionsTab } from '@/components/features/products/ProductTransactionsTab';
import ProductReportsTab from '@/components/features/products/ProductReportsTab';
import { useModuleAccess } from '@/lib/hooks/use-module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { CropParams } from '@/types/image-editor';

interface ProductDetailPageProps {
  params: Promise<{
    productId: string;
  }>;
}

interface Product {
  product_id: number;
  internal_code: string;
  name: string;
  description: string | null;
  bullet_points: string | null;
  primary_image?: string | null;
  images?: ProductImage[];
  categories?: ProductCategory[];
}

interface ProductImage {
  image_id: string | number;
  product_id: string | number;
  image_url: string;
  is_primary: boolean;
  crop_params?: CropParams | null;
}

interface ProductCategory {
  product_cat_id: number;
  categoryname: string;
}

const PRODUCT_DETAIL_TABS = ['details', 'images', 'categories', 'costing', 'cutlist', 'options', 'transactions', 'reports'] as const;
type ProductDetailTab = typeof PRODUCT_DETAIL_TABS[number];
type PendingNavigation =
  | { type: 'back' }
  | { type: 'browser-back' }
  | { type: 'tab'; tab: ProductDetailTab }
  | { type: 'link'; href: string }
  | null;

// Fetch a single product by ID
async function fetchProduct(productId: number): Promise<Product | null> {
  try {
    const response = await authorizedFetch(`/api/products/${productId}`, { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || 'Failed to fetch product');
    }

    const json = await response.json();
    const product = json?.product as Product | undefined;
    if (!product) return null;

    const images = Array.isArray(product.images) ? product.images : [];
    const primaryImage =
      images.find((img) => img.is_primary)?.image_url ||
      (images.length > 0 ? images[0].image_url : null);

    return {
      ...product,
      primary_image: primaryImage,
      images,
      categories: Array.isArray(product.categories) ? product.categories : [],
    };
  } catch (error) {
    console.error('Error fetching product:', error);
    return null;
  }
}

export default function ProductDetailPage({ params }: ProductDetailPageProps) {
  // Unwrap the params Promise (Next.js 16 requirement)
  const { productId: productIdParam } = use(params);
  const productId = parseInt(productIdParam, 10);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editBulletPoints, setEditBulletPoints] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);
  const [addFgQty, setAddFgQty] = useState('');
  const [addFgLocation, setAddFgLocation] = useState('');
  const [addingFg, setAddingFg] = useState(false);
  const [reservationsOpen, setReservationsOpen] = useState(false);
  const [hasPendingImageUploads, setHasPendingImageUploads] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation>(null);
  const bypassPopstateRef = useRef(false);

  console.log('ProductDetailPage mounted, productId:', productId);

  const activeTabParam = searchParams?.get('tab');
  const activeTab: ProductDetailTab = PRODUCT_DETAIL_TABS.includes(activeTabParam as ProductDetailTab)
    ? (activeTabParam as ProductDetailTab)
    : 'details';

  const updateTabInUrl = (nextTab: ProductDetailTab) => {
    const params = new URLSearchParams(searchParams?.toString() || '');

    if (nextTab === 'details') {
      params.delete('tab');
    } else {
      params.set('tab', nextTab);
    }

    const query = params.toString();
    const url = query ? `/products/${productId}?${query}` : `/products/${productId}`;
    router.replace(url, { scroll: false });
  };

  // Fetch product
  const { data: product, isLoading, error, refetch } = useQuery({
    queryKey: ['product', productId],
    queryFn: async () => {
      console.log('Fetching product data for ID:', productId);
      const result = await fetchProduct(productId);
      console.log('Product data fetched:', result);
      return result;
    },
  });

  const { data: configuratorAccess } = useModuleAccess(MODULE_KEYS.FURNITURE_CONFIGURATOR);

  const canUseConfigurator = Boolean(configuratorAccess?.allowed);

  // FG: fetch inventory rows for this product
  const { data: inventoryRows, refetch: refetchInventory } = useQuery({
    queryKey: ['productInventory', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_inventory')
        .select('product_inventory_id, product_id, quantity_on_hand, location')
        .eq('product_id', productId);
      if (error) {
        console.error('[product-inventory] error', error);
        return [] as Array<{ product_inventory_id: number; product_id: number; quantity_on_hand: number | string | null; location: string | null }>; 
      }
      return data || [];
    },
    enabled: Number.isFinite(productId),
  });

  // FG: fetch active reservations for this product across orders
  const { data: reservationRows, refetch: refetchReservations } = useQuery({
    queryKey: ['productReservations', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_reservations')
        .select('order_id, product_id, qty_reserved')
        .eq('product_id', productId);
      if (error) {
        console.error('[product-reservations] error', error);
        return [] as Array<{ order_id: number; product_id: number; qty_reserved: number | string | null }>;
      }
      return data || [];
    },
    enabled: Number.isFinite(productId),
  });

  // Derived FG summary
  const onHandTotal = (inventoryRows || []).reduce((sum, r: any) => sum + Number(r?.quantity_on_hand ?? 0), 0);
  const reservedTotal = (reservationRows || []).reduce((sum, r: any) => sum + Number(r?.qty_reserved ?? r?.reserved_quantity ?? 0), 0);
  const availableTotal = Math.max(0, onHandTotal - reservedTotal);

  // Reservations breakdown (for dialog)
  const reservationsList: Array<{ order_id: number; qty: number }> = (reservationRows || [])
    .map((r: any) => ({ order_id: Number(r?.order_id), qty: Number(r?.qty_reserved ?? r?.reserved_quantity ?? 0) }))
    .filter((r) => Number.isFinite(r.order_id) && r.qty > 0);
  const reservationsByOrderCount = new Set(reservationsList.map((r) => r.order_id)).size;
  const reservationsListSorted = [...reservationsList].sort((a, b) => (b.order_id - a.order_id));
  const orderIds = useMemo(() => Array.from(new Set(reservationsListSorted.map((r) => r.order_id))), [reservationsListSorted]);

  // Fetch latest attachment per order (when dialog is open)
  const { data: orderAttachments } = useQuery({
    queryKey: ['attachmentsForOrders', orderIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_attachments')
        .select('id, order_id, file_url, file_name, uploaded_at')
        .in('order_id', orderIds);
      if (error) throw error;
      return data || [];
    },
    enabled: reservationsOpen && orderIds.length > 0,
  });

  const attachmentsByOrder = useMemo(() => {
    const map: Record<number, any> = {};
    (orderAttachments || []).forEach((a: any) => {
      const prev = map[a.order_id];
      if (!prev || new Date(a.uploaded_at) > new Date(prev.uploaded_at)) {
        map[a.order_id] = a;
      }
    });
    return map;
  }, [orderAttachments]);

  const requestNavigation = (nextNavigation: Exclude<PendingNavigation, null>) => {
    if (hasPendingImageUploads) {
      setPendingNavigation(nextNavigation);
      return;
    }

    if (nextNavigation.type === 'back' || nextNavigation.type === 'browser-back') {
      bypassPopstateRef.current = true;
      router.back();
      return;
    }

    if (nextNavigation.type === 'tab') {
      updateTabInUrl(nextNavigation.tab);
      return;
    }

    router.push(nextNavigation.href);
  };

  // Handle back button - use router.back() to preserve URL params (filters)
  const handleBack = () => {
    requestNavigation({ type: 'back' });
  };

  const handleTabChange = (nextTab: string) => {
    requestNavigation({ type: 'tab', tab: nextTab as ProductDetailTab });
  };

  useEffect(() => {
    if (!hasPendingImageUploads || activeTab !== 'images') return;

    const handlePopState = () => {
      if (bypassPopstateRef.current) {
        bypassPopstateRef.current = false;
        return;
      }

      window.history.go(1);
      setPendingNavigation({ type: 'browser-back' });
    };

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      if (link.target === '_blank' || link.hasAttribute('download')) return;
      if (!link.href.startsWith(window.location.origin)) return;
      if (link.href === window.location.href) return;

      event.preventDefault();
      event.stopPropagation();

      const href = `${link.pathname}${link.search}${link.hash}`;
      setPendingNavigation({ type: 'link', href });
    };

    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleDocumentClick, true);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [activeTab, hasPendingImageUploads]);

  const handleConfirmPendingNavigation = () => {
    if (!pendingNavigation) return;

    if (pendingNavigation.type === 'back' || pendingNavigation.type === 'browser-back') {
      setPendingNavigation(null);
      bypassPopstateRef.current = true;
      router.back();
      return;
    }

    if (pendingNavigation.type === 'tab') {
      updateTabInUrl(pendingNavigation.tab);
      setPendingNavigation(null);
      return;
    }

    router.push(pendingNavigation.href);
    setPendingNavigation(null);
  };

  const openEdit = () => {
    setEditCode(product?.internal_code ?? '');
    setEditName(product?.name ?? '');
    setEditDescription(product?.description ?? '');
    setEditBulletPoints(product?.bullet_points ?? '');
    setEditOpen(true);
  };

  const saveProductSnapshot = async (next: {
    internal_code?: string;
    name?: string;
    description?: string | null;
    bullet_points?: string | null;
    categories?: number[];
  }) => {
    if (!product) {
      throw new Error('Product not loaded');
    }

    const response = await authorizedFetch(`/api/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify({
        internal_code: next.internal_code ?? product.internal_code,
        name: next.name ?? product.name,
        description: next.description ?? product.description ?? null,
        bullet_points: next.bullet_points ?? product.bullet_points ?? null,
        categories: next.categories ?? (product.categories ?? []).map((category) => category.product_cat_id),
      }),
    });

    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error(json?.error || 'Failed to update product');
    }
  };

  const handleSaveProduct = async () => {
    if (!product) return;
    setSavingProduct(true);
    try {
      await saveProductSnapshot({
        internal_code: editCode.trim(),
        name: editName.trim(),
        description: editDescription || null,
        bullet_points: editBulletPoints || null,
      });
      toast({ title: 'Product updated', description: 'Your changes have been saved.' });
      setEditOpen(false);
      await refetch();
    } catch (e: any) {
      console.error('[save-product]', e);
      toast({ title: 'Failed to update product', description: e?.message || 'Please try again', variant: 'destructive' });
    } finally {
      setSavingProduct(false);
    }
  };

  const handleAddFg = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(addFgQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ title: 'Invalid quantity', description: 'Enter a positive number', variant: 'destructive' });
      return;
    }
    setAddingFg(true);
    try {
      const res = await authorizedFetch(`/api/products/${productId}/add-fg`, {
        method: 'POST',
        body: JSON.stringify({ quantity: qty, location: addFgLocation || null }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error || 'Failed to add finished goods');
      toast({ title: 'Finished goods added', description: `Added ${qty} to on-hand${addFgLocation ? ' @ ' + addFgLocation : ''}.` });
      setAddFgQty('');
      setAddFgLocation('');
      await Promise.all([refetchInventory(), refetchReservations()]);
    } catch (e: any) {
      console.error('[add-fg]', e);
      toast({ title: 'Failed to add finished goods', description: e?.message || 'Please try again', variant: 'destructive' });
    } finally {
      setAddingFg(false);
    }
  };

  if (isLoading) {
    console.log('Product detail page is loading...');
    return <div className="p-8 text-center">Loading product details...</div>;
  }

  if (error || !product) {
    console.error('Error loading product:', error);
    return (
      <div className="p-8 text-center text-destructive">
        Error loading product details. The product may not exist.
        <div className="mt-4">
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Products
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <div className="text-sm px-2 py-1 bg-muted rounded-md">
            {product.internal_code}
          </div>
        </div>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <Button onClick={openEdit}>
            <Edit className="h-4 w-4 mr-2" />
            Edit Product
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Product</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="code">Product Code</Label>
                <Input id="code" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea id="desc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bullet_points">Details / Bullet Points</Label>
                <Textarea
                  id="bullet_points"
                  value={editBulletPoints}
                  onChange={(e) => setEditBulletPoints(e.target.value)}
                  rows={4}
                  placeholder="Size: 2m x 3m&#10;Material: Solid wood&#10;Finish: Walnut"
                />
                <p className="text-xs text-muted-foreground">One per line — auto-fills into quotes as bullet points</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveProduct} disabled={savingProduct}>
                {savingProduct ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="overflow-x-auto flex-nowrap">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="costing">Costing</TabsTrigger>
          <TabsTrigger value="cutlist">Cutlist</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        
        <TabsContent value="details" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Product image */}
            <div className="rounded-lg border border-border/50 bg-muted/30 p-4 flex flex-col items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground self-start">Product Image</p>
              {product.primary_image ? (
                <div className="relative h-52 w-52 rounded-md overflow-hidden bg-card ring-0 dark:bg-white/5 dark:ring-1 dark:ring-white/10">
                  <Image
                    src={product.primary_image}
                    alt={product.name}
                    fill
                    className="object-contain dark:brightness-110 dark:drop-shadow-[0_8px_24px_rgba(0,0,0,0.85)]"
                  />
                </div>
              ) : (
                <div className="h-52 w-52 bg-muted rounded-md flex items-center justify-center">
                  <Package className="h-20 w-20 text-muted-foreground/50" />
                </div>
              )}
            </div>

            {/* Product details */}
            <div className="md:col-span-2 rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Product Details</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Product Code</span>
                  <p className="text-sm font-medium">{product.internal_code}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Name</span>
                  <p className="text-sm font-medium">{product.name}</p>
                </div>
                <div className="col-span-2 space-y-1">
                  <span className="text-xs text-muted-foreground">Description</span>
                  <p className="text-sm whitespace-pre-line">
                    {product.description || <span className="text-muted-foreground">No description provided</span>}
                  </p>
                </div>
                <div className="col-span-2 space-y-1">
                  <span className="text-xs text-muted-foreground">Categories</span>
                  <div className="flex flex-wrap gap-1.5">
                    {product.categories && product.categories.length > 0 ? (
                      product.categories.map(category => (
                        <div
                          key={category.product_cat_id}
                          className="px-2 py-0.5 text-xs rounded-full bg-muted border border-border/50"
                        >
                          {category.categoryname}
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">No categories assigned</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Finished-Goods Inventory Summary */}
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Finished-Goods Inventory</p>
              <p className="text-xs text-muted-foreground mt-0.5">On-hand, reserved, and available quantities for this product.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-md border border-border/50 bg-background/50 p-3">
                <div className="text-xs text-muted-foreground">On Hand</div>
                <div className="text-xl font-semibold mt-1">{onHandTotal}</div>
              </div>
              <div className="rounded-md border border-border/50 bg-background/50 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">Reserved (all orders)</div>
                  {reservationsListSorted.length > 0 && (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setReservationsOpen(true)}>
                      View
                    </button>
                  )}
                </div>
                <div className="text-xl font-semibold mt-1">{reservedTotal}</div>
              </div>
              <div className="rounded-md border border-border/50 bg-background/50 p-3">
                <div className="text-xs text-muted-foreground">Available</div>
                <div className="text-xl font-semibold mt-1">{availableTotal}</div>
              </div>
            </div>
            {Array.isArray(inventoryRows) && inventoryRows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Locations tracked: {inventoryRows.filter((r: any) => r.location).length} / {inventoryRows.length}
              </p>
            )}
            {Array.isArray(reservationRows) && reservationRows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Active reservations across {new Set(reservationRows.map((r: any) => r.order_id)).size} order(s).
              </p>
            )}

            {/* Add Finished Goods */}
            <div className="border-t border-border/50 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Add Stock</p>
              <form onSubmit={handleAddFg} className="grid grid-cols-1 sm:grid-cols-6 gap-x-4 gap-y-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label htmlFor="fg-qty" className="text-xs text-muted-foreground">Quantity</Label>
                  <Input id="fg-qty" type="number" min="0" step="1" value={addFgQty} onChange={(e) => setAddFgQty(e.target.value)} placeholder="e.g. 5" />
                </div>
                <div className="sm:col-span-3 space-y-1.5">
                  <Label htmlFor="fg-loc" className="text-xs text-muted-foreground">Location (optional)</Label>
                  <Input id="fg-loc" value={addFgLocation} onChange={(e) => setAddFgLocation(e.target.value)} placeholder="Leave blank for primary" />
                </div>
                <div className="sm:col-span-1 flex items-end">
                  <Button type="submit" disabled={addingFg || !addFgQty} className="w-full">
                    {addingFg ? 'Adding…' : 'Add FG'}
                  </Button>
                </div>
              </form>
            </div>
          </div>

          {/* Reservations dialog */}
          <Dialog open={reservationsOpen} onOpenChange={setReservationsOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Reserved across {reservationsByOrderCount} order(s)</DialogTitle>
                <DialogDescription>Click an order to open its page or open the latest PDF attachment.</DialogDescription>
              </DialogHeader>
              <div className="divide-y">
                {reservationsListSorted.map((r) => {
                  const att = attachmentsByOrder[r.order_id];
                  return (
                    <div key={r.order_id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <Link className="text-primary hover:underline" href={`/orders/${r.order_id}`}>Order #{r.order_id}</Link>
                        <span className="text-sm text-muted-foreground">Qty {r.qty}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {att?.file_url ? (
                          <a className="text-sm text-primary hover:underline" href={att.file_url} target="_blank" rel="noopener noreferrer">
                            Open PDF
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">No attachment</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Product Images</CardTitle>
              <CardDescription>
                Manage product images. You can upload new images, set a primary image, and delete images.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImageGallery
                productId={product.product_id.toString()}
                productCode={product.internal_code}
                images={product.images || []}
                onImagesChange={() => refetch()}
                onPendingUploadsChange={setHasPendingImageUploads}
              />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Product Categories</CardTitle>
              <CardDescription>
                Manage product category assignments
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {product.categories && product.categories.length > 0 ? (
                    product.categories.map(category => (
                      <div 
                        key={category.product_cat_id}
                        className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted"
                      >
                        <span>{category.categoryname}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0 hover:bg-transparent hover:opacity-50"
                          onClick={async () => {
                            try {
                              await saveProductSnapshot({
                                categories: (product.categories || [])
                                  .filter((entry) => entry.product_cat_id !== category.product_cat_id)
                                  .map((entry) => entry.product_cat_id),
                              })

                              toast({
                                title: "Success",
                                description: "Category removed successfully",
                              })

                              await refetch()
                            } catch (error) {
                              console.error('Error removing category:', error)
                              toast({
                                title: "Error",
                                description: "Failed to remove category",
                                variant: "destructive",
                              })
                            }
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No categories assigned</p>
                  )}
                </div>
                <CategoryDialog
                  productId={product.product_id.toString()}
                  existingCategories={product.categories || []}
                  onAddCategoryIds={async (categoryIds) => {
                    const existingIds = (product.categories || []).map((category) => category.product_cat_id);
                    const nextCategories = Array.from(new Set([...existingIds, ...categoryIds]));
                    await saveProductSnapshot({ categories: nextCategories });
                  }}
                  onCategoriesChange={() => refetch()}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="cutlist" className="space-y-4">
          <div className="flex gap-2">
            {canUseConfigurator ? (
              <Link href={`/products/${product.product_id}/configurator`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Package className="h-4 w-4" />
                  Design with Configurator
                </Button>
              </Link>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled
                title="Furniture Configurator module is disabled for your organization"
              >
                <Package className="h-4 w-4" />
                Configurator Locked
              </Button>
            )}
          </div>
          <ProductCutlistTab productId={product.product_id} />
        </TabsContent>
        
        <TabsContent value="options" className="space-y-4">
          <ProductOptionsTab productId={product.product_id} />
        </TabsContent>

        <TabsContent value="costing" className="space-y-4">
          <ProductCosting productId={product.product_id} />
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Product Transactions</CardTitle>
              <CardDescription>Per-product finished-good activity feed.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProductTransactionsTab productId={product.product_id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          {activeTab === 'reports' && <ProductReportsTab productId={product.product_id} />}
        </TabsContent>
      </Tabs>

      <AlertDialog open={pendingNavigation !== null} onOpenChange={(open) => (!open ? setPendingNavigation(null) : undefined)}>
        <AlertDialogContent className="max-w-md border-border/60 bg-background/95 backdrop-blur">
          <AlertDialogHeader className="space-y-3 text-left">
            <AlertDialogTitle className="text-xl">Upload Not Finished</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
              You have an image staged on the Images tab, but it has not been uploaded yet. If you leave now, that pasted or cropped image will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Click <span className="font-semibold text-foreground">Upload Image</span> first if you want to keep it attached to this product.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingNavigation(null)}>Stay On Images</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPendingNavigation}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Leave Without Uploading
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

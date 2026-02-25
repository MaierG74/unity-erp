'use client';

import { useState, useMemo, use } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRouter } from 'next/navigation';
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
import { useModuleAccess } from '@/lib/hooks/use-module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { authorizedFetch } from '@/lib/client/auth-fetch';

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
  primary_image?: string | null;
  images?: ProductImage[];
  categories?: ProductCategory[];
}

interface ProductImage {
  image_id: string | number;
  product_id: string | number;
  image_url: string;
  is_primary: boolean;
}

interface ProductCategory {
  product_cat_id: number;
  categoryname: string;
}

// Fetch a single product by ID
async function fetchProduct(productId: number): Promise<Product | null> {
  try {
    // Fetch the product
    const { data: product, error } = await supabase
      .from('products')
      .select(`
        product_id,
        internal_code,
        name,
        description
      `)
      .eq('product_id', productId)
      .single();

    if (error) throw error;
    if (!product) return null;

    // Fetch images for this product
    const { data: images, error: imagesError } = await supabase
      .from('product_images')
      .select('*')
      .eq('product_id', productId);

    if (imagesError) throw imagesError;

    // Fetch categories for this product
    const { data: categoryAssignments, error: catError } = await supabase
      .from('product_category_assignments')
      .select(`
        product_cat_id
      `)
      .eq('product_id', productId);

    if (catError) throw catError;

    let categories: ProductCategory[] = [];
    if (categoryAssignments && categoryAssignments.length > 0) {
      const catIds = categoryAssignments.map(c => c.product_cat_id);
      const { data: cats, error: catsError } = await supabase
        .from('product_categories')
        .select('*')
        .in('product_cat_id', catIds);

      if (catsError) throw catsError;
      categories = cats || [];
    }

    // Find primary image
    const primaryImage = images?.find(img => img.is_primary)?.image_url || 
                         (images && images.length > 0 ? images[0].image_url : null);

    return {
      ...product,
      primary_image: primaryImage,
      images: images || [],
      categories: categories
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
  const [activeTab, setActiveTab] = useState('details');
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);
  const [addFgQty, setAddFgQty] = useState('');
  const [addFgLocation, setAddFgLocation] = useState('');
  const [addingFg, setAddingFg] = useState(false);
  const [reservationsOpen, setReservationsOpen] = useState(false);

  console.log('ProductDetailPage mounted, productId:', productId);

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

  // Handle back button - use router.back() to preserve URL params (filters)
  const handleBack = () => {
    router.back();
  };

  const openEdit = () => {
    setEditCode(product?.internal_code ?? '');
    setEditName(product?.name ?? '');
    setEditDescription(product?.description ?? '');
    setEditOpen(true);
  };

  const handleSaveProduct = async () => {
    if (!product) return;
    setSavingProduct(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({
          internal_code: editCode.trim(),
          name: editName.trim(),
          description: editDescription || null,
        })
        .eq('product_id', productId);
      if (error) throw error;
      toast({ title: 'Product updated', description: 'Your changes have been saved.' });
      setEditOpen(false);
      refetch();
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="costing">Costing</TabsTrigger>
          <TabsTrigger value="cutlist">Cutlist</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>
        
        <TabsContent value="details" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Product image */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Product Image</CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                {product.primary_image ? (
                  <div className="relative h-60 w-60 rounded-md overflow-hidden bg-card ring-0 dark:bg-white/5 dark:ring-1 dark:ring-white/10">
                    <Image 
                      src={product.primary_image}
                      alt={product.name}
                      fill
                      className="object-contain dark:brightness-110 dark:drop-shadow-[0_8px_24px_rgba(0,0,0,0.85)]"
                    />
                  </div>
                ) : (
                  <div className="h-60 w-60 bg-muted rounded-md flex items-center justify-center">
                    <Package className="h-24 w-24 text-muted-foreground/50" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Product details */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">Product Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground">
                    Product Code
                  </h3>
                  <p className="mt-1">{product.internal_code}</p>
                </div>
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground">
                    Name
                  </h3>
                  <p className="mt-1">{product.name}</p>
                </div>
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground">
                    Description
                  </h3>
                  <p className="mt-1 whitespace-pre-line">
                    {product.description || 'No description provided'}
                  </p>
                </div>

                {/* Categories */}
                <div>
                  <h3 className="font-medium text-sm text-muted-foreground">
                    Categories
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {product.categories && product.categories.length > 0 ? (
                      product.categories.map(category => (
                        <div 
                          key={category.product_cat_id}
                          className="px-2 py-1 text-xs rounded-full bg-muted"
                        >
                          {category.categoryname}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No categories assigned</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Finished-Goods Inventory Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Finished-Goods Inventory</CardTitle>
              <CardDescription>On-hand, reserved, and available quantities for this product.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-md border p-4">
                  <div className="text-sm text-muted-foreground">On Hand</div>
                  <div className="text-2xl font-semibold mt-1">{onHandTotal}</div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">Reserved (all orders)</div>
                    {reservationsListSorted.length > 0 && (
                      <button type="button" className="text-xs text-primary hover:underline" onClick={() => setReservationsOpen(true)}>
                        View
                      </button>
                    )}
                  </div>
                  <div className="text-2xl font-semibold mt-1">{reservedTotal}</div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-sm text-muted-foreground">Available</div>
                  <div className="text-2xl font-semibold mt-1">{availableTotal}</div>
                </div>
              </div>
              {Array.isArray(inventoryRows) && inventoryRows.length > 0 && (
                <div className="mt-4 text-sm text-muted-foreground">
                  Locations tracked: {inventoryRows.filter((r: any) => r.location).length} / {inventoryRows.length}
                </div>
              )}
              {Array.isArray(reservationRows) && reservationRows.length > 0 && (
                <div className="mt-2 text-sm text-muted-foreground">
                  Active reservations across {new Set(reservationRows.map((r: any) => r.order_id)).size} order(s).
                </div>
              )}

              {/* Add Finished Goods */}
              <form onSubmit={handleAddFg} className="mt-6 grid grid-cols-1 sm:grid-cols-6 gap-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="fg-qty">Add Quantity</Label>
                  <Input id="fg-qty" type="number" min="0" step="1" value={addFgQty} onChange={(e) => setAddFgQty(e.target.value)} placeholder="e.g. 5" />
                </div>
                <div className="sm:col-span-3">
                  <Label htmlFor="fg-loc">Location (optional)</Label>
                  <Input id="fg-loc" value={addFgLocation} onChange={(e) => setAddFgLocation(e.target.value)} placeholder="Leave blank for primary" />
                </div>
                <div className="sm:col-span-1 flex items-end">
                  <Button type="submit" disabled={addingFg || !addFgQty} className="w-full">
                    {addingFg ? 'Adding…' : 'Add FG'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

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
                              const { error } = await supabase
                                .from('product_category_assignments')
                                .delete()
                                .eq('product_id', product.product_id)
                                .eq('product_cat_id', category.product_cat_id)

                              if (error) throw error

                              toast({
                                title: "Success",
                                description: "Category removed successfully",
                              })

                              refetch()
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
            <Link href={`/products/${product.product_id}/cutlist-builder`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                Cutlist Builder
              </Button>
            </Link>
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
      </Tabs>
    </div>
  );
}

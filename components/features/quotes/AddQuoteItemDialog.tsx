'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchProducts, type Product } from '@/lib/db/quotes';

interface AddQuoteItemDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateManual: (payload: { description: string; qty: number; unit_price: number }) => void;
  onCreateProduct: (payload: { product_id: number; name: string; qty: number; explode: boolean; include_labour?: boolean; attach_image?: boolean }) => void;
}

export default function AddQuoteItemDialog({ open, onClose, onCreateManual, onCreateProduct }: AddQuoteItemDialogProps) {
  const [tab, setTab] = React.useState<'manual' | 'product'>('manual');

  // manual fields
  const [description, setDescription] = React.useState('');
  const [qty, setQty] = React.useState(1);
  const [unitPrice, setUnitPrice] = React.useState(0);

  // product fields
  const [products, setProducts] = React.useState<Product[]>([]);
  const [productQuery, setProductQuery] = React.useState('');
  const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(null);
  // Quantity input removed — items import as 1 by default; user sets final line qty later
  const [explode, setExplode] = React.useState(true);
  const [includeLabor, setIncludeLabor] = React.useState(true);
  const [attachImage, setAttachImage] = React.useState(true);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open && tab === 'product') {
      (async () => {
        setLoading(true);
        try {
          const data = await fetchProducts();
          setProducts(data);
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [open, tab]);

  const handleClose = () => {
    // reset
    setTab('manual');
    setDescription('');
    setQty(1);
    setUnitPrice(0);
    setProducts([]);
    setProductQuery('');
    setSelectedProduct(null);
    setExplode(true);
    setAttachImage(true);
    setIncludeLabor(true);
    onClose();
  };

  const handleCreate = () => {
    if (tab === 'manual') {
      if (!description.trim()) return;
      onCreateManual({ description: description.trim(), qty, unit_price: unitPrice });
    } else if (tab === 'product') {
      if (!selectedProduct) return;
      // Always import as quantity 1; user can set the final quantity on the line item afterwards
      onCreateProduct({ product_id: selectedProduct.product_id, name: selectedProduct.name, qty: 1, explode, include_labour: includeLabor as boolean, attach_image: attachImage as boolean });
    }
    handleClose();
  };

  const filteredProducts = products.filter(p =>
    (p.internal_code || '').toLowerCase().includes(productQuery.toLowerCase()) ||
    (p.name || '').toLowerCase().includes(productQuery.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle>Add Item</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mt-2">
          <TabsList>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="product">Product</TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="space-y-3 mt-3">
            <div>
              <Label htmlFor="desc">Description</Label>
              <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Enter item description" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m-qty">Quantity</Label>
                <Input id="m-qty" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value || 0))} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <Label htmlFor="m-price">Unit Price (R)</Label>
                <Input id="m-price" type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value || 0))} onFocus={(e) => e.target.select()} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="product" className="space-y-3 mt-3">
            <div>
              <Label htmlFor="p-search">Search Products</Label>
              <Input id="p-search" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Search by code or name" />
            </div>
            {loading ? (
              <div className="text-center py-4">Loading products…</div>
            ) : (
              <div className="max-h-56 overflow-y-auto border border-input rounded bg-card">
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">No products found</div>
                ) : (
                  filteredProducts.map((p) => (
                    <div key={p.product_id} className={`p-3 border-b border-input cursor-pointer hover:bg-muted/40 ${selectedProduct?.product_id === p.product_id ? 'bg-accent text-accent-foreground' : ''}`} onClick={() => setSelectedProduct(p)}>
                      <div className="font-medium">{p.name}</div>
                      {p.internal_code && <div className="text-sm">Code: {p.internal_code}</div>}
                    </div>
                  ))
                )}
              </div>
            )}
            {selectedProduct && (
              <div className="p-3 bg-muted/40 border border-input rounded">
                <div className="font-medium">Selected: {selectedProduct.name}</div>
                {selectedProduct.internal_code && <div className="text-sm text-foreground">Code: {selectedProduct.internal_code}</div>}
              </div>
            )}
            <div className="flex flex-col gap-3">
              <div className="text-xs text-muted-foreground">
                Items are imported at quantity 1. Set the final quantity on the line item after adding.
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="explode" checked={explode} onCheckedChange={(v) => setExplode(Boolean(v))} />
                <Label htmlFor="explode" className="text-sm text-muted-foreground">Explode BOM into Costing Cluster</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="include-labor" checked={includeLabor} onCheckedChange={(v) => setIncludeLabor(Boolean(v))} />
                <Label htmlFor="include-labor" className="text-sm text-muted-foreground">Include Labour</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="attach-image" checked={attachImage} onCheckedChange={(v) => setAttachImage(Boolean(v))} />
                <Label htmlFor="attach-image" className="text-sm text-muted-foreground">Attach product image to this item</Label>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" className="h-9" onClick={handleClose}>Cancel</Button>
          <Button size="sm" className="h-9" onClick={handleCreate} disabled={(tab === 'manual' && !description.trim()) || (tab === 'product' && !selectedProduct)}>Add Item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

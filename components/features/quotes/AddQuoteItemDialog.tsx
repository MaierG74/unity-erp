'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Package, Search } from 'lucide-react';
import { fetchProducts, type Product, type QuoteItemType, type QuoteItemTextAlign } from '@/lib/db/quotes';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import {
  fetchProductOptionGroups,
  type ProductOptionGroup,
  type ProductOptionSelection,
} from '@/lib/db/products';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface AddQuoteItemDialogProps {
  open: boolean;
  onClose: () => void;
  onCreateManual: (payload: { description: string; qty: number; unit_price: number }) => void | Promise<void>;
  onCreateProduct: (payload: {
    product_id: number;
    name: string;
    qty: number;
    explode: boolean;
    include_labour?: boolean;
    include_overhead?: boolean;
    attach_image?: boolean;
    selected_options?: ProductOptionSelection;
  }) => void | Promise<void>;
  onCreateText?: (payload: { description: string; item_type: QuoteItemType; text_align: QuoteItemTextAlign }) => void | Promise<void>;
}

export default function AddQuoteItemDialog({ open, onClose, onCreateManual, onCreateProduct, onCreateText }: AddQuoteItemDialogProps) {
  const [tab, setTab] = React.useState<'manual' | 'product' | 'text'>('manual');

  // manual fields
  const [description, setDescription] = React.useState('');
  const [qty, setQty] = React.useState<string>('1');
  const [unitPrice, setUnitPrice] = React.useState<string>('0');

  // text/heading fields
  const [textContent, setTextContent] = React.useState('');
  const [textType, setTextType] = React.useState<'heading' | 'note'>('heading');
  const [textAlign, setTextAlign] = React.useState<QuoteItemTextAlign>('left');

  // product fields
  const [products, setProducts] = React.useState<Product[]>([]);
  const [productQuery, setProductQuery] = React.useState('');
  const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(null);
  const [optionGroups, setOptionGroups] = React.useState<ProductOptionGroup[]>([]);
  const [selectedOptions, setSelectedOptions] = React.useState<ProductOptionSelection>({});
  // Quantity input removed — items import as 1 by default; user sets final line qty later
  const [explode, setExplode] = React.useState(true);
  const [includeLabor, setIncludeLabor] = React.useState(true);
  const [includeOverhead, setIncludeOverhead] = React.useState(true);
  const [attachImage, setAttachImage] = React.useState(true);
  const [productsLoading, setProductsLoading] = React.useState(false);
  const [optionsLoading, setOptionsLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const productSearchInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open && tab === 'product') {
      (async () => {
        setProductsLoading(true);
        try {
          const data = await fetchProducts();
          setProducts(data);
        } finally {
          setProductsLoading(false);
        }
      })();
    }
  }, [open, tab]);

  React.useEffect(() => {
    if (tab !== 'product' || selectedProduct) return;
    const id = window.setTimeout(() => {
      productSearchInputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [tab, selectedProduct]);

  React.useEffect(() => {
    if (!selectedProduct) {
      setOptionGroups([]);
      setSelectedOptions({});
      setOptionsLoading(false);
      return;
    }

    let cancelled = false;
    setOptionsLoading(true);

    (async () => {
      const groups = await fetchProductOptionGroups(selectedProduct.product_id);
      if (cancelled) return;
      setOptionGroups(groups);
      setSelectedOptions((prev) => {
        const next: ProductOptionSelection = {};
        for (const group of groups) {
          const existing = prev[group.code];
          const matching = group.values.find((value) => value.code === existing);
          if (matching) {
            next[group.code] = matching.code;
            continue;
          }

          const defaultValue =
            group.values.find((value) => value.is_default) ||
            (group.is_required && group.values.length > 0 ? group.values[0] : undefined);
          if (defaultValue?.code) {
            next[group.code] = defaultValue.code;
          }
        }
        return next;
      });
    })()
      .catch((error) => {
        console.warn('Failed to load product options:', error);
        setOptionGroups([]);
        setSelectedOptions({});
      })
      .finally(() => {
        if (!cancelled) {
          setOptionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProduct?.product_id]);

  const resetForm = React.useCallback(() => {
    setTab('manual');
    setDescription('');
    setQty('1');
    setUnitPrice('0');
    setProducts([]);
    setProductsLoading(false);
    setProductQuery('');
    setSelectedProduct(null);
    setOptionGroups([]);
    setSelectedOptions({});
    setExplode(true);
    setAttachImage(true);
    setIncludeLabor(true);
    setIncludeOverhead(true);
    setOptionsLoading(false);
    // Reset text fields
    setTextContent('');
    setTextType('heading');
    setTextAlign('left');
  }, []);

  const handleClose = React.useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (submitting) return;
      handleClose();
    }
  };

  const handleCreate = async () => {
    if (submitting) return;
    if (tab === 'manual') {
      if (!description.trim()) return;
      setSubmitting(true);
      let success = false;
      try {
        await Promise.resolve(
          onCreateManual({
            description: description.trim(),
            qty: Number(qty) || 1,
            unit_price: Math.round((Number(unitPrice) || 0) * 100) / 100,
          })
        );
        success = true;
      } catch (error) {
        console.error('Failed to add manual quote item:', error);
      } finally {
        setSubmitting(false);
        if (success) handleClose();
      }
    } else if (tab === 'product') {
      if (!selectedProduct) return;
      setSubmitting(true);
      const normalizedOptions = Object.fromEntries(
        Object.entries(selectedOptions).filter(([, value]) => typeof value === 'string' && value.length > 0)
      );
      try {
        // Always import as quantity 1; user can set the final quantity on the line item afterwards
        await Promise.resolve(
          onCreateProduct({
            product_id: selectedProduct.product_id,
            name: selectedProduct.name,
            qty: 1,
            explode,
            include_labour: includeLabor as boolean,
            include_overhead: includeOverhead as boolean,
            attach_image: attachImage as boolean,
            selected_options: Object.keys(normalizedOptions).length ? normalizedOptions : undefined,
          })
        );
        handleClose();
      } catch (error) {
        console.error('Failed to add product quote item:', error);
      } finally {
        setSubmitting(false);
      }
    } else if (tab === 'text') {
      if (!textContent.trim() || !onCreateText) return;
      setSubmitting(true);
      let success = false;
      try {
        await Promise.resolve(
          onCreateText({
            description: textContent.trim(),
            item_type: textType,
            text_align: textAlign,
          })
        );
        success = true;
      } catch (error) {
        console.error('Failed to add text/heading item:', error);
      } finally {
        setSubmitting(false);
        if (success) handleClose();
      }
    }
  };

  const matchesAllTokens = (query: string, ...fields: Array<string | null | undefined>) => {
    const tokens = query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return true;
    const hay = fields
      .map((f) => (f || '').toLowerCase())
      .join(' ');
    return tokens.every((token) => hay.includes(token));
  };

  const filteredProducts = products.filter((p) => matchesAllTokens(productQuery, p.internal_code, p.name));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle>Add Item</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mt-2">
          <TabsList>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="product">Product</TabsTrigger>
            <TabsTrigger value="text">Text / Heading</TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="space-y-3 mt-3">
            <div>
              <Label htmlFor="desc">Description</Label>
              <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Enter item description" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="m-qty">Quantity</Label>
                <Input id="m-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <Label htmlFor="m-price">Unit Price (R)</Label>
                <Input id="m-price" type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} onFocus={(e) => e.target.select()} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="product" className="space-y-3 mt-3">
            {selectedProduct ? (
              <div className="flex items-center gap-2 px-3 py-2 border border-input rounded-lg bg-muted/30">
                <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{selectedProduct.name}</div>
                  {selectedProduct.internal_code && (
                    <div className="text-xs text-muted-foreground">{selectedProduct.internal_code}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="flex flex-col border border-input rounded-lg overflow-hidden" style={{ height: '220px' }}>
                <div className="p-2 border-b shrink-0">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      ref={productSearchInputRef}
                      id="p-search"
                      type="text"
                      value={productQuery}
                      onChange={(e) => setProductQuery(e.target.value)}
                      placeholder="Search by code or name..."
                      className="w-full h-8 pl-7 pr-2 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-auto">
                  {productsLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading products...</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background border-b">
                        <tr className="text-muted-foreground">
                          <th className="text-left p-2 font-medium">Product</th>
                          <th className="p-2 w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProducts.map((p) => (
                          <tr key={p.product_id} className="border-b hover:bg-muted/40">
                            <td className="p-2 max-w-0">
                              <div className="truncate">{p.name}</div>
                              {p.internal_code && (
                                <div className="text-xs text-muted-foreground truncate">{p.internal_code}</div>
                              )}
                            </td>
                            <td className="p-2 text-right">
                              <Button size="sm" className="h-7 text-xs px-2" onClick={() => setSelectedProduct(p)}>
                                Select
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {filteredProducts.length === 0 && (
                          <tr>
                            <td className="p-4 text-center text-muted-foreground" colSpan={2}>
                              {products.length === 0 ? 'No products available' : 'No products match your search'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
            {selectedProduct && (
              <div className="p-3 bg-muted/40 border border-input rounded">
                <div className="font-medium">Selected: {selectedProduct.name}</div>
                {selectedProduct.internal_code && <div className="text-sm text-foreground">Code: {selectedProduct.internal_code}</div>}
                {optionsLoading ? (
                  <div className="text-xs text-muted-foreground mt-2">Loading configuration…</div>
                ) : optionGroups.length > 0 ? (
                  <div className="space-y-4 mt-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Configuration</div>
                    {optionGroups.map((group) => {
                      const value = selectedOptions[group.code] ?? '';
                      const handleChange = (next: string) => {
                        setSelectedOptions((prev) => {
                          const copy = { ...prev };
                          if (!next) {
                            delete copy[group.code];
                          } else {
                            copy[group.code] = next;
                          }
                          return copy;
                        });
                      };

                      return (
                        <div key={group.option_group_id} className="space-y-1">
                          <Label htmlFor={`option-${group.code}`} className="text-sm">
                            {group.label}
                            {group.is_required ? <span className="text-destructive"> *</span> : null}
                          </Label>
                          <Select value={value} onValueChange={handleChange}>
                            <SelectTrigger id={`option-${group.code}`} className="w-full">
                              <SelectValue placeholder="Choose option" />
                            </SelectTrigger>
                            <SelectContent>
                              {!group.is_required && (
                                <SelectItem value="">No selection</SelectItem>
                              )}
                              {group.values.map((option) => (
                                <SelectItem key={option.option_value_id} value={option.code}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground mt-2">No configurable options for this product.</div>
                )}
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
                <Checkbox id="include-overhead" checked={includeOverhead} onCheckedChange={(v) => setIncludeOverhead(Boolean(v))} />
                <Label htmlFor="include-overhead" className="text-sm text-muted-foreground">Include Overhead</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="attach-image" checked={attachImage} onCheckedChange={(v) => setAttachImage(Boolean(v))} />
                <Label htmlFor="attach-image" className="text-sm text-muted-foreground">Attach product image to this item</Label>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="text" className="space-y-4 mt-3">
            <div>
              <Label htmlFor="text-content">Text</Label>
              <Input
                id="text-content"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Enter heading or note text"
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <RadioGroup value={textType} onValueChange={(v) => setTextType(v as 'heading' | 'note')} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="heading" id="type-heading" />
                  <Label htmlFor="type-heading" className="font-normal cursor-pointer">Heading</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="note" id="type-note" />
                  <Label htmlFor="type-note" className="font-normal cursor-pointer">Note</Label>
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                Headings appear bold and larger. Notes appear as regular text. You can add images via attachments after creating.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Alignment</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant={textAlign === 'left' ? 'default' : 'outline'}
                  size="sm"
                  className="px-3"
                  onClick={() => setTextAlign('left')}
                >
                  <AlignLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={textAlign === 'center' ? 'default' : 'outline'}
                  size="sm"
                  className="px-3"
                  onClick={() => setTextAlign('center')}
                >
                  <AlignCenter className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={textAlign === 'right' ? 'default' : 'outline'}
                  size="sm"
                  className="px-3"
                  onClick={() => setTextAlign('right')}
                >
                  <AlignRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" size="sm" className="h-9" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-9"
            onClick={handleCreate}
            disabled={
              submitting ||
              (tab === 'manual' && !description.trim()) ||
              (tab === 'product' && !selectedProduct) ||
              (tab === 'text' && (!textContent.trim() || !onCreateText))
            }
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              'Add Item'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

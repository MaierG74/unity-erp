import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchComponents, Component, fetchSupplierComponentsForComponent, SupplierComponent, fetchProducts, Product, formatCurrency } from '@/lib/db/quotes';
import SupplierBrowseModal from './SupplierBrowseModal';
import { Building2, FileText, Database, Package, Layers } from 'lucide-react';

interface ComponentSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onAddComponent: (component: {
    type: 'manual' | 'database' | 'product' | 'collection';
    description: string;
    qty: number;
    unit_cost: number;
    component_id?: number;
    supplier_component_id?: number;
    product_id?: number;
    explode?: boolean;
    include_labour?: boolean;
    collection_id?: number;
  }) => void;
  defaultEntryType?: 'manual' | 'database' | 'product' | 'collection';
  requireSupplier?: boolean;
}

const ComponentSelectionDialog: React.FC<ComponentSelectionDialogProps> = ({
  open,
  onClose,
  onAddComponent,
  defaultEntryType = 'manual',
  requireSupplier = true,
}) => {
  const [entryType, setEntryType] = useState<'manual' | 'database' | 'product' | 'collection'>(defaultEntryType);
  const [components, setComponents] = useState<Component[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<Component | null>(null);
  const [supplierComponents, setSupplierComponents] = useState<SupplierComponent[]>([]);
  const [selectedSupplierComponent, setSelectedSupplierComponent] = useState<SupplierComponent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [overrideUnitCost, setOverrideUnitCost] = useState(false);
  
  // Manual entry fields
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState<string>('1');
  const [unitCost, setUnitCost] = useState<string>('0');
  // Product selection fields
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Array<{ collection_id: number; name: string; code?: string }>>([]);
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null);
  const [collectionScale, setCollectionScale] = useState<string>('1');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productQty, setProductQty] = useState<string>('1');
  const [explodeProduct, setExplodeProduct] = useState(true);
  const [includeLabor, setIncludeLabor] = useState(true);
  const [showSupplierBrowse, setShowSupplierBrowse] = useState(false);

  // Refs for auto-focus
  const descriptionInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const productSearchInputRef = useRef<HTMLInputElement>(null);

  // Helper: tokenized search - matches if ALL words in query appear somewhere in any field
  const matchesAllTokens = (query: string, ...fields: (string | undefined | null)[]): boolean => {
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return true;
    const combined = fields.map(f => (f || '').toLowerCase()).join(' ');
    return tokens.every(token => combined.includes(token));
  };

  // Load components/products when dialog opens and specific type is selected
  useEffect(() => {
    if (!open) return;
    setEntryType(defaultEntryType);
  }, [open, defaultEntryType]);

  useEffect(() => {
    if (open && entryType === 'database') {
      loadComponents();
    }
    if (open && entryType === 'product') {
      loadProducts();
    }
    if (open && entryType === 'collection') {
      loadCollections();
    }
  }, [open, entryType]);

  // Auto-focus appropriate input when tab changes
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (entryType === 'manual') {
        descriptionInputRef.current?.focus();
      } else if (entryType === 'database' && !selectedComponent) {
        searchInputRef.current?.focus();
      } else if (entryType === 'product') {
        productSearchInputRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [open, entryType, selectedComponent]);

  const loadComponents = async () => {
    setLoading(true);
    try {
      const componentData = await fetchComponents();
      setComponents(componentData);
    } catch (error) {
      console.error('Error loading components:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    setLoading(true);
    try {
      const productData = await fetchProducts();
      setProducts(productData);
    } catch (error) {
      console.error('Error loading products:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCollections = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/collections', { cache: 'no-store' });
      const json = await res.json();
      setCollections(json.collections || []);
    } catch (error) {
      console.error('Error loading collections:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter components based on search (tokenized - all words must match)
  const filteredComponents = components.filter(component =>
    matchesAllTokens(searchQuery, component.internal_code, component.description)
  );

  const handleComponentSelect = async (component: Component) => {
    setSelectedComponent(component);
    setDescription(component.description || '');
    setSelectedSupplierComponent(null); // Reset supplier selection
    setUnitCost('0');
    
    // Load suppliers for this component
    if (requireSupplier && component.component_id) {
      setLoadingSuppliers(true);
      try {
        const suppliers = await fetchSupplierComponentsForComponent(component.component_id);
        setSupplierComponents(suppliers);
        // Preselect lowest price if available
        if (suppliers && suppliers.length > 0) {
          const withPrice = suppliers.filter(s => typeof s.price === 'number');
          if (withPrice.length > 0) {
            const lowest = withPrice.reduce((min, s) => (Number(s.price) < Number(min.price) ? s : min));
            setSelectedSupplierComponent(lowest);
            setUnitCost(String(Number(lowest.price || 0)));
            setOverrideUnitCost(false);
          }
        }
      } catch (error) {
        console.error('Error loading suppliers for component:', error);
        setSupplierComponents([]);
      } finally {
        setLoadingSuppliers(false);
      }
    } else {
      setSupplierComponents([]);
      setSelectedSupplierComponent(null);
      setLoadingSuppliers(false);
    }
  };

  const handleSupplierSelect = (supplierComponent: SupplierComponent) => {
    setSelectedSupplierComponent(supplierComponent);
    setUnitCost(String(supplierComponent.price || 0));
    setOverrideUnitCost(false);
  };

  const handleSubmit = () => {
    if (entryType === 'manual') {
      if (!description.trim()) return;
      
      onAddComponent({
        type: 'manual',
        description: description.trim(),
        qty: Number(qty) || 1,
        unit_cost: Math.round((Number(unitCost) || 0) * 100) / 100
      });
    } else if (entryType === 'database') {
      if (!selectedComponent) return;

      const supplierComponent = requireSupplier ? selectedSupplierComponent : selectedSupplierComponent ?? null;
      if (requireSupplier && !supplierComponent) return;

      const effectiveUnitCost = Math.round((Number(unitCost) || 0) * 100) / 100;

      onAddComponent({
        type: 'database',
        description: supplierComponent
          ? `${selectedComponent.description} (${supplierComponent.supplier?.name})`
          : selectedComponent.description || selectedComponent.internal_code || 'Component',
        qty: Number(qty) || 1,
        unit_cost: effectiveUnitCost,
        component_id: selectedComponent.component_id,
        supplier_component_id: supplierComponent?.supplier_component_id,
      });
    } else if (entryType === 'product') {
      if (!selectedProduct) return;
      onAddComponent({
        // Product flow emits a normalized payload for parent to handle
        // (expansion into component lines happens upstream)
        // @ts-ignore - allowed extended shape
        type: 'product',
        product_id: selectedProduct.product_id,
        qty: Number(productQty) || 1,
        // carry explode preference
        explode: explodeProduct,
        include_labour: includeLabor,
        description: selectedProduct.name,
        unit_cost: 0,
      });
    } else if (entryType === 'collection') {
      if (!selectedCollection) return;
      onAddComponent({
        // @ts-ignore - extended
        type: 'collection',
        collection_id: selectedCollection,
        qty: 1,
        unit_cost: 0,
        description: 'Costing Cluster',
      });
    }

    // Reset form
    setDescription('');
    setQty('1');
    setUnitCost('0');
    setSelectedComponent(null);
    setSelectedSupplierComponent(null);
    setSupplierComponents([]);
    setSearchQuery('');
    onClose();
  };

  const handleClose = () => {
    // Reset form on close
    setDescription('');
    setQty('1');
    setUnitCost('0');
    setSelectedComponent(null);
    setSelectedSupplierComponent(null);
    setSupplierComponents([]);
    setSearchQuery('');
    setEntryType('manual');
    setProducts([]);
    setSelectedProduct(null);
    setProductQty('1');
    setExplodeProduct(true);
    setIncludeLabor(true);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl sm:rounded-xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Add Component</DialogTitle>
            <Button type="button" variant="outline" size="sm" className="h-8 mr-10" onClick={() => setShowSupplierBrowse(true)}>
              <Building2 className="h-4 w-4 mr-2" /> Browse by supplier
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto overflow-x-visible px-1">
          {/* Tab-based Entry Type Selection */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setEntryType('manual')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                entryType === 'manual'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
            >
              <FileText className="h-4 w-4" />
              Manual
            </button>
            <button
              type="button"
              onClick={() => setEntryType('database')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                entryType === 'database'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
            >
              <Database className="h-4 w-4" />
              Component
            </button>
            <button
              type="button"
              onClick={() => setEntryType('product')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                entryType === 'product'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
            >
              <Package className="h-4 w-4" />
              Product
            </button>
            <button
              type="button"
              onClick={() => setEntryType('collection')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                entryType === 'collection'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
            >
              <Layers className="h-4 w-4" />
              Cluster
            </button>
          </div>

          {entryType === 'manual' ? (
            /* Manual Entry Form */
            <div className="space-y-3">
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  ref={descriptionInputRef}
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter component description..."
                  onFocus={(e) => e.target.select()}
                  className="placeholder:text-muted-foreground text-foreground"
                />
              </div>
            </div>
          ) : entryType === 'database' ? (
            /* Database Component Selection - collapsed UI */
            <div className="space-y-3">
              {!selectedComponent ? (
                <div>
                  <Label htmlFor="search">Search Components</Label>
                  <Input
                    ref={searchInputRef}
                    id="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by internal code or description..."
                    className="placeholder:text-muted-foreground text-foreground"
                  />
                  {searchQuery.trim().length === 0 ? (
                    <div className="text-sm text-muted-foreground mt-2">
                      Start typing to search components, or use “Browse by supplier”.
                    </div>
                  ) : loading ? (
                    <div className="text-center py-4">Loading components...</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto border border-input rounded bg-card mt-2">
                      {filteredComponents.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground">
                          No components found matching your search.
                        </div>
                      ) : (
                        filteredComponents.map((component) => (
                          <div
                            key={component.component_id}
                            className="p-3 border-b border-input cursor-pointer hover:bg-muted/40"
                            onClick={() => handleComponentSelect(component)}
                          >
                            <div className="font-medium">{component.description}</div>
                            {component.internal_code && <div className="text-sm">Code: {component.internal_code}</div>}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 border rounded bg-accent/10 flex items-center justify-between">
                  <div className="truncate">
                    <div className="font-medium truncate">{selectedComponent.description}</div>
                    {selectedComponent.internal_code && <div className="text-xs text-muted-foreground truncate">Code: {selectedComponent.internal_code}</div>}
                  </div>
                  <div className="shrink-0 flex gap-2">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => { setSelectedComponent(null); setSupplierComponents([]); setSelectedSupplierComponent(null); setUnitCost('0'); }}>
                      Change
                    </Button>
                  </div>
                </div>
              )}

              {/* Supplier selection */}
              {selectedComponent && !selectedSupplierComponent && (
                <div>
                  <Label>Select Supplier</Label>
                  {loadingSuppliers ? (
                    <div className="text-center py-4">Loading suppliers...</div>
                  ) : supplierComponents.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">No suppliers available for this component.</div>
                  ) : (
                    <div className="max-h-44 overflow-y-auto border border-input rounded bg-card">
                      {supplierComponents.map((sc) => {
                        const min = supplierComponents.reduce((m, s) => (Number(s.price || Infinity) < m ? Number(s.price || Infinity) : m), Infinity);
                        const isLowest = Number(sc.price || Infinity) === min && Number.isFinite(min);
                        return (
                          <div
                            key={sc.supplier_component_id}
                            className="p-3 border-b border-input cursor-pointer hover:bg-muted/40"
                            onClick={() => handleSupplierSelect(sc)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium">{sc.supplier?.name}</div>
                                <div className="text-sm">Code: {sc.supplier_code}</div>
                                {sc.lead_time && (
                                  <div className="text-xs">Lead time: {sc.lead_time} days</div>
                                )}
                              </div>
                              <div className="text-right">
                                <div className="font-medium">{formatCurrency(Number(sc.price || 0))} {isLowest && (<span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 align-middle">Lowest</span>)}</div>
                                {sc.min_order_quantity && (
                                  <div className="text-xs">Min: {sc.min_order_quantity}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {selectedSupplierComponent && (
                <div className="p-3 border rounded bg-accent/10 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{selectedSupplierComponent.supplier?.name}</div>
                    <div className="text-xs text-muted-foreground">Price: {formatCurrency(Number(selectedSupplierComponent.price || 0))}</div>
                  </div>
                  <div className="shrink-0 flex gap-2">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => { setSelectedSupplierComponent(null); setOverrideUnitCost(false); }}>
                      Change
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : entryType === 'collection' ? (
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-4">Loading clusters...</div>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-input rounded bg-card">
                  {collections.map((c) => (
                    <div
                      key={c.collection_id}
                      className={`p-3 border-b border-input cursor-pointer hover:bg-muted/40 ${selectedCollection === c.collection_id ? 'bg-accent text-accent-foreground' : ''}`}
                      onClick={() => setSelectedCollection(c.collection_id)}
                    >
                      <div className="font-medium">{c.name}</div>
                      {c.code && <div className="text-sm">Code: {c.code}</div>}
                    </div>
                  ))}
                  {collections.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground">No costing clusters available</div>
                  )}
                </div>
              )}
              <div>
                <Label htmlFor="cc-scale">Scale</Label>
                <Input id="cc-scale" type="number" value={collectionScale} onChange={(e) => setCollectionScale(e.target.value)} onFocus={(e) => e.target.select()} />
              </div>
            </div>
          ) : (
            /* Product Selection */
            <div className="space-y-3">
              <div>
                <Label htmlFor="product-search">Search Products</Label>
                <Input
                  ref={productSearchInputRef}
                  id="product-search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by code or name..."
                  className="placeholder:text-muted-foreground text-foreground"
                />
              </div>

              {loading ? (
                <div className="text-center py-4">Loading products...</div>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-input rounded bg-card">
                  {products.filter(p =>
                    matchesAllTokens(searchQuery, p.internal_code, p.name)
                  ).map((p) => (
                    <div
                      key={p.product_id}
                      className={`p-3 border-b border-input cursor-pointer hover:bg-muted/40 ${
                        selectedProduct?.product_id === p.product_id ? 'bg-accent text-accent-foreground' : ''
                      }`}
                      onClick={() => setSelectedProduct(p)}
                    >
                      <div className="font-medium">{p.name}</div>
                      {p.internal_code && <div className="text-sm">Code: {p.internal_code}</div>}
                    </div>
                  ))}
                  {products.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground">No products available</div>
                  )}
                </div>
              )}
              {selectedProduct && (
                <div className="p-3 bg-muted/40 border border-input rounded">
                  <div className="font-medium">Selected: {selectedProduct.name}</div>
                  {selectedProduct.internal_code && (
                    <div className="text-sm text-foreground">Code: {selectedProduct.internal_code}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Quantity and Unit Cost (common for manual/database/product) */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                type="number"
                min="1"
                value={entryType === 'product' ? productQty : entryType === 'collection' ? 1 : qty}
                onChange={(e) => {
                  const value = e.target.value;
                  if (entryType === 'product') setProductQty(value);
                  else if (entryType !== 'collection') setQty(value);
                }}
                onFocus={(e) => e.target.select()}
                className="placeholder:text-muted-foreground text-foreground"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="unit-cost">Unit Cost (R)</Label>
                {entryType === 'database' && selectedSupplierComponent && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox id="override-price" checked={overrideUnitCost} onCheckedChange={(v) => setOverrideUnitCost(Boolean(v))} />
                    <label htmlFor="override-price">Override</label>
                  </div>
                )}
              </div>
              <Input
                id="unit-cost"
                type="number"
                min="0"
                step="0.01"
                value={entryType === 'collection' ? 0 : unitCost}
                onChange={(e) => {
                  const value = e.target.value;
                  if (entryType !== 'collection') setUnitCost(value);
                }}
                onFocus={(e) => e.target.select()}
                disabled={entryType === 'collection' || (entryType === 'database' && selectedSupplierComponent !== null && !overrideUnitCost)}
                className={`placeholder:text-muted-foreground text-foreground ${entryType === 'collection' ? 'bg-muted cursor-not-allowed' : ''} ${entryType === 'database' && selectedSupplierComponent && !overrideUnitCost ? 'bg-muted cursor-not-allowed' : ''}`}
                />
            </div>
          </div>

          {/* Total Display */}
          <div className="text-right">
            <span className="font-medium text-foreground">Total: {formatCurrency((entryType === 'product' ? (Number(productQty) || 0) : (Number(qty) || 0)) * (entryType === 'collection' ? 0 : (Number(unitCost) || 0)))}</span>
          </div>

          {/* Product explode option */}
          {entryType === 'product' && (
            <div className="flex items-center gap-2">
              <Checkbox id="explode" checked={explodeProduct} onCheckedChange={(v) => setExplodeProduct(Boolean(v))} />
              <Label htmlFor="explode" className="text-sm text-muted-foreground">Explode into component lines (recommended)</Label>
            </div>
          )}
          {entryType === 'product' && (
            <div className="flex items-center gap-2">
              <Checkbox id="include-labor" checked={includeLabor} onCheckedChange={(v) => setIncludeLabor(Boolean(v))} />
              <Label htmlFor="include-labor" className="text-sm text-muted-foreground">Include Labour</Label>
            </div>
          )}
        </div>

      <DialogFooter className="mt-4">
        <Button variant="outline" size="sm" className="h-9" onClick={handleClose}>
          Cancel
        </Button>
          <Button 
            size="sm"
            className="h-9"
            onClick={handleSubmit}
            disabled={
              (entryType === 'manual' && !description.trim()) ||
              (entryType === 'database' && (!selectedComponent || !selectedSupplierComponent)) ||
              (entryType === 'product' && !selectedProduct) ||
              (entryType === 'collection' && !selectedCollection)
            }
          >
            Add Component
          </Button>
        </DialogFooter>
      </DialogContent>
      <SupplierBrowseModal
        open={showSupplierBrowse}
        onOpenChange={setShowSupplierBrowse}
        onSelect={(sc) => {
          // Map to local selected component + supplier component
          setSelectedComponent({
            component_id: sc.component_id!,
            internal_code: sc.component?.internal_code || undefined,
            description: sc.component?.description || undefined,
          } as any);
          setSelectedSupplierComponent({
            ...sc,
          } as any);
          setUnitCost(String(sc.price || 0));
          setSearchQuery('');
          setOverrideUnitCost(false);
        }}
      />
    </Dialog>
  );
};

export default ComponentSelectionDialog;

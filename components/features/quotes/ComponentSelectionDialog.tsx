import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchComponents, Component, fetchSupplierComponentsForComponent, SupplierComponent, fetchProducts, Product } from '@/lib/db/quotes';
import SupplierBrowseModal from './SupplierBrowseModal';
import { Building2 } from 'lucide-react';

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
}

const ComponentSelectionDialog: React.FC<ComponentSelectionDialogProps> = ({
  open,
  onClose,
  onAddComponent
}) => {
  const [entryType, setEntryType] = useState<'manual' | 'database' | 'product'>('manual');
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
  const [qty, setQty] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  // Product selection fields
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Array<{ collection_id: number; name: string; code?: string }>>([]);
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null);
  const [collectionScale, setCollectionScale] = useState<number>(1);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productQty, setProductQty] = useState(1);
  const [explodeProduct, setExplodeProduct] = useState(true);
  const [includeLabor, setIncludeLabor] = useState(true);
  const [showSupplierBrowse, setShowSupplierBrowse] = useState(false);

  // Load components/products when dialog opens and specific type is selected
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

  // Filter components based on search
  const filteredComponents = components.filter(component =>
    component.internal_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    component.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleComponentSelect = async (component: Component) => {
    setSelectedComponent(component);
    setDescription(component.description || '');
    setSelectedSupplierComponent(null); // Reset supplier selection
    setUnitCost(0);
    
    // Load suppliers for this component
    if (component.component_id) {
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
            setUnitCost(Number(lowest.price || 0));
            setOverrideUnitCost(false);
          }
        }
      } catch (error) {
        console.error('Error loading suppliers for component:', error);
        setSupplierComponents([]);
      } finally {
        setLoadingSuppliers(false);
      }
    }
  };

  const handleSupplierSelect = (supplierComponent: SupplierComponent) => {
    setSelectedSupplierComponent(supplierComponent);
    setUnitCost(supplierComponent.price || 0);
    setOverrideUnitCost(false);
  };

  const handleSubmit = () => {
    if (entryType === 'manual') {
      if (!description.trim()) return;
      
      onAddComponent({
        type: 'manual',
        description: description.trim(),
        qty,
        unit_cost: unitCost
      });
    } else if (entryType === 'database') {
      if (!selectedComponent || !selectedSupplierComponent) return;
      
      onAddComponent({
        type: 'database',
        description: `${selectedComponent.description} (${selectedSupplierComponent.supplier?.name})`,
        qty,
        unit_cost: unitCost,
        component_id: selectedComponent.component_id,
        supplier_component_id: selectedSupplierComponent.supplier_component_id
      });
    } else if (entryType === 'product') {
      if (!selectedProduct) return;
      onAddComponent({
        // Product flow emits a normalized payload for parent to handle
        // (expansion into component lines happens upstream)
        // @ts-ignore - allowed extended shape
        type: 'product',
        product_id: selectedProduct.product_id,
        qty: productQty,
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
    setQty(1);
    setUnitCost(0);
    setSelectedComponent(null);
    setSelectedSupplierComponent(null);
    setSupplierComponents([]);
    setSearchQuery('');
    onClose();
  };

  const handleClose = () => {
    // Reset form on close
    setDescription('');
    setQty(1);
    setUnitCost(0);
    setSelectedComponent(null);
    setSelectedSupplierComponent(null);
    setSupplierComponents([]);
    setSearchQuery('');
    setEntryType('manual');
    setProducts([]);
    setSelectedProduct(null);
    setProductQty(1);
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
            {entryType === 'database' && (
              <Button type="button" variant="outline" size="sm" className="h-8 mr-10" onClick={() => setShowSupplierBrowse(true)}>
                <Building2 className="h-4 w-4 mr-2" /> Browse by supplier
              </Button>
            )}
          </div>
        </DialogHeader>
        
        <div className="space-y-3 max-h-[70vh] overflow-y-auto overflow-x-visible px-1">
          {/* Entry Type Selection */}
          <div>
            <Label htmlFor="entry-type">Component Type</Label>
            <Select value={entryType} onValueChange={(value: any) => setEntryType(value)}>
              <SelectTrigger className="h-9 bg-background text-foreground border-input focus:ring-inset focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual Entry</SelectItem>
                <SelectItem value="database">Database Component</SelectItem>
                <SelectItem value="product">Product</SelectItem>
                <SelectItem value="collection">Costing Cluster</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {entryType === 'manual' ? (
            /* Manual Entry Form */
            <div className="space-y-3">
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
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
                    <Button size="sm" variant="outline" className="h-8" onClick={() => { setSelectedComponent(null); setSupplierComponents([]); setSelectedSupplierComponent(null); setUnitCost(0); }}>
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
                                <div className="font-medium">R{Number(sc.price || 0).toFixed(2)} {isLowest && (<span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 align-middle">Lowest</span>)}</div>
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
                    <div className="text-xs text-muted-foreground">Price: R{Number(selectedSupplierComponent.price || 0).toFixed(2)}</div>
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
                <Input id="cc-scale" type="number" value={collectionScale} onChange={(e) => setCollectionScale(Number(e.target.value || 1))} onFocus={(e) => e.target.select()} />
              </div>
            </div>
          ) : (
            /* Product Selection */
            <div className="space-y-3">
              <div>
                <Label htmlFor="product-search">Search Products</Label>
                <Input
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
                  {(products.filter(p =>
                    (p.internal_code || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (p.name || '').toLowerCase().includes(searchQuery.toLowerCase())
                  )).map((p) => (
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
                  if (value === '') {
                    if (entryType === 'product') setProductQty(0); else if (entryType !== 'collection') setQty(0);
                  } else {
                    const n = Number(value) || 1;
                    if (entryType === 'product') setProductQty(n); else if (entryType !== 'collection') setQty(n);
                  }
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
                  if (value === '') {
                    if (entryType !== 'collection') setUnitCost(0);
                  } else {
                    if (entryType !== 'collection') setUnitCost(Number(value) || 0);
                  }
                }}
                onFocus={(e) => e.target.select()}
                disabled={entryType === 'collection' || (entryType === 'database' && selectedSupplierComponent !== null && !overrideUnitCost)}
                className={`placeholder:text-muted-foreground text-foreground ${entryType === 'collection' ? 'bg-muted cursor-not-allowed' : ''} ${entryType === 'database' && selectedSupplierComponent && !overrideUnitCost ? 'bg-muted cursor-not-allowed' : ''}`}
                />
            </div>
          </div>

          {/* Total Display */}
          <div className="text-right">
            <span className="font-medium text-foreground">Total: R{((entryType === 'product' ? productQty : qty) * (entryType === 'collection' ? 0 : unitCost)).toFixed(2)}</span>
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
          setUnitCost(sc.price || 0);
          setSearchQuery('');
          setOverrideUnitCost(false);
        }}
      />
    </Dialog>
  );
};

export default ComponentSelectionDialog;

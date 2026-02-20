import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  fetchComponents, Component,
  fetchSupplierComponentsForComponent, SupplierComponent,
  fetchProducts, Product,
  fetchSuppliersSimple, SupplierLite,
  fetchSupplierComponentsBySupplier, SupplierComponentWithMaster,
  formatCurrency,
} from '@/lib/db/quotes';
import { Building2, FileText, Database, Package, Layers, Search } from 'lucide-react';

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
  const [entryType, setEntryType] = useState<'manual' | 'database' | 'product' | 'collection' | 'supplier'>(defaultEntryType);
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
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productQty, setProductQty] = useState<string>('1');
  const [explodeProduct, setExplodeProduct] = useState(true);
  const [includeLabor, setIncludeLabor] = useState(true);

  // By Supplier tab state
  const [browseSuppliers, setBrowseSuppliers] = useState<SupplierLite[]>([]);
  const [browseSupplierQuery, setBrowseSupplierQuery] = useState('');
  const [browseSelectedSupplierId, setBrowseSelectedSupplierId] = useState<number | null>(null);
  const [browseComponents, setBrowseComponents] = useState<SupplierComponentWithMaster[]>([]);
  const [browseCompQuery, setBrowseCompQuery] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);

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
    if (open && entryType === 'supplier') {
      loadBrowseSuppliers();
    }
  }, [open, entryType]);

  // Load components when a supplier is selected in the browse tab
  useEffect(() => {
    if (!open || !browseSelectedSupplierId) return;
    setBrowseLoading(true);
    fetchSupplierComponentsBySupplier(browseSelectedSupplierId)
      .then(setBrowseComponents)
      .finally(() => setBrowseLoading(false));
  }, [open, browseSelectedSupplierId]);

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

  const loadBrowseSuppliers = async () => {
    try {
      const list = await fetchSuppliersSimple();
      setBrowseSuppliers(list);
    } catch (error) {
      console.error('Error loading suppliers:', error);
    }
  };

  // Filter components based on search (tokenized - all words must match)
  const filteredComponents = components.filter(component =>
    matchesAllTokens(searchQuery, component.internal_code, component.description)
  );

  const filteredBrowseSuppliers = browseSuppliers.filter(s =>
    s.name.toLowerCase().includes(browseSupplierQuery.toLowerCase())
  );

  const filteredBrowseComponents = browseComponents.filter(it => {
    const q = browseCompQuery.toLowerCase();
    if (!q) return true;
    return [it.component?.internal_code || '', it.component?.description || '', it.supplier_code || '']
      .some(f => f.toLowerCase().includes(q));
  });

  const handleComponentSelect = async (component: Component) => {
    setSelectedComponent(component);
    setDescription(component.description || '');
    setSelectedSupplierComponent(null);
    setUnitCost('0');

    if (requireSupplier && component.component_id) {
      setLoadingSuppliers(true);
      try {
        const suppliers = await fetchSupplierComponentsForComponent(component.component_id);
        setSupplierComponents(suppliers);
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

  // Called when user picks a component from the By Supplier browse tab
  const handleBrowseSelect = (sc: SupplierComponentWithMaster) => {
    setSelectedComponent({
      component_id: sc.component_id!,
      internal_code: sc.component?.internal_code || undefined,
      description: sc.component?.description || undefined,
    } as any);
    setSelectedSupplierComponent({ ...sc } as any);
    setUnitCost(String(sc.price || 0));
    setSearchQuery('');
    setOverrideUnitCost(false);
    setEntryType('database');
  };

  const handleSubmit = () => {
    if (entryType === 'manual') {
      if (!description.trim()) return;
      onAddComponent({
        type: 'manual',
        description: description.trim(),
        qty: Number(qty) || 1,
        unit_cost: Math.round((Number(unitCost) || 0) * 100) / 100,
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
        // @ts-ignore - allowed extended shape
        type: 'product',
        product_id: selectedProduct.product_id,
        qty: Number(productQty) || 1,
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
    // Reset browse state
    setBrowseSupplierQuery('');
    setBrowseSelectedSupplierId(null);
    setBrowseComponents([]);
    setBrowseCompQuery('');
    onClose();
  };

  const showQtyAndCost = entryType !== 'supplier' && entryType !== 'collection';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle>Add Component</DialogTitle>
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
            <button
              type="button"
              onClick={() => setEntryType('supplier')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                entryType === 'supplier'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
            >
              <Building2 className="h-4 w-4" />
              Supplier
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
            /* Database Component Selection */
            <div className="space-y-3">
              {!selectedComponent ? (
                <div className="flex flex-col border border-input rounded-lg overflow-hidden" style={{ height: '220px' }}>
                  <div className="p-2 border-b shrink-0">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        ref={searchInputRef}
                        id="search"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by code or description..."
                        className="w-full h-8 pl-7 pr-2 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {loading ? (
                      <div className="p-4 text-sm text-muted-foreground">Loading components...</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background border-b">
                          <tr className="text-muted-foreground">
                            <th className="text-left p-2 font-medium">Component</th>
                            <th className="p-2 w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {searchQuery.trim().length === 0 ? (
                            <tr><td className="p-4 text-center text-muted-foreground" colSpan={2}>Search by code or description, or use the Supplier tab to browse by supplier.</td></tr>
                          ) : filteredComponents.length === 0 ? (
                            <tr><td className="p-4 text-center text-muted-foreground" colSpan={2}>No components found.</td></tr>
                          ) : filteredComponents.map((component) => (
                            <tr key={component.component_id} className="border-b hover:bg-muted/40">
                              <td className="p-2 max-w-0">
                                <div className="truncate">{component.description}</div>
                                {component.internal_code && (
                                  <div className="text-xs text-muted-foreground truncate">{component.internal_code}</div>
                                )}
                              </td>
                              <td className="p-2 text-right">
                                <Button size="sm" className="h-7 text-xs px-2" onClick={() => handleComponentSelect(component)}>
                                  Select
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
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
                <div className="flex flex-col border border-input rounded-lg overflow-hidden" style={{ height: '180px' }}>
                  {loadingSuppliers ? (
                    <div className="flex-1 flex items-center justify-center p-4 text-sm text-muted-foreground">Loading suppliers...</div>
                  ) : supplierComponents.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center p-4 text-sm text-muted-foreground">No suppliers available for this component.</div>
                  ) : (
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background border-b">
                          <tr className="text-muted-foreground">
                            <th className="text-left p-2 font-medium">Supplier</th>
                            <th className="text-right p-2 w-28 font-medium">Price</th>
                            <th className="p-2 w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplierComponents.map((sc) => {
                            const min = supplierComponents.reduce((m, s) => (Number(s.price || Infinity) < m ? Number(s.price || Infinity) : m), Infinity);
                            const isLowest = Number(sc.price || Infinity) === min && Number.isFinite(min);
                            return (
                              <tr key={sc.supplier_component_id} className="border-b hover:bg-muted/40">
                                <td className="p-2 max-w-0">
                                  <div className="truncate">{sc.supplier?.name}</div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {sc.supplier_code}{sc.lead_time ? ` · ${sc.lead_time}d lead time` : ''}
                                  </div>
                                </td>
                                <td className="p-2 text-right whitespace-nowrap">
                                  {formatCurrency(Number(sc.price || 0))}
                                  {isLowest && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Low</span>}
                                </td>
                                <td className="p-2 text-right">
                                  <Button size="sm" className="h-7 text-xs px-2" onClick={() => handleSupplierSelect(sc)}>
                                    Select
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
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
            </div>
          ) : entryType === 'supplier' ? (
            /* By Supplier Browse */
            <div className="flex flex-col border border-input rounded-lg overflow-hidden" style={{ height: '280px' }}>
              {browseSelectedSupplierId ? (
                /* Supplier selected — collapsed pill + full-width component table */
                <>
                  {/* Collapsed supplier pill */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">
                      {browseSuppliers.find(s => s.supplier_id === browseSelectedSupplierId)?.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setBrowseSelectedSupplierId(null); setBrowseComponents([]); setBrowseCompQuery(''); }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      Change
                    </button>
                  </div>

                  {/* Filter + component table */}
                  <div className="p-2 border-b shrink-0">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        value={browseCompQuery}
                        onChange={(e) => setBrowseCompQuery(e.target.value)}
                        placeholder="Filter components"
                        className="w-full h-8 pl-7 pr-2 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {browseLoading ? (
                      <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background border-b">
                          <tr className="text-muted-foreground">
                            <th className="text-left p-2 font-medium">Component</th>
                            <th className="text-right p-2 w-28 font-medium">Price</th>
                            <th className="p-2 w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredBrowseComponents.map(it => (
                            <tr key={it.supplier_component_id} className="border-b hover:bg-muted/40">
                              <td className="p-2 max-w-0">
                                <div className="truncate">{it.component?.description || '-'}</div>
                                {it.component?.internal_code && (
                                  <div className="text-xs text-muted-foreground truncate">{it.component.internal_code}</div>
                                )}
                              </td>
                              <td className="p-2 text-right whitespace-nowrap">{formatCurrency(Number(it.price || 0))}</td>
                              <td className="p-2 text-right">
                                <Button size="sm" className="h-7 text-xs px-2" onClick={() => handleBrowseSelect(it)}>
                                  Select
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {filteredBrowseComponents.length === 0 && (
                            <tr>
                              <td className="p-4 text-center text-muted-foreground" colSpan={3}>No components</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              ) : (
                /* No supplier selected — two-column picker */
                <div className="flex flex-1 min-h-0">
                  {/* Suppliers column */}
                  <div className="w-44 shrink-0 border-r flex flex-col">
                    <div className="p-2 border-b">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          value={browseSupplierQuery}
                          onChange={(e) => setBrowseSupplierQuery(e.target.value)}
                          placeholder="Search suppliers"
                          className="w-full h-8 pl-7 pr-2 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto">
                      {filteredBrowseSuppliers.map(s => (
                        <button
                          key={s.supplier_id}
                          type="button"
                          onClick={() => { setBrowseSelectedSupplierId(s.supplier_id); setBrowseCompQuery(''); }}
                          className="w-full text-left px-3 py-2 border-b text-sm hover:bg-muted/40 transition-colors"
                        >
                          {s.name}
                        </button>
                      ))}
                      {filteredBrowseSuppliers.length === 0 && (
                        <div className="p-3 text-sm text-muted-foreground">No suppliers</div>
                      )}
                    </div>
                  </div>
                  {/* Placeholder right panel */}
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                    Select a supplier to browse their components
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Product Selection */
            <div className="space-y-3">
              {selectedProduct ? (
                /* Product selected — collapsed pill */
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
                /* No product selected — search + table */
                <div className="flex flex-col border border-input rounded-lg overflow-hidden" style={{ height: '220px' }}>
                  <div className="p-2 border-b shrink-0">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        ref={productSearchInputRef}
                        id="product-search"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by code or name..."
                        className="w-full h-8 pl-7 pr-2 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {loading ? (
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
                          {products.filter(p => matchesAllTokens(searchQuery, p.internal_code, p.name)).map((p) => (
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
                          {products.filter(p => matchesAllTokens(searchQuery, p.internal_code, p.name)).length === 0 && (
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
            </div>
          )}

          {/* Quantity and Unit Cost — hidden on Supplier tab (nothing selected yet) */}
          {showQtyAndCost && (
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
          )}

          {/* Total Display */}
          {showQtyAndCost && (
            <div className="text-right">
              <span className="font-medium text-foreground">Total: {formatCurrency((entryType === 'product' ? (Number(productQty) || 0) : (Number(qty) || 0)) * (entryType === 'collection' ? 0 : (Number(unitCost) || 0)))}</span>
            </div>
          )}

          {/* Product explode option */}
          {entryType === 'product' && (
            <div className="flex items-center gap-2">
              <Checkbox id="explode" checked={explodeProduct} onCheckedChange={(v) => setExplodeProduct(Boolean(v))} />
              <Label htmlFor="explode" className="text-sm text-muted-foreground">Add as individual component lines (recommended)</Label>
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
              entryType === 'supplier' ||
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
    </Dialog>
  );
};

export default ComponentSelectionDialog;

'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Search,
  Package,
  Truck,
  Check,
  ArrowUpDown,
  X,
  Loader2,
  ChevronRight,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ModalSupplierComponent = {
  supplier_component_id: number;
  supplier_id: number;
  price: number;
  lead_time: number | null;
  min_order_quantity: number | null;
  supplier: { name: string; supplier_id: number } | null;
};

export type ModalComponent = {
  component_id: number;
  internal_code: string;
  description: string | null;
  category_id: number | null;
  category: { categoryname: string } | null;
  inventory: { quantity_on_hand: number }[] | null;
  suppliercomponents: ModalSupplierComponent[] | null;
};

export type ComponentSelection = {
  component_id: number;
  internal_code: string;
  description: string | null;
  category_name: string | null;
  stock_on_hand: number | null;
  suppliers: ModalSupplierComponent[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: ComponentSelection) => void;
  /** Component IDs already in the order, to visually indicate */
  existingComponentIds?: number[];
};

// ── Data Fetching ──────────────────────────────────────────────────────────────

async function fetchRichComponents(): Promise<ModalComponent[]> {
  const { data, error } = await supabase
    .from('components')
    .select(
      `
      component_id, internal_code, description, category_id,
      category:component_categories(categoryname),
      inventory(quantity_on_hand),
      suppliercomponents(
        supplier_component_id, supplier_id, price, lead_time, min_order_quantity,
        supplier:suppliers(name, supplier_id)
      )
    `
    )
    .order('internal_code');

  if (error) throw new Error('Failed to fetch components');
  return (data ?? []) as unknown as ModalComponent[];
}

async function fetchActiveSuppliers(): Promise<
  { supplier_id: number; name: string }[]
> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('supplier_id, name')
    .eq('is_active', true)
    .order('name');

  if (error) throw new Error('Failed to fetch suppliers');
  return data ?? [];
}

async function fetchFrequentComponentIds(): Promise<number[]> {
  const { data, error } = await supabase.rpc('get_frequently_ordered_components' as any, {
    months_back: 6,
    max_results: 15,
  });

  // If the RPC doesn't exist, fall back to a direct query
  if (error) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('supplier_orders')
      .select('suppliercomponents(component_id)')
      .gte('order_date', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
      .limit(200);

    if (fallbackError || !fallbackData) return [];

    // Count occurrences of each component_id
    const counts = new Map<number, number>();
    fallbackData.forEach((row: any) => {
      const compId = row.suppliercomponents?.component_id;
      if (compId) counts.set(compId, (counts.get(compId) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([id]) => id);
  }

  return (data ?? []).map((r: any) => r.component_id);
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

type SortField = 'code' | 'description' | 'category' | 'stock' | 'price';
type SortDir = 'asc' | 'desc';

function compareComponents(
  a: ModalComponent,
  b: ModalComponent,
  field: SortField,
  dir: SortDir
): number {
  const mul = dir === 'asc' ? 1 : -1;
  switch (field) {
    case 'code':
      return mul * (a.internal_code ?? '').localeCompare(b.internal_code ?? '');
    case 'description':
      return mul * (a.description ?? '').localeCompare(b.description ?? '');
    case 'category': {
      const catA = a.category?.categoryname ?? '';
      const catB = b.category?.categoryname ?? '';
      return mul * catA.localeCompare(catB);
    }
    case 'stock': {
      const stockA = a.inventory?.[0]?.quantity_on_hand ?? 0;
      const stockB = b.inventory?.[0]?.quantity_on_hand ?? 0;
      return mul * (stockA - stockB);
    }
    case 'price': {
      const priceA = Math.min(
        ...(a.suppliercomponents ?? []).map((s) => s.price ?? Infinity)
      );
      const priceB = Math.min(
        ...(b.suppliercomponents ?? []).map((s) => s.price ?? Infinity)
      );
      return (
        mul *
        ((isFinite(priceA) ? priceA : 99999999) -
          (isFinite(priceB) ? priceB : 99999999))
      );
    }
    default:
      return 0;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ComponentSearchModal({
  open,
  onOpenChange,
  onSelect,
  existingComponentIds = [],
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(
    null
  );
  const [supplierSearch, setSupplierSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('code');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [activeTab, setActiveTab] = useState<'component' | 'supplier'>(
    'component'
  );

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search on open
  useEffect(() => {
    if (open) {
      // Small delay so dialog animation completes
      const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    } else {
      // Reset state when closing
      setSearchQuery('');
      setSelectedCategory(null);
      setSelectedSupplierId(null);
      setSupplierSearch('');
    }
  }, [open]);

  // ── Data queries ───────────────────────────────────────────────────────────

  const { data: components, isLoading: componentsLoading } = useQuery({
    queryKey: ['richComponents'],
    queryFn: fetchRichComponents,
    staleTime: 60_000,
  });

  const { data: suppliers, isLoading: suppliersLoading } = useQuery({
    queryKey: ['activeSuppliersList'],
    queryFn: fetchActiveSuppliers,
    staleTime: 60_000,
  });

  const { data: frequentComponentIds } = useQuery({
    queryKey: ['frequentComponents'],
    queryFn: fetchFrequentComponentIds,
    staleTime: 5 * 60_000,
  });

  // ── Derived: frequent components ───────────────────────────────────────────

  const frequentComponents = useMemo(() => {
    if (!components || !frequentComponentIds?.length) return [];
    const idSet = new Set(frequentComponentIds);
    return frequentComponentIds
      .map((id) => components.find((c) => c.component_id === id))
      .filter(Boolean) as ModalComponent[];
  }, [components, frequentComponentIds]);

  // ── Derived: categories ────────────────────────────────────────────────────

  const categories = useMemo(() => {
    if (!components) return [];
    const cats = new Map<string, number>();
    components.forEach((c) => {
      const name = c.category?.categoryname;
      if (name) cats.set(name, (cats.get(name) ?? 0) + 1);
    });
    return Array.from(cats.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }, [components]);

  // ── Filtered / sorted components ───────────────────────────────────────────

  const filteredComponents = useMemo(() => {
    if (!components) return [];

    let results = components;

    // Filter by category
    if (selectedCategory) {
      results = results.filter(
        (c) => c.category?.categoryname === selectedCategory
      );
    }

    // Tab-specific filtering
    if (activeTab === 'supplier' && selectedSupplierId) {
      results = results.filter((c) =>
        c.suppliercomponents?.some(
          (sc) => sc.supplier_id === selectedSupplierId
        )
      );
    }

    // Search query — match against code, description, category, supplier name
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/);
      results = results.filter((c) => {
        const searchable = [
          c.internal_code,
          c.description,
          c.category?.categoryname,
          ...(c.suppliercomponents ?? []).map((sc) => sc.supplier?.name),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return terms.every((term) => searchable.includes(term));
      });
    }

    // Sort
    results = [...results].sort((a, b) =>
      compareComponents(a, b, sortField, sortDir)
    );

    return results;
  }, [
    components,
    searchQuery,
    selectedCategory,
    activeTab,
    selectedSupplierId,
    sortField,
    sortDir,
  ]);

  // ── Filtered suppliers (for supplier tab) ──────────────────────────────────

  const filteredSuppliers = useMemo(() => {
    if (!suppliers) return [];
    if (!supplierSearch.trim()) return suppliers;
    const q = supplierSearch.toLowerCase();
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, supplierSearch]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField]
  );

  const handleSelect = useCallback(
    (comp: ModalComponent) => {
      onSelect({
        component_id: comp.component_id,
        internal_code: comp.internal_code,
        description: comp.description,
        category_name: comp.category?.categoryname ?? null,
        stock_on_hand: comp.inventory?.[0]?.quantity_on_hand ?? null,
        suppliers: comp.suppliercomponents ?? [],
      });
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  // ── Sort header helper ─────────────────────────────────────────────────────

  const SortHeader = ({
    field,
    children,
    className,
  }: {
    field: SortField;
    children: React.ReactNode;
    className?: string;
  }) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className={`flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors ${className ?? ''}`}
    >
      {children}
      <ArrowUpDown
        className={`h-3 w-3 ${sortField === field ? 'text-foreground' : 'opacity-40'}`}
      />
    </button>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] sm:max-h-[85vh] p-0 gap-0">
        <div className="max-h-[min(calc(100vh-4rem),85vh)] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b space-y-4 flex-shrink-0">
            <DialogHeader>
              <DialogTitle>Select Component</DialogTitle>
              <DialogDescription>
                Search for components by code, name, or supplier
              </DialogDescription>
            </DialogHeader>

            {/* Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as 'component' | 'supplier')}
            >
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="component" className="flex-1 sm:flex-none">
                  <Package className="h-4 w-4 mr-2" />
                  Search by Component
                </TabsTrigger>
                <TabsTrigger value="supplier" className="flex-1 sm:flex-none">
                  <Truck className="h-4 w-4 mr-2" />
                  Search by Supplier
                </TabsTrigger>
              </TabsList>

              {/* Component tab: search + category chips */}
              <TabsContent value="component" className="mt-3 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    placeholder="Search by code, name, description, or supplier..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-10"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Category chips — collapsible */}
                {categories.length > 0 && (
                  selectedCategory ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        variant="default"
                        className="cursor-pointer gap-1"
                        onClick={() => setSelectedCategory(null)}
                      >
                        {selectedCategory}
                        <X className="h-3 w-3" />
                      </Badge>
                    </div>
                  ) : (
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group">
                        <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                        Filter by Category
                        <span className="text-muted-foreground/60">({categories.length})</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="flex flex-wrap gap-1.5 mt-2 max-h-[72px] overflow-y-auto">
                          {categories.map((cat) => (
                            <Badge
                              key={cat.name}
                              variant="outline"
                              className="cursor-pointer hover:bg-accent"
                              onClick={() => setSelectedCategory(cat.name)}
                            >
                              {cat.name}
                              <span className="ml-1 text-muted-foreground">
                                {cat.count}
                              </span>
                            </Badge>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )
                )}
              </TabsContent>

              {/* Supplier tab: supplier selector + search */}
              <TabsContent value="supplier" className="mt-3 space-y-3">
                {!selectedSupplierId ? (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search for a supplier..."
                        value={supplierSearch}
                        onChange={(e) => setSupplierSearch(e.target.value)}
                        className="pl-9 h-10"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-[200px] overflow-y-auto border rounded-md">
                      {suppliersLoading && (
                        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Loading suppliers...
                        </div>
                      )}
                      {!suppliersLoading &&
                        filteredSuppliers.map((s) => (
                          <button
                            key={s.supplier_id}
                            type="button"
                            onClick={() => {
                              setSelectedSupplierId(s.supplier_id);
                              setSupplierSearch('');
                              setSearchQuery('');
                            }}
                            className="w-full text-left px-4 py-2.5 hover:bg-accent transition-colors border-b last:border-b-0 text-sm"
                          >
                            <span className="font-medium">{s.name}</span>
                          </button>
                        ))}
                      {!suppliersLoading && filteredSuppliers.length === 0 && (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          No suppliers found
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="gap-1 cursor-pointer" onClick={() => setSelectedSupplierId(null)}>
                        <Truck className="h-3 w-3" />
                        {suppliers?.find(
                          (s) => s.supplier_id === selectedSupplierId
                        )?.name ?? 'Supplier'}
                        <X className="h-3 w-3" />
                      </Badge>
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          ref={searchInputRef}
                          placeholder="Filter components from this supplier..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="pl-9 h-10"
                        />
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Results table */}
          {(activeTab === 'component' || selectedSupplierId) && (
            <div className="flex-1 overflow-y-auto min-h-0">
              {/* Frequently Ordered — collapsible, shown only when no search/filter active */}
              {activeTab === 'component' &&
                !searchQuery &&
                !selectedCategory &&
                frequentComponents.length > 0 && (
                  <div className="px-6 py-3 border-b bg-accent/20">
                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group">
                        <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                        Frequently Ordered
                        <span className="text-muted-foreground/60">({frequentComponents.length})</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {frequentComponents.map((comp) => {
                            const isExisting = existingComponentIds.includes(
                              comp.component_id
                            );
                            return (
                              <button
                                key={comp.component_id}
                                type="button"
                                onClick={() => handleSelect(comp)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors hover:bg-accent ${
                                  isExisting
                                    ? 'border-green-500/30 bg-green-500/10'
                                    : 'border-border'
                                }`}
                              >
                                <span className="font-mono font-medium">
                                  {comp.internal_code}
                                </span>
                                {comp.description && (
                                  <span className="text-muted-foreground max-w-[150px] truncate">
                                    {comp.description}
                                  </span>
                                )}
                                {isExisting && (
                                  <Check className="h-3 w-3 text-green-500" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}

              {/* Table header */}
              <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm border-b grid grid-cols-[1fr_1.5fr_120px_80px_100px_80px] gap-2 px-6 py-2">
                <SortHeader field="code">Code</SortHeader>
                <SortHeader field="description">Description</SortHeader>
                <SortHeader field="category">Category</SortHeader>
                <SortHeader field="stock">Stock</SortHeader>
                <SortHeader field="price">Price</SortHeader>
                <span className="text-xs font-medium text-muted-foreground">
                  Suppliers
                </span>
              </div>

              {/* Loading state */}
              {componentsLoading && (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading components...
                </div>
              )}

              {/* Results */}
              {!componentsLoading && filteredComponents.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {searchQuery || selectedCategory
                    ? 'No components match your search'
                    : 'No components found'}
                </div>
              )}

              {!componentsLoading &&
                filteredComponents.map((comp) => {
                  const stock = comp.inventory?.[0]?.quantity_on_hand ?? null;
                  const suppliers = comp.suppliercomponents ?? [];
                  const minPrice =
                    suppliers.length > 0
                      ? Math.min(...suppliers.map((s) => s.price))
                      : null;
                  const maxPrice =
                    suppliers.length > 0
                      ? Math.max(...suppliers.map((s) => s.price))
                      : null;
                  const isExisting = existingComponentIds.includes(
                    comp.component_id
                  );

                  return (
                    <button
                      key={comp.component_id}
                      type="button"
                      onClick={() => handleSelect(comp)}
                      className={`w-full text-left grid grid-cols-[1fr_1.5fr_120px_80px_100px_80px] gap-2 px-6 py-3 hover:bg-accent/50 transition-colors border-b ${
                        isExisting ? 'bg-accent/20' : ''
                      }`}
                    >
                      {/* Code */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-sm font-medium truncate">
                          {comp.internal_code}
                        </span>
                        {isExisting && (
                          <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        )}
                      </div>

                      {/* Description */}
                      <span className="text-sm text-muted-foreground truncate">
                        {comp.description || '—'}
                      </span>

                      {/* Category */}
                      <div>
                        {comp.category?.categoryname && (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-normal"
                          >
                            {comp.category.categoryname}
                          </Badge>
                        )}
                      </div>

                      {/* Stock */}
                      <span
                        className={`text-sm tabular-nums ${
                          stock === null
                            ? 'text-muted-foreground'
                            : stock === 0
                              ? 'text-destructive'
                              : stock < 10
                                ? 'text-amber-500'
                                : 'text-foreground'
                        }`}
                      >
                        {stock ?? '—'}
                      </span>

                      {/* Price */}
                      <span className="text-sm tabular-nums">
                        {minPrice !== null
                          ? minPrice === maxPrice
                            ? `R${minPrice.toFixed(2)}`
                            : `R${minPrice.toFixed(0)}–${maxPrice!.toFixed(0)}`
                          : '—'}
                      </span>

                      {/* Supplier count */}
                      <span className="text-sm text-muted-foreground">
                        {suppliers.length > 0 ? suppliers.length : '—'}
                      </span>
                    </button>
                  );
                })}
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-3 border-t flex items-center justify-between bg-background flex-shrink-0">
            <span className="text-xs text-muted-foreground">
              {!componentsLoading &&
                (activeTab === 'component' || selectedSupplierId) &&
                `${filteredComponents.length} component${filteredComponents.length !== 1 ? 's' : ''}`}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

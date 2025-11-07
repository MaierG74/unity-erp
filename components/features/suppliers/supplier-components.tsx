'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { addSupplierComponent, deleteSupplierComponent, updateSupplierComponent, getSuppliersList, getSupplierComponents, type SupplierComponentWithDetails } from '@/lib/api/suppliers';
import type { SupplierWithDetails, SupplierComponent } from '@/types/suppliers';
import { Trash2, Plus, Edit, Check, X, Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import ReactSelect from 'react-select';
import type { StylesConfig } from 'react-select';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/quotes';
import { useDebounce } from '@/hooks/use-debounce';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

type OptionType = {
  value: string;
  label: string;
};

interface SupplierComponentsProps {
  supplier: SupplierWithDetails;
}

type ComponentFormData = {
  component_id: number;
  supplier_id: number;
  supplier_code: string;
  price: number;
  lead_time?: number;
  min_order_quantity?: number;
};

export function SupplierComponents({ supplier }: SupplierComponentsProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ComponentFormData | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addForm, setAddForm] = useState<ComponentFormData | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 300);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<'internal_code' | 'price' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const router = useRouter();
  const queryClient = useQueryClient();

  // Reset to page 1 when debounced search or category changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, selectedCategory]);

  const pageSizeOptions = [10, 25, 50, 100];
  const [componentSearchTerm, setComponentSearchTerm] = useState('');

  // Async component search - only loads when dropdown is opened or search term changes
  const { data: components = [], isLoading: componentsSearchLoading } = useQuery({
    queryKey: ['components-search', componentSearchTerm],
    queryFn: async () => {
      let query = supabase
        .from('components')
        .select('component_id, internal_code, description')
        .order('internal_code')
        .limit(100); // Limit to 100 results for performance

      if (componentSearchTerm.trim()) {
        query = query.or(`internal_code.ilike.%${componentSearchTerm.trim()}%,description.ilike.%${componentSearchTerm.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: true, // Always enabled, but will search based on term
    staleTime: 30000, // Cache for 30 seconds
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: getSuppliersList,
  });

  // Fetch supplier components separately (optimized - only loads when Components tab is opened)
  const { data: supplierComponents = [], isLoading: componentsLoading } = useQuery({
    queryKey: ['supplier-components', supplier.supplier_id],
    queryFn: () => getSupplierComponents(supplier.supplier_id),
    enabled: true, // Always fetch when component mounts (tab is already lazy loaded)
  });

  // Fetch categories for filtering
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_categories')
        .select('cat_id, categoryname')
        .order('categoryname');
      if (error) throw error;
      return data;
    },
  });

  const addMutation = useMutation({
    mutationFn: addSupplierComponent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-components', supplier.supplier_id] });
      setIsAdding(false);
      setAddForm(null);
      setAddError(null);
    },
    onError: (err: any) => {
      const msg = String(err?.message || 'Failed to add component');
      if (msg.includes('duplicate key') || msg.includes('suppliercomponents_component_id_supplier_id_key')) {
        setAddError('This component is already linked to this supplier.');
      } else {
        setAddError(msg);
      }
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SupplierComponent> }) =>
      updateSupplierComponent(id, data),
    onSuccess: (data, variables) => {
      const oldSupplierId = supplier.supplier_id;
      const newSupplierId = variables.data.supplier_id;
      
      // Invalidate queries for both old and new supplier
      queryClient.invalidateQueries({ queryKey: ['supplier', oldSupplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-components', oldSupplierId] });
      if (newSupplierId && newSupplierId !== oldSupplierId) {
        queryClient.invalidateQueries({ queryKey: ['supplier', newSupplierId] });
        queryClient.invalidateQueries({ queryKey: ['supplier-components', newSupplierId] });
        // Navigate to the new supplier's page if supplier changed
        router.push(`/suppliers/${newSupplierId}?tab=components`);
      } else {
        queryClient.invalidateQueries({ queryKey: ['supplier-components', supplier.supplier_id] });
        setEditingId(null);
        setFormData(null);
        setUpdateError(null);
      }
    },
    onError: (err: any) => {
      const msg = String(err?.message || 'Failed to update component');
      if (msg.includes('duplicate key') || msg.includes('suppliercomponents_component_id_supplier_id_key')) {
        setUpdateError('This component is already linked to the selected supplier.');
      } else {
        setUpdateError(msg);
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSupplierComponent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', supplier.supplier_id] });
      queryClient.invalidateQueries({ queryKey: ['supplier-components', supplier.supplier_id] });
    },
  });

  const startEdit = (component: SupplierComponent) => {
    setEditingId(component.supplier_component_id);
    setComponentSearchTerm(''); // Reset search when opening edit form
    setFormData({
      component_id: component.component_id,
      supplier_id: component.supplier_id,
      supplier_code: component.supplier_code,
      price: component.price,
      lead_time: component.lead_time || undefined,
      min_order_quantity: component.min_order_quantity || undefined,
    });
    setUpdateError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData(null);
    setUpdateError(null);
    setComponentSearchTerm(''); // Reset search when closing edit form
  };

  const handleUpdate = (id: number) => {
    if (!formData) return;

    updateMutation.mutate({
      id,
      data: {
        component_id: formData.component_id,
        supplier_id: formData.supplier_id,
        supplier_code: formData.supplier_code,
        price: formData.price,
        lead_time: formData.lead_time || null,
        min_order_quantity: formData.min_order_quantity || null,
      },
    });
  };

  // Derived: options and disabled set for already-linked components
  const linkedComponentIds = useMemo(() => new Set((supplierComponents || []).map(c => c.component_id)), [supplierComponents]);
  const componentOptions: OptionType[] = useMemo(() =>
    (components || []).map((c: any) => ({ value: String(c.component_id), label: `${c.internal_code} - ${c.description}` })),
    [components]
  );

  const supplierOptions: OptionType[] = useMemo(() =>
    (suppliers || []).map((s: any) => ({ value: String(s.supplier_id), label: s.name })),
    [suppliers]
  );

  const startAdd = () => {
    setIsAdding(true);
    setAddError(null);
    setComponentSearchTerm(''); // Reset search when opening add form
    setAddForm({ component_id: 0, supplier_id: supplier.supplier_id, supplier_code: '', price: 0, lead_time: undefined, min_order_quantity: undefined });
  };

  const cancelAdd = () => {
    setIsAdding(false);
    setAddForm(null);
    setAddError(null);
    setComponentSearchTerm(''); // Reset search when closing add form
  };

  const handleCreate = async () => {
    if (!addForm) return;
    if (!addForm.component_id || addForm.component_id <= 0) { setAddError('Please choose a component.'); return; }
    if (!addForm.supplier_code?.trim()) { setAddError('Supplier code is required.'); return; }
    if (addForm.price === null || addForm.price === undefined || Number(addForm.price) < 0) { setAddError('Price must be zero or greater.'); return; }
    setAddError(null);
    await addMutation.mutateAsync({
      component_id: addForm.component_id,
      supplier_id: supplier.supplier_id,
      supplier_code: addForm.supplier_code.trim(),
      price: Number(addForm.price),
      lead_time: addForm.lead_time ?? null,
      min_order_quantity: addForm.min_order_quantity ?? null,
    });
  };

  // Filtered and sorted components view
  const filteredComponents = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    let filtered = (supplierComponents || []).filter((c) => {
      // Category filter
      if (selectedCategory !== 'all') {
        const categoryName = c.component?.category?.categoryname ?? '';
        if (categoryName !== selectedCategory) {
          return false;
        }
      }

      // Text search filter
      if (!q) return true;
      const fields = [
        c.component?.internal_code ?? "",
        c.component?.description ?? "",
        c.supplier_code ?? "",
        c.component?.category?.categoryname ?? "", // Include category in search
      ];
      return fields.some((f) => f.toLowerCase().includes(q));
    });

    // Apply sorting
    if (sortField) {
      filtered = [...filtered].sort((a, b) => {
        let valueA: string | number | null;
        let valueB: string | number | null;

        if (sortField === 'internal_code') {
          valueA = a.component?.internal_code ?? '';
          valueB = b.component?.internal_code ?? '';
        } else if (sortField === 'price') {
          valueA = a.price ?? 0;
          valueB = b.price ?? 0;
        } else {
          return 0;
        }

        // Handle null/undefined values
        if (valueA == null && valueB == null) return 0;
        if (valueA == null) return 1;
        if (valueB == null) return -1;

        // String comparison
        if (typeof valueA === 'string' && typeof valueB === 'string') {
          const comparison = valueA.localeCompare(valueB);
          return sortDirection === 'asc' ? comparison : -comparison;
        }

        // Number comparison
        if (typeof valueA === 'number' && typeof valueB === 'number') {
          return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
        }

        return 0;
      });
    }

    return filtered;
  }, [supplierComponents, debouncedSearch, selectedCategory, sortField, sortDirection]);

  // Paginated components
  const paginatedComponents = useMemo(() => {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return filteredComponents.slice(start, end);
  }, [filteredComponents, page, pageSize]);

  const totalCount = filteredComponents.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Handle search input change (debounced)
  const handleSearchInputChange = useCallback((value: string) => {
    setSearchInput(value);
  }, []);

  // Handle sort click
  const handleSort = useCallback((field: 'internal_code' | 'price') => {
    if (sortField === field) {
      // If already sorting by this field, toggle direction
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // If sorting by a new field, set it and default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(1); // Reset to first page when sorting changes
  }, [sortField, sortDirection]);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    // Scroll to top of table
    const tableContainer = document.querySelector('[data-table-container]');
    if (tableContainer) {
      tableContainer.scrollTop = 0;
    }
  }, []);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  }, []);

  // Shared classNames for react-select (Style Guide tokens + dark mode)
  const selectClassNames = {
    control: (state: any) => cn(
      "h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background text-foreground",
      state.isFocused && "ring-2 ring-ring ring-offset-2",
      state.isDisabled && "opacity-50 cursor-not-allowed"
    ),
    valueContainer: () => "p-0",
    singleValue: () => "text-foreground",
    input: () => "text-foreground",
    placeholder: () => "text-muted-foreground",
    indicatorsContainer: () => "text-muted-foreground",
    dropdownIndicator: ({ isFocused }: any) => cn("text-muted-foreground", isFocused && "text-foreground"),
    menu: () => "z-[9999] mt-2 bg-popover text-popover-foreground rounded-md border shadow-md",
    menuList: () => "p-1",
    option: ({ isSelected, isFocused }: any) => cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
      isSelected && "bg-primary text-primary-foreground",
      !isSelected && isFocused && "bg-accent text-accent-foreground",
      !isSelected && !isFocused && "text-popover-foreground hover:bg-accent hover:text-accent-foreground"
    ),
  } as const;

  // Inline style overrides are necessary because react-select applies inline styles
  // that can override our classes. Use CSS variables so dark/light themes work.
  const selectStyles: StylesConfig<OptionType, false> = {
    container: (base) => ({ ...base, minWidth: '14rem' }),
    control: (base, state) => ({
      ...base,
      backgroundColor: 'hsl(var(--background))',
      borderColor: 'hsl(var(--input))',
      minHeight: '2.25rem', // h-9
      boxShadow: state.isFocused ? '0 0 0 2px hsl(var(--ring))' : base.boxShadow,
      '&:hover': { borderColor: 'hsl(var(--input))' },
    }),
    valueContainer: (base) => ({ ...base, padding: 0 }),
    singleValue: (base) => ({ ...base, color: 'hsl(var(--foreground))' }),
    input: (base) => ({ ...base, color: 'hsl(var(--foreground))' }),
    placeholder: (base) => ({ ...base, color: 'hsl(var(--muted-foreground))' }),
    indicatorsContainer: (base) => ({ ...base, color: 'hsl(var(--muted-foreground))' }),
    dropdownIndicator: (base, state) => ({
      ...base,
      color: state.isFocused ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: 'hsl(var(--popover))',
      color: 'hsl(var(--popover-foreground))',
      zIndex: 9999,
      minWidth: '28rem',
      width: 'max-content',
      maxWidth: '90vw',
    }),
    menuList: (base) => ({ ...base, padding: 4 }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected
        ? 'hsl(var(--primary))'
        : state.isFocused
        ? 'hsl(var(--accent))'
        : 'transparent',
      color: state.isSelected
        ? 'hsl(var(--primary-foreground))'
        : state.isFocused
        ? 'hsl(var(--accent-foreground))'
        : 'hsl(var(--popover-foreground))',
    }),
    clearIndicator: (base) => ({ ...base, color: 'hsl(var(--muted-foreground))' }),
  };

  // Loading state for components
  if (componentsLoading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="h-9 w-full md:w-96 bg-muted animate-pulse rounded-lg" />
          <div className="h-9 w-32 bg-muted animate-pulse rounded-lg md:shrink-0" />
        </div>
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <div className="h-4 w-24 bg-muted rounded" />
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="h-4 w-32 bg-muted rounded" />
                <div className="ml-auto h-4 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex w-full items-center gap-3 md:max-w-2xl">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              placeholder="Filter by code, description, supplier code, or category"
              className="w-full h-9 pl-9 pr-10 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => handleSearchInputChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full md:w-[200px] h-9">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories
                .filter((category) => category.categoryname && category.categoryname.trim() !== '')
                .map((category) => (
                  <SelectItem key={category.cat_id} value={category.categoryname}>
                    {category.categoryname}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          {!isAdding && (
            <button
              onClick={startAdd}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <Plus className="h-4 w-4" />
              Add Component
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card shadow-sm max-h-[65vh] overflow-auto" data-table-container>
        <table className="w-full">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">
                <button
                  onClick={() => handleSort('internal_code')}
                  className="flex items-center gap-2 hover:text-foreground transition-colors"
                  aria-label={`Sort by component code ${sortField === 'internal_code' ? (sortDirection === 'asc' ? '(ascending)' : '(descending)') : ''}`}
                >
                  Component
                  {sortField === 'internal_code' ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )
                  ) : (
                    <ArrowUpDown className="h-4 w-4 opacity-50" />
                  )}
                </button>
              </th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Description</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Supplier Code</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-right p-4 font-medium">
                <button
                  onClick={() => handleSort('price')}
                  className="flex items-center gap-2 ml-auto hover:text-foreground transition-colors w-full justify-end"
                  aria-label={`Sort by price ${sortField === 'price' ? (sortDirection === 'asc' ? '(ascending)' : '(descending)') : ''}`}
                >
                  Price
                  {sortField === 'price' ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp className="h-4 w-4" />
                    ) : (
                      <ArrowDown className="h-4 w-4" />
                    )
                  ) : (
                    <ArrowUpDown className="h-4 w-4 opacity-50" />
                  )}
                </button>
              </th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-right p-4 font-medium">Lead Time</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-right p-4 font-medium">Min Order</th>
              <th className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-right p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isAdding && (
              <tr className="border-b">
                {/* Component select */}
                <td className="p-4 align-top">
                  <ReactSelect<OptionType>
                    value={addForm?.component_id ? {
                      value: String(addForm.component_id),
                      label: componentOptions.find(o => o.value === String(addForm.component_id))?.label || ''
                    } : null}
                    onChange={(opt) => {
                      setAddForm(prev => prev ? { ...prev, component_id: Number(opt?.value || 0) } : prev);
                      if (opt) {
                        setComponentSearchTerm(''); // Clear search term when option is selected
                      }
                    }}
                    options={componentOptions}
                    isOptionDisabled={(opt) => linkedComponentIds.has(Number(opt.value))}
                    isSearchable
                    onInputChange={(newValue) => {
                      setComponentSearchTerm(newValue);
                    }}
                    filterOption={() => true}
                    inputValue={componentSearchTerm}
                    placeholder="Select"
                    menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                    menuPosition="fixed"
                    className="w-full md:min-w-[14rem]"
                    classNames={selectClassNames}
                    styles={selectStyles}
                  />
                  {addError && (
                    <p className="mt-2 text-sm text-destructive">{addError}</p>
                  )}
                </td>

                {/* Description (read-only from selected) */}
                <td className="p-4 align-top text-muted-foreground">
                  <span className="block max-w-[36ch] truncate">
                    {(() => {
                      const c = (components || []).find((x: any) => x.component_id === addForm?.component_id);
                      return c?.description || '-';
                    })()}
                  </span>
                </td>

                {/* Supplier code */}
                <td className="p-4 align-top">
                  <input
                    type="text"
                    value={addForm?.supplier_code || ''}
                    onChange={(e) => setAddForm(prev => prev ? { ...prev, supplier_code: e.target.value } : prev)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Supplier code"
                  />
                </td>

                {/* Price */}
                <td className="p-4 align-top">
                  <div className="flex items-center gap-1">
                    <span>R</span>
                    <input
                      type="number"
                      value={addForm?.price ?? 0}
                      onChange={(e) => setAddForm(prev => prev ? { ...prev, price: Number(e.target.value) } : prev)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring"
                      step="0.01"
                      min="0"
                    />
                  </div>
                </td>

                {/* Lead Time */}
                <td className="p-4 align-top">
                  <input
                    type="number"
                    value={addForm?.lead_time ?? ''}
                    onChange={(e) => setAddForm(prev => prev ? { ...prev, lead_time: Number(e.target.value) } : prev)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    min="0"
                    placeholder="Days"
                  />
                </td>

                {/* MOQ */}
                <td className="p-4 align-top">
                  <input
                    type="number"
                    value={addForm?.min_order_quantity ?? ''}
                    onChange={(e) => setAddForm(prev => prev ? { ...prev, min_order_quantity: Number(e.target.value) } : prev)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    min="0"
                    placeholder="Qty"
                  />
                </td>

                {/* Actions */}
                <td className="p-4 text-right align-top">
                  <div className="inline-flex gap-2">
                    <button
                      onClick={handleCreate}
                      className="inline-flex items-center justify-center rounded-md bg-primary px-3 h-9 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Save
                    </button>
                    <button
                      onClick={cancelAdd}
                      className="inline-flex items-center justify-center rounded-md border border-input px-3 h-9 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {paginatedComponents.map((component) => (
              <tr key={component.supplier_component_id} className="border-b">
                {editingId === component.supplier_component_id ? (
                  <>
                    <td className="p-4" colSpan={2}>
                      <div className="space-y-4">
                        <div className="w-full">
                          <label className="text-sm font-medium mb-2 block">Component</label>
                          <ReactSelect<OptionType>
                            value={{
                              value: component.component_id.toString(),
                              label: `${component.component.internal_code} - ${component.component.description}`
                            }}
                            onChange={(newValue: OptionType | null) => {
                              if (newValue) {
                                setFormData(prev => prev ? {
                                  ...prev,
                                  component_id: parseInt(newValue.value)
                                } : null);
                                setComponentSearchTerm(''); // Clear search term when option is selected
                              }
                            }}
                            options={componentOptions}
                            isOptionDisabled={(opt) => linkedComponentIds.has(Number(opt.value)) && Number(opt.value) !== component.component_id}
                            isSearchable
                            onInputChange={(newValue) => {
                              setComponentSearchTerm(newValue);
                            }}
                            filterOption={() => true}
                            inputValue={componentSearchTerm}
                            placeholder="Select"
                            menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                            menuPosition="fixed"
                            className="w-full md:min-w-[14rem]"
                            classNames={selectClassNames}
                            styles={selectStyles}
                          />
                        </div>
                        <div className="w-full">
                          <label className="text-sm font-medium mb-2 block">Supplier</label>
                          <ReactSelect<OptionType>
                            value={formData?.supplier_id ? {
                              value: formData.supplier_id.toString(),
                              label: supplierOptions.find(o => o.value === formData.supplier_id.toString())?.label || ''
                            } : null}
                            onChange={(newValue: OptionType | null) => {
                              if (newValue) {
                                setFormData(prev => prev ? {
                                  ...prev,
                                  supplier_id: parseInt(newValue.value)
                                } : null);
                              }
                            }}
                            options={supplierOptions}
                            isSearchable
                            placeholder="Select supplier"
                            menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                            menuPosition="fixed"
                            className="w-full md:min-w-[14rem]"
                            classNames={selectClassNames}
                            styles={selectStyles}
                          />
                          {updateError && (
                            <p className="mt-2 text-sm text-destructive">{updateError}</p>
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <label className="text-sm font-medium mb-2 block">Supplier Code</label>
                            <input
                              type="text"
                              value={formData?.supplier_code || ''}
                              onChange={(e) =>
                                setFormData((prev) => prev ? { ...prev, supplier_code: e.target.value } : null)
                              }
                              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Price</label>
                            <div className="flex items-center gap-1">
                              <span>R</span>
                              <input
                                type="number"
                                value={formData?.price || 0}
                                onChange={(e) =>
                                  setFormData((prev) => prev ? { ...prev, price: Number(e.target.value) } : null)
                                }
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-ring"
                                step="0.01"
                                min="0"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Lead Time</label>
                            <input
                              type="number"
                              value={formData?.lead_time || ''}
                              onChange={(e) =>
                                setFormData((prev) => prev ? { ...prev, lead_time: Number(e.target.value) } : null)
                              }
                              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              min="0"
                            />
                          </div>
                          <div>
                            <label className="text-sm font-medium mb-2 block">Min Order</label>
                            <input
                              type="number"
                              value={formData?.min_order_quantity || ''}
                              onChange={(e) =>
                                setFormData((prev) => prev ? { ...prev, min_order_quantity: Number(e.target.value) } : null)
                              }
                              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                              min="0"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleUpdate(component.supplier_component_id)}
                            className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            <Check className="h-4 w-4 mr-2" />
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="inline-flex items-center justify-center rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                          >
                            <X className="h-4 w-4 mr-2" />
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-4">
                      <a
                        href={`/inventory?focusComponent=${component.component_id}`}
                        className="text-primary hover:underline"
                        title="View in master components"
                      >
                        {component.component.internal_code}
                      </a>
                    </td>
                    <td className="p-4">{component.component.description}</td>
                    <td className="p-4">{component.supplier_code}</td>
                    <td className="p-4 text-right">
                      {component.price !== null && component.price !== undefined 
                        ? formatCurrency(component.price)
                        : formatCurrency(0)}
                    </td>
                    <td className="p-4 text-right">{component.lead_time || '-'}</td>
                    <td className="p-4 text-right">{component.min_order_quantity || '-'}</td>
                    <td className="p-4 text-right space-x-2">
                      <button
                        onClick={() => startEdit(component)}
                        className="text-primary hover:text-primary/90"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(component.supplier_component_id)}
                        disabled={deleteMutation.isPending}
                        className="text-destructive hover:text-destructive/90 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {paginatedComponents.length === 0 && !isAdding && (
              <tr>
                <td colSpan={7} className="p-4 text-center text-muted-foreground">
                  {debouncedSearch || selectedCategory !== 'all' ? (
                    <span>
                      No components match
                      {debouncedSearch && ` "${debouncedSearch}"`}
                      {debouncedSearch && selectedCategory !== 'all' && ' and'}
                      {selectedCategory !== 'all' && ` category "${selectedCategory}"`}.
                    </span>
                  ) : (
                    <span>No components added yet.</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalCount > 0 && (
        <div className="flex flex-col items-start gap-4 border-t border-border/60 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span>Rows per page:</span>
              <Select value={String(pageSize)} onValueChange={(value) => handlePageSizeChange(Number(value))}>
                <SelectTrigger className="h-9 w-24 rounded-md border border-border bg-background text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {pageSizeOptions.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="hidden md:inline">•</span>
              <span>
                {((page - 1) * pageSize + 1).toLocaleString()}–
                {Math.min(page * pageSize, totalCount).toLocaleString()} of {totalCount.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                aria-label="Go to previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                aria-label="Go to next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 

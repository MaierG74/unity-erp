'use client';

import { useState, useMemo, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { useReactToPrint } from 'react-to-print';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Search,
  X,
  RefreshCw,
  Printer,
  SlidersHorizontal,
  CalendarIcon,
  Check,
} from 'lucide-react';
import { format, subDays, startOfWeek, startOfMonth, startOfYear } from 'date-fns';
import { cn } from '@/lib/utils';
import type { ViewConfig } from '@/types/transaction-views';
import { DATE_PRESETS } from '@/types/transaction-views';
import { ViewManager } from './ViewManager';

type Props = {
  config: ViewConfig;
  onConfigChange: (config: ViewConfig) => void;
  onRefresh: () => void;
  onLoadView: (config: ViewConfig, viewId: string, viewName: string) => void;
  activeViewId: string | null;
  activeViewName: string | null;
  summary: { total: number; totalIn: number; totalOut: number };
  printRef: RefObject<HTMLDivElement | null>;
  transactionCount: number;
};

export function TransactionsToolbar({
  config,
  onConfigChange,
  onRefresh,
  onLoadView,
  activeViewId,
  activeViewName,
  summary,
  printRef,
  transactionCount,
}: Props) {
  const { user } = useAuth();
  const [showFilters, setShowFilters] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: 'Inventory Transactions Report',
  });

  // Fetch products for filter
  const { data: products = [] } = useQuery({
    queryKey: ['products', 'list-brief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('product_id, name')
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 120_000,
  });

  // Fetch suppliers for filter
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', 'list-brief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('supplier_id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 120_000,
  });

  // Fetch categories for filter
  const { data: categories = [] } = useQuery({
    queryKey: ['categories', 'list-brief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_categories')
        .select('cat_id, categoryname')
        .order('categoryname');
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 120_000,
  });

  // Fetch components for multi-select filter
  const { data: allComponents = [] } = useQuery({
    queryKey: ['components', 'list-brief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('components')
        .select('component_id, internal_code, description')
        .order('internal_code')
        .limit(500);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 120_000,
  });

  // Fetch transaction types for filter
  const { data: transactionTypes = [] } = useQuery({
    queryKey: ['transaction-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transaction_types')
        .select('transaction_type_id, type_name')
        .order('type_name');
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 120_000,
  });

  const updateFilter = <K extends keyof ViewConfig['filters']>(
    key: K,
    value: ViewConfig['filters'][K]
  ) => {
    onConfigChange({
      ...config,
      filters: { ...config.filters, [key]: value },
    });
  };

  const handlePresetClick = (preset: string) => {
    onConfigChange({
      ...config,
      dateRange: { from: null, to: null, preset },
    });
  };

  const handleCustomDateFrom = (date: Date | undefined) => {
    if (date) {
      onConfigChange({
        ...config,
        dateRange: {
          from: date.toISOString(),
          to: config.dateRange.to || new Date().toISOString(),
          preset: null,
        },
      });
    }
  };

  const handleCustomDateTo = (date: Date | undefined) => {
    if (date) {
      onConfigChange({
        ...config,
        dateRange: {
          from: config.dateRange.from || subDays(new Date(), 30).toISOString(),
          to: date.toISOString(),
          preset: null,
        },
      });
    }
  };

  const toggleComponent = (componentId: string) => {
    const current = config.filters.componentIds || [];
    const next = current.includes(componentId)
      ? current.filter((id) => id !== componentId)
      : [...current, componentId];
    onConfigChange({
      ...config,
      filters: { ...config.filters, componentIds: next },
    });
  };

  // Count active filters (excluding defaults)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (config.filters.transactionTypeId !== 'all') count++;
    if (config.filters.supplierId !== 'all') count++;
    if (config.filters.categoryId !== 'all') count++;
    if (config.filters.productId !== 'all') count++;
    if ((config.filters.componentIds || []).length > 0) count++;
    return count;
  }, [config.filters]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ label: string; key: keyof ViewConfig['filters']; value?: string }> = [];
    if (config.filters.productId !== 'all') {
      const product = products.find((p) => String(p.product_id) === config.filters.productId);
      chips.push({ label: `Product: ${product?.name || config.filters.productId}`, key: 'productId' });
    }
    if (config.filters.transactionTypeId !== 'all') {
      const tt = transactionTypes.find(
        (t) => String(t.transaction_type_id) === config.filters.transactionTypeId
      );
      chips.push({ label: `Type: ${tt?.type_name || config.filters.transactionTypeId}`, key: 'transactionTypeId' });
    }
    if (config.filters.supplierId !== 'all') {
      const supplier = suppliers.find((s) => String(s.supplier_id) === config.filters.supplierId);
      chips.push({ label: `Supplier: ${supplier?.name || config.filters.supplierId}`, key: 'supplierId' });
    }
    if (config.filters.categoryId !== 'all') {
      const cat = categories.find((c) => String(c.cat_id) === config.filters.categoryId);
      chips.push({ label: `Category: ${cat?.categoryname || config.filters.categoryId}`, key: 'categoryId' });
    }
    // Individual component chips
    for (const cid of config.filters.componentIds || []) {
      const comp = allComponents.find((c) => String(c.component_id) === cid);
      chips.push({
        label: `Component: ${comp?.internal_code || cid}`,
        key: 'componentIds',
        value: cid,
      });
    }
    return chips;
  }, [config.filters, products, transactionTypes, suppliers, categories, allComponents]);

  const dateLabel = config.dateRange.preset
    ? DATE_PRESETS.find((p) => p.value === config.dateRange.preset)?.label || 'Last 30 Days'
    : config.dateRange.from && config.dateRange.to
      ? `${format(new Date(config.dateRange.from), 'MMM dd')} — ${format(new Date(config.dateRange.to), 'MMM dd, yyyy')}`
      : 'Last 30 Days';

  return (
    <div className="space-y-2">
      {/* Top row: Search, Group By, Views, Print, Refresh */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search component, order, PO..."
            value={config.filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="pl-9 pr-10"
          />
          {config.filters.search && (
            <button
              type="button"
              onClick={() => updateFilter('search', '')}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-sm hover:bg-muted"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Group By */}
        <Select
          value={config.groupBy}
          onValueChange={(value) =>
            onConfigChange({ ...config, groupBy: value as ViewConfig['groupBy'] })
          }
        >
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Group By" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="component">By Component</SelectItem>
            <SelectItem value="supplier">By Supplier</SelectItem>
            <SelectItem value="supplier_component">Supplier → Component</SelectItem>
            <SelectItem value="period_week">By Week</SelectItem>
            <SelectItem value="period_month">By Month</SelectItem>
          </SelectContent>
        </Select>

        {/* Views */}
        <ViewManager
          config={config}
          onLoadView={onLoadView}
          activeViewId={activeViewId}
          activeViewName={activeViewName}
        />

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePrint()}
            className="h-9"
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh} className="h-9">
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Second row: Date range + Filters toggle */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Date presets */}
        {DATE_PRESETS.map((preset) => (
          <Button
            key={preset.value}
            variant={config.dateRange.preset === preset.value ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => handlePresetClick(preset.value)}
          >
            {preset.label}
          </Button>
        ))}

        {/* Custom date range */}
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={!config.dateRange.preset && config.dateRange.from ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
            >
              <CalendarIcon className="h-3.5 w-3.5 mr-1" />
              {!config.dateRange.preset && config.dateRange.from ? dateLabel : 'Custom'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex gap-2 p-3">
              <div>
                <p className="text-xs font-medium mb-1 text-muted-foreground">From</p>
                <CalendarComponent
                  mode="single"
                  selected={config.dateRange.from ? new Date(config.dateRange.from) : undefined}
                  onSelect={handleCustomDateFrom}
                />
              </div>
              <div>
                <p className="text-xs font-medium mb-1 text-muted-foreground">To</p>
                <CalendarComponent
                  mode="single"
                  selected={config.dateRange.to ? new Date(config.dateRange.to) : undefined}
                  onSelect={handleCustomDateTo}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">
            {transactionCount.toLocaleString()} txns
          </span>
          {summary.totalIn > 0 && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">
              +{summary.totalIn.toLocaleString()}
            </span>
          )}
          {summary.totalOut > 0 && (
            <span className="text-xs text-red-500 dark:text-red-400 font-medium">
              -{summary.totalOut.toLocaleString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className={cn('h-7 text-xs', showFilters && 'bg-accent')}
            onClick={() => setShowFilters(!showFilters)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      {/* Expanded filter controls */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 p-3 rounded-lg border bg-muted/30">
          {/* Product */}
          <Select
            value={config.filters.productId}
            onValueChange={(v) => updateFilter('productId', v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Products" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.product_id} value={String(p.product_id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Transaction Type */}
          <Select
            value={config.filters.transactionTypeId}
            onValueChange={(v) => updateFilter('transactionTypeId', v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {transactionTypes.map((tt) => (
                <SelectItem key={tt.transaction_type_id} value={String(tt.transaction_type_id)}>
                  {tt.type_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Supplier */}
          <Select
            value={config.filters.supplierId}
            onValueChange={(v) => updateFilter('supplierId', v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.supplier_id} value={String(s.supplier_id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Category */}
          <Select
            value={config.filters.categoryId}
            onValueChange={(v) => updateFilter('categoryId', v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.cat_id} value={String(c.cat_id)}>
                  {c.categoryname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Component multi-select */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[220px] justify-start text-left font-normal">
                {(config.filters.componentIds || []).length > 0
                  ? `${config.filters.componentIds.length} component${config.filters.componentIds.length > 1 ? 's' : ''}`
                  : 'Select components...'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Search components..."
                  value={componentSearch}
                  onValueChange={setComponentSearch}
                />
                <CommandList>
                  <CommandEmpty>No components found.</CommandEmpty>
                  <CommandGroup className="max-h-[200px] overflow-auto">
                    {allComponents
                      .filter((c) => {
                        if (!componentSearch) return true;
                        const term = componentSearch.toLowerCase();
                        return (
                          c.internal_code.toLowerCase().includes(term) ||
                          (c.description?.toLowerCase().includes(term) ?? false)
                        );
                      })
                      .slice(0, 50)
                      .map((c) => {
                        const isSelected = (config.filters.componentIds || []).includes(
                          String(c.component_id)
                        );
                        return (
                          <CommandItem
                            key={c.component_id}
                            value={`${c.internal_code} ${c.description || ''}`}
                            onSelect={() => toggleComponent(String(c.component_id))}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                isSelected ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <span className="font-medium">{c.internal_code}</span>
                            {c.description && (
                              <span className="ml-1 text-xs text-muted-foreground truncate">
                                {c.description}
                              </span>
                            )}
                          </CommandItem>
                        );
                      })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Active filter chips */}
      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilterChips.map((chip, i) => (
            <Badge
              key={`${chip.key}-${chip.value ?? i}`}
              variant="secondary"
              className="gap-1 pr-1 cursor-pointer hover:bg-destructive/10"
              onClick={() => {
                if (chip.key === 'componentIds' && chip.value) {
                  toggleComponent(chip.value);
                } else {
                  updateFilter(chip.key, chip.key === 'componentIds' ? [] as never : 'all' as never);
                }
              }}
            >
              {chip.label}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          {activeFilterChips.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-xs px-2"
              onClick={() =>
                onConfigChange({
                  ...config,
                  filters: {
                    ...config.filters,
                    transactionTypeId: 'all',
                    supplierId: 'all',
                    categoryId: 'all',
                    productId: 'all',
                    componentIds: [],
                  },
                })
              }
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

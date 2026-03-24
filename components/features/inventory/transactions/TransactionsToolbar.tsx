'use client';

import { useState, type RefObject } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Search,
  X,
  RefreshCw,
  Printer,
  CalendarIcon,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format, subDays, endOfDay, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import type { ViewConfig } from '@/types/transaction-views';
import { DATE_PRESETS } from '@/types/transaction-views';
import { ViewManager } from './ViewManager';
import { FilterBuilder } from './filters';

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
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: 'Inventory Transactions Report',
  });

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
          from: startOfDay(date).toISOString(),
          to: config.dateRange.to || endOfDay(new Date()).toISOString(),
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
          from: config.dateRange.from || startOfDay(subDays(new Date(), 30)).toISOString(),
          to: endOfDay(date).toISOString(),
          preset: null,
        },
      });
    }
  };


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
            onChange={(e) => onConfigChange({ ...config, filters: { ...config.filters, search: e.target.value } })}
            className="pl-9 pr-10"
          />
          {config.filters.search && (
            <button
              type="button"
              onClick={() => onConfigChange({ ...config, filters: { ...config.filters, search: '' } })}
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
        </div>
      </div>

      {/* Composable filter builder */}
      <FilterBuilder
        composableFilter={config.filters.composableFilter}
        onApply={(filter) => onConfigChange({
          ...config,
          filters: { ...config.filters, composableFilter: filter },
        })}
      />

      {/* Legacy filter indicators for old saved views */}
      <LegacyFilterPills config={config} onConfigChange={onConfigChange} />
    </div>
  );
}

/** Shows dismissible pills for legacy filter fields (productId, componentIds, supplierId, etc.) from old saved views */
function LegacyFilterPills({ config, onConfigChange }: { config: ViewConfig; onConfigChange: (c: ViewConfig) => void }) {
  const hasLegacy =
    config.filters.productId !== 'all' ||
    config.filters.transactionTypeId !== 'all' ||
    config.filters.supplierId !== 'all' ||
    config.filters.categoryId !== 'all' ||
    (config.filters.componentIds || []).length > 0;

  if (!hasLegacy) return null;

  const clear = (key: string) => {
    onConfigChange({
      ...config,
      filters: {
        ...config.filters,
        [key]: key === 'componentIds' ? [] : 'all',
      },
    });
  };

  const clearAll = () => {
    onConfigChange({
      ...config,
      filters: {
        ...config.filters,
        productId: 'all',
        transactionTypeId: 'all',
        supplierId: 'all',
        categoryId: 'all',
        componentIds: [],
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
      <span className="text-[10px] text-amber-500">Legacy filters from saved view:</span>
      {config.filters.productId !== 'all' && (
        <Badge variant="outline" className="text-[10px] h-5 gap-1 pr-1 cursor-pointer border-amber-500/30" onClick={() => clear('productId')}>
          Product: {config.filters.productId} <X className="h-2.5 w-2.5" />
        </Badge>
      )}
      {config.filters.transactionTypeId !== 'all' && (
        <Badge variant="outline" className="text-[10px] h-5 gap-1 pr-1 cursor-pointer border-amber-500/30" onClick={() => clear('transactionTypeId')}>
          Type: {config.filters.transactionTypeId} <X className="h-2.5 w-2.5" />
        </Badge>
      )}
      {config.filters.supplierId !== 'all' && (
        <Badge variant="outline" className="text-[10px] h-5 gap-1 pr-1 cursor-pointer border-amber-500/30" onClick={() => clear('supplierId')}>
          Supplier: {config.filters.supplierId} <X className="h-2.5 w-2.5" />
        </Badge>
      )}
      {config.filters.categoryId !== 'all' && (
        <Badge variant="outline" className="text-[10px] h-5 gap-1 pr-1 cursor-pointer border-amber-500/30" onClick={() => clear('categoryId')}>
          Category: {config.filters.categoryId} <X className="h-2.5 w-2.5" />
        </Badge>
      )}
      {(config.filters.componentIds || []).length > 0 && (
        <Badge variant="outline" className="text-[10px] h-5 gap-1 pr-1 cursor-pointer border-amber-500/30" onClick={() => clear('componentIds')}>
          {config.filters.componentIds.length} components <X className="h-2.5 w-2.5" />
        </Badge>
      )}
      <button type="button" onClick={clearAll} className="text-[10px] text-amber-500 hover:underline ml-1">
        Clear all legacy
      </button>
    </div>
  );
}

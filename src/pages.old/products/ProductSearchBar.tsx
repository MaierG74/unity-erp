'use client';

import { useMemo } from 'react';
import { Search, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface CategoryOption {
  product_cat_id: number;
  categoryname: string;
}

interface ProductSearchBarProps {
  value: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string;
  onCategoryChange: (value: string) => void;
  categoryOptions: CategoryOption[];
}

export function ProductSearchBar({
  value,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  categoryOptions,
}: ProductSearchBarProps) {
  const sortedOptions = useMemo(
    () =>
      categoryOptions
        .map((option) => ({
          value: option.product_cat_id.toString(),
          label: option.categoryname,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categoryOptions]
  );

  return (
    <div className="flex w-full flex-col gap-2 md:flex-row md:items-center">
      <div className="relative w-full md:min-w-[320px] md:max-w-[400px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => {
            onSearchChange(event.currentTarget.value);
            // TODO: debounce search input to avoid chatty network calls
          }}
          placeholder="Search code or name…"
          className="h-10 w-full rounded-md border border-input bg-background px-3 pl-9 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Search products"
        />
      </div>
      <Select value={selectedCategory} onValueChange={onCategoryChange}>
        <SelectTrigger className="h-10 w-full justify-between rounded-md border border-border bg-background px-3 text-sm text-muted-foreground md:w-48">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <SelectValue placeholder="All categories" />
          </div>
        </SelectTrigger>
        <SelectContent align="end" className="max-h-64 overflow-y-auto">
          <SelectItem value="all">All categories</SelectItem>
          {sortedOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}



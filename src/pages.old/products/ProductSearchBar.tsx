'use client';

import { useMemo, useState } from 'react';
import { Search, Filter, Check, ChevronsUpDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

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
  const [categoryOpen, setCategoryOpen] = useState(false);

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

  const selectedLabel =
    selectedCategory === 'all'
      ? 'All categories'
      : sortedOptions.find((o) => o.value === selectedCategory)?.label ?? 'All categories';

  return (
    <div className="flex w-full flex-col gap-2 md:flex-row md:items-center">
      <div className="relative w-full md:min-w-[320px] md:max-w-[400px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => {
            onSearchChange(event.currentTarget.value);
          }}
          placeholder="Search code or name…"
          className="h-10 w-full rounded-md border border-input bg-background px-3 pl-9 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          aria-label="Search products"
        />
      </div>
      <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={categoryOpen}
            className="h-10 w-full justify-between font-normal md:w-48 text-muted-foreground"
          >
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <span>{selectedLabel}</span>
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search categories..." />
            <CommandList>
              <CommandEmpty>No category found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="all"
                  onSelect={() => {
                    onCategoryChange('all');
                    setCategoryOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", selectedCategory === 'all' ? "opacity-100" : "opacity-0")} />
                  All categories
                </CommandItem>
                {sortedOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => {
                      onCategoryChange(option.value);
                      setCategoryOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selectedCategory === option.value ? "opacity-100" : "opacity-0")} />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

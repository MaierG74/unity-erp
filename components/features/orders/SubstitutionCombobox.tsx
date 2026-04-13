'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, Star, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { useComponentsByCategory, type ComponentOption } from '@/hooks/useComponentsByCategory';

type SubstitutionComboboxProps = {
  defaultComponentId: number;
  defaultComponentCode: string;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  selectedComponentId: number;
  onSelect: (component: ComponentOption) => void;
  categories: { cat_id: number; categoryname: string }[];
};

export function SubstitutionCombobox({
  defaultComponentId,
  defaultComponentCode,
  defaultCategoryId,
  defaultCategoryName,
  selectedComponentId,
  onSelect,
  categories,
}: SubstitutionComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>(
    defaultCategoryId ?? 'all',
  );

  const debouncedSearch = useDebounce(search, 300);
  const { components, loading } = useComponentsByCategory(
    open ? categoryFilter : null,
    debouncedSearch,
  );

  const selectedComponent = components.find(c => c.component_id === selectedComponentId);
  const displayCode = selectedComponent?.internal_code ?? defaultComponentCode;
  const displayPrice = selectedComponent?.cheapest_price ?? null;

  function handleSelect(component: ComponentOption) {
    onSelect(component);
    setOpen(false);
    setSearch('');
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 justify-between gap-1 text-xs font-normal"
        >
          <span className="truncate">
            {displayCode}
            {displayPrice != null && (
              <span className="ml-1 text-muted-foreground">R{displayPrice.toFixed(2)}</span>
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[400px] p-0" align="start">
        {/* Category filter row */}
        <div className="flex items-center gap-2 border-b px-2 py-2">
          <span className="text-xs text-muted-foreground shrink-0">Category:</span>
          <Select
            value={String(categoryFilter)}
            onValueChange={val => setCategoryFilter(val === 'all' ? 'all' : Number(val))}
          >
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Browse all categories
              </SelectItem>
              {defaultCategoryId != null && defaultCategoryName && (
                <SelectItem value={String(defaultCategoryId)} className="text-xs">
                  {defaultCategoryName} (default)
                </SelectItem>
              )}
              {categories
                .filter(
                  cat =>
                    cat.cat_id !== defaultCategoryId,
                )
                .map(cat => (
                  <SelectItem key={cat.cat_id} value={String(cat.cat_id)} className="text-xs">
                    {cat.categoryname}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by code, description, or supplier..."
            value={search}
            onValueChange={setSearch}
            className="text-xs h-8"
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : (
              <>
                <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                  No components found.
                </CommandEmpty>
                <CommandGroup>
                  {components.map(component => {
                    const isDefault = component.component_id === defaultComponentId;
                    const isSelected = component.component_id === selectedComponentId;
                    return (
                      <CommandItem
                        key={component.component_id}
                        value={String(component.component_id)}
                        onSelect={() => handleSelect(component)}
                        className="flex items-start gap-2 py-1.5 text-xs cursor-pointer"
                      >
                        <Check
                          className={cn(
                            'mt-0.5 h-3.5 w-3.5 shrink-0',
                            isSelected ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            {isDefault && (
                              <Star className="h-3 w-3 text-amber-500 shrink-0" fill="currentColor" />
                            )}
                            <span className="font-medium truncate">{component.internal_code}</span>
                            {isDefault && (
                              <span className="text-muted-foreground shrink-0">(default)</span>
                            )}
                          </div>
                          {component.description && (
                            <p className="text-muted-foreground truncate">{component.description}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {component.cheapest_price != null ? (
                            <span className="font-medium">R{component.cheapest_price.toFixed(2)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {component.cheapest_supplier_name && (
                            <p className="text-muted-foreground text-[10px]">
                              {component.cheapest_supplier_name}
                            </p>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

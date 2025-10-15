'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useEntityLinks } from '@/hooks/useEntityLinks';
import type { EntityLink, EntityLinkType } from '@/lib/client/entity-links';

const typeLabels: Record<EntityLinkType, string> = {
  order: 'Customer Orders',
  supplier_order: 'Supplier Orders',
  quote: 'Quotes',
};

interface TodoEntityLinkPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (link: EntityLink) => void;
}

function formatMeta(link: EntityLink): string | null {
  if (!link.meta) return null;
  if (link.type === 'order') {
    const customer = link.meta?.customer as string | null | undefined;
    const status = link.meta?.status as string | null | undefined;
    return [customer, status].filter(Boolean).join(' • ') || null;
  }
  if (link.type === 'supplier_order') {
    const supplier = link.meta?.supplier as string | null | undefined;
    const status = link.meta?.status as string | null | undefined;
    return [supplier, status].filter(Boolean).join(' • ') || null;
  }
  if (link.type === 'quote') {
    const customer = link.meta?.customer as string | null | undefined;
    const status = link.meta?.status as string | null | undefined;
    return [customer, status].filter(Boolean).join(' • ') || null;
  }
  return null;
}

export function TodoEntityLinkPicker({ open, onOpenChange, onSelect }: TodoEntityLinkPickerProps) {
  const [query, setQuery] = useState('');
  const { data, isLoading, error } = useEntityLinks(query, open);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      console.log('[TodoEntityLinkPicker] Data:', data);
      console.log('[TodoEntityLinkPicker] Loading:', isLoading);
      console.log('[TodoEntityLinkPicker] Error:', error);
      console.log('[TodoEntityLinkPicker] Query:', query);
    }
  }, [data, isLoading, error, query, open]);

  const groups = useMemo(() => {
    const result = [
      { type: 'order' as const, links: data?.orders ?? [] },
      { type: 'supplier_order' as const, links: data?.supplierOrders ?? [] },
      { type: 'quote' as const, links: data?.quotes ?? [] },
    ].filter(group => group.links.length > 0);
    console.log('[TodoEntityLinkPicker] Groups:', result);
    return result;
  }, [data]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput
        placeholder="Search orders, supplier orders, quotes..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : null}
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((group, index) => (
          <div key={group.type}>
            <CommandGroup heading={typeLabels[group.type]}>
              {group.links.map(link => {
                const meta = formatMeta(link);
                return (
                  <CommandItem
                    key={`${link.type}-${link.id}`}
                    value={`${link.type}-${link.id}-${link.label}`}
                    disabled={false}
                    onSelect={() => {
                      console.log('[TodoEntityLinkPicker] onSelect fired for:', link);
                      onSelect(link);
                      onOpenChange(false);
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      console.log('[TodoEntityLinkPicker] onPointerDown fired for:', link);
                      onSelect(link);
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex flex-col pointer-events-none">
                      <span className="font-medium">{link.label}</span>
                      {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
                      <span className="text-xs text-muted-foreground">{link.path}</span>
                    </div>
                    <Badge variant="outline" className="ml-auto capitalize pointer-events-none">
                      {group.type.replace('_', ' ')}
                    </Badge>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {index < groups.length - 1 ? <CommandSeparator /> : null}
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

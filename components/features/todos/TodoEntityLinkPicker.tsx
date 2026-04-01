'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useEntityLinks } from '@/hooks/useEntityLinks';
import { formatDateShort } from '@/lib/date-utils';
import type { EntityLink, EntityLinkType } from '@/lib/client/entity-links';

const typeLabels: Record<EntityLinkType, string> = {
  order: 'Customer Orders',
  supplier_order: 'Supplier Orders',
  quote: 'Quotes',
  customer: 'Customers',
  product: 'Products',
};

interface TodoEntityLinkPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (link: EntityLink) => void;
}

function formatMetaDate(value: unknown, label: string): string | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  return `${label} ${formatDateShort(value)}`;
}

function formatMeta(link: EntityLink): string | null {
  if (!link.meta) return null;

  if (link.type === 'order') {
    const customer = link.meta?.customer as string | null | undefined;
    const status = link.meta?.status as string | null | undefined;
    const dueDate = formatMetaDate(link.meta?.deliveryDate, 'Due');
    const createdAt = formatMetaDate(link.meta?.createdAt, 'Created');
    return [customer, status, dueDate ?? createdAt].filter(Boolean).join(' • ') || null;
  }

  if (link.type === 'supplier_order') {
    const lineId = link.meta?.orderId as number | string | null | undefined;
    const supplier = link.meta?.supplier as string | null | undefined;
    const componentCode = link.meta?.componentCode as string | null | undefined;
    const status = link.meta?.status as string | null | undefined;
    return [
      lineId ? `Line #${lineId}` : null,
      supplier,
      componentCode,
      status,
    ]
      .filter(Boolean)
      .join(' • ') || null;
  }

  if (link.type === 'quote') {
    const customer = link.meta?.customer as string | null | undefined;
    const status = link.meta?.status as string | null | undefined;
    const createdAt = formatMetaDate(link.meta?.createdAt, 'Created');
    return [customer, status, createdAt].filter(Boolean).join(' • ') || null;
  }

  if (link.type === 'customer') {
    const customerId = link.meta?.customerId as number | string | null | undefined;
    const email = link.meta?.email as string | null | undefined;
    const telephone = link.meta?.telephone as string | null | undefined;
    return [
      customerId ? `Customer #${customerId}` : null,
      email,
      telephone,
    ]
      .filter(Boolean)
      .join(' • ') || null;
  }

  if (link.type === 'product') {
    const internalCode = link.meta?.internalCode as string | null | undefined;
    const productId = link.meta?.productId as number | string | null | undefined;
    const description = link.meta?.description as string | null | undefined;
    return [
      internalCode,
      productId ? `Product #${productId}` : null,
      description,
    ]
      .filter(Boolean)
      .join(' • ') || null;
  }

  return null;
}

export function TodoEntityLinkPicker({ open, onOpenChange, onSelect }: TodoEntityLinkPickerProps) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const { data, isLoading, error } = useEntityLinks(deferredQuery, open);

  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  const groups = useMemo(() => {
    return [
      { type: 'order' as const, links: data?.orders ?? [] },
      { type: 'supplier_order' as const, links: data?.supplierOrders ?? [] },
      { type: 'quote' as const, links: data?.quotes ?? [] },
      { type: 'customer' as const, links: data?.customers ?? [] },
      { type: 'product' as const, links: data?.products ?? [] },
    ].filter(group => group.links.length > 0);
  }, [data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select Record</DialogTitle>
        </DialogHeader>

        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Search orders, quotes, supplier orders, customers, products..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="py-6 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : 'Failed to search records.'}
            </div>
          ) : groups.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {groups.map((group) => (
                <div key={group.type}>
                  <h3 className="mb-2 px-2 text-xs font-medium text-muted-foreground">
                    {typeLabels[group.type]}
                  </h3>
                  <div className="space-y-1">
                    {group.links.map(link => {
                      const meta = formatMeta(link);
                      return (
                        <button
                          key={`${link.type}-${link.id}`}
                          onClick={() => {
                            onSelect(link);
                            onOpenChange(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-hidden"
                        >
                          <div className="flex flex-1 flex-col gap-1">
                            <span className="font-medium">{link.label}</span>
                            {meta ? (
                              <span className="text-sm text-muted-foreground">{meta}</span>
                            ) : null}
                            <span className="text-xs text-muted-foreground">{link.path}</span>
                          </div>
                          <Badge variant="outline" className="capitalize">
                            {group.type.replace('_', ' ')}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

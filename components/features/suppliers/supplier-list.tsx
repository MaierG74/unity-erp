'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSuppliers } from '@/lib/api/suppliers';
import Link from 'next/link';
import { Search, Plus, FileText, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PricelistPreviewModal } from './pricelist-preview-modal';
import type { SupplierWithDetails } from '@/types/suppliers';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export function SupplierList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithDetails | null>(null);
  const [hasPricelistOnly, setHasPricelistOnly] = useState(() => {
    const param = searchParams?.get('hasPricelist');
    return param === '1' || param === 'true';
  });

  // Keep URL in sync when the checkbox changes
  useEffect(() => {
    // Build new query string while preserving existing params
    const sp = new URLSearchParams(Array.from(searchParams?.entries?.() || []));
    if (hasPricelistOnly) {
      sp.set('hasPricelist', '1');
    } else {
      sp.delete('hasPricelist');
    }
    const query = sp.toString();
    const url = query ? `/suppliers?${query}` : '/suppliers';
    router.replace(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPricelistOnly]);

  const { data: suppliers, isLoading, error } = useQuery({
    queryKey: ['suppliers'],
    queryFn: getSuppliers,
  });

  const filteredSuppliers = useMemo(() => {
    if (!suppliers) return [];

    return suppliers
      .filter((supplier) => {
        const matchesSearch = 
          supplier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (supplier.contact_info?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
          (supplier.emails?.some(e => e.email.toLowerCase().includes(searchTerm.toLowerCase())) || false);

        const matchesPricelist = hasPricelistOnly
          ? (supplier.pricelists?.length ?? 0) > 0
          : true;

        return matchesSearch && matchesPricelist;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, searchTerm, hasPricelistOnly]);

  // Helper to render simple initials avatar
  const renderAvatar = (name: string) => {
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0]?.toUpperCase())
      .slice(0, 2)
      .join('') || '?';
    return (
      <div className="mr-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
        {initials}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Toolbar skeleton */}
        <div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex w-full items-center gap-3 md:max-w-2xl">
            <div className="h-9 w-full md:w-96 bg-muted animate-pulse rounded-lg" />
            <div className="h-9 w-32 bg-muted animate-pulse rounded-md" />
          </div>
          <div className="h-9 w-32 bg-muted animate-pulse rounded-lg md:shrink-0" />
        </div>
        {/* Table skeleton */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="p-3 border-b bg-muted/40">
            <div className="grid grid-cols-4 gap-4">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              <div className="h-4 w-28 bg-muted animate-pulse rounded" />
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            </div>
          </div>
          <div className="divide-y">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="h-4 w-40 bg-muted rounded" />
                <div className="h-4 w-48 bg-muted rounded" />
                <div className="ml-auto h-4 w-24 bg-muted rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">Error loading suppliers: {error.message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar (Search + Filters + Add) */}
      <div className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between">
        {/* Left controls - Search and filters */}
        <div className="flex w-full items-center gap-3 md:max-w-2xl">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search suppliers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 pl-9 pr-10 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                aria-label="Clear search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>

          <label htmlFor="filter-pricelist" className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm text-muted-foreground">
            <Checkbox
              id="filter-pricelist"
              checked={hasPricelistOnly}
              onCheckedChange={(v) => setHasPricelistOnly(Boolean(v))}
            />
            <span>Has price list</span>
          </label>
        </div>

        {/* Right controls - Primary action */}
        <Link
          href="/suppliers/new"
          className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring md:shrink-0"
        >
          <Plus className="h-4 w-4" />
          Add Supplier
        </Link>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Name</th>
              <th scope="col" className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Contact Info</th>
              <th scope="col" className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-left p-4 font-medium">Primary Email</th>
              <th scope="col" className="sticky top-0 z-10 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 text-center p-4 font-medium">Price Lists</th>
            </tr>
          </thead>
          <tbody>
            {filteredSuppliers.map((supplier) => (
              <tr
                key={supplier.supplier_id}
                className="border-b odd:bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => router.push(`/suppliers/${supplier.supplier_id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') router.push(`/suppliers/${supplier.supplier_id}`);
                }}
                tabIndex={0}
                role="button"
                aria-label={`View details for ${supplier.name}`}
              >
                <td className="p-4">
                  <div className="flex items-center">
                    {renderAvatar(supplier.name)}
                    <span className="font-medium leading-none">{supplier.name}</span>
                  </div>
                </td>
                <td className="p-4 text-muted-foreground">
                  <span className="block max-w-[28ch] truncate" title={supplier.contact_info || ''}>
                    {supplier.contact_info || '-'}
                  </span>
                </td>
                <td className="p-4 text-muted-foreground">
                  {(() => {
                    const email = supplier.emails?.find((e) => e.is_primary)?.email || supplier.emails?.[0]?.email || '';
                    return (
                      <span className="block max-w-[32ch] truncate" title={email}>
                        {email || '-'}
                      </span>
                    );
                  })()}
                </td>
                <td className="p-4 text-center">
                  {supplier.pricelists && supplier.pricelists.length > 0 ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedSupplier(supplier); }}
                      className="inline-flex items-center gap-2 hover:opacity-90"
                    >
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {supplier.pricelists.length}
                      </span>
                      <span className="sr-only">Preview pricelists</span>
                      <FileText className="h-4 w-4 text-primary" />
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-xs">None</span>
                  )}
                </td>
              </tr>
            ))}
            {filteredSuppliers.length === 0 && (
              <tr>
                <td colSpan={4} className="p-12 text-center">
                  <div className="space-y-2">
                    <div className="text-base font-medium">No suppliers found</div>
                    <div className="text-sm text-muted-foreground">
                      {searchTerm
                        ? `No suppliers match "${searchTerm}"`
                        : 'Get started by adding your first supplier.'}
                    </div>
                    {!searchTerm && (
                      <Link
                        href="/suppliers/new"
                        className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                      >
                        <Plus className="h-4 w-4" />
                        Add Supplier
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredSuppliers.length} of {suppliers?.length} suppliers
      </div>

      {/* Pricelist Preview Modal */}
      {selectedSupplier && (
        <PricelistPreviewModal
          isOpen={!!selectedSupplier}
          onClose={() => setSelectedSupplier(null)}
          pricelists={selectedSupplier.pricelists}
          supplierName={selectedSupplier.name}
        />
      )}
    </div>
  );
}
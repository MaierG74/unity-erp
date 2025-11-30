'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSuppliers } from '@/lib/api/suppliers';
import Link from 'next/link';
import { Search, Plus, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PricelistPreviewModal } from './pricelist-preview-modal';
import type { SupplierWithDetails } from '@/types/suppliers';
import { Checkbox } from '@/components/ui/checkbox';
import { PdfThumbnailClient } from '@/components/ui/pdf-thumbnail-client';
import { FileIcon } from '@/components/ui/file-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

  const getAttachmentType = (fileType?: string, fileName?: string) => {
    const mime = (fileType || '').toLowerCase();
    if (mime.startsWith('application/pdf')) return 'pdf';
    if (mime.startsWith('image/')) return 'image';

    const ext = (fileName || '').split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return 'image';
    return 'other';
  };

  const renderPricelistStrip = (supplier: SupplierWithDetails) => {
    const pricelists = supplier.pricelists || [];
    if (!pricelists.length) return null;

    const visible = pricelists.slice(0, 6);
    const remaining = pricelists.length - visible.length;

    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 max-w-[18rem] overflow-hidden">
          {visible.map((p) => {
            const type = getAttachmentType(p.file_type, p.file_name);
            if (type === 'image') {
              return (
                <button
                  key={p.pricelist_id}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(p.file_url, '_blank', 'noopener,noreferrer');
                  }}
                  className="h-10 w-8 rounded border bg-muted overflow-hidden"
                  title={p.display_name}
                >
                  <img
                    src={p.file_url}
                    alt={p.display_name}
                    className="h-full w-full object-cover pointer-events-none"
                    loading="lazy"
                  />
                </button>
              );
            }
            if (type === 'pdf') {
              return (
                <button
                  key={p.pricelist_id}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(p.file_url, '_blank', 'noopener,noreferrer');
                  }}
                  className="h-10 w-8 overflow-hidden rounded border bg-muted"
                  title={p.display_name}
                >
                  <PdfThumbnailClient url={p.file_url} className="h-full w-full pointer-events-none" />
                </button>
              );
            }
            return (
              <button
                key={p.pricelist_id}
                className="h-10 w-8 rounded border bg-muted flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(p.file_url, '_blank', 'noopener,noreferrer');
                }}
                title={p.display_name}
              >
                <FileIcon fileName={p.file_name} size={18} className="text-primary pointer-events-none" />
              </button>
            );
          })}
        </div>
        {remaining > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedSupplier(supplier);
            }}
            className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground hover:bg-muted/80 transition-colors"
            aria-label="View more price lists"
          >
            +{remaining}
          </button>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <span className="text-muted-foreground animate-pulse text-lg">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center py-12">
        <span className="text-destructive text-lg">Error loading suppliers.</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-foreground">Suppliers</h1>
        <Button asChild className="button-primary flex gap-2 items-center">
          <Link href="/suppliers/new">
            <Plus className="h-5 w-5" />
            Add Supplier
          </Link>
        </Button>
      </div>

      <div className="relative mt-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
        <Input
          placeholder="Search suppliers..."
          className="pl-12 input-field bg-background text-foreground"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3 mt-2">
        <label htmlFor="filter-pricelist" className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm text-muted-foreground">
          <Checkbox
            id="filter-pricelist"
            checked={hasPricelistOnly}
            onCheckedChange={(v) => setHasPricelistOnly(Boolean(v))}
          />
          <span>Has price list</span>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl shadow-lg border border-border bg-card mt-8 dark:shadow-none">
        <table className="min-w-full divide-y divide-border bg-background dark:bg-card">
          <thead className="bg-muted dark:bg-muted/20">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Contact
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Email
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Price Lists
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-base text-muted-foreground">
                  {searchTerm ? 'No suppliers found matching your search.' : 'No suppliers found. Add your first supplier!'}
                </td>
              </tr>
            ) : (
              filteredSuppliers.map((supplier) => {
                const email = supplier.emails?.find((e) => e.is_primary)?.email || supplier.emails?.[0]?.email || '';
                return (
                  <tr key={supplier.supplier_id} className="hover:bg-accent/10 dark:hover:bg-accent/30 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-base font-semibold text-foreground">
                      <Link href={`/suppliers/${supplier.supplier_id}`} className="hover:underline">
                        {supplier.name || 'N/A'}
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-base text-muted-foreground">
                      {supplier.contact_info || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-base text-muted-foreground">
                      {email || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-base text-muted-foreground">
                      {supplier.pricelists && supplier.pricelists.length > 0 ? (
                        <div className="inline-flex items-center gap-2">
                          {renderPricelistStrip(supplier)}
                        </div>
                      ) : (
                        'None'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-base font-medium flex gap-2 justify-end">
                      <Link href={`/suppliers/${supplier.supplier_id}`} className="button-primary px-3 py-1 text-xs font-semibold">
                        View
                      </Link>
                      <Link href={`/suppliers/${supplier.supplier_id}/edit`} className="button-primary bg-secondary text-secondary-foreground px-3 py-1 text-xs font-semibold">
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
    </>
  );
}

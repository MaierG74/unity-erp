'use client';

/**
 * SupplierList Component
 *
 * REFACTORED: Uses PageToolbar for compact header layout.
 * - Removed separate h1, search input, and button rows
 * - All header elements consolidated into PageToolbar
 * - Checkbox filter passed as children to toolbar
 * - URL-based filter persistence for navigating back from detail pages
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSuppliers } from '@/lib/api/suppliers';
import { Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebounce } from '@/hooks/use-debounce';
import { PricelistPreviewModal } from './pricelist-preview-modal';
import type { SupplierWithDetails } from '@/types/suppliers';
import { Checkbox } from '@/components/ui/checkbox';
import { PdfThumbnailClient } from '@/components/ui/pdf-thumbnail-client';
import { FileIcon } from '@/components/ui/file-icon';
import { PageToolbar } from '@/components/ui/page-toolbar';

export function SupplierList() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize state from URL parameters
  const [searchTerm, setSearchTerm] = useState(() => searchParams?.get('q') || '');
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithDetails | null>(null);
  const [hasPricelistOnly, setHasPricelistOnly] = useState(() => {
    const param = searchParams?.get('hasPricelist');
    return param === '1' || param === 'true';
  });

  // Debounce search input to avoid excessive URL updates
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Re-read URL params when navigating back (component doesn't remount)
  const searchParamsString = searchParams?.toString() || '';
  useEffect(() => {
    const urlQuery = searchParams?.get('q') || '';
    const urlHasPricelist = searchParams?.get('hasPricelist');
    const urlHasPricelistBool = urlHasPricelist === '1' || urlHasPricelist === 'true';

    if (urlQuery !== searchTerm) setSearchTerm(urlQuery);
    if (urlHasPricelistBool !== hasPricelistOnly) setHasPricelistOnly(urlHasPricelistBool);
  }, [searchParamsString]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() || '');

    // Update search query (use debounced value)
    if (debouncedSearchTerm) {
      params.set('q', debouncedSearchTerm);
    } else {
      params.delete('q');
    }

    // Update pricelist filter
    if (hasPricelistOnly) {
      params.set('hasPricelist', '1');
    } else {
      params.delete('hasPricelist');
    }

    const query = params.toString();
    const url = query ? `/suppliers?${query}` : '/suppliers';
    router.replace(url, { scroll: false });
  }, [debouncedSearchTerm, hasPricelistOnly, router, searchParams]);

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
    // CHANGED: Wrapped in fragment with reduced spacing
    <div className="space-y-2">
      {/* NEW: PageToolbar replaces separate h1, search, button, and filter rows */}
      <PageToolbar
        title="Suppliers"
        searchPlaceholder="Search suppliers..."
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        actions={[
          {
            label: 'Add Supplier',
            onClick: () => router.push('/suppliers/new'),
            icon: <Plus className="h-4 w-4" />,
          },
        ]}
      >
        {/* Checkbox filter as toolbar child */}
        <label htmlFor="filter-pricelist" className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm text-muted-foreground">
          <Checkbox
            id="filter-pricelist"
            checked={hasPricelistOnly}
            onCheckedChange={(v) => setHasPricelistOnly(Boolean(v))}
          />
          <span>Has price list</span>
        </label>
      </PageToolbar>

      {/* CHANGED: Removed mt-8, table sits directly below toolbar */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-base text-muted-foreground">
                  {searchTerm ? 'No suppliers found matching your search.' : 'No suppliers found. Add your first supplier!'}
                </td>
              </tr>
            ) : (
              filteredSuppliers.map((supplier) => {
                const email = supplier.emails?.find((e) => e.is_primary)?.email || supplier.emails?.[0]?.email || '';
                return (
                  <tr
                    key={supplier.supplier_id}
                    className="hover:bg-accent/10 dark:hover:bg-accent/30 transition-colors cursor-pointer group"
                    onClick={() => router.push(`/suppliers/${supplier.supplier_id}`)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                      {supplier.name || 'N/A'}
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
    </div>
  );
}

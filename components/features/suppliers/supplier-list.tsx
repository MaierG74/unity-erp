'use client';

/**
 * SupplierList Component
 *
 * Features:
 * - PageToolbar with search, filters, and actions
 * - Active/inactive supplier filtering with URL persistence
 * - Open Orders indicator column (replaces Contact column)
 * - Client-side pagination
 * - Pricelist thumbnail strip
 * - Delete with confirmation dialog
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSuppliers, deleteSupplier, getOpenOrderCounts } from '@/lib/api/suppliers';
import { Plus, Trash2, Package, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebounce } from '@/hooks/use-debounce';
import { PricelistPreviewModal } from './pricelist-preview-modal';
import { OpenOrdersModal } from './open-orders-modal';
import type { SupplierWithDetails } from '@/types/suppliers';
import { Checkbox } from '@/components/ui/checkbox';
import { PdfThumbnailClient } from '@/components/ui/pdf-thumbnail-client';
import { FileIcon } from '@/components/ui/file-icon';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function SupplierList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Initialize state from URL parameters
  const [searchTerm, setSearchTerm] = useState(() => searchParams?.get('q') || '');
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithDetails | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<SupplierWithDetails | null>(null);
  const [openOrdersSupplier, setOpenOrdersSupplier] = useState<SupplierWithDetails | null>(null);
  const [hasPricelistOnly, setHasPricelistOnly] = useState(() => {
    const param = searchParams?.get('hasPricelist');
    return param === '1' || param === 'true';
  });
  const [showInactive, setShowInactive] = useState(() => {
    const param = searchParams?.get('showInactive');
    return param === '1' || param === 'true';
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pageSizeOptions = [10, 25, 50, 100];

  // Debounce search input to avoid excessive URL updates
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // Re-read URL params when navigating back (component doesn't remount)
  const searchParamsString = searchParams?.toString() || '';
  useEffect(() => {
    const urlQuery = searchParams?.get('q') || '';
    const urlHasPricelist = searchParams?.get('hasPricelist');
    const urlHasPricelistBool = urlHasPricelist === '1' || urlHasPricelist === 'true';
    const urlShowInactive = searchParams?.get('showInactive');
    const urlShowInactiveBool = urlShowInactive === '1' || urlShowInactive === 'true';

    if (urlQuery !== searchTerm) setSearchTerm(urlQuery);
    if (urlHasPricelistBool !== hasPricelistOnly) setHasPricelistOnly(urlHasPricelistBool);
    if (urlShowInactiveBool !== showInactive) setShowInactive(urlShowInactiveBool);
  }, [searchParamsString]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filter state to URL
  useEffect(() => {
    const currentUrlQuery = searchParams?.get('q') || '';
    const currentUrlHasPricelist = searchParams?.get('hasPricelist');
    const currentUrlHasPricelistBool = currentUrlHasPricelist === '1' || currentUrlHasPricelist === 'true';
    const currentUrlShowInactive = searchParams?.get('showInactive');
    const currentUrlShowInactiveBool = currentUrlShowInactive === '1' || currentUrlShowInactive === 'true';

    // Only update URL if values differ from current URL
    if (
      debouncedSearchTerm === currentUrlQuery &&
      hasPricelistOnly === currentUrlHasPricelistBool &&
      showInactive === currentUrlShowInactiveBool
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams?.toString() || '');

    if (debouncedSearchTerm) {
      params.set('q', debouncedSearchTerm);
    } else {
      params.delete('q');
    }

    if (hasPricelistOnly) {
      params.set('hasPricelist', '1');
    } else {
      params.delete('hasPricelist');
    }

    if (showInactive) {
      params.set('showInactive', '1');
    } else {
      params.delete('showInactive');
    }

    const query = params.toString();
    const url = query ? `/suppliers?${query}` : '/suppliers';
    router.replace(url, { scroll: false });
  }, [debouncedSearchTerm, hasPricelistOnly, showInactive, router, searchParams]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, hasPricelistOnly, showInactive]);

  const { data: suppliers, isLoading, error } = useQuery({
    queryKey: ['suppliers'],
    queryFn: getSuppliers,
  });

  const { data: openOrderCounts = {} } = useQuery({
    queryKey: ['supplier-open-order-counts'],
    queryFn: getOpenOrderCounts,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSupplier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setSupplierToDelete(null);
    },
    onError: (error: Error) => {
      setSupplierToDelete(null);
      toast({ title: 'Cannot delete supplier', description: error.message, variant: 'destructive' });
    },
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

        const matchesActive = showInactive ? true : supplier.is_active !== false;

        return matchesSearch && matchesPricelist && matchesActive;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, searchTerm, hasPricelistOnly, showInactive]);

  // Pagination
  const totalCount = filteredSuppliers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const paginatedSuppliers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSuppliers.slice(start, start + pageSize);
  }, [filteredSuppliers, currentPage, pageSize]);

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
    const allPricelists = supplier.pricelists || [];
    const activePricelists = allPricelists.filter(p => p.is_active);
    if (!activePricelists.length) return null;

    const visible = activePricelists.slice(0, 6);
    const remaining = activePricelists.length - visible.length;

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
    <div className="space-y-2">
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
        <label htmlFor="filter-pricelist" className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm text-muted-foreground">
          <Checkbox
            id="filter-pricelist"
            checked={hasPricelistOnly}
            onCheckedChange={(v) => setHasPricelistOnly(Boolean(v))}
          />
          <span>Has price list</span>
        </label>
        <label htmlFor="filter-inactive" className="inline-flex items-center gap-2 h-9 px-3 rounded-md border bg-background text-sm text-muted-foreground">
          <Checkbox
            id="filter-inactive"
            checked={showInactive}
            onCheckedChange={(v) => setShowInactive(Boolean(v))}
          />
          <span>Show inactive</span>
        </label>
      </PageToolbar>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="min-w-full divide-y divide-border bg-background dark:bg-card">
          <thead className="bg-muted dark:bg-muted/20">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-center text-xs font-bold text-muted-foreground uppercase tracking-wider w-32">
                Open Orders
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Email
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Price Lists
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-bold text-muted-foreground uppercase tracking-wider w-20">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginatedSuppliers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-base text-muted-foreground">
                  {searchTerm ? 'No suppliers found matching your search.' : 'No suppliers found. Add your first supplier!'}
                </td>
              </tr>
            ) : (
              paginatedSuppliers.map((supplier) => {
                const email = supplier.emails?.find((e) => e.is_primary)?.email || supplier.emails?.[0]?.email || '';
                const orderCount = openOrderCounts[supplier.supplier_id] || 0;
                return (
                  <tr
                    key={supplier.supplier_id}
                    className={`hover:bg-accent/10 dark:hover:bg-accent/30 transition-colors cursor-pointer group ${
                      supplier.is_active === false ? 'opacity-50' : ''
                    }`}
                    onClick={() => router.push(`/suppliers/${supplier.supplier_id}`)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                      <span className="flex items-center gap-2">
                        {supplier.name || 'N/A'}
                        {supplier.is_active === false && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Inactive</Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      {orderCount > 0 ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenOrdersSupplier(supplier);
                          }}
                          className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                          title={`${orderCount} open order${orderCount === 1 ? '' : 's'}`}
                        >
                          <Package className="h-4 w-4" />
                          <span className="font-semibold">{orderCount}</span>
                        </button>
                      ) : (
                        <span className="text-muted-foreground/40">&mdash;</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-base text-muted-foreground">
                      {email || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-base text-muted-foreground">
                      {supplier.pricelists && supplier.pricelists.length > 0 ? (
                        renderPricelistStrip(supplier) || (
                          <span className="text-muted-foreground/60">None active</span>
                        )
                      ) : (
                        'None'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSupplierToDelete(supplier);
                          }}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete supplier"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      {totalCount > 0 && (
        <div className="flex flex-col items-start gap-4 border-t border-border/60 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span>Rows per page:</span>
              <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setCurrentPage(1); }}>
                <SelectTrigger className="h-9 w-24 rounded-md border border-border bg-background text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {pageSizeOptions.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="hidden md:inline">&bull;</span>
              <span>
                {((currentPage - 1) * pageSize + 1).toLocaleString()}&ndash;
                {Math.min(currentPage * pageSize, totalCount).toLocaleString()} of {totalCount.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Go to previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                aria-label="Go to next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pricelist Preview Modal */}
      {selectedSupplier && (
        <PricelistPreviewModal
          isOpen={!!selectedSupplier}
          onClose={() => setSelectedSupplier(null)}
          pricelists={selectedSupplier.pricelists}
          supplierName={selectedSupplier.name}
        />
      )}

      {/* Open Orders Modal */}
      {openOrdersSupplier && (
        <OpenOrdersModal
          supplierId={openOrdersSupplier.supplier_id}
          supplierName={openOrdersSupplier.name}
          open={!!openOrdersSupplier}
          onClose={() => setOpenOrdersSupplier(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!supplierToDelete} onOpenChange={(open) => !open && setSupplierToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{supplierToDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (supplierToDelete) {
                  deleteMutation.mutate(supplierToDelete.supplier_id);
                }
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

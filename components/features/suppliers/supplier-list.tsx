'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSuppliers } from '@/lib/api/suppliers';
import Link from 'next/link';
import { Search, Plus, ExternalLink, FileText } from 'lucide-react';
import { PricelistPreviewModal } from './pricelist-preview-modal';
import type { SupplierWithDetails } from '@/types/suppliers';

export function SupplierList() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierWithDetails | null>(null);

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
        
        return matchesSearch;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, searchTerm]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading suppliers...</div>
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
      {/* Header */}
      <div className="flex justify-between items-center">
        <Link
          href="/suppliers/new"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Supplier
        </Link>
      </div>

      {/* Search */}
      <div className="flex gap-4 items-center p-4 bg-card rounded-lg border shadow-sm">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search suppliers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-input"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-4 text-muted-foreground font-medium">Name</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Contact Info</th>
              <th className="text-left p-4 text-muted-foreground font-medium">Primary Email</th>
              <th className="text-center p-4 text-muted-foreground font-medium">Price Lists</th>
              <th className="text-right p-4 text-muted-foreground font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSuppliers.map((supplier) => (
              <tr key={supplier.supplier_id} className="border-b hover:bg-muted/50 transition-colors">
                <td className="p-4 font-medium">{supplier.name}</td>
                <td className="p-4 text-muted-foreground">{supplier.contact_info}</td>
                <td className="p-4 text-muted-foreground">
                  {supplier.emails?.find((e) => e.is_primary)?.email || 
                   supplier.emails?.[0]?.email || '-'}
                </td>
                <td className="p-4 text-center">
                  {supplier.pricelists && supplier.pricelists.length > 0 ? (
                    <button
                      onClick={() => setSelectedSupplier(supplier)}
                      className="inline-flex items-center gap-1 text-primary hover:text-primary/90"
                    >
                      <FileText className="h-4 w-4" />
                      <span className="text-sm">{supplier.pricelists.length}</span>
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-sm">None</span>
                  )}
                </td>
                <td className="p-4 text-right">
                  <Link
                    href={`/suppliers/${supplier.supplier_id}`}
                    className="inline-flex items-center gap-1 text-primary hover:text-primary/90 font-medium"
                  >
                    View Details
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
            {filteredSuppliers.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center">
                  <div className="text-muted-foreground">
                    {searchTerm
                      ? `No suppliers found matching "${searchTerm}"`
                      : 'No suppliers found. Add your first supplier to get started.'}
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
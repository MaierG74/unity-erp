'use client';

import * as React from 'react';
import { Search, X, Filter } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

interface ComponentRow {
  component_id: number;
  internal_code: string;
  description: string | null;
  category_name: string | null;
  price: number | null;
  supplier_name: string | null;
}

export interface SelectedComponent {
  component_id: number;
  internal_code: string;
  description: string;
  price: number;
  // Parsed dimensions (if available from description)
  length_mm?: number;
  width_mm?: number;
  thickness_mm?: number;
}

export interface ComponentPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Category IDs to filter by (e.g., [75] for Melamine, [39] for Edging) */
  categoryIds?: number[];
  /** Title for the dialog */
  title?: string;
  /** Description for the dialog */
  description?: string;
  /** Called when a component is selected */
  onSelect: (component: SelectedComponent) => void;
}

// =============================================================================
// Category Constants
// =============================================================================

export const CATEGORY_IDS = {
  MELAMINE: 75,
  MDF: 3,
  PLYWOOD: 14,
  EDGING: 39,
} as const;

// =============================================================================
// Dimension Parser
// =============================================================================

/**
 * Attempts to parse dimensions from a component description.
 * Handles formats like:
 * - "2.750x1.830x16" or "2750x1830x16" (L x W x T)
 * - "16mm African Wenge" (just thickness)
 * - "1mm x 36mm" (thickness x width for edging)
 */
function parseDimensions(description: string | null): {
  length_mm?: number;
  width_mm?: number;
  thickness_mm?: number;
} {
  if (!description) return {};

  const result: { length_mm?: number; width_mm?: number; thickness_mm?: number } = {};

  // Try to match "2.750x1.830x16" or "2750x1830x16" format (with or without decimals)
  const fullMatch = description.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+)/);
  if (fullMatch) {
    // Parse values - multiply by 1000 if looks like meters (e.g., 2.750)
    let length = parseFloat(fullMatch[1]);
    let width = parseFloat(fullMatch[2]);
    const thickness = parseFloat(fullMatch[3]);

    // If length/width look like meters (< 10), convert to mm
    if (length < 10) length *= 1000;
    if (width < 10) width *= 1000;

    result.length_mm = Math.round(length);
    result.width_mm = Math.round(width);
    result.thickness_mm = Math.round(thickness);
    return result;
  }

  // Try to match just thickness at start like "16mm African Wenge"
  const thicknessMatch = description.match(/^(\d+)\s*mm/i);
  if (thicknessMatch) {
    result.thickness_mm = parseInt(thicknessMatch[1], 10);
  }

  // Try to match edging format "1mm x 36mm" (thickness x width)
  const edgingMatch = description.match(/(\d+(?:\.\d+)?)\s*mm\s*[xX×]\s*(\d+(?:\.\d+)?)\s*mm/i);
  if (edgingMatch) {
    result.thickness_mm = parseFloat(edgingMatch[1]);
    result.width_mm = parseFloat(edgingMatch[2]);
  }

  return result;
}

// =============================================================================
// Component
// =============================================================================

// Category ID to name mapping
const CATEGORY_NAMES: Record<number, string> = {
  [CATEGORY_IDS.MELAMINE]: 'Melamine',
  [CATEGORY_IDS.MDF]: 'MDF',
  [CATEGORY_IDS.PLYWOOD]: 'Plywood',
  [CATEGORY_IDS.EDGING]: 'Edging',
};

interface Supplier {
  supplier_id: number;
  name: string;
}

export function ComponentPickerDialog({
  open,
  onOpenChange,
  categoryIds,
  title = 'Select Component',
  description = 'Search and select a component from inventory.',
  onSelect,
}: ComponentPickerDialogProps) {
  const [search, setSearch] = React.useState('');
  const [components, setComponents] = React.useState<ComponentRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);

  // Filter state - category filter can be cleared by user
  const [activeCategoryIds, setActiveCategoryIds] = React.useState<number[] | undefined>(categoryIds);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = React.useState<string>('all');

  const PAGE_SIZE = 50;

  // Reset filters when dialog opens with new categoryIds
  React.useEffect(() => {
    if (open) {
      setActiveCategoryIds(categoryIds);
      setSelectedSupplierId('all');
    }
  }, [open, categoryIds]);

  // Fetch suppliers list once
  React.useEffect(() => {
    if (open && suppliers.length === 0) {
      supabase
        .from('suppliers')
        .select('supplier_id, name')
        .order('name')
        .then(({ data }) => {
          if (data) setSuppliers(data);
        });
    }
  }, [open, suppliers.length]);

  // Fetch components when dialog opens or filters change
  const fetchComponents = React.useCallback(async (offset = 0, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // Build query based on whether we're filtering by supplier
      let query;

      if (selectedSupplierId !== 'all') {
        // When filtering by supplier, we need to join through suppliercomponents
        query = supabase
          .from('suppliercomponents')
          .select(`
            price,
            component:components(
              component_id,
              internal_code,
              description,
              category_id,
              category:component_categories(categoryname)
            ),
            supplier:suppliers(name)
          `)
          .eq('supplier_id', parseInt(selectedSupplierId))
          .order('price')
          .range(offset, offset + PAGE_SIZE); // Fetch PAGE_SIZE + 1 to check if more exist
      } else {
        // Standard query without supplier filter
        query = supabase
          .from('components')
          .select(`
            component_id,
            internal_code,
            description,
            category_id,
            category:component_categories(categoryname),
            suppliercomponents(price, supplier:suppliers(name))
          `)
          .order('internal_code')
          .range(offset, offset + PAGE_SIZE); // Fetch PAGE_SIZE + 1 to check if more exist
      }

      // Filter by category if active
      if (activeCategoryIds && activeCategoryIds.length > 0) {
        if (selectedSupplierId !== 'all') {
          query = query.in('component.category_id', activeCategoryIds);
        } else {
          query = query.in('category_id', activeCategoryIds);
        }
      }

      // Search filter
      if (search.trim()) {
        if (selectedSupplierId !== 'all') {
          query = query.or(
            `component.internal_code.ilike.%${search}%,component.description.ilike.%${search}%`
          );
        } else {
          query = query.or(
            `internal_code.ilike.%${search}%,description.ilike.%${search}%`
          );
        }
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      // Transform data to flat structure
      let rows: ComponentRow[];

      if (selectedSupplierId !== 'all') {
        // Data is from suppliercomponents join
        rows = (data || [])
          .filter((item: any) => item.component) // Filter out nulls from category filter
          .map((item: any) => ({
            component_id: item.component.component_id,
            internal_code: item.component.internal_code || '',
            description: item.component.description,
            category_name: item.component.category?.categoryname || null,
            price: item.price,
            supplier_name: item.supplier?.name || null,
          }));
      } else {
        // Data is from components table
        rows = (data || []).map((item: any) => {
          const prices = item.suppliercomponents?.map((sc: any) => sc.price) || [];
          const lowestPrice = prices.length > 0 ? Math.min(...prices) : null;
          const supplierWithLowestPrice = item.suppliercomponents?.find(
            (sc: any) => sc.price === lowestPrice
          );

          return {
            component_id: item.component_id,
            internal_code: item.internal_code || '',
            description: item.description,
            category_name: item.category?.categoryname || null,
            price: lowestPrice,
            supplier_name: supplierWithLowestPrice?.supplier?.name || null,
          };
        });
      }

      // Check if there are more results (we fetched PAGE_SIZE + 1)
      const hasMoreResults = rows.length > PAGE_SIZE;
      if (hasMoreResults) {
        rows = rows.slice(0, PAGE_SIZE); // Remove the extra item
      }
      setHasMore(hasMoreResults);

      if (append) {
        setComponents(prev => [...prev, ...rows]);
      } else {
        setComponents(rows);
      }
    } catch (err) {
      console.error('Failed to fetch components:', err);
      setError('Failed to load components');
      if (!append) {
        setComponents([]);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activeCategoryIds, search, selectedSupplierId]);

  const handleLoadMore = () => {
    fetchComponents(components.length, true);
  };

  // Fetch on open and search change
  React.useEffect(() => {
    if (open) {
      fetchComponents();
    }
  }, [open, fetchComponents]);

  // Reset search when dialog closes
  React.useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  const handleSelect = (component: ComponentRow) => {
    const dimensions = parseDimensions(component.description);

    onSelect({
      component_id: component.component_id,
      internal_code: component.internal_code,
      description: component.description || '',
      price: component.price || 0,
      ...dimensions,
    });

    onOpenChange(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      fetchComponents();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Search Bar */}
        <div className="flex items-center gap-2 pb-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-9"
              autoFocus
            />
            {search && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={() => setSearch('')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={fetchComponents} disabled={loading}>
            Search
          </Button>
        </div>

        {/* Compact Filter Row */}
        <div className="flex items-center gap-3 text-sm pb-1">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">Filters:</span>
          </div>

          {/* Category filter chip - removable */}
          {activeCategoryIds && activeCategoryIds.length > 0 ? (
            <Badge variant="secondary" className="gap-1 h-6 text-xs font-normal">
              {activeCategoryIds.map(id => CATEGORY_NAMES[id] || `Cat ${id}`).join(', ')}
              <button
                onClick={() => setActiveCategoryIds(undefined)}
                className="ml-0.5 hover:bg-muted-foreground/20 rounded-full p-0.5"
                title="Show all categories"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ) : (
            <Badge variant="outline" className="h-6 text-xs font-normal text-muted-foreground">
              All categories
            </Badge>
          )}

          {/* Supplier dropdown */}
          <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue placeholder="All suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All suppliers</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.supplier_id} value={String(s.supplier_id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Reset filters link */}
          {(selectedSupplierId !== 'all' || !activeCategoryIds) && categoryIds && (
            <button
              onClick={() => {
                setActiveCategoryIds(categoryIds);
                setSelectedSupplierId('all');
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Reset
            </button>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Results Table */}
        <div className="flex-1 overflow-auto border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[100px]">Category</TableHead>
                <TableHead className="w-[100px] text-right">Price</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !loadingMore ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : components.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No components found
                  </TableCell>
                </TableRow>
              ) : (
                components.map((component) => (
                  <TableRow
                    key={component.component_id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSelect(component)}
                  >
                    <TableCell className="font-mono text-sm">
                      {component.internal_code}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[300px]">
                      {component.description || '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {component.category_name || '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {component.price !== null ? `R ${component.price.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(component);
                        }}
                      >
                        Select
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footer with Load More */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {components.length} result{components.length !== 1 ? 's' : ''}
            {hasMore && ' (more available)'}
          </span>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="h-7 text-xs"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ComponentPickerDialog;

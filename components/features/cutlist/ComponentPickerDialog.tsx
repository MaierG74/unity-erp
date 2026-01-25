'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
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
  const [error, setError] = React.useState<string | null>(null);

  // Fetch components when dialog opens or search changes
  const fetchComponents = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('components')
        .select(`
          component_id,
          internal_code,
          description,
          category:component_categories(categoryname),
          suppliercomponents(price, supplier:suppliers(name))
        `)
        .order('internal_code')
        .limit(50);

      // Filter by category if specified
      if (categoryIds && categoryIds.length > 0) {
        query = query.in('category_id', categoryIds);
      }

      // Search filter
      if (search.trim()) {
        query = query.or(
          `internal_code.ilike.%${search}%,description.ilike.%${search}%`
        );
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      // Transform data to flat structure
      const rows: ComponentRow[] = (data || []).map((item: any) => {
        // Get lowest price from supplier components
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

      setComponents(rows);
    } catch (err) {
      console.error('Failed to fetch components:', err);
      setError('Failed to load components');
      setComponents([]);
    } finally {
      setLoading(false);
    }
  }, [categoryIds, search]);

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
              {loading ? (
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

        {/* Footer hint */}
        <div className="text-xs text-muted-foreground">
          Showing up to 50 results. Use search to find specific components.
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ComponentPickerDialog;

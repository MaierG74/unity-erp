'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Plus, RefreshCw, Pencil, Trash2, Search, X, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
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
import { OverheadElementDialog } from './OverheadElementDialog';

export type OverheadCategory = {
  category_id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
};

export type OverheadElement = {
  element_id: number;
  code: string;
  name: string;
  description: string | null;
  cost_type: 'fixed' | 'percentage';
  default_value: number;
  percentage_basis: 'materials' | 'labor' | 'total' | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  usage_count: number;
  category_id: number | null;
  category?: OverheadCategory | null;
};

export function OverheadCostsTab() {
  const [searchText, setSearchText] = useState('');
  const [selectedElement, setSelectedElement] = useState<OverheadElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch overhead cost elements
  const { data: elements = [], isLoading, error } = useQuery({
    queryKey: ['overhead-cost-elements'],
    queryFn: async () => {
      const res = await fetch('/api/overhead-cost-elements');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch overhead cost elements');
      }
      const data = await res.json();
      return data.elements as OverheadElement[];
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Filter elements based on search
  const filteredElements = useMemo(() => {
    if (!searchText) return elements;
    const lower = searchText.toLowerCase();
    return elements.filter(
      (el) =>
        el.code.toLowerCase().includes(lower) ||
        el.name.toLowerCase().includes(lower) ||
        (el.description?.toLowerCase().includes(lower) ?? false)
    );
  }, [elements, searchText]);

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['overhead-cost-elements'] });
    toast({
      title: 'Data refreshed',
      description: 'Overhead cost elements have been refreshed.',
    });
  };

  const handleAdd = () => {
    setSelectedElement(null);
    setDialogMode('add');
    setDialogOpen(true);
  };

  const handleEdit = (element: OverheadElement) => {
    setSelectedElement(element);
    setDialogMode('edit');
    setDialogOpen(true);
  };

  const handleDeleteClick = (element: OverheadElement) => {
    setSelectedElement(element);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedElement) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/overhead-cost-elements/${selectedElement.element_id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete element');
      }

      toast({
        title: 'Element deleted',
        description: `"${selectedElement.name}" has been deleted.`,
      });

      queryClient.invalidateQueries({ queryKey: ['overhead-cost-elements'] });
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setSelectedElement(null);
    }
  };

  const handleDialogSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['overhead-cost-elements'] });
  };

  const formatValue = (element: OverheadElement) => {
    if (element.cost_type === 'fixed') {
      return `R${element.default_value.toFixed(2)}`;
    }
    return `${element.default_value}% of ${element.percentage_basis}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-destructive">
          Error loading overhead cost elements: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">
          Manage overhead cost elements (wrapping, powder coating, etc.) that can be assigned to products.
          Changes here automatically update all products using these elements.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="inline-flex gap-2 p-3 bg-card rounded-xl border shadow-sm">
          <Button onClick={refreshData} className="h-9" variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button className="h-9" onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Add Element
          </Button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search elements..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9 pr-10"
          />
          {searchText && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => setSearchText('')}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Products</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredElements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {searchText ? 'No elements match your search.' : 'No overhead cost elements defined yet.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredElements.map((element) => (
                <TableRow key={element.element_id}>
                  <TableCell className="font-mono font-medium">{element.code}</TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{element.name}</div>
                      {element.description && (
                        <div className="text-xs text-muted-foreground">{element.description}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {element.category ? (
                      <Badge variant="outline">{element.category.name}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={element.cost_type === 'fixed' ? 'default' : 'secondary'}>
                      {element.cost_type === 'fixed' ? 'Fixed' : 'Percentage'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatValue(element)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={element.is_active ? 'default' : 'outline'}>
                      {element.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {element.usage_count > 0 ? (
                      <Badge variant="secondary">{element.usage_count}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(element)}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteClick(element)}
                        title="Delete"
                        disabled={element.usage_count > 0}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit Dialog */}
      <OverheadElementDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        element={selectedElement}
        onSuccess={handleDialogSuccess}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete overhead cost element?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedElement?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

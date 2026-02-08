'use client';

import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Plus, RefreshCw, Pencil, Trash2, GitMerge, Search, X, Loader2 } from 'lucide-react';
import { AddCategoryDialog } from './AddCategoryDialog';
import { EditCategoryDialog } from './EditCategoryDialog';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';
import { MergeCategoriesDialog } from './MergeCategoriesDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';

type Category = {
  cat_id: number;
  categoryname: string;
  component_count?: number;
};

export function CategoriesTab() {
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch categories with component counts
  const { data: categories = [], isLoading, error } = useQuery({
    queryKey: ['categories', 'with-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('component_categories')
        .select('cat_id, categoryname')
        .order('categoryname');

      if (error) {
        console.error('Error fetching categories:', error);
        throw error;
      }

      // Fetch component counts for each category
      const categoriesWithCounts = await Promise.all(
        (data || []).map(async (category) => {
          const { count, error: countError } = await supabase
            .from('components')
            .select('*', { count: 'exact', head: true })
            .eq('category_id', category.cat_id);

          if (countError) {
            console.error('Error fetching component count:', countError);
            return { ...category, component_count: 0 };
          }

          return { ...category, component_count: count || 0 };
        })
      );

      return categoriesWithCounts;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Filter categories based on search
  const filteredCategories = useMemo(() => {
    if (!searchText) return categories;
    return categories.filter((cat) =>
      cat.categoryname.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [categories, searchText]);

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ['categories'] });
    queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
    toast({
      title: 'Data refreshed',
      description: 'Categories have been refreshed from the database.',
    });
  };

  const handleEdit = (category: Category) => {
    setSelectedCategory(category);
    setEditDialogOpen(true);
  };

  const handleDelete = (category: Category) => {
    setSelectedCategory(category);
    setDeleteDialogOpen(true);
  };

  const handleMerge = (category: Category) => {
    setSelectedCategory(category);
    setMergeDialogOpen(true);
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
          Error loading categories: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="inline-flex gap-2 p-3 bg-card rounded-xl border shadow-sm">
          <Button onClick={refreshData} className="h-9" variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button className="h-9" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Category
          </Button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search categories..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9 pr-10"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Categories Table */}
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category Name</TableHead>
              <TableHead className="text-center">Components</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCategories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                  {searchText
                    ? 'No categories found matching your search.'
                    : 'No categories yet. Click "Add Category" to create one.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredCategories.map((category) => (
                <TableRow key={category.cat_id}>
                  <TableCell className="font-medium">
                    {category.categoryname}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">{category.component_count || 0}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEdit(category)}
                        title="Edit category"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleMerge(category)}
                        title="Merge category"
                      >
                        <GitMerge className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(category)}
                        title="Delete category"
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

      {/* Dialogs */}
      <AddCategoryDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />

      {selectedCategory && (
        <>
          <EditCategoryDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            category={selectedCategory}
          />
          <DeleteCategoryDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            category={selectedCategory}
            allCategories={categories}
          />
          <MergeCategoriesDialog
            open={mergeDialogOpen}
            onOpenChange={setMergeDialogOpen}
            sourceCategory={selectedCategory}
            allCategories={categories}
          />
        </>
      )}
    </div>
  );
}


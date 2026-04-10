'use client';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Pencil, Copy, Trash2, MoreVertical, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { ProductRow } from './ProductsPage';
import { CopyProductDialog } from './CopyProductDialog';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ProductsRowActionsProps {
  product: ProductRow;
  onError: (message: string) => void;
}

export function ProductsRowActions({ product, onError }: ProductsRowActionsProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await authorizedFetch(`/api/products/${product.product_id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to delete product');
      }
    },
    onSuccess: async () => {
      setDeleteDialogOpen(false);
      toast({
        title: 'Product deleted',
        description: `${product.name} was removed successfully`,
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to delete product';
      onError(message);
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Open actions menu for ${product.name}`}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onClick={() => {
              router.push(`/products/${product.product_id}`);
            }}
          >
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCopyDialogOpen(true)}>
            <Copy className="mr-2 h-4 w-4" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CopyProductDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        sourceProduct={product}
        onCopyComplete={(newProduct) => {
          router.push(`/products/${newProduct.product_id}`);
        }}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{product.internal_code} - {product.name}&quot;? This will remove the
              product and its own setup data such as categories, BOM, labor, overhead, and images.
              Products already referenced by orders cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

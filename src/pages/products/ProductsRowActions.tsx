'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Pencil, Copy, Trash2, MoreVertical } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ProductRow } from './ProductsPage';

interface ProductsRowActionsProps {
  product: ProductRow;
  onError: (message: string) => void;
}

export function ProductsRowActions({ product, onError }: ProductsRowActionsProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/products/${product.product_id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to delete product');
      }
    },
    onSuccess: async () => {
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

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/products/${product.product_id}/duplicate`, {
        method: 'POST',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to duplicate product');
      }
    },
    onSuccess: async () => {
      toast({
        title: 'Product duplicated',
        description: `${product.name} has a new copy`,
      });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to duplicate product';
      onError(message);
    },
  });

  return (
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
            window.location.assign(`/products/${product.product_id}`);
          }}
        >
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => duplicateMutation.mutate()}
          disabled={duplicateMutation.isPending}
        >
          <Copy className="mr-2 h-4 w-4" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            // TODO: Wire AlertDialog confirmation before deleting
            deleteMutation.mutate();
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { ProductRow } from './ProductsPage';
import { ReactNode } from 'react';

interface ProductsActionsMenuProps {
  product: ProductRow;
  children: ReactNode;
  onError: (message: string) => void;
}

export function ProductsActionsMenu({ product, children, onError }: ProductsActionsMenuProps) {
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
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={() => {
            window.location.assign(`/products/${product.product_id}`);
          }}
        >
          ✏️ Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            duplicateMutation.mutate();
          }}
          disabled={duplicateMutation.isPending}
        >
          📦 Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            deleteMutation.mutate();
          }}
          disabled={deleteMutation.isPending}
        >
          🗑️ Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


'use client';

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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

type SupplierComponent = {
  supplier_component_id: number;
  supplier_id: number;
  supplier_code: string;
  price: number;
  supplier: {
    supplier_id: number;
    name: string;
  };
};

type DeleteSupplierDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierComponent: SupplierComponent;
};

export function DeleteSupplierDialog({
  open,
  onOpenChange,
  supplierComponent,
}: DeleteSupplierDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Delete supplier mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('suppliercomponents')
        .delete()
        .eq('supplier_component_id', supplierComponent.supplier_component_id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['component'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      toast({
        title: 'Supplier removed',
        description: 'The supplier link has been successfully removed.',
      });
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Error deleting supplier:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove supplier. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Supplier Link</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove <strong>{supplierComponent.supplier.name}</strong> (Code:{' '}
            {supplierComponent.supplier_code}) from this component?
            <br />
            <br />
            This will remove the pricing information and supplier link. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Remove Supplier
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}







'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
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
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

type DeleteComponentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  componentId: number;
  componentName: string;
};

export function DeleteComponentDialog({
  open,
  onOpenChange,
  componentId,
  componentName,
}: DeleteComponentDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // First check if there are any dependencies
      const { data: bomData } = await supabase
        .from('billofmaterials')
        .select('bom_id')
        .eq('component_id', componentId)
        .limit(1);

      if (bomData && bomData.length > 0) {
        throw new Error('This component is used in one or more product BOMs and cannot be deleted.');
      }

      const { data: supplierData } = await supabase
        .from('suppliercomponents')
        .select('supplier_component_id')
        .eq('component_id', componentId)
        .limit(1);

      if (supplierData && supplierData.length > 0) {
        throw new Error('This component has supplier links. Please remove them first.');
      }

      // Delete inventory record first
      await supabase
        .from('inventory')
        .delete()
        .eq('component_id', componentId);

      // Delete the component
      const { error } = await supabase
        .from('components')
        .delete()
        .eq('component_id', componentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      toast({
        title: 'Component deleted',
        description: `${componentName} has been deleted.`,
      });
      onOpenChange(false);
      router.push('/inventory');
    },
    onError: (error: Error) => {
      toast({
        title: 'Delete failed',
        description: error.message || 'Failed to delete component.',
        variant: 'destructive',
      });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Component?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{componentName}</strong>? This action cannot be undone.
            <br /><br />
            This will also delete any associated inventory records and transaction history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

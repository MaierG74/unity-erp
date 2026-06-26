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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ShieldAlert } from 'lucide-react';

const DELETE_BLOCKED_MESSAGE =
  'This component has stock history, so it cannot be deleted. Disable it instead to hide it from new work while keeping past purchases, issues, adjustments, and reports intact.';

const dependencyTables = [
  'inventory_transactions',
  'stock_issuances',
  'billofmaterials',
  'bom_collection_items',
  'section_details',
  'quote_cluster_lines',
  'supplier_order_customer_orders',
];

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
      const dependencyChecks = await Promise.all(
        dependencyTables.map((table) =>
          supabase
            .from(table)
            .select('*', { count: 'exact', head: true })
            .eq('component_id', componentId)
        )
      );

      const dependencyCheckError = dependencyChecks.find((result) => result.error)?.error;
      if (dependencyCheckError) {
        throw dependencyCheckError;
      }

      const hasDependencies = dependencyChecks.some((result) => (result.count ?? 0) > 0);
      if (hasDependencies) {
        throw new Error(DELETE_BLOCKED_MESSAGE);
      }

      // Use the API route which handles all related tables with admin privileges
      const response = await fetch(`/api/inventory/components/${componentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(response.status === 409 ? DELETE_BLOCKED_MESSAGE : errorText || 'Failed to delete component');
      }
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
          <AlertDialogDescription className="space-y-3">
            <span>
              Delete <strong>{componentName}</strong>? This is only available for unused components.
            </span>
            <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100">
              <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-300" />
              <AlertTitle>History is protected</AlertTitle>
              <AlertDescription>
                If this component has ever been received, issued, adjusted, used in a BOM, or linked
                to purchasing or quote history, deletion will be blocked. Disable it instead to hide
                it from new work while keeping the audit trail safe.
              </AlertDescription>
            </Alert>
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

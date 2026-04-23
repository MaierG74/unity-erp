'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
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

type ToggleActiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  componentId: number;
  componentName: string;
  isActive: boolean;
};

export function ToggleActiveDialog({
  open,
  onOpenChange,
  componentId,
  componentName,
  isActive,
}: ToggleActiveDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const nextActive = !isActive;

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('components')
        .update({ is_active: nextActive })
        .eq('component_id', componentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['component', componentId] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-components'] });
      queryClient.invalidateQueries({ queryKey: ['components'] });
      queryClient.invalidateQueries({ queryKey: ['richComponents'] });
      queryClient.invalidateQueries({ queryKey: ['component-search'] });
      queryClient.invalidateQueries({ queryKey: ['board-components'] });
      queryClient.invalidateQueries({ queryKey: ['edging-components'] });
      toast({
        title: nextActive ? 'Component enabled' : 'Component disabled',
        description: nextActive
          ? `${componentName} is available again for POs, BOMs and stock issue.`
          : `${componentName} is hidden from POs, BOMs and stock issue. Historical data preserved.`,
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: nextActive ? 'Enable failed' : 'Disable failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {nextActive ? 'Enable component?' : 'Disable component?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {nextActive ? (
              <>
                Re-enable <strong>{componentName}</strong>? It will appear again in PO creation,
                BOM pickers and stock issue.
              </>
            ) : (
              <>
                Disable <strong>{componentName}</strong>? It will be hidden from PO creation,
                BOM pickers and stock issue. Historical data is preserved and you can re-enable
                at any time.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {nextActive ? 'Enable' : 'Disable'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

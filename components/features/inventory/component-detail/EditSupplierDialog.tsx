'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  supplier_code: z.string().min(1, 'Supplier code is required'),
  price: z.string().min(1, 'Price is required'),
});

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

type EditSupplierDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierComponent: SupplierComponent;
};

export function EditSupplierDialog({ open, onOpenChange, supplierComponent }: EditSupplierDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      supplier_code: supplierComponent.supplier_code,
      price: supplierComponent.price.toString(),
    },
  });

  useEffect(() => {
    form.reset({
      supplier_code: supplierComponent.supplier_code,
      price: supplierComponent.price.toString(),
    });
  }, [supplierComponent, form]);

  // Update supplier mutation
  const updateMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      const { error } = await supabase
        .from('suppliercomponents')
        .update({
          supplier_code: values.supplier_code,
          price: parseFloat(values.price),
        })
        .eq('supplier_component_id', supplierComponent.supplier_component_id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['component'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      toast({
        title: 'Supplier updated',
        description: 'The supplier information has been successfully updated.',
      });
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Error updating supplier:', error);
      toast({
        title: 'Error',
        description: 'Failed to update supplier. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateMutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Supplier</DialogTitle>
          <DialogDescription>
            Update pricing and code for {supplierComponent.supplier.name}.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Supplier</label>
              <div className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
                {supplierComponent.supplier.name}
              </div>
            </div>

            <FormField
              control={form.control}
              name="supplier_code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supplier Code *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., L650" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit Price (ZAR) *</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Supplier
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}







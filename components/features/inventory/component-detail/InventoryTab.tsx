'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Save, Package, MapPin, AlertTriangle } from 'lucide-react';

const formSchema = z.object({
  quantity_on_hand: z.string().min(1, 'Quantity is required'),
  reorder_level: z.string().min(1, 'Reorder level is required'),
  location: z.string().optional(),
});

type ComponentData = {
  component_id: number;
  inventory: Array<{
    inventory_id: number;
    quantity_on_hand: number;
    location: string | null;
    reorder_level: number | null;
  }> | null;
};

type InventoryTabProps = {
  component: ComponentData;
};

export function InventoryTab({ component }: InventoryTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inventory = component.inventory?.[0];

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      quantity_on_hand: inventory?.quantity_on_hand?.toString() || '0',
      reorder_level: inventory?.reorder_level?.toString() || '0',
      location: inventory?.location || '',
    },
  });

  // Update inventory mutation
  const updateMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      if (inventory?.inventory_id) {
        // Update existing inventory
        const { error } = await supabase
          .from('inventory')
          .update({
            quantity_on_hand: parseInt(values.quantity_on_hand),
            reorder_level: parseInt(values.reorder_level),
            location: values.location || null,
          })
          .eq('inventory_id', inventory.inventory_id);

        if (error) throw error;
      } else {
        // Create new inventory record
        const { error } = await supabase.from('inventory').insert({
          component_id: component.component_id,
          quantity_on_hand: parseInt(values.quantity_on_hand),
          reorder_level: parseInt(values.reorder_level),
          location: values.location || null,
        });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['component', component.component_id] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'components'] });
      toast({
        title: 'Inventory updated',
        description: 'Inventory settings have been successfully updated.',
      });
    },
    onError: (error) => {
      console.error('Error updating inventory:', error);
      toast({
        title: 'Update failed',
        description: 'Failed to update inventory. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateMutation.mutate(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Stock Levels
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="quantity_on_hand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity on Hand *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Current stock quantity</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reorder_level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reorder Level *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Minimum stock before reordering</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <MapPin className="h-4 w-4 inline mr-1" />
                    Storage Location
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Warehouse A, Shelf 3" {...field} />
                  </FormControl>
                  <FormDescription>
                    Where this component is stored in your facility
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Stock Alert Info */}
        {parseInt(form.watch('quantity_on_hand') || '0') <=
          parseInt(form.watch('reorder_level') || '0') && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div className="text-amber-800">
                  <p className="font-medium">Stock Alert</p>
                  <p className="text-sm mt-1">
                    Current quantity is at or below the reorder level. Consider placing a
                    purchase order to replenish stock.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end">
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Save Inventory Settings
          </Button>
        </div>
      </form>
    </Form>
  );
}







'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { OverheadElement } from './OverheadCostsTab';

type OverheadCategory = {
  category_id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
};

const formSchema = z.object({
  code: z.string().min(1, 'Code is required').max(50, 'Code must be 50 characters or less'),
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
  cost_type: z.enum(['fixed', 'percentage']),
  default_value: z.coerce.number().min(0, 'Value must be 0 or greater'),
  percentage_basis: z.enum(['materials', 'labor', 'total']).optional(),
  is_active: z.boolean(),
  category_id: z.coerce.number().optional(),
});

type FormValues = z.infer<typeof formSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  element: OverheadElement | null;
  onSuccess: () => void;
};

export function OverheadElementDialog({ open, onOpenChange, mode, element, onSuccess }: Props) {
  const { toast } = useToast();

  // Fetch categories for dropdown
  const { data: categories = [] } = useQuery<OverheadCategory[]>({
    queryKey: ['overhead-categories'],
    queryFn: async () => {
      const res = await fetch('/api/overhead-categories');
      if (!res.ok) return [];
      const json = await res.json();
      return json?.items ?? [];
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: '',
      name: '',
      description: '',
      cost_type: 'fixed',
      default_value: 0,
      percentage_basis: 'total',
      is_active: true,
      category_id: undefined,
    },
  });

  const costType = form.watch('cost_type');
  const isSubmitting = form.formState.isSubmitting;

  // Reset form when dialog opens/closes or element changes
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && element) {
        form.reset({
          code: element.code,
          name: element.name,
          description: element.description || '',
          cost_type: element.cost_type,
          default_value: element.default_value,
          percentage_basis: element.percentage_basis || 'total',
          is_active: element.is_active,
          category_id: element.category_id ?? undefined,
        });
      } else {
        form.reset({
          code: '',
          name: '',
          description: '',
          cost_type: 'fixed',
          default_value: 0,
          percentage_basis: 'total',
          is_active: true,
          category_id: undefined,
        });
      }
    }
  }, [open, mode, element, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      const payload = {
        code: values.code,
        name: values.name,
        description: values.description || null,
        cost_type: values.cost_type,
        default_value: values.default_value,
        percentage_basis: values.cost_type === 'percentage' ? values.percentage_basis : null,
        is_active: values.is_active,
        category_id: values.category_id || null,
      };

      const url =
        mode === 'edit' && element
          ? `/api/overhead-cost-elements/${element.element_id}`
          : '/api/overhead-cost-elements';

      const method = mode === 'edit' ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${mode === 'edit' ? 'update' : 'create'} element`);
      }

      toast({
        title: mode === 'edit' ? 'Element updated' : 'Element created',
        description: `"${values.name}" has been ${mode === 'edit' ? 'updated' : 'created'}.`,
      });

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: mode === 'edit' ? 'Update failed' : 'Create failed',
        description: err instanceof Error ? err.message : 'An error occurred',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? 'Edit Overhead Cost Element' : 'Add Overhead Cost Element'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Update the overhead cost element details.'
              : 'Create a new overhead cost element that can be assigned to products.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input placeholder="WRAP" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Wrapping" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional description of this overhead cost..."
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select
                    onValueChange={(val) => field.onChange(val === 'none' ? undefined : Number(val))}
                    value={field.value?.toString() ?? 'none'}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No Category</SelectItem>
                      {categories
                        .filter((c) => c.is_active)
                        .map((category) => (
                          <SelectItem key={category.category_id} value={category.category_id.toString()}>
                            {category.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Group this element under a category for better organization
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cost_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed Amount</SelectItem>
                        <SelectItem value="percentage">Percentage</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {field.value === 'fixed' ? 'A flat amount in Rands' : 'A percentage of costs'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="default_value"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{costType === 'fixed' ? 'Amount (R)' : 'Percentage (%)'}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step={costType === 'fixed' ? '0.01' : '0.1'}
                        min="0"
                        placeholder={costType === 'fixed' ? '20.00' : '5'}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {costType === 'percentage' && (
              <FormField
                control={form.control}
                name="percentage_basis"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Calculate Percentage Of</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select basis" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="materials">Materials Cost</SelectItem>
                        <SelectItem value="labor">Labor Cost</SelectItem>
                        <SelectItem value="total">Total (Materials + Labor)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The percentage will be calculated based on this cost
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Active</FormLabel>
                    <FormDescription>
                      Inactive elements cannot be assigned to new products
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? mode === 'edit'
                    ? 'Saving...'
                    : 'Creating...'
                  : mode === 'edit'
                    ? 'Save Changes'
                    : 'Create Element'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

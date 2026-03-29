'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface JobCategory {
  category_id: number;
  name: string;
  current_hourly_rate: number;
  parent_category_id: number | null;
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  hourly_rate: z.coerce.number().positive('Rate must be greater than 0'),
});

type FormValues = z.infer<typeof schema>;

interface InlineCategoryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: number;
  parentName?: string;
  defaultRate?: number;
  onCreated: (category: JobCategory) => void;
}

export function InlineCategoryForm({
  open,
  onOpenChange,
  parentId,
  parentName,
  defaultRate,
  onCreated,
}: InlineCategoryFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      hourly_rate: defaultRate ?? 0,
    },
  });

  // Reset form when dialog opens with fresh defaultRate
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      form.reset({ name: '', hourly_rate: defaultRate ?? 0 });
    }
    onOpenChange(nextOpen);
  };

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Insert category
      const { data, error } = await supabase
        .from('job_categories')
        .insert({
          name: values.name,
          current_hourly_rate: values.hourly_rate,
          parent_category_id: parentId ?? null,
        })
        .select()
        .single();

      if (error) throw error;

      // Insert initial rate row
      const { error: rateError } = await supabase
        .from('job_category_rates')
        .insert({
          category_id: data.category_id,
          hourly_rate: values.hourly_rate,
          effective_date: new Date().toISOString().split('T')[0],
        });

      if (rateError) {
        console.error('Failed to insert initial rate row:', rateError);
        // Non-fatal — category was created, rate can be added later
      }

      return data as JobCategory;
    },
    onSuccess: (category) => {
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      queryClient.invalidateQueries({ queryKey: ['jobCategoryRates'] });
      toast({ title: parentId ? 'Subcategory created' : 'Category created' });
      onOpenChange(false);
      onCreated(category);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create category',
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {parentId ? 'New Subcategory' : 'New Category'}
          </DialogTitle>
          {parentName && (
            <DialogDescription>Under: {parentName}</DialogDescription>
          )}
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-3"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hourly_rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hourly Rate</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        R
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="pl-7 pr-10"
                        placeholder="0.00"
                        {...field}
                        value={field.value || ''}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        /hr
                      </span>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

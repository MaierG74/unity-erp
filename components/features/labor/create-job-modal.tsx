'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface JobCategory {
  category_id: number;
  name: string;
  description: string | null;
  current_hourly_rate: number;
  parent_category_id: number | null;
}

interface CreatedJob {
  job_id: number;
  name: string;
  description: string | null;
  category_id: number;
}

const jobSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  category_id: z.string().min(1, 'Category is required'),
});

type JobFormValues = z.infer<typeof jobSchema>;

interface CreateJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated: (job: CreatedJob) => void;
  initialCategoryId?: number; // Optional pre-selected category
}

export function CreateJobModal({
  isOpen,
  onClose,
  onJobCreated,
  initialCategoryId,
}: CreateJobModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch job categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['jobCategories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_categories')
        .select('*')
        .order('name');

      if (error) throw error;
      return data as JobCategory[];
    },
  });

  // Build parent/child maps
  const { parentCategories, childrenByParent } = useMemo(() => {
    const parents: JobCategory[] = [];
    const children = new Map<number, JobCategory[]>();

    for (const cat of categories) {
      if (cat.parent_category_id === null) {
        parents.push(cat);
      } else {
        const list = children.get(cat.parent_category_id) || [];
        list.push(cat);
        children.set(cat.parent_category_id, list);
      }
    }

    return { parentCategories: parents, childrenByParent: children };
  }, [categories]);

  // Determine initial parent from initialCategoryId
  const initialParent = useMemo(() => {
    if (!initialCategoryId || categories.length === 0) return '';
    const cat = categories.find((c) => c.category_id === initialCategoryId);
    if (!cat) return '';
    if (cat.parent_category_id === null) {
      // It's a parent category
      return cat.category_id.toString();
    }
    // It's a subcategory - return its parent
    return cat.parent_category_id.toString();
  }, [initialCategoryId, categories]);

  const initialSub = useMemo(() => {
    if (!initialCategoryId || categories.length === 0) return '';
    const cat = categories.find((c) => c.category_id === initialCategoryId);
    if (!cat) return '';
    if (cat.parent_category_id !== null) {
      return cat.category_id.toString();
    }
    return '';
  }, [initialCategoryId, categories]);

  // Local state for cascading selects
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedSubId, setSelectedSubId] = useState('');

  // Initialize selects when categories load or initialCategoryId changes
  useEffect(() => {
    if (isOpen && categories.length > 0) {
      setSelectedParentId(initialParent);
      setSelectedSubId(initialSub);
    }
  }, [isOpen, categories.length, initialParent, initialSub]);

  // Get subcategories for the selected parent
  const subcategoriesForParent = useMemo(() => {
    if (!selectedParentId) return [];
    return childrenByParent.get(parseInt(selectedParentId)) || [];
  }, [selectedParentId, childrenByParent]);

  // Compute the effective category_id from parent + sub selection
  const effectiveCategoryId = useMemo(() => {
    if (selectedSubId) return selectedSubId;
    return selectedParentId;
  }, [selectedParentId, selectedSubId]);

  // Initialize form
  const form = useForm<JobFormValues>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      name: '',
      description: '',
      category_id: '',
    },
  });

  // Sync effectiveCategoryId to form
  useEffect(() => {
    form.setValue('category_id', effectiveCategoryId);
  }, [effectiveCategoryId, form]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      form.reset({ name: '', description: '', category_id: '' });
      setSelectedParentId('');
      setSelectedSubId('');
    }
  }, [isOpen, form]);

  // Add job mutation
  const addJob = useMutation({
    mutationFn: async (values: JobFormValues) => {
      const { data, error } = await supabase
        .from('jobs')
        .insert({
          name: values.name,
          description: values.description || null,
          category_id: parseInt(values.category_id),
        })
        .select();

      if (error) throw error;
      return data[0] as CreatedJob;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      form.reset();
      toast({
        title: 'Success',
        description: 'Job added successfully',
      });
      onJobCreated(data);
      onClose();
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to add job',
        variant: 'destructive',
      });
      console.error('Error adding job:', error);
    },
  });

  // Handle form submission
  const onSubmit = (values: JobFormValues) => {
    addJob.mutate(values);
  };

  // Handle parent change - reset subcategory
  const handleParentChange = (value: string) => {
    setSelectedParentId(value);
    setSelectedSubId('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
          <DialogDescription>
            Add a new job that can be used in bills of labor
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Category (parent) select */}
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select
                onValueChange={handleParentChange}
                value={selectedParentId}
                disabled={categoriesLoading}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {parentCategories.map((category) => (
                    <SelectItem
                      key={category.category_id}
                      value={category.category_id.toString()}
                    >
                      {category.name} - R{category.current_hourly_rate.toFixed(2)}/hr
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Show form-level error for category_id */}
              {form.formState.errors.category_id && (
                <p className="text-sm font-medium text-destructive">
                  {form.formState.errors.category_id.message}
                </p>
              )}
            </FormItem>

            {/* Subcategory select - only show when parent has subcategories */}
            {subcategoriesForParent.length > 0 && (
              <FormItem>
                <FormLabel>Subcategory (optional)</FormLabel>
                <Select
                  onValueChange={(v) => setSelectedSubId(v === '_none' ? '' : v)}
                  value={selectedSubId}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="None (use parent category)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="_none">None (use parent category)</SelectItem>
                    {subcategoriesForParent.map((sub) => (
                      <SelectItem
                        key={sub.category_id}
                        value={sub.category_id.toString()}
                      >
                        {sub.name} - R{sub.current_hourly_rate.toFixed(2)}/hr
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}

            {/* Hidden field to register category_id with form validation */}
            <input type="hidden" {...form.register('category_id')} />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={addJob.isPending}
              >
                {addJob.isPending ? 'Creating...' : 'Create Job'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

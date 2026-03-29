'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
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
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Plus } from 'lucide-react';
import { InlineCategoryForm } from './inline-category-form';

interface JobCategory {
  category_id: number;
  name: string;
  current_hourly_rate: number;
  parent_category_id: number | null;
}

interface CreatedJob {
  job_id: number;
  name: string;
  description: string | null;
  category_id: number;
  estimated_minutes: number | null;
  time_unit: string | null;
}

const jobSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional(),
  category_id: z.string().min(1, 'Category is required'),
  estimated_time: z.string().optional(),
  time_unit: z.string().optional(),
  piecework_rate: z.string().optional(),
});

type JobFormValues = z.infer<typeof jobSchema>;

const DEFAULT_FORM_VALUES: JobFormValues = {
  name: '',
  description: '',
  category_id: '',
  estimated_time: '',
  time_unit: 'minutes',
  piecework_rate: '',
};

interface CreateJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated: (job: CreatedJob) => void;
  initialCategoryId?: number; // Optional pre-selected category
  showAddAnother?: boolean;
}

export function CreateJobModal({
  isOpen,
  onClose,
  onJobCreated,
  initialCategoryId,
  showAddAnother = false,
}: CreateJobModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Fetch job categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['jobCategories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_categories')
        .select('category_id, name, current_hourly_rate, parent_category_id')
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

  // Determine initial parent/sub from initialCategoryId
  const { initialParent, initialSub } = useMemo(() => {
    if (!initialCategoryId || categories.length === 0) return { initialParent: '', initialSub: '' };
    const cat = categories.find((c) => c.category_id === initialCategoryId);
    if (!cat) return { initialParent: '', initialSub: '' };
    return cat.parent_category_id === null
      ? { initialParent: cat.category_id.toString(), initialSub: '' }
      : { initialParent: cat.parent_category_id.toString(), initialSub: cat.category_id.toString() };
  }, [initialCategoryId, categories]);

  // Local state for cascading selects
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedSubId, setSelectedSubId] = useState('');
  const [isNewCategoryOpen, setIsNewCategoryOpen] = useState(false);
  const [isNewSubcategoryOpen, setIsNewSubcategoryOpen] = useState(false);

  // Initialize selects only when dialog first opens (not on every categories change)
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (isOpen && categories.length > 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      setSelectedParentId(initialParent);
      setSelectedSubId(initialSub);
    }
    if (!isOpen) {
      hasInitialized.current = false;
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
    defaultValues: DEFAULT_FORM_VALUES,
  });

  // Sync effectiveCategoryId to form
  useEffect(() => {
    form.setValue('category_id', effectiveCategoryId);
  }, [effectiveCategoryId, form]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      form.reset(DEFAULT_FORM_VALUES);
      setSelectedParentId('');
      setSelectedSubId('');
      setIsNewCategoryOpen(false);
      setIsNewSubcategoryOpen(false);
    }
  }, [isOpen, form]);

  // Add job mutation
  const addJob = useMutation({
    mutationFn: async ({
      values,
      mode,
    }: {
      values: JobFormValues;
      mode: 'close' | 'another';
    }) => {
      const estimatedTime = values.estimated_time ? parseFloat(values.estimated_time) : null;
      if (estimatedTime !== null && estimatedTime <= 0) {
        throw new Error('Estimated time must be greater than 0');
      }
      const timeUnit = estimatedTime !== null ? (values.time_unit || 'minutes') : null;

      const pieceworkRate = values.piecework_rate ? parseFloat(values.piecework_rate) : null;
      if (pieceworkRate !== null && pieceworkRate <= 0) {
        throw new Error('Piecework rate must be greater than 0');
      }

      // Step 1: Insert the job
      const { data, error } = await supabase
        .from('jobs')
        .insert({
          name: values.name,
          description: values.description || null,
          category_id: parseInt(values.category_id),
          estimated_minutes: estimatedTime,
          time_unit: timeUnit,
        })
        .select();

      if (error) throw error;
      const job = data[0] as CreatedJob;

      // Step 2: Insert piecework rate if provided
      // effective_date omitted — DB default is CURRENT_DATE (server-side, timezone-safe)
      let rateError: Error | null = null;
      if (pieceworkRate !== null) {
        const { error: prError } = await supabase
          .from('piece_work_rates')
          .insert({
            job_id: job.job_id,
            product_id: null,
            rate: pieceworkRate,
          });

        if (prError) {
          rateError = new Error(prError.message);
        }
      }

      return { job, rateError, mode };
    },
    onSuccess: ({ job, rateError, mode }) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['piece-rates'] });
      queryClient.invalidateQueries({ queryKey: ['all-piece-rates-current'] });

      if (rateError) {
        toast({
          title: 'Job created',
          description: 'Job created, but piecework rate failed — you can add it later.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Job created' });
      }

      if (mode === 'another') {
        form.reset({
          ...DEFAULT_FORM_VALUES,
          category_id: effectiveCategoryId,
          time_unit: form.getValues('time_unit'),
        });
        requestAnimationFrame(() => nameInputRef.current?.focus());
      } else {
        onJobCreated(job);
        onClose();
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create job',
        variant: 'destructive',
      });
      console.error('Error adding job:', error);
    },
  });

  const validateNumeric = (
    fieldName: 'estimated_time' | 'piecework_rate',
    label: string,
    value: string | undefined,
  ): boolean => {
    if (!value || value === '') return true;
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num <= 0) {
      form.setError(fieldName, { message: `${label} must be a number greater than 0` });
      return false;
    }
    return true;
  };

  const handleSubmit = (mode: 'close' | 'another') => {
    form.handleSubmit((values) => {
      const timeOk = validateNumeric('estimated_time', 'Estimated time', values.estimated_time);
      const rateOk = validateNumeric('piecework_rate', 'Piecework rate', values.piecework_rate);
      if (!timeOk || !rateOk) return;
      addJob.mutate({ values, mode });
    })();
  };

  // Handle parent change - reset subcategory
  const handleParentChange = (value: string) => {
    if (value === '__new_category__') {
      setIsNewCategoryOpen(true);
      return;
    }
    setSelectedParentId(value);
    setSelectedSubId('');
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Job</DialogTitle>
          <DialogDescription>
            Add a new job that can be used in bills of labor
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit('close'); }} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              {/* Left column */}
              <div className="space-y-3">
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
                      <SelectSeparator />
                      <SelectItem value="__new_category__" className="text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Plus className="h-3 w-3" />
                          New Category
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Show form-level error for category_id */}
                  {form.formState.errors.category_id && (
                    <p className="text-sm font-medium text-destructive">
                      {form.formState.errors.category_id.message}
                    </p>
                  )}
                </FormItem>

                {/* Subcategory select - show when parent is selected (allows creating first subcategory) */}
                {selectedParentId && (
                  <FormItem>
                    <FormLabel>Subcategory (optional)</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        if (v === '__new_subcategory__') {
                          setIsNewSubcategoryOpen(true);
                          return;
                        }
                        setSelectedSubId(v === '_none' ? '' : v);
                      }}
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
                        {subcategoriesForParent.length > 0 && <SelectSeparator />}
                        <SelectItem value="__new_subcategory__" className="text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Plus className="h-3 w-3" />
                            New Subcategory
                          </span>
                        </SelectItem>
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
                        <Input
                          {...field}
                          ref={(e) => {
                            field.ref(e);
                            (nameInputRef as React.MutableRefObject<HTMLInputElement | null>).current = e;
                          }}
                          autoFocus
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Right column */}
              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="estimated_time"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estimated Time (optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="any"
                          min="0.01"
                          placeholder="0"
                          {...field}
                          value={field.value || ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="time_unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time Unit</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="minutes">Minutes</SelectItem>
                          <SelectItem value="hours">Hours</SelectItem>
                          <SelectItem value="seconds">Seconds</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="piecework_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Piecework Rate (optional)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            placeholder="0.00"
                            className="pl-7 pr-14"
                            {...field}
                            value={field.value || ''}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">/piece</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Full-width description below grid */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
              >
                Cancel
              </Button>
              {showAddAnother && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={addJob.isPending}
                  onClick={() => handleSubmit('another')}
                >
                  {addJob.isPending ? 'Creating...' : 'Create & Add Another'}
                </Button>
              )}
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

    {/* Inline category creation dialogs — outside parent Dialog to avoid nested Radix issues */}
    <InlineCategoryForm
      open={isNewCategoryOpen}
      onOpenChange={setIsNewCategoryOpen}
      onCreated={(cat) => {
        queryClient.setQueryData<JobCategory[]>(['jobCategories'], (old = []) => [...old, cat]);
        requestAnimationFrame(() => {
          setSelectedParentId(cat.category_id.toString());
          setSelectedSubId('');
        });
      }}
    />

    <InlineCategoryForm
      open={isNewSubcategoryOpen}
      onOpenChange={setIsNewSubcategoryOpen}
      parentId={selectedParentId ? parseInt(selectedParentId) : undefined}
      parentName={parentCategories.find((c) => c.category_id.toString() === selectedParentId)?.name}
      defaultRate={parentCategories.find((c) => c.category_id.toString() === selectedParentId)?.current_hourly_rate}
      onCreated={(cat) => {
        queryClient.setQueryData<JobCategory[]>(['jobCategories'], (old = []) => [...old, cat]);
        requestAnimationFrame(() => {
          setSelectedSubId(cat.category_id.toString());
        });
      }}
    />
  </>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit, Calendar, Loader2, ChevronDown, ChevronRight, Search, DollarSign, Briefcase, CornerDownRight } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

// Define types
interface JobCategory {
  category_id: number;
  name: string;
  description: string | null;
  current_hourly_rate: number;
  parent_category_id: number | null;
}

interface JobCategoryRate {
  rate_id: number;
  category_id: number;
  hourly_rate: number;
  effective_date: string;
  end_date: string | null;
}

// Form schema for adding/editing job categories
const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  current_hourly_rate: z.coerce.number().min(0, 'Hourly rate must be a positive number'),
  parent_category_id: z.string().optional(),
});

// Form schema for adding rate versions
const rateSchema = z.object({
  hourly_rate: z.coerce.number().min(0, 'Hourly rate must be a positive number'),
  effective_date: z.date({
    required_error: 'Effective date is required',
  }),
});

type CategoryFormValues = z.infer<typeof categorySchema>;
type RateFormValues = z.infer<typeof rateSchema>;

export function JobCategoriesManager() {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [isAddingRate, setIsAddingRate] = useState<number | null>(null);
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [isEditCategoryOpen, setIsEditCategoryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<string>('name-asc');
  const [deletingCategory, setDeletingCategory] = useState<JobCategory | null>(null);
  const [addingSubForParentId, setAddingSubForParentId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Initialize category form
  const categoryForm = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: '',
      description: '',
      current_hourly_rate: 0,
      parent_category_id: '',
    },
  });

  // Initialize rate form
  const rateForm = useForm<RateFormValues>({
    resolver: zodResolver(rateSchema),
    defaultValues: {
      hourly_rate: 0,
      effective_date: new Date(),
    },
  });

  // Fetch job categories with job counts
  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['jobCategories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_categories')
        .select('*');

      if (error) throw error;
      return data as JobCategory[];
    },
  });

  // Fetch job counts per category
  const { data: jobCounts = {} } = useQuery({
    queryKey: ['jobCountsByCategory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('category_id');

      if (error) throw error;

      const counts: Record<number, number> = {};
      data.forEach((job: { category_id: number | null }) => {
        if (job.category_id != null) {
          counts[job.category_id] = (counts[job.category_id] || 0) + 1;
        }
      });
      return counts;
    },
  });

  // Fetch rates for all categories
  const { data: allCategoryRates = [], isLoading: ratesLoading } = useQuery({
    queryKey: ['jobCategoryRates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_category_rates')
        .select('*')
        .order('effective_date', { ascending: false });

      if (error) throw error;
      return data as JobCategoryRate[];
    },
  });

  // Derived: parent categories and children map
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

  // Filter and sort categories — return hierarchical list
  const filteredHierarchy = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    // Get matching category IDs
    const matchingIds = new Set<number>();
    if (query) {
      for (const cat of categories) {
        if (
          cat.name.toLowerCase().includes(query) ||
          cat.description?.toLowerCase().includes(query)
        ) {
          matchingIds.add(cat.category_id);
          // If subcategory matches, also include its parent for context
          if (cat.parent_category_id !== null) {
            matchingIds.add(cat.parent_category_id);
          }
          // If parent matches, include its children
          if (cat.parent_category_id === null) {
            const children = childrenByParent.get(cat.category_id) || [];
            children.forEach(c => matchingIds.add(c.category_id));
          }
        }
      }
    }

    // Filter parents
    let filteredParents = query
      ? parentCategories.filter(p => matchingIds.has(p.category_id))
      : parentCategories;

    // Sort parents
    const sortFn = (a: JobCategory, b: JobCategory) => {
      switch (sortBy) {
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'rate-asc': return a.current_hourly_rate - b.current_hourly_rate;
        case 'rate-desc': return b.current_hourly_rate - a.current_hourly_rate;
        case 'jobs-desc': return (jobCounts[b.category_id] || 0) - (jobCounts[a.category_id] || 0);
        default: return a.name.localeCompare(b.name);
      }
    };

    filteredParents = [...filteredParents].sort(sortFn);

    // Build hierarchy: parent + filtered children
    const result: { parent: JobCategory; children: JobCategory[] }[] = [];
    for (const parent of filteredParents) {
      let children = childrenByParent.get(parent.category_id) || [];
      if (query) {
        children = children.filter(c => matchingIds.has(c.category_id));
      }
      children = [...children].sort(sortFn);
      result.push({ parent, children });
    }

    // Also include orphan subcategories that match but whose parent doesn't exist
    // (shouldn't happen, but defensive)
    if (query) {
      const includedParentIds = new Set(result.map(r => r.parent.category_id));
      const orphans = categories.filter(
        c => c.parent_category_id !== null && matchingIds.has(c.category_id) && !includedParentIds.has(c.parent_category_id!)
      );
      if (orphans.length > 0) {
        // Render them as top-level for visibility
        for (const orphan of orphans) {
          result.push({ parent: orphan, children: [] });
        }
      }
    }

    return result;
  }, [categories, parentCategories, childrenByParent, searchQuery, sortBy, jobCounts]);

  // Total visible count for empty state
  const filteredCount = useMemo(
    () => filteredHierarchy.reduce((sum, g) => sum + 1 + g.children.length, 0),
    [filteredHierarchy]
  );

  // Calculate stats
  const stats = useMemo(() => {
    if (categories.length === 0) {
      return { parentCount: 0, subcategoryCount: 0, avgRate: 0, totalJobs: 0 };
    }

    const rates = categories.map(c => c.current_hourly_rate);
    const parentCount = parentCategories.length;
    const subcategoryCount = categories.length - parentCount;
    const avgRate = rates.reduce((sum, r) => sum + r, 0) / categories.length;
    const totalJobs = Object.values(jobCounts).reduce((sum: number, c: number) => sum + c, 0);

    return { parentCount, subcategoryCount, avgRate, totalJobs };
  }, [categories, parentCategories, jobCounts]);

  // Get rates for a specific category
  const getRatesForCategory = (categoryId: number) => {
    return allCategoryRates.filter(rate => rate.category_id === categoryId);
  };

  // Toggle category expansion
  const toggleCategory = (categoryId: number) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  // Check if a category has subcategories
  const hasSubcategories = (categoryId: number) => {
    return (childrenByParent.get(categoryId) || []).length > 0;
  };

  // Get subcategory count for a parent
  const getSubcategoryCount = (categoryId: number) => {
    return (childrenByParent.get(categoryId) || []).length;
  };

  // Check if a category is a descendant of another (for edit validation)
  const isDescendantOf = (categoryId: number, potentialAncestorId: number): boolean => {
    const children = childrenByParent.get(potentialAncestorId) || [];
    return children.some(c => c.category_id === categoryId);
  };

  // Pre-fill hourly rate when parent is selected in add form
  const watchParentId = categoryForm.watch('parent_category_id');

  // Add job category mutation
  const addCategory = useMutation({
    mutationFn: async (values: CategoryFormValues) => {
      const { data, error } = await supabase
        .from('job_categories')
        .insert({
          name: values.name,
          description: values.description || null,
          current_hourly_rate: values.current_hourly_rate,
          parent_category_id: values.parent_category_id ? parseInt(values.parent_category_id) : null,
        })
        .select();

      if (error) throw error;

      const categoryId = data[0].category_id;
      const { error: rateError } = await supabase
        .from('job_category_rates')
        .insert({
          category_id: categoryId,
          hourly_rate: values.current_hourly_rate,
          effective_date: new Date().toISOString().split('T')[0],
        });

      if (rateError) throw rateError;

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      queryClient.invalidateQueries({ queryKey: ['jobCategoryRates'] });
      categoryForm.reset();
      setIsAddCategoryOpen(false);
      setAddingSubForParentId(null);
      toast({
        title: 'Success',
        description: 'Job category added',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to add job category',
        variant: 'destructive',
      });
      console.error('Error adding job category:', error);
    },
  });

  // Update job category mutation
  const updateCategory = useMutation({
    mutationFn: async (values: CategoryFormValues & { category_id: number }) => {
      const { data, error } = await supabase
        .from('job_categories')
        .update({
          name: values.name,
          description: values.description || null,
          current_hourly_rate: values.current_hourly_rate,
          parent_category_id: values.parent_category_id ? parseInt(values.parent_category_id) : null,
        })
        .eq('category_id', values.category_id)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      setEditingId(null);
      setIsEditCategoryOpen(false);
      categoryForm.reset({ name: '', description: '', current_hourly_rate: 0, parent_category_id: '' });
      toast({
        title: 'Success',
        description: 'Job category updated',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to update job category',
        variant: 'destructive',
      });
      console.error('Error updating job category:', error);
    },
  });

  // Delete job category mutation
  const deleteCategory = useMutation({
    mutationFn: async (categoryId: number) => {
      const { error: ratesError } = await supabase
        .from('job_category_rates')
        .delete()
        .eq('category_id', categoryId);

      if (ratesError) throw ratesError;

      const { error } = await supabase
        .from('job_categories')
        .delete()
        .eq('category_id', categoryId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      queryClient.invalidateQueries({ queryKey: ['jobCategoryRates'] });
      queryClient.invalidateQueries({ queryKey: ['jobCountsByCategory'] });
      setDeletingCategory(null);
      toast({
        title: 'Success',
        description: 'Job category deleted',
      });
    },
    onError: (error) => {
      setDeletingCategory(null);
      toast({
        title: 'Error',
        description: 'Failed to delete job category. It may have jobs or subcategories assigned to it.',
        variant: 'destructive',
      });
      console.error('Error deleting job category:', error);
    },
  });

  // Add rate version mutation
  const addRateVersion = useMutation({
    mutationFn: async (values: RateFormValues & { categoryId: number }) => {
      const { categoryId, ...rateValues } = values;

      const { data: laterRates, error: checkError } = await supabase
        .from('job_category_rates')
        .select('*')
        .eq('category_id', categoryId)
        .gte('effective_date', rateValues.effective_date.toISOString().split('T')[0])
        .order('effective_date', { ascending: true });

      if (checkError) throw checkError;

      let endDate = null;
      if (laterRates && laterRates.length > 0) {
        endDate = new Date(laterRates[0].effective_date);
        endDate.setDate(endDate.getDate() - 1);
      }

      const { data: earlierRates, error: earlierError } = await supabase
        .from('job_category_rates')
        .select('*')
        .eq('category_id', categoryId)
        .lt('effective_date', rateValues.effective_date.toISOString().split('T')[0])
        .order('effective_date', { ascending: false })
        .limit(1);

      if (earlierError) throw earlierError;

      const { data, error } = await supabase
        .from('job_category_rates')
        .insert({
          category_id: categoryId,
          hourly_rate: rateValues.hourly_rate,
          effective_date: rateValues.effective_date.toISOString().split('T')[0],
          end_date: endDate ? endDate.toISOString().split('T')[0] : null,
        })
        .select();

      if (error) throw error;

      if (earlierRates && earlierRates.length > 0) {
        const prevDate = new Date(rateValues.effective_date);
        prevDate.setDate(prevDate.getDate() - 1);

        const { error: updateError } = await supabase
          .from('job_category_rates')
          .update({
            end_date: prevDate.toISOString().split('T')[0],
          })
          .eq('rate_id', earlierRates[0].rate_id);

        if (updateError) throw updateError;
      }

      const today = new Date().toISOString().split('T')[0];
      const effectiveDate = rateValues.effective_date.toISOString().split('T')[0];

      if (effectiveDate <= today && (!endDate || endDate.toISOString().split('T')[0] >= today)) {
        const { error: updateCategoryError } = await supabase
          .from('job_categories')
          .update({
            current_hourly_rate: rateValues.hourly_rate,
          })
          .eq('category_id', categoryId);

        if (updateCategoryError) throw updateCategoryError;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCategoryRates'] });
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      rateForm.reset();
      setIsAddingRate(null);
      toast({
        title: 'Success',
        description: 'Rate version added',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to add rate version',
        variant: 'destructive',
      });
      console.error('Error adding rate version:', error);
    },
  });

  // Handle category form submission
  const onCategorySubmit = (values: CategoryFormValues) => {
    if (editingId) {
      updateCategory.mutate({
        ...values,
        category_id: editingId,
      });
    } else {
      addCategory.mutate(values);
    }
  };

  // Handle rate form submission
  const onRateSubmit = (categoryId: number) => (values: RateFormValues) => {
    addRateVersion.mutate({ ...values, categoryId });
  };

  // Start editing a category
  const startEditing = (category: JobCategory) => {
    setEditingId(category.category_id);
    categoryForm.reset({
      name: category.name,
      description: category.description || '',
      current_hourly_rate: category.current_hourly_rate,
      parent_category_id: category.parent_category_id?.toString() || '',
    });
    setIsEditCategoryOpen(true);
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    categoryForm.reset();
    setIsEditCategoryOpen(false);
  };

  // Parent category select field used in both add and edit dialogs
  const renderParentCategoryField = (isEdit: boolean) => {
    // For edit: determine if this parent has subcategories (can't become a subcategory itself)
    const editingCategory = isEdit && editingId
      ? categories.find(c => c.category_id === editingId)
      : null;
    const editHasChildren = editingId ? hasSubcategories(editingId) : false;

    return (
      <FormField
        control={categoryForm.control}
        name="parent_category_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Parent Category</FormLabel>
            <Select
              value={field.value || 'none'}
              onValueChange={(val) => {
                const newVal = val === 'none' ? '' : val;
                field.onChange(newVal);
                // Pre-fill hourly rate from parent when adding
                if (!isEdit && newVal) {
                  const parent = parentCategories.find(p => p.category_id === parseInt(newVal));
                  if (parent) {
                    categoryForm.setValue('current_hourly_rate', parent.current_hourly_rate);
                  }
                }
              }}
              disabled={isEdit && editHasChildren}
            >
              <FormControl>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="None (top-level)" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="none">None (top-level)</SelectItem>
                {parentCategories
                  .filter(p => {
                    // Don't allow setting parent to self
                    if (isEdit && editingId && p.category_id === editingId) return false;
                    // Don't allow setting parent to own child
                    if (isEdit && editingId && isDescendantOf(p.category_id, editingId)) return false;
                    return true;
                  })
                  .map(p => (
                    <SelectItem key={p.category_id} value={p.category_id.toString()}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {isEdit && editHasChildren && (
              <p className="text-xs text-muted-foreground">
                Cannot change — this category has subcategories
              </p>
            )}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };

  // Render a single category row
  const renderCategoryRow = (category: JobCategory, isSubcategory: boolean) => {
    const isExpanded = expandedCategories.has(category.category_id);
    const categoryRates = getRatesForCategory(category.category_id);
    const isAddingRateForThis = isAddingRate === category.category_id;
    const jobCount = jobCounts[category.category_id] || 0;
    const subcatCount = getSubcategoryCount(category.category_id);
    const canDelete = !hasSubcategories(category.category_id);

    return (
      <div key={category.category_id} className={cn('p-4', isSubcategory && 'ml-8 border-l-2 border-muted')}>
        {/* Category Header */}
        <div className="flex items-start justify-between gap-4">
          <button
            onClick={() => toggleCategory(category.category_id)}
            className="flex-1 flex items-start gap-3 text-left hover:opacity-70 transition-opacity"
          >
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                {isSubcategory && (
                  <CornerDownRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <h3 className="font-medium">{category.name}</h3>
                <span className="text-sm font-semibold text-primary">
                  R{category.current_hourly_rate.toFixed(2)}/hr
                </span>
                <Badge variant="secondary" className="text-xs">
                  {jobCount} {jobCount === 1 ? 'job' : 'jobs'}
                </Badge>
                {isSubcategory && category.parent_category_id && (
                  <Badge variant="outline" className="text-xs">
                    Subcategory of: {categories.find(c => c.category_id === category.parent_category_id)?.name}
                  </Badge>
                )}
                {!isSubcategory && subcatCount > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {subcatCount} {subcatCount === 1 ? 'subcategory' : 'subcategories'}
                  </Badge>
                )}
              </div>
              {category.description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {category.description}
                </p>
              )}
            </div>
          </button>

          <div className="flex items-center gap-2">
            {!isSubcategory && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setAddingSubForParentId(category.category_id);
                  categoryForm.reset({
                    name: '',
                    description: '',
                    current_hourly_rate: category.current_hourly_rate,
                    parent_category_id: category.category_id.toString(),
                  });
                  setIsAddCategoryOpen(true);
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Subcategory
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => startEditing(category)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="destructiveSoft"
              size="icon"
              className="h-8 w-8"
              disabled={!canDelete}
              onClick={() => canDelete && setDeletingCategory(category)}
              title={!canDelete ? 'Delete subcategories first' : undefined}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Expanded Rate History */}
        {isExpanded && (
          <div className="mt-4 ml-8 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Rate History</h4>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => setIsAddingRate(category.category_id)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Rate
              </Button>
            </div>

            {ratesLoading ? (
              <div className="text-sm text-muted-foreground">Loading rates...</div>
            ) : categoryRates.length === 0 ? (
              <div className="text-sm text-muted-foreground">No rate history</div>
            ) : (
              <div className="space-y-2">
                {categoryRates.map((rate) => (
                  <div
                    key={rate.rate_id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-muted/20"
                  >
                    <div>
                      <div className="font-medium">R{rate.hourly_rate.toFixed(2)}/hr</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(rate.effective_date), 'PPP')}
                        {' → '}
                        {rate.end_date ? format(new Date(rate.end_date), 'PPP') : 'Current'}
                      </div>
                    </div>
                    {!rate.end_date && (
                      <span className="text-xs font-medium text-primary px-2 py-1 rounded-md bg-primary/10">
                        Active
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add Rate Form */}
            {isAddingRateForThis && (
              <Card className="mt-3">
                <CardContent className="p-4">
                  <Form {...rateForm}>
                    <form
                      onSubmit={rateForm.handleSubmit(onRateSubmit(category.category_id))}
                      className="space-y-3"
                    >
                      <FormField
                        control={rateForm.control}
                        name="hourly_rate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm">Hourly Rate (R)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                className="h-9"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={rateForm.control}
                        name="effective_date"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel className="text-sm">Effective Date</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      "h-9 w-full pl-3 text-left font-normal",
                                      !field.value && "text-muted-foreground"
                                    )}
                                  >
                                    {field.value ? (
                                      format(field.value, "PPP")
                                    ) : (
                                      <span>Pick a date</span>
                                    )}
                                    <Calendar className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <CalendarComponent
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  disabled={(date) => date < new Date("1900-01-01")}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="flex justify-end gap-2 pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() => {
                            setIsAddingRate(null);
                            rateForm.reset();
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          className="h-9"
                          disabled={addRateVersion.isPending}
                        >
                          {addRateVersion.isPending ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              Adding...
                            </>
                          ) : (
                            'Add Rate'
                          )}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    );
  };

  // Determine delete dialog content
  const deletingHasSubcategories = deletingCategory ? hasSubcategories(deletingCategory.category_id) : false;

  return (
    <div className="space-y-4">
      {/* Compact Stats Row */}
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Briefcase className="h-4 w-4" />
          <span className="font-medium text-foreground">{stats.parentCount}</span> categories
        </div>
        {stats.subcategoryCount > 0 && (
          <div className="flex items-center gap-1.5">
            <CornerDownRight className="h-4 w-4" />
            <span className="font-medium text-foreground">{stats.subcategoryCount}</span> subcategories
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <DollarSign className="h-4 w-4" />
          Avg <span className="font-medium text-foreground">R{stats.avgRate.toFixed(2)}</span>/hr
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">{stats.totalJobs}</span> total jobs
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Button onClick={() => setIsAddCategoryOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Category
        </Button>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9"
            />
          </div>

          {/* Sort dropdown */}
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name (A-Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z-A)</SelectItem>
              <SelectItem value="rate-desc">Rate (High-Low)</SelectItem>
              <SelectItem value="rate-asc">Rate (Low-High)</SelectItem>
              <SelectItem value="jobs-desc">Most Jobs</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Categories List */}
      <Card>
        <CardContent className="p-0">
          {categoriesLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading categories...
            </div>
          ) : filteredCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Briefcase className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="font-medium">
                {searchQuery ? 'No categories match your search' : 'No job categories yet'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Create your first category to organize jobs and set hourly rates'}
              </p>
              {!searchQuery && (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => setIsAddCategoryOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {filteredHierarchy.map(({ parent, children }) => (
                <div key={parent.category_id}>
                  {renderCategoryRow(parent, false)}
                  {children.map(child => renderCategoryRow(child, true))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation AlertDialog */}
      <AlertDialog open={!!deletingCategory} onOpenChange={(open) => !open && setDeletingCategory(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingHasSubcategories ? (
                <span className="block text-destructive">
                  This category has {getSubcategoryCount(deletingCategory!.category_id)} subcategorie(s). Delete them first before deleting this category.
                </span>
              ) : (
                <>
                  Are you sure you want to delete <span className="font-medium text-foreground">{deletingCategory?.name}</span>?
                  This will also remove all rate history for this category. This action cannot be undone.
                  {(jobCounts[deletingCategory?.category_id ?? 0] || 0) > 0 && (
                    <span className="block mt-2 text-destructive">
                      Warning: This category has {jobCounts[deletingCategory?.category_id ?? 0]} job(s) assigned to it.
                    </span>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!deletingHasSubcategories && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (deletingCategory) {
                    deleteCategory.mutate(deletingCategory.category_id);
                  }
                }}
              >
                {deleteCategory.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Category Dialog */}
      <Dialog open={isAddCategoryOpen} onOpenChange={(open) => {
        if (!open) {
          setIsAddCategoryOpen(false);
          setAddingSubForParentId(null);
          categoryForm.reset();
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {addingSubForParentId
                ? `Add Subcategory`
                : 'Add Job Category'}
            </DialogTitle>
            <DialogDescription>
              {addingSubForParentId
                ? `Adding a subcategory under "${parentCategories.find(p => p.category_id === addingSubForParentId)?.name}"`
                : 'Create a new labor category with an initial hourly rate'}
            </DialogDescription>
          </DialogHeader>
          <Form {...categoryForm}>
            <form onSubmit={categoryForm.handleSubmit(onCategorySubmit)} className="space-y-4">
              {addingSubForParentId ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Parent Category</p>
                  <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-muted/30 text-sm">
                    <span className="flex-1">{parentCategories.find(p => p.category_id === addingSubForParentId)?.name}</span>
                    <Badge variant="secondary" className="text-xs">Locked</Badge>
                  </div>
                </div>
              ) : (
                renderParentCategoryField(false)
              )}

              <FormField
                control={categoryForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-9" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={categoryForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={categoryForm.control}
                name="current_hourly_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Initial Hourly Rate (R)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-9"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setIsAddCategoryOpen(false);
                    setAddingSubForParentId(null);
                    categoryForm.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-9"
                  disabled={addCategory.isPending}
                >
                  {addCategory.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      {addingSubForParentId ? 'Add Subcategory' : 'Add Category'}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog open={isEditCategoryOpen} onOpenChange={(open) => { if (!open) cancelEditing(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Job Category</DialogTitle>
            <DialogDescription>
              Update the category details and current rate
            </DialogDescription>
          </DialogHeader>
          <Form {...categoryForm}>
            <form onSubmit={categoryForm.handleSubmit(onCategorySubmit)} className="space-y-4">
              {renderParentCategoryField(true)}

              <FormField
                control={categoryForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} className="h-9" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={categoryForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={categoryForm.control}
                name="current_hourly_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Hourly Rate (R)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-9"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={cancelEditing}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-9"
                  disabled={updateCategory.isPending}
                >
                  {updateCategory.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update Category'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

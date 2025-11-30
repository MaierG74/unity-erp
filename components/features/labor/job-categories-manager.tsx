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
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Edit, Calendar, Loader2, ChevronDown, ChevronRight, Search, TrendingUp, DollarSign, Briefcase } from 'lucide-react';
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
  const [sortBy, setSortBy] = useState<'name' | 'rate'>('name');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Initialize category form
  const categoryForm = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: '',
      description: '',
      current_hourly_rate: 0,
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
  
  // Fetch job categories
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
  
  // Fetch rates for all categories (we'll filter by expanded ones)
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
  
  // Filter and sort categories
  const filteredAndSortedCategories = useMemo(() => {
    let filtered = categories;
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(cat => 
        cat.name.toLowerCase().includes(query) ||
        cat.description?.toLowerCase().includes(query)
      );
    }
    
    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      } else {
        return b.current_hourly_rate - a.current_hourly_rate;
      }
    });
    
    return sorted;
  }, [categories, searchQuery, sortBy]);
  
  // Calculate stats
  const stats = useMemo(() => {
    if (categories.length === 0) {
      return { total: 0, avgRate: 0, maxRate: 0, minRate: 0 };
    }
    
    const rates = categories.map(c => c.current_hourly_rate);
    const total = categories.length;
    const avgRate = rates.reduce((sum, r) => sum + r, 0) / total;
    const maxRate = Math.max(...rates);
    const minRate = Math.min(...rates);
    
    return { total, avgRate, maxRate, minRate };
  }, [categories]);
  
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
  
  // Add job category mutation
  const addCategory = useMutation({
    mutationFn: async (values: CategoryFormValues) => {
      const { data, error } = await supabase
        .from('job_categories')
        .insert({
          name: values.name,
          description: values.description || null,
          current_hourly_rate: values.current_hourly_rate,
        })
        .select();
        
      if (error) throw error;
      
      // Also create an initial rate entry
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
      categoryForm.reset({ name: '', description: '', current_hourly_rate: 0 });
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
      // First delete all rates for this category
      const { error: ratesError } = await supabase
        .from('job_category_rates')
        .delete()
        .eq('category_id', categoryId);
        
      if (ratesError) throw ratesError;
      
      // Then delete the category
      const { error } = await supabase
        .from('job_categories')
        .delete()
        .eq('category_id', categoryId);
        
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      queryClient.invalidateQueries({ queryKey: ['jobCategoryRates'] });
      toast({
        title: 'Success',
        description: 'Job category deleted',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to delete job category. It may be in use.',
        variant: 'destructive',
      });
      console.error('Error deleting job category:', error);
    },
  });
  
  // Add rate version mutation
  const addRateVersion = useMutation({
    mutationFn: async (values: RateFormValues & { categoryId: number }) => {
      const { categoryId, ...rateValues } = values;
      
      // Check if there are any existing rates with effective dates after the new one
      const { data: laterRates, error: checkError } = await supabase
        .from('job_category_rates')
        .select('*')
        .eq('category_id', categoryId)
        .gte('effective_date', rateValues.effective_date.toISOString().split('T')[0])
        .order('effective_date', { ascending: true });
        
      if (checkError) throw checkError;
      
      // If there are later rates, we need to set the end_date of our new rate
      let endDate = null;
      if (laterRates && laterRates.length > 0) {
        endDate = new Date(laterRates[0].effective_date);
        endDate.setDate(endDate.getDate() - 1);
      }
      
      // Find the most recent rate before our new one to update its end_date
      const { data: earlierRates, error: earlierError } = await supabase
        .from('job_category_rates')
        .select('*')
        .eq('category_id', categoryId)
        .lt('effective_date', rateValues.effective_date.toISOString().split('T')[0])
        .order('effective_date', { ascending: false })
        .limit(1);
        
      if (earlierError) throw earlierError;
      
      // Insert the new rate
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
      
      // Update the end_date of the previous rate
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
      
      // Update the current_hourly_rate if this is the most recent rate
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
    });
    setIsEditCategoryOpen(true);
  };
  
  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    categoryForm.reset();
    setIsEditCategoryOpen(false);
  };
  
  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Total Categories
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Average Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R{stats.avgRate.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">per hour</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Highest Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R{stats.maxRate.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">per hour</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Lowest Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R{stats.minRate.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">per hour</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Button onClick={() => setIsAddCategoryOpen(true)} className="h-9">
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
          
          {/* Sort */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Sort:</span>
            <Button
              variant={sortBy === 'name' ? 'default' : 'outline'}
              size="sm"
              className="h-9"
              onClick={() => setSortBy('name')}
            >
              Name
            </Button>
            <Button
              variant={sortBy === 'rate' ? 'default' : 'outline'}
              size="sm"
              className="h-9"
              onClick={() => setSortBy('rate')}
            >
              Rate
            </Button>
          </div>
        </div>
      </div>

      {/* Categories List */}
      <Card>
        <CardContent className="p-0">
          {categoriesLoading ? (
            <div className="text-center py-8">Loading categories...</div>
          ) : filteredAndSortedCategories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No categories match your search' : 'No job categories defined yet'}
            </div>
          ) : (
            <div className="divide-y">
              {filteredAndSortedCategories.map((category) => {
                const isExpanded = expandedCategories.has(category.category_id);
                const categoryRates = getRatesForCategory(category.category_id);
                const isAddingRateForThis = isAddingRate === category.category_id;
                
                return (
                  <div key={category.category_id} className="p-4">
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
                            <h3 className="font-medium">{category.name}</h3>
                            <span className="text-sm font-semibold text-primary">
                              R{category.current_hourly_rate.toFixed(2)}/hr
                            </span>
                          </div>
                          {category.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {category.description}
                            </p>
                          )}
                        </div>
                      </button>
                      
                      <div className="flex items-center gap-2">
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
                          onClick={() => {
                            if (confirm(`Are you sure you want to delete ${category.name}?`)) {
                              deleteCategory.mutate(category.category_id);
                            }
                          }}
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
              })}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Add Category Dialog */}
      <Dialog open={isAddCategoryOpen} onOpenChange={setIsAddCategoryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Job Category</DialogTitle>
            <DialogDescription>
              Create a new labor category with an initial hourly rate
            </DialogDescription>
          </DialogHeader>
          <Form {...categoryForm}>
            <form onSubmit={categoryForm.handleSubmit(onCategorySubmit)} className="space-y-4">
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
                      Add Category
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Edit Category Dialog */}
      <Dialog open={isEditCategoryOpen} onOpenChange={setIsEditCategoryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Job Category</DialogTitle>
            <DialogDescription>
              Update the category details and current rate
            </DialogDescription>
          </DialogHeader>
          <Form {...categoryForm}>
            <form onSubmit={categoryForm.handleSubmit(onCategorySubmit)} className="space-y-4">
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

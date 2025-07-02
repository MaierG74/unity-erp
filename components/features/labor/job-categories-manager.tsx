'use client';

import { useState } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Edit, Save, X, Calendar } from 'lucide-react';
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
  const [selectedCategory, setSelectedCategory] = useState<JobCategory | null>(null);
  const [isAddingRate, setIsAddingRate] = useState(false);
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
  
  // Fetch rates for selected category
  const { data: categoryRates = [], isLoading: ratesLoading } = useQuery({
    queryKey: ['jobCategoryRates', selectedCategory?.category_id],
    queryFn: async () => {
      if (!selectedCategory) return [];
      
      const { data, error } = await supabase
        .from('job_category_rates')
        .select('*')
        .eq('category_id', selectedCategory.category_id)
        .order('effective_date', { ascending: false });
        
      if (error) throw error;
      return data as JobCategoryRate[];
    },
    enabled: !!selectedCategory,
  });
  
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
      categoryForm.reset();
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
      if (selectedCategory) {
        setSelectedCategory(null);
      }
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
    mutationFn: async (values: RateFormValues) => {
      if (!selectedCategory) throw new Error('No category selected');
      
      // Check if there are any existing rates with effective dates after the new one
      const { data: laterRates, error: checkError } = await supabase
        .from('job_category_rates')
        .select('*')
        .eq('category_id', selectedCategory.category_id)
        .gte('effective_date', values.effective_date.toISOString().split('T')[0])
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
        .eq('category_id', selectedCategory.category_id)
        .lt('effective_date', values.effective_date.toISOString().split('T')[0])
        .order('effective_date', { ascending: false })
        .limit(1);
        
      if (earlierError) throw earlierError;
      
      // Insert the new rate
      const { data, error } = await supabase
        .from('job_category_rates')
        .insert({
          category_id: selectedCategory.category_id,
          hourly_rate: values.hourly_rate,
          effective_date: values.effective_date.toISOString().split('T')[0],
          end_date: endDate ? endDate.toISOString().split('T')[0] : null,
        })
        .select();
        
      if (error) throw error;
      
      // Update the end_date of the previous rate
      if (earlierRates && earlierRates.length > 0) {
        const prevDate = new Date(values.effective_date);
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
      const effectiveDate = values.effective_date.toISOString().split('T')[0];
      
      if (effectiveDate <= today && (!endDate || endDate.toISOString().split('T')[0] >= today)) {
        const { error: updateCategoryError } = await supabase
          .from('job_categories')
          .update({
            current_hourly_rate: values.hourly_rate,
          })
          .eq('category_id', selectedCategory.category_id);
          
        if (updateCategoryError) throw updateCategoryError;
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobCategoryRates', selectedCategory?.category_id] });
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      rateForm.reset();
      setIsAddingRate(false);
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
  const onRateSubmit = (values: RateFormValues) => {
    addRateVersion.mutate(values);
  };
  
  // Start editing a category
  const startEditing = (category: JobCategory) => {
    setEditingId(category.category_id);
    categoryForm.reset({
      name: category.name,
      description: category.description || '',
      current_hourly_rate: category.current_hourly_rate,
    });
  };
  
  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    categoryForm.reset();
  };
  
  // Select a category to view its rates
  const selectCategory = (category: JobCategory) => {
    setSelectedCategory(category);
  };
  
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Job Categories List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Job Categories</CardTitle>
            <CardDescription>
              Manage labor categories and their hourly rates
            </CardDescription>
          </CardHeader>
          <CardContent>
            {categoriesLoading ? (
              <div className="text-center py-4">Loading categories...</div>
            ) : (
              <>
                {/* Categories Table */}
                <div className="rounded-md border mb-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Current Rate</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-4">
                            No job categories defined yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        categories.map((category) => (
                          <TableRow 
                            key={category.category_id}
                            className={cn(
                              "cursor-pointer",
                              selectedCategory?.category_id === category.category_id && "bg-muted"
                            )}
                            onClick={() => selectCategory(category)}
                          >
                            <TableCell>{category.name}</TableCell>
                            <TableCell>{category.description}</TableCell>
                            <TableCell>R{category.current_hourly_rate.toFixed(2)}/hr</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditing(category);
                                  }}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Are you sure you want to delete ${category.name}?`)) {
                                      deleteCategory.mutate(category.category_id);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Add/Edit Category Form */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-md">
                      {editingId ? 'Edit Category' : 'Add Category'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...categoryForm}>
                      <form
                        onSubmit={categoryForm.handleSubmit(onCategorySubmit)}
                        className="space-y-4"
                      >
                        <FormField
                          control={categoryForm.control}
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
                          control={categoryForm.control}
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

                        <FormField
                          control={categoryForm.control}
                          name="current_hourly_rate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Hourly Rate (R)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end space-x-2">
                          {editingId && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={cancelEditing}
                            >
                              Cancel
                            </Button>
                          )}
                          <Button
                            type="submit"
                            disabled={addCategory.isPending || updateCategory.isPending}
                          >
                            {addCategory.isPending || updateCategory.isPending ? (
                              'Saving...'
                            ) : editingId ? (
                              'Update Category'
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Add Category
                              </>
                            )}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </>
            )}
          </CardContent>
        </Card>

        {/* Rate Versions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {selectedCategory ? `Rate History: ${selectedCategory.name}` : 'Rate History'}
            </CardTitle>
            <CardDescription>
              {selectedCategory 
                ? 'View and manage historical rates for this category' 
                : 'Select a category to view its rate history'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedCategory ? (
              <div className="text-center py-4 text-muted-foreground">
                Select a category to view its rate history
              </div>
            ) : ratesLoading ? (
              <div className="text-center py-4">Loading rates...</div>
            ) : (
              <>
                {/* Rates Table */}
                <div className="rounded-md border mb-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hourly Rate</TableHead>
                        <TableHead>Effective From</TableHead>
                        <TableHead>Effective To</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryRates.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-4">
                            No rate history for this category
                          </TableCell>
                        </TableRow>
                      ) : (
                        categoryRates.map((rate) => (
                          <TableRow key={rate.rate_id}>
                            <TableCell>R{rate.hourly_rate.toFixed(2)}/hr</TableCell>
                            <TableCell>{format(new Date(rate.effective_date), 'PPP')}</TableCell>
                            <TableCell>
                              {rate.end_date 
                                ? format(new Date(rate.end_date), 'PPP')
                                : 'Current'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Add Rate Version Button */}
                {!isAddingRate ? (
                  <Button
                    onClick={() => setIsAddingRate(true)}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add New Rate Version
                  </Button>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-md">Add Rate Version</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Form {...rateForm}>
                        <form
                          onSubmit={rateForm.handleSubmit(onRateSubmit)}
                          className="space-y-4"
                        >
                          <FormField
                            control={rateForm.control}
                            name="hourly_rate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Hourly Rate (R)</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
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
                                <FormLabel>Effective Date</FormLabel>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <FormControl>
                                      <Button
                                        variant={"outline"}
                                        className={cn(
                                          "w-full pl-3 text-left font-normal",
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
                                      disabled={(date) =>
                                        date < new Date("1900-01-01")
                                      }
                                      initialFocus
                                    />
                                  </PopoverContent>
                                </Popover>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <div className="flex justify-end space-x-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setIsAddingRate(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              disabled={addRateVersion.isPending}
                            >
                              {addRateVersion.isPending ? (
                                'Adding...'
                              ) : (
                                'Add Rate Version'
                              )}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 
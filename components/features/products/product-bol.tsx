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
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Edit, Save, X, Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { CreateJobModal } from '@/components/features/labor/create-job-modal';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from '@/lib/utils';
import { debounce } from 'lodash';

// Define types
interface JobCategory {
  category_id: number;
  name: string;
  description: string | null;
  current_hourly_rate: number;
}

interface Job {
  job_id: number;
  name: string;
  description: string | null;
  category_id: number;
  category: JobCategory;
}

interface JobCategoryRate {
  rate_id: number;
  category_id: number;
  hourly_rate: number;
  effective_date: string;
  end_date: string | null;
}

// Our normalized BOL item type for use in the component
interface BOLItem {
  bol_id: number;
  product_id: number;
  job_id: number;
  time_required: number;
  time_unit: 'hours' | 'minutes' | 'seconds';
  quantity: number;
  rate_id: number | null;
  job: Job;
  rate: JobCategoryRate | null;
}

// Form schema for adding/editing BOL items
const bolItemSchema = z.object({
  job_category_id: z.string().min(1, 'Job category is required'),
  job_id: z.string().min(1, 'Job is required'),
  time_required: z.coerce.number().min(0.01, 'Time must be greater than 0'),
  time_unit: z.enum(['hours', 'minutes', 'seconds']),
  quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
});

type BOLItemFormValues = z.infer<typeof bolItemSchema>;

interface ProductBOLProps {
  productId: number;
}

export function ProductBOL({ productId }: ProductBOLProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [isCreateJobModalOpen, setIsCreateJobModalOpen] = useState(false);
  const [jobSearchTerm, setJobSearchTerm] = useState('');
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Initialize form with proper defaults
  const form = useForm<BOLItemFormValues>({
    resolver: zodResolver(bolItemSchema),
    defaultValues: {
      job_category_id: '',
      job_id: '',
      time_required: 1.0,
      time_unit: 'minutes',
      quantity: 1,
    },
  });
  
  // Fetch BOL items for this product
  const { data: bolItems = [], isLoading: bolLoading } = useQuery({
    queryKey: ['productBOL', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billoflabour')
        .select(`
          bol_id,
          product_id,
          job_id,
          time_required,
          time_unit,
          quantity,
          rate_id,
          jobs (
            job_id,
            name,
            description,
            category_id,
            job_categories (
              category_id,
              name,
              description,
              current_hourly_rate
            )
          ),
          job_category_rates (
            rate_id,
            category_id,
            hourly_rate,
            effective_date,
            end_date
          )
        `)
        .eq('product_id', productId);
        
      if (error) throw error;
      
      // Transform the response to match our BOLItem interface
      return (data || []).map((item: any) => ({
        bol_id: item.bol_id,
        product_id: item.product_id,
        job_id: item.job_id,
        time_required: item.time_required,
        time_unit: item.time_unit,
        quantity: item.quantity,
        rate_id: item.rate_id,
        job: {
          ...item.jobs,
          category: item.jobs.job_categories
        },
        rate: item.job_category_rates
      })) as BOLItem[];
    },
  });
  
  // Fetch job categories
  const { data: jobCategories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['jobCategories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_categories')
        .select('*');
        
      if (error) throw error;
      return data as JobCategory[];
    },
  });
  
  // Fetch jobs (filtered by selected category if applicable)
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs', selectedCategoryId, jobSearchTerm],
    queryFn: async () => {
      let query = supabase
        .from('jobs')
        .select(`
          job_id,
          name,
          description,
          category_id,
          job_categories (
            category_id,
            name,
            description,
            current_hourly_rate
          )
        `);
        
      if (selectedCategoryId) {
        query = query.eq('category_id', selectedCategoryId);
      }
      
      if (jobSearchTerm) {
        query = query.ilike('name', `%${jobSearchTerm}%`);
      }
      
      const { data, error } = await query.order('name');
      
      if (error) throw error;
      
      return (data || []).map((job: any) => ({
        ...job,
        category: job.job_categories
      })) as Job[];
    },
    enabled: !categoriesLoading, // Only run this query after categories are loaded
  });
  
  // Debounced job search handler
  const debouncedJobSearch = debounce((value: string) => {
    setJobSearchTerm(value);
  }, 300);
  
  // Handle create job button click
  const handleCreateJobClick = () => {
    setIsCreateJobModalOpen(true);
  };
  
  // Handle job created from modal
  const handleJobCreated = (createdJob: any) => {
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    // Set the form values to use the newly created job
    form.setValue('job_category_id', createdJob.category_id.toString());
    form.setValue('job_id', createdJob.job_id.toString());
    setSelectedCategoryId(createdJob.category_id);
  };
  
  // Add BOL item mutation
  const addBOLItem = useMutation({
    mutationFn: async (values: BOLItemFormValues) => {
      // Find the current rate for the selected job category
      const categoryId = parseInt(values.job_category_id);
      const today = new Date().toISOString().split('T')[0];
      
      const { data: rates, error: ratesError } = await supabase
        .from('job_category_rates')
        .select('*')
        .eq('category_id', categoryId)
        .lte('effective_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order('effective_date', { ascending: false })
        .limit(1);
        
      if (ratesError) throw ratesError;
      
      const rateId = rates && rates.length > 0 ? rates[0].rate_id : null;
      
      const { data, error } = await supabase
        .from('billoflabour')
        .insert({
          product_id: productId,
          job_id: parseInt(values.job_id),
          time_required: values.time_required,
          time_unit: values.time_unit,
          quantity: values.quantity,
          rate_id: rateId,
        })
        .select();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOL', productId] });
      form.reset({
        job_category_id: '',
        job_id: '',
        time_required: 1.0,
        time_unit: 'minutes',
        quantity: 1,
      });
      setSelectedCategoryId(null);
      toast({
        title: 'Success',
        description: 'Job added to BOL',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to add job to BOL',
        variant: 'destructive',
      });
      console.error('Error adding BOL item:', error);
    },
  });
  
  // Update BOL item mutation
  const updateBOLItem = useMutation({
    mutationFn: async (values: BOLItemFormValues & { bol_id: number }) => {
      // Find the current rate for the selected job category
      const categoryId = parseInt(values.job_category_id);
      const today = new Date().toISOString().split('T')[0];
      
      const { data: rates, error: ratesError } = await supabase
        .from('job_category_rates')
        .select('*')
        .eq('category_id', categoryId)
        .lte('effective_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order('effective_date', { ascending: false })
        .limit(1);
        
      if (ratesError) throw ratesError;
      
      const rateId = rates && rates.length > 0 ? rates[0].rate_id : null;
      
      const { data, error } = await supabase
        .from('billoflabour')
        .update({
          job_id: parseInt(values.job_id),
          time_required: values.time_required,
          time_unit: values.time_unit,
          quantity: values.quantity,
          rate_id: rateId,
        })
        .eq('bol_id', values.bol_id)
        .select();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOL', productId] });
      setEditingId(null);
      setSelectedCategoryId(null);
      toast({
        title: 'Success',
        description: 'BOL item updated',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to update BOL item',
        variant: 'destructive',
      });
      console.error('Error updating BOL item:', error);
    },
  });
  
  // Delete BOL item mutation
  const deleteBOLItem = useMutation({
    mutationFn: async (bolId: number) => {
      const { error } = await supabase
        .from('billoflabour')
        .delete()
        .eq('bol_id', bolId);
        
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOL', productId] });
      toast({
        title: 'Success',
        description: 'Job removed from BOL',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to remove job from BOL',
        variant: 'destructive',
      });
      console.error('Error deleting BOL item:', error);
    },
  });
  
  // Handle form submission for adding new BOL item
  const onSubmit = (values: BOLItemFormValues) => {
    addBOLItem.mutate(values);
  };
  
  // Start editing a BOL item
  const startEditing = (item: BOLItem) => {
    setEditingId(item.bol_id);
    setSelectedCategoryId(item.job.category_id);
    
    form.setValue('job_category_id', item.job.category_id.toString());
    form.setValue('job_id', item.job_id.toString());
    form.setValue('time_required', item.time_required);
    form.setValue('time_unit', item.time_unit);
    form.setValue('quantity', item.quantity);
  };
  
  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    setSelectedCategoryId(null);
    form.reset();
  };
  
  // Save edited BOL item
  const saveEdit = (bolId: number) => {
    const values = form.getValues();
    updateBOLItem.mutate({
      ...values,
      bol_id: bolId,
    });
  };
  
  // Convert time to hours based on the unit
  const convertToHours = (time: number, unit: string): number => {
    switch (unit) {
      case 'hours':
        return time;
      case 'minutes':
        return time / 60;
      case 'seconds':
        return time / 3600;
      default:
        return time;
    }
  };
  
  // Calculate cost for a BOL item
  const calculateCost = (item: BOLItem): number => {
    const hourlyRate = item.rate?.hourly_rate || item.job.category.current_hourly_rate || 0;
    const timeInHours = convertToHours(item.time_required, item.time_unit);
    return hourlyRate * timeInHours * item.quantity;
  };
  
  // Calculate total hours for all BOL items
  const calculateTotalHours = (): number => {
    return bolItems.reduce((total, item) => {
      return total + (convertToHours(item.time_required, item.time_unit) * item.quantity);
    }, 0);
  };
  
  // Calculate total cost for all BOL items
  const calculateTotalCost = (): number => {
    return bolItems.reduce((total, item) => {
      return total + calculateCost(item);
    }, 0);
  };
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bill of Labor</CardTitle>
          <CardDescription>
            Manage the labor operations required to manufacture this product
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bolLoading ? (
            <div className="text-center py-4">Loading BOL data...</div>
          ) : (
            <>
              {/* BOL Items Table */}
              <div className="rounded-md border mb-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Time Required</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Hourly Rate</TableHead>
                      <TableHead>Total Time (hrs)</TableHead>
                      <TableHead>Total Cost</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bolItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-4">
                          No jobs added to this product yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      bolItems.map((item) => (
                        <TableRow key={item.bol_id}>
                          {editingId === item.bol_id ? (
                            <>
                              <TableCell>
                                <Select
                                  value={form.watch('job_category_id')}
                                  onValueChange={(value) => {
                                    form.setValue('job_category_id', value);
                                    form.setValue('job_id', '');
                                    setSelectedCategoryId(value ? parseInt(value) : null);
                                  }}
                                >
                                  <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Select category" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {jobCategories.map((category) => (
                                      <SelectItem
                                        key={category.category_id}
                                        value={category.category_id.toString()}
                                      >
                                        {category.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={form.watch('job_id')}
                                  onValueChange={(value) => {
                                    console.log('Editing job selected:', value);
                                    form.setValue('job_id', value);
                                    
                                    // Auto-select job category if needed
                                    if (!form.watch('job_category_id')) {
                                      const selectedJob = jobs.find(j => j.job_id.toString() === value);
                                      if (selectedJob) {
                                        form.setValue('job_category_id', selectedJob.category_id.toString());
                                        setSelectedCategoryId(selectedJob.category_id);
                                      }
                                    }
                                  }}
                                  disabled={!form.watch('job_category_id')}
                                >
                                  <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Select job" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {jobs
                                      .filter(job => 
                                        !selectedCategoryId || 
                                        job.category_id === selectedCategoryId
                                      )
                                      .map((job) => (
                                        <SelectItem
                                          key={job.job_id}
                                          value={job.job_id.toString()}
                                        >
                                          {job.name}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  <Input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={form.watch('time_required')}
                                    onChange={(e) =>
                                      form.setValue('time_required', parseFloat(e.target.value))
                                    }
                                    className="w-20"
                                  />
                                  <Select
                                    value={form.watch('time_unit')}
                                    onValueChange={(value: 'hours' | 'minutes' | 'seconds') => 
                                      form.setValue('time_unit', value)
                                    }
                                  >
                                    <SelectTrigger className="w-[100px]">
                                      <SelectValue placeholder="Select unit" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="hours">Hours</SelectItem>
                                      <SelectItem value="minutes">Minutes</SelectItem>
                                      <SelectItem value="seconds">Seconds</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={form.watch('quantity')}
                                  onChange={(e) =>
                                    form.setValue('quantity', parseInt(e.target.value))
                                  }
                                  className="w-20"
                                />
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  const categoryId = form.watch('job_category_id');
                                  const category = jobCategories.find(
                                    c => c.category_id.toString() === categoryId
                                  );
                                  return category ? `R${category.current_hourly_rate.toFixed(2)}/hr` : 'N/A';
                                })()}
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  const time = form.watch('time_required') || 0;
                                  const unit = form.watch('time_unit') || 'hours';
                                  const quantity = form.watch('quantity') || 1;
                                  return (convertToHours(time, unit) * quantity).toFixed(2);
                                })()}
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  const categoryId = form.watch('job_category_id');
                                  const category = jobCategories.find(
                                    c => c.category_id.toString() === categoryId
                                  );
                                  const hourlyRate = category?.current_hourly_rate || 0;
                                  const time = form.watch('time_required') || 0;
                                  const unit = form.watch('time_unit') || 'hours';
                                  const quantity = form.watch('quantity') || 1;
                                  return `R${(hourlyRate * convertToHours(time, unit) * quantity).toFixed(2)}`;
                                })()}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => saveEdit(item.bol_id)}
                                  >
                                    <Save className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={cancelEditing}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell>{item.job.category.name}</TableCell>
                              <TableCell>{item.job.name}</TableCell>
                              <TableCell>
                                {item.time_required} {item.time_unit}
                              </TableCell>
                              <TableCell>{item.quantity}</TableCell>
                              <TableCell>
                                R{(item.rate?.hourly_rate || item.job.category.current_hourly_rate).toFixed(2)}/hr
                              </TableCell>
                              <TableCell>
                                {(convertToHours(item.time_required, item.time_unit) * item.quantity).toFixed(2)}
                              </TableCell>
                              <TableCell>
                                R{calculateCost(item).toFixed(2)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => startEditing(item)}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => deleteBOLItem.mutate(item.bol_id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))
                    )}
                    {bolItems.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-right font-medium">
                          Total:
                        </TableCell>
                        <TableCell className="font-medium">
                          {calculateTotalHours().toFixed(2)} hrs
                        </TableCell>
                        <TableCell className="font-medium">
                          R{calculateTotalCost().toFixed(2)}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Add New BOL Item Form */}
              {editingId === null && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-md">Add Job</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...form}>
                      <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Job Category Selection */}
                          <FormField
                            control={form.control}
                            name="job_category_id"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Job Category</FormLabel>
                                <Select
                                  onValueChange={(value) => {
                                    field.onChange(value);
                                    
                                    // Only reset job selection if category changes to a different value
                                    if (value !== field.value) {
                                      form.setValue('job_id', '');
                                      setSelectedCategoryId(value ? parseInt(value) : null);
                                    }
                                  }}
                                  value={field.value}
                                  disabled={categoriesLoading}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {jobCategories.map((category) => (
                                      <SelectItem
                                        key={category.category_id}
                                        value={category.category_id.toString()}
                                      >
                                        {category.name} - R{category.current_hourly_rate.toFixed(2)}/hr
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {/* Job Selection with Command Menu for search */}
                          <FormField
                            control={form.control}
                            name="job_id"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Job</FormLabel>
                                <Select
                                  onValueChange={(value) => {
                                    console.log('Job selected directly:', value);
                                    field.onChange(value);
                                    
                                    // Auto-select job category if not already selected
                                    if (!form.watch('job_category_id')) {
                                      const selectedJob = jobs.find(j => j.job_id.toString() === value);
                                      if (selectedJob) {
                                        console.log('Auto-selecting category:', selectedJob.category_id);
                                        form.setValue('job_category_id', selectedJob.category_id.toString());
                                        setSelectedCategoryId(selectedJob.category_id);
                                      }
                                    }
                                  }}
                                  value={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select job" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {jobs.length === 0 && (
                                      <div className="text-center py-2 text-sm text-muted-foreground">
                                        No jobs available
                                        <Button
                                          variant="link"
                                          className="mx-auto block mt-1"
                                          onClick={() => {
                                            setIsCreateJobModalOpen(true);
                                          }}
                                        >
                                          + Create new job
                                        </Button>
                                      </div>
                                    )}
                                    
                                    {selectedCategoryId ? (
                                      <div className="px-2 py-1 text-xs text-muted-foreground">
                                        Filtered by category
                                      </div>
                                    ) : null}
                                    
                                    {jobs
                                      .filter(job => !selectedCategoryId || job.category_id === selectedCategoryId)
                                      .map((job) => (
                                        <SelectItem
                                          key={job.job_id}
                                          value={job.job_id.toString()}
                                        >
                                          {job.name}
                                          {!selectedCategoryId && (
                                            <span className="ml-2 text-xs text-muted-foreground">
                                              ({jobCategories.find(cat => cat.category_id === job.category_id)?.name})
                                            </span>
                                          )}
                                        </SelectItem>
                                      ))}
                                    
                                    <div className="p-2 border-t">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          setIsCreateJobModalOpen(true);
                                        }}
                                      >
                                        <Plus className="h-4 w-4 mr-2" />
                                        Create new job
                                      </Button>
                                    </div>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {/* Time Required */}
                          <FormField
                            control={form.control}
                            name="time_required"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Time Required</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {/* Time Unit */}
                          <FormField
                            control={form.control}
                            name="time_unit"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Time Unit</FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  value={field.value || "minutes"}
                                  defaultValue="minutes"
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select unit">
                                        {field.value === 'hours' ? 'Hours' : 
                                         field.value === 'minutes' ? 'Minutes' : 
                                         field.value === 'seconds' ? 'Seconds' : 'Minutes'}
                                      </SelectValue>
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="hours">Hours</SelectItem>
                                    <SelectItem value="minutes">Minutes</SelectItem>
                                    <SelectItem value="seconds">Seconds</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {/* Quantity */}
                          <FormField
                            control={form.control}
                            name="quantity"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Quantity</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="1"
                                    step="1"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="flex justify-end">
                          <Button
                            type="submit"
                            disabled={addBOLItem.isPending}
                          >
                            {addBOLItem.isPending ? (
                              'Adding...'
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Add Job
                              </>
                            )}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}
              
              {/* Create Job Modal */}
              <CreateJobModal
                isOpen={isCreateJobModalOpen}
                onClose={() => setIsCreateJobModalOpen(false)}
                onJobCreated={handleJobCreated}
                initialCategoryId={selectedCategoryId || undefined}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 
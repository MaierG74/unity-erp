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
import { Plus, Trash2, Edit, Save, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

// Define types
interface Job {
  job_id: number;
  name: string;
  description: string | null;
  cost_per_unit_time: number | null;
}

// Our normalized BOL item type for use in the component
interface BOLItem {
  bol_id: number;
  product_id: number;
  job_id: number;
  time_required: number;
  job: Job;
}

// Form schema for adding/editing BOL items
const bolItemSchema = z.object({
  job_id: z.string().min(1, 'Job is required'),
  time_required: z.coerce.number().min(0.01, 'Time must be greater than 0'),
});

type BOLItemFormValues = z.infer<typeof bolItemSchema>;

interface ProductBOLProps {
  productId: number;
}

export function ProductBOL({ productId }: ProductBOLProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Initialize form
  const form = useForm<BOLItemFormValues>({
    resolver: zodResolver(bolItemSchema),
    defaultValues: {
      job_id: '',
      time_required: 1.0,
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
          jobs (
            job_id,
            name,
            description,
            cost_per_unit_time
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
        job: item.jobs
      })) as BOLItem[];
    },
  });
  
  // Fetch all jobs for the dropdown
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('job_id, name, description, cost_per_unit_time');
        
      if (error) throw error;
      return data as Job[];
    },
  });
  
  // Add BOL item mutation
  const addBOLItem = useMutation({
    mutationFn: async (values: BOLItemFormValues) => {
      const { data, error } = await supabase
        .from('billoflabour')
        .insert({
          product_id: productId,
          job_id: parseInt(values.job_id),
          time_required: values.time_required,
        })
        .select();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOL', productId] });
      form.reset();
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
      const { data, error } = await supabase
        .from('billoflabour')
        .update({
          job_id: parseInt(values.job_id),
          time_required: values.time_required,
        })
        .eq('bol_id', values.bol_id)
        .select();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productBOL', productId] });
      setEditingId(null);
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
    form.setValue('job_id', item.job_id.toString());
    form.setValue('time_required', item.time_required);
  };
  
  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
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
  
  // Calculate total labor cost
  const calculateTotalCost = () => {
    return bolItems.reduce((total, item) => {
      const costPerUnit = item.job.cost_per_unit_time || 0;
      return total + (costPerUnit * item.time_required);
    }, 0).toFixed(2);
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
                      <TableHead>Job</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Time Required (hrs)</TableHead>
                      <TableHead>Cost Per Hour</TableHead>
                      <TableHead>Total Cost</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bolItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-4">
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
                                  value={form.watch('job_id')}
                                  onValueChange={(value) => form.setValue('job_id', value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select job" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {jobs.map((job) => (
                                      <SelectItem
                                        key={job.job_id}
                                        value={job.job_id.toString()}
                                      >
                                        {job.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {form.formState.errors.job_id && (
                                  <p className="text-sm text-destructive mt-1">
                                    {form.formState.errors.job_id.message}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                {/* Description will be shown based on selected job */}
                                {jobs.find(
                                  (j) => j.job_id.toString() === form.watch('job_id')
                                )?.description || ''}
                              </TableCell>
                              <TableCell>
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
                                {form.formState.errors.time_required && (
                                  <p className="text-sm text-destructive mt-1">
                                    {form.formState.errors.time_required.message}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell>
                                {jobs.find(
                                  (j) => j.job_id.toString() === form.watch('job_id')
                                )?.cost_per_unit_time?.toFixed(2) || 'N/A'}
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  const job = jobs.find(
                                    (j) => j.job_id.toString() === form.watch('job_id')
                                  );
                                  const cost = job?.cost_per_unit_time || 0;
                                  const time = form.watch('time_required') || 0;
                                  return (cost * time).toFixed(2);
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
                              <TableCell>{item.job.name}</TableCell>
                              <TableCell>{item.job.description}</TableCell>
                              <TableCell>{item.time_required.toFixed(2)}</TableCell>
                              <TableCell>
                                {item.job.cost_per_unit_time?.toFixed(2) || 'N/A'}
                              </TableCell>
                              <TableCell>
                                {((item.job.cost_per_unit_time || 0) * item.time_required).toFixed(2)}
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
                        <TableCell colSpan={4} className="text-right font-medium">
                          Total Labor Cost:
                        </TableCell>
                        <TableCell className="font-medium">
                          ${calculateTotalCost()}
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
                          <FormField
                            control={form.control}
                            name="job_id"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Job</FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  value={field.value}
                                  disabled={jobsLoading}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select job" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {jobs.map((job) => (
                                      <SelectItem
                                        key={job.job_id}
                                        value={job.job_id.toString()}
                                      >
                                        {job.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="time_required"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Time Required (hours)</FormLabel>
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 
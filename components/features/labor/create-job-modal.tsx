'use client';

import { useState } from 'react';
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
  
  // Initialize form
  const form = useForm<JobFormValues>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      name: '',
      description: '',
      category_id: initialCategoryId ? String(initialCategoryId) : '',
    },
  });
  
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
            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={categoriesLoading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map((category) => (
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
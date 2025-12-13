'use client';

import { useState, useEffect } from 'react';
import React from 'react';
import { useRouter } from 'next/navigation';
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
  CardFooter,
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Edit, Loader2, ChevronDown, ChevronRight, Search, Briefcase, TrendingUp, DollarSign, Filter } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/use-debounce';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Define types
interface JobCategory {
  category_id: number;
  name: string;
  description: string | null;
  current_hourly_rate: number;
}

interface LaborRole {
  role_id: number;
  name: string;
  color: string | null;
}

interface Job {
  job_id: number;
  name: string;
  description: string | null;
  category_id: number;
  role_id: number | null;
  category?: JobCategory;
  labor_roles?: LaborRole | null;
}

// Form schema for adding/editing jobs
const jobSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  category_id: z.string().min(1, 'Category is required'),
});

type JobFormValues = z.infer<typeof jobSchema>;

export function JobsManager() {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set());
  const [isAddJobOpen, setIsAddJobOpen] = useState(false);
  const [isEditJobOpen, setIsEditJobOpen] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Initialize form
  const form = useForm<JobFormValues>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      name: '',
      description: '',
      category_id: '',
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
  
  // Fetch all jobs (no pagination)
  const { data: allJobs = [], isLoading: jobsLoading, error: jobsError } = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => {
      // Try full query with role_id first, fall back if column doesn't exist
      let { data, error } = await supabase
        .from('jobs')
        .select(`
          job_id,
          name,
          description,
          category_id,
          role_id,
          job_categories (
            category_id,
            name,
            description,
            current_hourly_rate
          ),
          labor_roles (
            role_id,
            name,
            color
          )
        `)
        .order('name');

      // If role_id column doesn't exist, use basic query
      if (error && error.message?.includes('role_id')) {
        console.warn('[JobsManager] role_id column not found, using basic query');
        const { data: basicData, error: basicError } = await supabase
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
          `)
          .order('name');

        if (basicError) {
          console.error('[JobsManager] Error fetching jobs:', basicError);
          throw basicError;
        }
        data = basicData;
        error = null;
      } else if (error) {
        console.error('[JobsManager] Error fetching jobs:', error);
        throw error;
      }

      console.log('[JobsManager] Loaded jobs:', data);
      return (data || []).map((job: any) => ({
        ...job,
        category: job.job_categories,
        labor_roles: job.labor_roles
      })) as Job[];
    },
  });
  
  // Filter and search jobs client-side
  const filteredJobs = React.useMemo(() => {
    let filtered = allJobs;
    
    // Apply category filter
    if (categoryFilter) {
      filtered = filtered.filter(job => job.category_id.toString() === categoryFilter);
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(job => 
        job.name.toLowerCase().includes(query) ||
        job.description?.toLowerCase().includes(query) ||
        job.category?.name.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [allJobs, categoryFilter, searchQuery]);
  
  // Calculate stats
  const stats = React.useMemo(() => {
    if (allJobs.length === 0) {
      return { total: 0, avgRate: 0, categoriesUsed: 0 };
    }
    
    const rates = allJobs.map(j => j.category?.current_hourly_rate || 0).filter(r => r > 0);
    const avgRate = rates.length > 0 ? rates.reduce((sum, r) => sum + r, 0) / rates.length : 0;
    const uniqueCategories = new Set(allJobs.map(j => j.category_id)).size;
    
    return {
      total: allJobs.length,
      avgRate,
      categoriesUsed: uniqueCategories
    };
  }, [allJobs]);
  
  // Toggle job expansion
  const toggleJob = (jobId: number) => {
    const newExpanded = new Set(expandedJobs);
    if (newExpanded.has(jobId)) {
      newExpanded.delete(jobId);
    } else {
      newExpanded.add(jobId);
    }
    setExpandedJobs(newExpanded);
  };
  
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
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      form.reset();
      setIsAddJobOpen(false);
      toast({
        title: 'Success',
        description: 'Job added successfully',
      });
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
  
  // Update job mutation
  const updateJob = useMutation({
    mutationFn: async (values: JobFormValues & { job_id: number }) => {
      const { data, error } = await supabase
        .from('jobs')
        .update({
          name: values.name,
          description: values.description || null,
          category_id: parseInt(values.category_id),
        })
        .eq('job_id', values.job_id)
        .select();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setEditingId(null);
      setIsEditJobOpen(false);
      toast({
        title: 'Success',
        description: 'Job updated successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to update job',
        variant: 'destructive',
      });
      console.error('Error updating job:', error);
    },
  });
  
  // Delete job mutation
  const deleteJob = useMutation({
    mutationFn: async (jobId: number) => {
      const { error } = await supabase
        .from('jobs')
        .delete()
        .eq('job_id', jobId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: 'Success', description: 'Job deleted successfully' });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: 'Failed to delete job. It may be in use.',
        variant: 'destructive',
      });
      console.error('Error deleting job:', error);
    },
  });
  
  // Handle form submission
  const onSubmit = (values: JobFormValues) => {
    if (editingId) {
      updateJob.mutate({
        ...values,
        job_id: editingId,
      });
    } else {
      addJob.mutate(values);
    }
  };
  
  // Start editing a job
  const startEditing = (job: Job) => {
    setEditingId(job.job_id);
    form.reset({
      name: job.name,
      description: job.description || '',
      category_id: job.category_id.toString(),
    });
    setIsEditJobOpen(true);
  };
  
  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    form.reset();
    setIsEditJobOpen(false);
  };
  
  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Total Jobs
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
              <Filter className="h-4 w-4" />
              Categories Used
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.categoriesUsed}</div>
            <p className="text-xs text-muted-foreground mt-1">of {categories.length} total</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Button onClick={() => setIsAddJobOpen(true)} className="h-9">
          <Plus className="h-4 w-4 mr-2" />
          Add Job
        </Button>
        
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search jobs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          
          {/* Category Filter */}
          <Select
            value={categoryFilter || '_all'}
            onValueChange={(value) => setCategoryFilter(value === '_all' ? '' : value)}
          >
            <SelectTrigger className="h-9 w-full md:w-48">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem
                  key={category.category_id}
                  value={category.category_id.toString()}
                >
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Jobs List */}
      <Card>
        <CardContent className="p-0">
          {jobsError && (
            <div className="text-center py-8 text-red-600">
              <p className="font-medium">Error loading jobs</p>
              <p className="text-sm">{jobsError?.message || 'Unknown error'}</p>
            </div>
          )}
          {!jobsError && (jobsLoading || categoriesLoading) ? (
            <div className="text-center py-8">Loading jobs...</div>
          ) : !jobsError && filteredJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery || categoryFilter ? 'No jobs match your filters' : 'No jobs defined yet'}
            </div>
          ) : !jobsError && (
            <div className="divide-y">
              {filteredJobs.map((job) => {
                const isExpanded = expandedJobs.has(job.job_id);
                
                return (
                  <div
                    key={job.job_id}
                    className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/labor/jobs/${job.job_id}`)}
                  >
                    {/* Job Header */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 flex items-start gap-3">
                        <ChevronRight className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium">{job.name}</h3>
                            <Badge variant="outline">{job.category?.name || 'Uncategorized'}</Badge>
                            {job.labor_roles && (
                              <Badge
                                style={{ backgroundColor: job.labor_roles.color || undefined }}
                                className="text-white text-xs"
                              >
                                {job.labor_roles.name}
                              </Badge>
                            )}
                            <span className="text-sm font-semibold text-primary">
                              {job.category ? `R${job.category.current_hourly_rate.toFixed(2)}/hr` : 'N/A'}
                            </span>
                          </div>
                          {job.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                              {job.description}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEditing(job)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructiveSoft"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            if (confirm(`Are you sure you want to delete ${job.name}?`)) {
                              deleteJob.mutate(job.job_id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Add Job Dialog */}
      <Dialog open={isAddJobOpen} onOpenChange={setIsAddJobOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Job</DialogTitle>
            <DialogDescription>
              Create a new job and assign it to a category
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
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
                control={form.control}
                name="category_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-9">
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
              
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setIsAddJobOpen(false);
                    form.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-9"
                  disabled={addJob.isPending}
                >
                  {addJob.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Job
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      {/* Edit Job Dialog */}
      <Dialog open={isEditJobOpen} onOpenChange={setIsEditJobOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Job</DialogTitle>
            <DialogDescription>
              Update the job details and category assignment
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
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
                control={form.control}
                name="category_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-9">
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
                  disabled={updateJob.isPending}
                >
                  {updateJob.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    'Update Job'
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
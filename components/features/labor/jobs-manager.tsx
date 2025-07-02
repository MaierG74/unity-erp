'use client';

import { useState, useEffect } from 'react';
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
import { Plus, Trash2, Edit, Save, X, ChevronDown, ChevronUp, Search, Filter, LayoutList, LayoutGrid } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
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
  category?: JobCategory;
}

// Form schema for adding/editing jobs
const jobSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  category_id: z.string().min(1, 'Category is required'),
});

type JobFormValues = z.infer<typeof jobSchema>;

export function JobsManager() {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalJobs, setTotalJobs] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [isCompactView, setIsCompactView] = useState(true);
  
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
  
  // Count total jobs (for pagination)
  useEffect(() => {
    const fetchTotalJobs = async () => {
      let query = supabase
        .from('jobs')
        .select('job_id', { count: 'exact', head: true });
      
      // Apply filters if present
      if (categoryFilter) {
        query = query.eq('category_id', categoryFilter);
      }
      
      if (searchTerm) {
        query = query.or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
      }
      
      const { count, error } = await query;
      
      if (!error && count !== null) {
        setTotalJobs(count);
      }
    };
    
    fetchTotalJobs();
  }, [categoryFilter, searchTerm]);
  
  // Fetch jobs with filters and pagination
  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ['jobs', page, pageSize, categoryFilter, searchTerm],
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
      
      // Apply filters if present
      if (categoryFilter) {
        query = query.eq('category_id', categoryFilter);
      }
      
      if (searchTerm) {
        query = query.or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
      }
      
      // Apply pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      
      query = query
        .order('name')
        .range(from, to);
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      return (data || []).map((job: any) => ({
        ...job,
        category: job.job_categories
      })) as Job[];
    },
  });
  
  // Debounced search handler
  const debouncedSearch = debounce((value: string) => {
    setSearchTerm(value);
    setPage(1); // Reset to first page on new search
  }, 300);
  
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    debouncedSearch(e.target.value);
  };
  
  // Category filter handler
  const handleCategoryFilterChange = (value: string) => {
    setCategoryFilter(value === '_all' ? '' : value);
    setPage(1); // Reset to first page on new filter
  };
  
  // Row expansion handler
  const toggleRowExpansion = (jobId: number) => {
    setExpandedRows(prev => ({
      ...prev,
      [jobId]: !prev[jobId]
    }));
  };
  
  // View mode toggle handler
  const toggleViewMode = () => {
    setIsCompactView(!isCompactView);
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
      toast({
        title: 'Success',
        description: 'Job added successfully',
      });
      refetchJobs();
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
      toast({
        title: 'Success',
        description: 'Job updated successfully',
      });
      refetchJobs();
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
      toast({
        title: 'Success',
        description: 'Job deleted successfully',
      });
      refetchJobs();
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
  };
  
  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    form.reset();
  };
  
  // Calculate total pages
  const totalPages = Math.ceil(totalJobs / pageSize);
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Jobs Management</CardTitle>
              <CardDescription>
                Manage jobs and assign them to categories
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleViewMode}
                title={isCompactView ? "Switch to detailed view" : "Switch to compact view"}
              >
                {isCompactView ? <LayoutGrid className="h-4 w-4" /> : <LayoutList className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {jobsLoading || categoriesLoading ? (
            <div className="text-center py-4">Loading...</div>
          ) : (
            <>
              {/* Search and Filter Controls */}
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search jobs..."
                    onChange={handleSearchChange}
                    className="pl-8"
                  />
                </div>
                <div className="w-full sm:w-48">
                  <Select
                    value={categoryFilter}
                    onValueChange={handleCategoryFilterChange}
                  >
                    <SelectTrigger>
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

              {/* Jobs Table */}
              <div className="rounded-md border mb-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {isCompactView && <TableHead className="w-[30px]"></TableHead>}
                      <TableHead>Name</TableHead>
                      {!isCompactView && <TableHead>Description</TableHead>}
                      <TableHead>Category</TableHead>
                      <TableHead>Hourly Rate</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isCompactView ? 5 : 6} className="text-center py-4">
                          No jobs found
                        </TableCell>
                      </TableRow>
                    ) : (
                      jobs.map((job) => (
                        <>
                          <TableRow key={job.job_id}>
                            {isCompactView && (
                              <TableCell className="px-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => toggleRowExpansion(job.job_id)}
                                >
                                  {expandedRows[job.job_id] ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                            )}
                            <TableCell className="font-medium">{job.name}</TableCell>
                            {!isCompactView && <TableCell>{job.description}</TableCell>}
                            <TableCell>
                              <Badge variant="outline">{job.category?.name || 'Uncategorized'}</Badge>
                            </TableCell>
                            <TableCell>
                              {job.category ? `R${job.category.current_hourly_rate.toFixed(2)}/hr` : 'N/A'}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => startEditing(job)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    if (confirm(`Are you sure you want to delete ${job.name}?`)) {
                                      deleteJob.mutate(job.job_id);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isCompactView && expandedRows[job.job_id] && (
                            <TableRow>
                              <TableCell colSpan={5} className="bg-muted/30">
                                <div className="p-2">
                                  <h4 className="text-sm font-semibold mb-1">Description:</h4>
                                  <p className="text-sm text-muted-foreground">{job.description || 'No description provided'}</p>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center my-4">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious 
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          className={page === 1 ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                      
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        // Display pages around the current page
                        let pageToShow;
                        if (totalPages <= 5) {
                          pageToShow = i + 1;
                        } else if (page <= 3) {
                          pageToShow = i + 1;
                        } else if (page >= totalPages - 2) {
                          pageToShow = totalPages - 4 + i;
                        } else {
                          pageToShow = page - 2 + i;
                        }
                        
                        return (
                          <PaginationItem key={pageToShow}>
                            <PaginationLink
                              isActive={pageToShow === page}
                              onClick={() => setPage(pageToShow)}
                            >
                              {pageToShow}
                            </PaginationLink>
                          </PaginationItem>
                        );
                      })}
                      
                      {totalPages > 5 && page < totalPages - 2 && (
                        <>
                          <PaginationItem>
                            <PaginationEllipsis />
                          </PaginationItem>
                          <PaginationItem>
                            <PaginationLink onClick={() => setPage(totalPages)}>
                              {totalPages}
                            </PaginationLink>
                          </PaginationItem>
                        </>
                      )}
                      
                      <PaginationItem>
                        <PaginationNext 
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          className={page === totalPages ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}

              {/* Add/Edit Job Form */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-md">
                    {editingId ? 'Edit Job' : 'Add Job'}
                  </CardTitle>
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
                          name="category_id"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Category</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value}
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
                      </div>

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
                          disabled={addJob.isPending || updateJob.isPending}
                        >
                          {addJob.isPending || updateJob.isPending ? (
                            'Saving...'
                          ) : editingId ? (
                            'Update Job'
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
            </>
          )}
        </CardContent>
        <CardFooter className="flex justify-between text-sm text-muted-foreground">
          <div>
            {!jobsLoading && (
              <span>
                Showing {jobs.length} of {totalJobs} jobs
              </span>
            )}
          </div>
          <div className="flex space-x-4">
            <Select 
              value={pageSize.toString()}
              onValueChange={(value) => {
                setPageSize(parseInt(value));
                setPage(1); // Reset to first page when changing page size
              }}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Items per page" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 per page</SelectItem>
                <SelectItem value="20">20 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
                <SelectItem value="100">100 per page</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
} 
'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import Link from 'next/link';

// UI Components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/components/ui/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
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

// Icons
import {
  ArrowLeft,
  Edit,
  Save,
  X,
  Plus,
  Trash2,
  Loader2,
  Calendar as CalendarIcon,
  DollarSign,
  Clock,
  Package,
  Briefcase,
  Users,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

// Custom Components
import { RoleSelector, LaborRole } from './role-selector';
import { JobTimeAnalysis } from './job-time-analysis';
import { cn } from '@/lib/utils';

// Types
interface JobCategory {
  category_id: number;
  name: string;
  description: string | null;
  current_hourly_rate: number;
  parent_category_id: number | null;
}

interface Job {
  job_id: number;
  name: string;
  description: string | null;
  category_id: number;
  role_id: number | null;
  estimated_minutes: number | null;
  time_unit: 'hours' | 'minutes' | 'seconds' | null;
  category?: JobCategory;
  labor_roles?: LaborRole;
}

interface HourlyRate {
  rate_id: number;
  job_id: number;
  hourly_rate: number;
  effective_date: string;
  end_date: string | null;
}

interface PieceworkRate {
  rate_id: number;
  job_id: number;
  product_id: number | null;
  rate: number;
  effective_date: string;
  end_date: string | null;
  product?: { product_id: number; name: string; internal_code: string } | null;
}

interface BOLItem {
  bol_id: number;
  product_id: number;
  job_id: number;
  pay_type: 'hourly' | 'piece';
  time_required: number | null;
  time_unit: string;
  quantity: number;
  product?: { product_id: number; name: string; internal_code: string };
}

// Form schemas
const jobEditSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  category_id: z.string().min(1, 'Category is required'),
  role_id: z.string().nullable(),
  estimated_minutes: z.coerce.number().min(0, 'Time must be positive').nullable().optional(),
  time_unit: z.enum(['hours', 'minutes', 'seconds']).default('hours'),
});

const hourlyRateSchema = z.object({
  hourly_rate: z.coerce.number().min(0, 'Rate must be positive'),
  effective_date: z.date({ required_error: 'Effective date is required' }),
});

const pieceworkRateSchema = z.object({
  rate: z.coerce.number().min(0, 'Rate must be positive'),
  effective_date: z.date({ required_error: 'Effective date is required' }),
  product_id: z.string().optional(),
});

interface JobDetailProps {
  jobId: number;
}

export function JobDetail({ jobId }: JobDetailProps) {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // UI state
  const [isEditing, setIsEditing] = useState(false);
  const [isAddHourlyOpen, setIsAddHourlyOpen] = useState(false);
  const [isAddPieceworkOpen, setIsAddPieceworkOpen] = useState(false);
  const [deleteRateId, setDeleteRateId] = useState<{ id: number; type: 'hourly' | 'piecework' } | null>(null);
  const [editParentId, setEditParentId] = useState('');
  const [editSubId, setEditSubId] = useState('');

  // Forms
  const editForm = useForm<z.infer<typeof jobEditSchema>>({
    resolver: zodResolver(jobEditSchema),
  });

  const hourlyRateForm = useForm<z.infer<typeof hourlyRateSchema>>({
    resolver: zodResolver(hourlyRateSchema),
    defaultValues: { hourly_rate: 0, effective_date: new Date() },
  });

  const pieceworkRateForm = useForm<z.infer<typeof pieceworkRateSchema>>({
    resolver: zodResolver(pieceworkRateSchema),
    defaultValues: { rate: 0, effective_date: new Date(), product_id: '' },
  });

  // Fetch job details
  const { data: job, isLoading: jobLoading, error: jobError } = useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          job_categories (*),
          labor_roles (*)
        `)
        .eq('job_id', jobId)
        .single();

      if (error) throw error;
      return {
        ...data,
        category: data.job_categories,
      } as Job;
    },
  });

  // Fetch categories for edit form
  const { data: categories = [] } = useQuery({
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

  // Build parent/children maps for cascading category selects
  const { editParentCategories, editChildrenByParent } = useMemo(() => {
    const parents = categories.filter((c) => c.parent_category_id === null);
    const childMap = new Map<number, JobCategory[]>();
    for (const cat of categories) {
      if (cat.parent_category_id !== null) {
        const list = childMap.get(cat.parent_category_id) || [];
        list.push(cat);
        childMap.set(cat.parent_category_id, list);
      }
    }
    return { editParentCategories: parents, editChildrenByParent: childMap };
  }, [categories]);

  // Fetch hourly rates
  const { data: hourlyRates = [] } = useQuery({
    queryKey: ['job-hourly-rates', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_hourly_rates')
        .select('*')
        .eq('job_id', jobId)
        .order('effective_date', { ascending: false });
      if (error) throw error;
      return data as HourlyRate[];
    },
  });

  // Fetch piecework rates
  const { data: pieceworkRates = [] } = useQuery({
    queryKey: ['job-piecework-rates', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('piece_work_rates')
        .select(`
          *,
          products (product_id, name, internal_code)
        `)
        .eq('job_id', jobId)
        .order('effective_date', { ascending: false });
      if (error) throw error;
      return (data || []).map((r: any) => ({ ...r, product: r.products })) as PieceworkRate[];
    },
  });

  // Fetch products for piecework rate form
  const { data: products = [] } = useQuery({
    queryKey: ['products-simple'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('product_id, name, internal_code')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch BOL items that use this job
  const { data: bolItems = [] } = useQuery({
    queryKey: ['job-bol-items', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billoflabour')
        .select(`
          bol_id,
          product_id,
          job_id,
          pay_type,
          time_required,
          time_unit,
          quantity,
          products (product_id, name, internal_code)
        `)
        .eq('job_id', jobId);
      if (error) throw error;
      return (data || []).map((item: any) => ({ ...item, product: item.products })) as BOLItem[];
    },
  });

  // Fetch suggested role
  const { data: suggestedRole } = useQuery({
    queryKey: ['job-suggested-role', jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('suggest_job_role', { p_job_id: jobId });
      if (error) return null;
      return data as number | null;
    },
    enabled: !!job && !job.role_id,
  });

  // Update job mutation
  const updateJob = useMutation({
    mutationFn: async (values: z.infer<typeof jobEditSchema>) => {
      const { error } = await supabase
        .from('jobs')
        .update({
          name: values.name,
          description: values.description || null,
          category_id: parseInt(values.category_id),
          role_id: values.role_id ? parseInt(values.role_id) : null,
          estimated_minutes: values.estimated_minutes || null,
          time_unit: values.time_unit,
        })
        .eq('job_id', jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setIsEditing(false);
      setEditParentId('');
      setEditSubId('');
      toast({ title: 'Success', description: 'Job updated successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update job', variant: 'destructive' });
    },
  });

  // Add hourly rate mutation
  const addHourlyRate = useMutation({
    mutationFn: async (values: z.infer<typeof hourlyRateSchema>) => {
      const eff = values.effective_date.toISOString().split('T')[0];

      // Check for later rates to determine end_date
      const { data: later } = await supabase
        .from('job_hourly_rates')
        .select('*')
        .eq('job_id', jobId)
        .gte('effective_date', eff)
        .order('effective_date', { ascending: true })
        .limit(1);

      let endDate: string | null = null;
      if (later && later.length > 0) {
        const d = new Date(later[0].effective_date);
        d.setDate(d.getDate() - 1);
        endDate = d.toISOString().split('T')[0];
      }

      // Get earlier rate to close
      const { data: earlier } = await supabase
        .from('job_hourly_rates')
        .select('*')
        .eq('job_id', jobId)
        .lt('effective_date', eff)
        .order('effective_date', { ascending: false })
        .limit(1);

      // Insert new rate
      const { error } = await supabase
        .from('job_hourly_rates')
        .insert({
          job_id: jobId,
          hourly_rate: values.hourly_rate,
          effective_date: eff,
          end_date: endDate,
        });
      if (error) throw error;

      // Close previous rate
      if (earlier && earlier.length > 0) {
        const prevEnd = new Date(values.effective_date);
        prevEnd.setDate(prevEnd.getDate() - 1);
        await supabase
          .from('job_hourly_rates')
          .update({ end_date: prevEnd.toISOString().split('T')[0] })
          .eq('rate_id', earlier[0].rate_id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-hourly-rates', jobId] });
      setIsAddHourlyOpen(false);
      hourlyRateForm.reset({ hourly_rate: 0, effective_date: new Date() });
      toast({ title: 'Success', description: 'Hourly rate added' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add rate', variant: 'destructive' });
    },
  });

  // Add piecework rate mutation
  const addPieceworkRate = useMutation({
    mutationFn: async (values: z.infer<typeof pieceworkRateSchema>) => {
      const eff = values.effective_date.toISOString().split('T')[0];
      const productId = values.product_id ? parseInt(values.product_id) : null;

      // Check for later rates
      let query = supabase
        .from('piece_work_rates')
        .select('*')
        .eq('job_id', jobId)
        .gte('effective_date', eff)
        .order('effective_date', { ascending: true })
        .limit(1);

      if (productId) {
        query = query.eq('product_id', productId);
      } else {
        query = query.is('product_id', null);
      }

      const { data: later } = await query;

      let endDate: string | null = null;
      if (later && later.length > 0) {
        const d = new Date(later[0].effective_date);
        d.setDate(d.getDate() - 1);
        endDate = d.toISOString().split('T')[0];
      }

      // Get earlier rate
      let earlierQuery = supabase
        .from('piece_work_rates')
        .select('*')
        .eq('job_id', jobId)
        .lt('effective_date', eff)
        .order('effective_date', { ascending: false })
        .limit(1);

      if (productId) {
        earlierQuery = earlierQuery.eq('product_id', productId);
      } else {
        earlierQuery = earlierQuery.is('product_id', null);
      }

      const { data: earlier } = await earlierQuery;

      // Insert new rate
      const { error } = await supabase
        .from('piece_work_rates')
        .insert({
          job_id: jobId,
          product_id: productId,
          rate: values.rate,
          effective_date: eff,
          end_date: endDate,
        });
      if (error) throw error;

      // Close previous rate
      if (earlier && earlier.length > 0) {
        const prevEnd = new Date(values.effective_date);
        prevEnd.setDate(prevEnd.getDate() - 1);
        await supabase
          .from('piece_work_rates')
          .update({ end_date: prevEnd.toISOString().split('T')[0] })
          .eq('rate_id', earlier[0].rate_id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-piecework-rates', jobId] });
      setIsAddPieceworkOpen(false);
      pieceworkRateForm.reset({ rate: 0, effective_date: new Date(), product_id: '' });
      toast({ title: 'Success', description: 'Piecework rate added' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add rate', variant: 'destructive' });
    },
  });

  // Delete rate mutation
  const deleteRate = useMutation({
    mutationFn: async ({ id, type }: { id: number; type: 'hourly' | 'piecework' }) => {
      const table = type === 'hourly' ? 'job_hourly_rates' : 'piece_work_rates';
      const { error } = await supabase.from(table).delete().eq('rate_id', id);
      if (error) throw error;
    },
    onSuccess: (_, { type }) => {
      const key = type === 'hourly' ? 'job-hourly-rates' : 'job-piecework-rates';
      queryClient.invalidateQueries({ queryKey: [key, jobId] });
      setDeleteRateId(null);
      toast({ title: 'Deleted', description: 'Rate removed' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to delete rate', variant: 'destructive' });
    },
  });

  // Apply suggested role
  const applySuggestedRole = useMutation({
    mutationFn: async (roleId: number) => {
      const { error } = await supabase
        .from('jobs')
        .update({ role_id: roleId })
        .eq('job_id', jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: 'Role applied', description: 'Job role has been updated' });
    },
  });

  // Start editing
  const startEditing = () => {
    if (job) {
      const cat = categories.find((c) => c.category_id === job.category_id);
      let parentId = '';
      let subId = '';
      if (cat) {
        if (cat.parent_category_id === null) {
          parentId = cat.category_id.toString();
        } else {
          parentId = cat.parent_category_id.toString();
          subId = cat.category_id.toString();
        }
      }
      setEditParentId(parentId);
      setEditSubId(subId);
      editForm.reset({
        name: job.name,
        description: job.description || '',
        category_id: job.category_id.toString(),
        role_id: job.role_id?.toString() || null,
        estimated_minutes: job.estimated_minutes || null,
        time_unit: job.time_unit || 'hours',
      });
      setIsEditing(true);
    }
  };

  // Get current rates
  const currentHourlyRate = hourlyRates.find(r => !r.end_date);
  const currentPieceworkRate = pieceworkRates.find(r => !r.end_date && !r.product_id);
  const productSpecificRates = pieceworkRates.filter(r => r.product_id && !r.end_date);

  // Loading state
  if (jobLoading) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  // Error state
  if (jobError || !job) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Job Not Found</h2>
            <p className="text-muted-foreground mb-4">
              The job you're looking for doesn't exist or has been deleted.
            </p>
            <Button onClick={() => router.push('/labor')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Labor Management
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/labor')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{job.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">
              {job.category?.parent_category_id
                ? `${categories.find((c) => c.category_id === job.category?.parent_category_id)?.name ?? 'Unknown'} > ${job.category.name}`
                : job.category?.name || 'Uncategorized'}
            </Badge>
            {job.labor_roles && (
              <Badge
                style={{ backgroundColor: job.labor_roles.color || undefined }}
                className="text-white"
              >
                <Users className="h-3 w-3 mr-1" />
                {job.labor_roles.name}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Role Suggestion Banner */}
      {!job.role_id && suggestedRole && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Role Suggestion</p>
                  <p className="text-sm text-muted-foreground">
                    Based on the category, we suggest assigning a role to this job for better labor planning.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => applySuggestedRole.mutate(suggestedRole)}
                  disabled={applySuggestedRole.isPending}
                >
                  {applySuggestedRole.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Apply Suggestion
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Details & Time Analysis */}
        <div className="space-y-6">
          {/* Job Details Card — inline edit */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                {isEditing ? 'Edit Job Details' : 'Job Details'}
              </CardTitle>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={editForm.handleSubmit((v) => updateJob.mutate(v))}
                    disabled={updateJob.isPending}
                  >
                    {updateJob.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setIsEditing(false); setEditParentId(''); setEditSubId(''); }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={startEditing}>
                  <Edit className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <Form {...editForm}>
                  <form
                    id="job-edit-form"
                    onSubmit={editForm.handleSubmit((v) => updateJob.mutate(v))}
                    className="space-y-4"
                  >
                    {/* Row 1: Name + Role */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={editForm.control}
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
                        control={editForm.control}
                        name="role_id"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Role</FormLabel>
                            <FormControl>
                              <RoleSelector
                                value={field.value}
                                onChange={field.onChange}
                                placeholder="Select role for planning"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Row 2: Category group + Estimated Time group */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Category + Subcategory stacked */}
                      <div className="space-y-3">
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select
                            value={editParentId}
                            onValueChange={(v) => {
                              setEditParentId(v);
                              setEditSubId('');
                              editForm.setValue('category_id', v, { shouldValidate: true });
                            }}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {editParentCategories.map((cat) => (
                                <SelectItem key={cat.category_id} value={cat.category_id.toString()}>
                                  {cat.name} - R{cat.current_hourly_rate.toFixed(2)}/hr
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {editForm.formState.errors.category_id && (
                            <p className="text-sm font-medium text-destructive">
                              {editForm.formState.errors.category_id.message}
                            </p>
                          )}
                        </FormItem>

                        {editParentId && (editChildrenByParent.get(parseInt(editParentId)) || []).length > 0 && (
                          <FormItem>
                            <FormLabel>Subcategory (optional)</FormLabel>
                            <Select
                              value={editSubId || '_none'}
                              onValueChange={(v) => {
                                const val = v === '_none' ? '' : v;
                                setEditSubId(val);
                                editForm.setValue('category_id', val || editParentId, { shouldValidate: true });
                              }}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="None (use parent category)" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="_none">None (use parent category)</SelectItem>
                                {(editChildrenByParent.get(parseInt(editParentId)) || []).map((sub) => (
                                  <SelectItem key={sub.category_id} value={sub.category_id.toString()}>
                                    {sub.name} - R{sub.current_hourly_rate.toFixed(2)}/hr
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      </div>

                      {/* Estimated Time + Time Unit stacked */}
                      <div className="space-y-3">
                        <FormField
                          control={editForm.control}
                          name="estimated_minutes"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Estimated Time (optional)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  placeholder="e.g., 2.5"
                                  {...field}
                                  value={field.value ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value === '' ? null : parseFloat(e.target.value);
                                    field.onChange(val);
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={editForm.control}
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
                                  <SelectItem value="hours">Hours</SelectItem>
                                  <SelectItem value="minutes">Minutes</SelectItem>
                                  <SelectItem value="seconds">Seconds</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Row 3: Description full-width */}
                    <FormField
                      control={editForm.control}
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
                  </form>
                </Form>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Category</p>
                      <p className="font-medium">
                        {job.category?.parent_category_id
                          ? `${categories.find((c) => c.category_id === job.category?.parent_category_id)?.name ?? 'Unknown'} > ${job.category.name}`
                          : job.category?.name || 'None'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Category Rate</p>
                      <p className="font-medium">R{job.category?.current_hourly_rate?.toFixed(2) || '0.00'}/hr</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Role</p>
                      <p className="font-medium">{job.labor_roles?.name || 'Not assigned'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Estimated Time</p>
                      <p className="font-medium">
                        {job.estimated_minutes
                          ? `${job.estimated_minutes} ${job.time_unit || 'hours'} per piece`
                          : 'Not set'}
                      </p>
                    </div>
                  </div>
                  {job.description && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
                      <p className="text-sm">{job.description}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Time Analysis - shows average times from completed jobs */}
          <JobTimeAnalysis jobId={jobId} />
        </div>

        {/* Right Column - Rates */}
        <div className="space-y-6">
          {/* Hourly Rates Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Hourly Rates
                </CardTitle>
                <CardDescription>Job-specific hourly rate history</CardDescription>
              </div>
              <Button size="sm" onClick={() => setIsAddHourlyOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Rate
              </Button>
            </CardHeader>
            <CardContent>
              {currentHourlyRate ? (
                <div className="mb-4 p-3 rounded-lg border bg-muted/30">
                  <p className="text-sm text-muted-foreground">Current Rate</p>
                  <p className="text-2xl font-bold text-primary">
                    R{currentHourlyRate.hourly_rate.toFixed(2)}/hr
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Since {format(new Date(currentHourlyRate.effective_date), 'MMM d, yyyy')}
                  </p>
                </div>
              ) : (
                <div className="mb-4 p-3 rounded-lg border bg-muted/30">
                  <p className="text-sm text-muted-foreground">No job-specific rate</p>
                  <p className="text-lg font-medium">
                    Using category rate: R{job.category?.current_hourly_rate?.toFixed(2) || '0.00'}/hr
                  </p>
                </div>
              )}

              {hourlyRates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Rate History</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hourlyRates.map((rate) => (
                        <TableRow key={rate.rate_id}>
                          <TableCell className="font-medium">
                            R{rate.hourly_rate.toFixed(2)}/hr
                          </TableCell>
                          <TableCell>{format(new Date(rate.effective_date), 'MMM d, yyyy')}</TableCell>
                          <TableCell>
                            {rate.end_date ? format(new Date(rate.end_date), 'MMM d, yyyy') : (
                              <Badge variant="secondary">Current</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setDeleteRateId({ id: rate.rate_id, type: 'hourly' })}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Piecework Rates Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Piecework Rates
                </CardTitle>
                <CardDescription>Per-unit rates (default and product-specific)</CardDescription>
              </div>
              <Button size="sm" onClick={() => setIsAddPieceworkOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Rate
              </Button>
            </CardHeader>
            <CardContent>
              {/* Default Piecework Rate */}
              {currentPieceworkRate ? (
                <div className="mb-4 p-3 rounded-lg border bg-muted/30">
                  <p className="text-sm text-muted-foreground">Default Rate</p>
                  <p className="text-2xl font-bold text-primary">
                    R{currentPieceworkRate.rate.toFixed(2)}/piece
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Since {format(new Date(currentPieceworkRate.effective_date), 'MMM d, yyyy')}
                  </p>
                </div>
              ) : (
                <div className="mb-4 p-3 rounded-lg border bg-muted/30 text-center text-muted-foreground">
                  No default piecework rate set
                </div>
              )}

              {/* Product-Specific Rates */}
              {productSpecificRates.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-sm font-medium">Product-Specific Rates</p>
                  <div className="space-y-2">
                    {productSpecificRates.map((rate) => (
                      <div
                        key={rate.rate_id}
                        className="flex items-center justify-between p-2 rounded border"
                      >
                        <div>
                          <p className="font-medium">{rate.product?.name}</p>
                          <p className="text-sm text-muted-foreground">{rate.product?.internal_code}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-primary">R{rate.rate.toFixed(2)}/pc</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => setDeleteRateId({ id: rate.rate_id, type: 'piecework' })}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Piecework Rate History */}
              {pieceworkRates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Rate History</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pieceworkRates.slice(0, 5).map((rate) => (
                        <TableRow key={rate.rate_id}>
                          <TableCell>{rate.product?.name || 'Default'}</TableCell>
                          <TableCell className="font-medium">R{rate.rate.toFixed(2)}/pc</TableCell>
                          <TableCell>{format(new Date(rate.effective_date), 'MMM d, yyyy')}</TableCell>
                          <TableCell>
                            {rate.end_date ? format(new Date(rate.end_date), 'MMM d, yyyy') : (
                              <Badge variant="secondary">Current</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Used in Products Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Used in Products
          </CardTitle>
          <CardDescription>Products that include this job in their Bill of Labor</CardDescription>
        </CardHeader>
        <CardContent>
          {bolItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>This job is not used in any products yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Pay Type</TableHead>
                  <TableHead>Time/Qty</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bolItems.map((item) => (
                  <TableRow key={item.bol_id}>
                    <TableCell className="font-medium">{item.product?.name}</TableCell>
                    <TableCell>{item.product?.internal_code}</TableCell>
                    <TableCell>
                      <Badge variant={item.pay_type === 'hourly' ? 'default' : 'secondary'}>
                        {item.pay_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.pay_type === 'hourly'
                        ? `${item.time_required || 0} ${item.time_unit}`
                        : `${item.quantity} pcs`}
                    </TableCell>
                    <TableCell>
                      <Link href={`/products/${item.product_id}`}>
                        <Button variant="ghost" size="sm">View Product</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Hourly Rate Dialog */}
      <Dialog open={isAddHourlyOpen} onOpenChange={setIsAddHourlyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Hourly Rate</DialogTitle>
            <DialogDescription>Set a new job-specific hourly rate</DialogDescription>
          </DialogHeader>
          <Form {...hourlyRateForm}>
            <form onSubmit={hourlyRateForm.handleSubmit((v) => addHourlyRate.mutate(v))} className="space-y-4">
              <FormField
                control={hourlyRateForm.control}
                name="hourly_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hourly Rate (R)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={hourlyRateForm.control}
                name="effective_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value ? format(field.value, 'PPP') : 'Pick a date'}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddHourlyOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addHourlyRate.isPending}>
                  {addHourlyRate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Rate
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add Piecework Rate Dialog */}
      <Dialog open={isAddPieceworkOpen} onOpenChange={setIsAddPieceworkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Piecework Rate</DialogTitle>
            <DialogDescription>Set a per-piece rate (default or product-specific)</DialogDescription>
          </DialogHeader>
          <Form {...pieceworkRateForm}>
            <form onSubmit={pieceworkRateForm.handleSubmit((v) => addPieceworkRate.mutate(v))} className="space-y-4">
              <FormField
                control={pieceworkRateForm.control}
                name="product_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product (optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Default (all products)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">Default (all products)</SelectItem>
                        {products.map((p: any) => (
                          <SelectItem key={p.product_id} value={p.product_id.toString()}>
                            {p.name} ({p.internal_code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={pieceworkRateForm.control}
                name="rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate per Piece (R)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={pieceworkRateForm.control}
                name="effective_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              'w-full pl-3 text-left font-normal',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            {field.value ? format(field.value, 'PPP') : 'Pick a date'}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddPieceworkOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addPieceworkRate.isPending}>
                  {addPieceworkRate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Rate
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteRateId} onOpenChange={() => setDeleteRateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rate</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this rate? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRateId && deleteRate.mutate(deleteRateId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

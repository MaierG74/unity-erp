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
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Badge } from '@/components/ui/badge';

// dialogs
const AddJobDialog = dynamic(() => import('./AddJobDialog'), { ssr: false });

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

interface JobHourlyRate {
  rate_id: number;
  hourly_rate: number;
  effective_date: string;
  end_date: string | null;
}

// Our normalized BOL item type for use in the component
interface BOLItem {
  bol_id: number;
  product_id: number;
  job_id: number;
  time_required: number | null;
  time_unit: 'hours' | 'minutes' | 'seconds';
  quantity: number;
  rate_id: number | null; // legacy
  hourly_rate_id?: number | null;
  pay_type?: 'hourly' | 'piece';
  piece_rate_id?: number | null;
  job: Job;
  rate: JobCategoryRate | null; // legacy category rate
  hourly_rate?: JobHourlyRate | null;
  piece_rate?: { rate_id: number; rate: number } | null;
}

// Form schema for adding/editing BOL items
const bolItemSchema = z.object({
  job_category_id: z.string().min(1, 'Job category is required'),
  job_id: z.string().min(1, 'Job is required'),
  pay_type: z.enum(['hourly', 'piece']).default('hourly'),
  time_required: z.coerce.number().optional(),
  time_unit: z.enum(['hours', 'minutes', 'seconds']).optional(),
  quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
});

type BOLItemFormValues = z.infer<typeof bolItemSchema>;

interface ProductBOLProps {
  productId: number;
}

export function ProductBOL({ productId }: ProductBOLProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [jobSearchTerm, setJobSearchTerm] = useState('');
  const [jobSearchInput, setJobSearchInput] = useState('');
  const debouncedJobSearch = useDebounce(jobSearchInput, 300);
  useEffect(() => {
    setJobSearchTerm(debouncedJobSearch);
  }, [debouncedJobSearch]);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const featureAttach = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_FEATURE_ATTACH_BOM === 'true'
  const [addJobOpen, setAddJobOpen] = useState(false)
  
  // Initialize form with proper defaults
  const form = useForm<BOLItemFormValues>({
    resolver: zodResolver(bolItemSchema),
    defaultValues: {
      job_category_id: '',
      job_id: '',
      pay_type: 'hourly',
      time_required: 1.0,
      time_unit: 'minutes',
      quantity: 1,
    },
  });

  // Map: bol_id -> direct row for inline editing (moved below to avoid use-before-declare)

  // Effective BOL (explicit + linked)
  const { data: effectiveBOL } = useQuery({
    enabled: true,
    queryKey: ['effectiveBOL', productId],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/products/${productId}/effective-bol`)
        if (!res.ok) return { items: [] }
        return (await res.json()) as { items: any[] }
      } catch {
        return { items: [] }
      }
    }
  })

  // Linked sub-products for badges
  const { data: productLinks = [] } = useQuery({
    enabled: featureAttach,
    queryKey: ['productBOMLinks', productId],
    queryFn: async () => {
      const { data: links } = await supabase
        .from('product_bom_links')
        .select('sub_product_id, scale')
        .eq('product_id', productId)
      const ids = (links || []).map((l: any) => Number(l.sub_product_id))
      let map: Record<number, { product_id: number; internal_code: string; name: string }> = {}
      if (ids.length > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('product_id, internal_code, name')
          .in('product_id', ids)
        for (const p of (prods || []) as any[]) map[Number((p as any).product_id)] = p as any
      }
      return (links || []).map((l: any) => ({ sub_product_id: Number(l.sub_product_id), product: map[Number(l.sub_product_id)] }))
    }
  })

  const linkProductMap = useMemo(() => {
    const m = new Map<number, { product_id: number; internal_code: string; name: string }>()
    for (const l of productLinks || []) {
      if ((l as any)?.product) m.set(Number((l as any).sub_product_id), (l as any).product)
    }
    return m
  }, [productLinks])
  
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
          hourly_rate_id,
          pay_type,
          piece_rate_id,
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
          ),
          job_hourly_rates:job_hourly_rates (
            rate_id,
            hourly_rate,
            effective_date,
            end_date
          ),
          piece_rate:piece_work_rates (
            rate_id,
            rate
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
        hourly_rate_id: item.hourly_rate_id,
        pay_type: item.pay_type || 'hourly',
        piece_rate_id: item.piece_rate_id,
        job: {
          ...item.jobs,
          category: item.jobs.job_categories
        },
        rate: item.job_category_rates,
        hourly_rate: (item as any).job_hourly_rates,
        piece_rate: item.piece_rate
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
  
  // Map of direct rows by bol_id (after bolItems is available)
  const bolById = useMemo(() => {
    const m = new Map<number, BOLItem>();
    for (const b of bolItems || []) {
      if (typeof b?.bol_id === 'number') m.set(Number(b.bol_id), b);
    }
    return m;
  }, [bolItems]);

  // Build unified rows (effective or fallback to direct-only)
  const unifiedRows = useMemo(() => {
    if (effectiveBOL?.items && (effectiveBOL.items as any[]).length > 0) {
      return effectiveBOL.items as any[];
    }
    return (bolItems || []).map((b) => ({
      bol_id: b.bol_id,
      job_id: b.job_id,
      job_name: b.job?.name,
      category_name: b.job?.category?.name,
      pay_type: b.pay_type || 'hourly',
      time_required: b.time_required,
      time_unit: b.time_unit,
      quantity: b.quantity,
      hourly_rate: b.hourly_rate?.hourly_rate ?? b.rate?.hourly_rate ?? b.job.category.current_hourly_rate,
      piece_rate: b.piece_rate?.rate,
      _source: 'direct',
      _editable: true,
    })) as any[];
  }, [effectiveBOL, bolItems]);

  // Job search handler (debounced via useDebounce)
  const handleJobSearchChange = (value: string) => {
    setJobSearchInput(value);
  };
  
  // Update BOL item mutation
  const updateBOLItem = useMutation({
    mutationFn: async (values: BOLItemFormValues & { bol_id: number }) => {
      const categoryId = parseInt(values.job_category_id);
      const jobId = parseInt(values.job_id);
      const today = new Date().toISOString().split('T')[0];

      let updateData: any = {
        job_id: jobId,
        quantity: values.quantity,
      };

      if ((values.pay_type || 'hourly') === 'hourly') {
        const { data: rates, error: ratesError } = await supabase
          .from('job_hourly_rates')
          .select('*')
          .eq('job_id', jobId)
          .lte('effective_date', today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order('effective_date', { ascending: false })
          .limit(1);
        if (ratesError) throw ratesError;
        const hourlyRateId = rates && rates.length > 0 ? rates[0].rate_id : null;
        updateData = {
          ...updateData,
          pay_type: 'hourly',
          time_required: values.time_required ?? 1.0,
          time_unit: values.time_unit ?? 'minutes',
          hourly_rate_id: hourlyRateId,
          piece_rate_id: null,
        };
      } else {
        const { data: prates, error: prError } = await supabase
          .from('piece_work_rates')
          .select('rate_id, job_id, product_id, rate, effective_date, end_date')
          .eq('job_id', jobId)
          .lte('effective_date', today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order('effective_date', { ascending: false });
        if (prError) throw prError;
        const chosen = (prates || []).find((r: any) => r.product_id === productId) || (prates || []).find((r: any) => r.product_id == null) || null;
        const pieceRateId = chosen ? chosen.rate_id : null;
        updateData = {
          ...updateData,
          pay_type: 'piece',
          time_required: null,
          time_unit: 'hours',
          rate_id: null,
          piece_rate_id: pieceRateId,
        };
      }

      const { data, error } = await supabase
        .from('billoflabour')
        .update(updateData)
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
  
  // Note: adding new BOL items is handled via <AddJobDialog />; no local onSubmit needed here.

  // Start editing a BOL item
  const startEditing = (item: BOLItem) => {
    setEditingId(item.bol_id);
    setSelectedCategoryId(item.job.category_id);
    
    form.setValue('job_category_id', item.job.category_id.toString());
    form.setValue('job_id', item.job_id.toString());
    form.setValue('pay_type', (item.pay_type || 'hourly') as any);
    if ((item.pay_type || 'hourly') === 'hourly') {
      form.setValue('time_required', item.time_required as any);
      form.setValue('time_unit', item.time_unit as any);
    } else {
      form.setValue('time_required', 0 as any);
      form.setValue('time_unit', 'hours' as any);
    }
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
  const convertToHours = (time: number | null, unit: string): number => {
    if (!time) return 0;
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
    if ((item.pay_type || 'hourly') === 'piece') {
      const pieceRate = item.piece_rate?.rate || 0;
      return pieceRate * item.quantity;
    }
    const hourlyRate = (item.hourly_rate?.hourly_rate ?? item.rate?.hourly_rate ?? item.job.category.current_hourly_rate) || 0;
    const timeInHours = convertToHours(item.time_required, item.time_unit);
    return hourlyRate * timeInHours * item.quantity;
  };
  
  // Calculate total hours for all BOL items
  const calculateTotalHours = (): number => {
    return bolItems.reduce((total, item: any) => {
      if ((item.pay_type || 'hourly') === 'piece') return total;
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Bill of Labor</CardTitle>
              <CardDescription>Manage the labor operations required to manufacture this product</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAddJobOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Add Job
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {bolLoading ? (
            <div className="text-center py-4">Loading BOL data...</div>
          ) : (
            <>
              {/* Unified Effective BOL Table (direct + linked) with inline edit for direct rows */}
              <div className="rounded-md border mb-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Pay Type</TableHead>
                      <TableHead>Time Required</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Total Time (hrs)</TableHead>
                      <TableHead>Total Cost</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unifiedRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-4">
                          No jobs added to this product yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      unifiedRows.map((it, idx) => {
                        const direct = (it._editable && typeof it.bol_id === 'number') ? bolById.get(Number(it.bol_id)) : undefined
                        const pay = (it.pay_type || (direct?.pay_type || 'hourly')) as 'hourly' | 'piece'
                        const qty = Number(it.quantity || direct?.quantity || 1)
                        const timeReq = pay === 'piece' ? null : (it.time_required ?? direct?.time_required ?? 0)
                        const unit = pay === 'piece' ? 'hours' : (it.time_unit ?? direct?.time_unit ?? 'hours')
                        const rate = pay === 'piece' ? (it.piece_rate ?? direct?.piece_rate?.rate ?? null) : (it.hourly_rate ?? direct?.hourly_rate?.hourly_rate ?? direct?.rate?.hourly_rate ?? direct?.job?.category?.current_hourly_rate ?? null)
                        const totalHrs = pay === 'piece' ? null : ((unit === 'hours' ? (timeReq || 0) : unit === 'minutes' ? (timeReq || 0)/60 : (timeReq || 0)/3600) * qty)
                        const totalCost = pay === 'piece' ? ((rate || 0) * qty) : ((rate || 0) * (totalHrs || 0))
                        const fromCode = typeof it._sub_product_id === 'number' ? linkProductMap.get(Number(it._sub_product_id))?.internal_code : undefined

                        if (direct && editingId === direct.bol_id) {
                          return (
                        <TableRow key={`bol-${idx}`}>
                          <Form {...form}>
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
                                  <Select
                                    value={form.watch('pay_type') || 'hourly'}
                                    onValueChange={(value: 'hourly' | 'piece') => form.setValue('pay_type', value)}
                                  >
                                    <SelectTrigger className="w-[120px]">
                                      <SelectValue placeholder="Pay Type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="hourly">Hourly</SelectItem>
                                      <SelectItem value="piece">Piecework</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={form.watch('time_required')}
                                    onChange={(e) => form.setValue('time_required', parseFloat(e.target.value))}
                                    className="w-20"
                                    disabled={form.watch('pay_type') === 'piece'}
                                  />
                                  <Select
                                    value={form.watch('time_unit')}
                                    onValueChange={(value: 'hours' | 'minutes' | 'seconds') => form.setValue('time_unit', value)}
                                    disabled={form.watch('pay_type') === 'piece'}
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
                                  const category = jobCategories.find(c => c.category_id.toString() === categoryId);
                                  if (form.watch('pay_type') === 'piece') {
                                    return 'Piece rate (as of today)';
                                  }
                                  // During edit we don't fetch job_hourly_rates live; display category fallback only
                                  return category ? `R${category.current_hourly_rate.toFixed(2)}/hr` : 'N/A';
                                })()}
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  if (form.watch('pay_type') === 'piece') return '—';
                                  const time = form.watch('time_required') || 0;
                                  const unit = form.watch('time_unit') || 'hours';
                                  const quantity = form.watch('quantity') || 1;
                                  return (convertToHours(time, unit) * quantity).toFixed(2);
                                })()}
                              </TableCell>
                              <TableCell>
                                {(() => {
                                  const categoryId = form.watch('job_category_id');
                                  const category = jobCategories.find(c => c.category_id.toString() === categoryId);
                                  const quantity = form.watch('quantity') || 1;
                                  if (form.watch('pay_type') === 'piece') {
                                    // We don't fetch piece rate here; just show qty placeholder total
                                    return `R—`;
                                  }
                                  const hourlyRate = category?.current_hourly_rate || 0;
                                  const time = form.watch('time_required') || 0;
                                  const unit = form.watch('time_unit') || 'hours';
                                  return `R${(hourlyRate * convertToHours(time, unit) * quantity).toFixed(2)}`;
                                })()}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => saveEdit(direct.bol_id)}
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
                            </Form>
                          </TableRow>
                          )
                        }

                        return (
                          <TableRow key={`bol-${idx}`}>
                            <TableCell>{it.category_name || direct?.job?.category?.name || ''}</TableCell>
                            <TableCell>{it.job_name || direct?.job?.name || ''}</TableCell>
                            <TableCell className="capitalize">{pay}</TableCell>
                            <TableCell>{pay === 'piece' ? '—' : `${timeReq ?? 0} ${unit}`}</TableCell>
                            <TableCell>{qty}</TableCell>
                            <TableCell>{pay === 'piece' ? (rate != null ? `R${Number(rate).toFixed(2)}/pc` : 'R—/pc') : (rate != null ? `R${Number(rate).toFixed(2)}/hr` : 'R—/hr')}</TableCell>
                            <TableCell>{totalHrs == null ? '—' : totalHrs.toFixed(2)}</TableCell>
                            <TableCell>R{Number(totalCost || 0).toFixed(2)}</TableCell>
                            <TableCell>
                              {direct ? (
                                <div className="flex items-center gap-2">
                                  <Button variant="ghost" size="icon" onClick={() => startEditing(direct)}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button variant="destructiveSoft" size="icon" onClick={() => deleteBOLItem.mutate(direct.bol_id)} aria-label="Delete job">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">Linked</Badge>
                                  {fromCode && <Badge variant="secondary">{fromCode}</Badge>}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Add Job Dialog */}
              <AddJobDialog
                productId={productId}
                open={addJobOpen}
                onOpenChange={setAddJobOpen}
                onApplied={() => {
                  queryClient.invalidateQueries({ queryKey: ['productBOL', productId] })
                  queryClient.invalidateQueries({ queryKey: ['effectiveBOL', productId] })
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

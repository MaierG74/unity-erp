'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Plus, Trash2, Calendar as CalendarIcon, Search } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

type Job = { job_id: number; name: string };
type Product = { product_id: number; name: string; internal_code: string | null };

type PieceRate = {
  rate_id: number;
  job_id: number;
  product_id: number | null;
  rate: number;
  effective_date: string;
  end_date: string | null;
};

const addRateSchema = z.object({
  job_id: z.string().min(1, 'Job is required'),
  applies_to: z.enum(['default', 'product']).default('default'),
  product_id: z.string().optional(),
  rate: z.coerce.number().min(0, 'Rate must be a positive number'),
  effective_date: z.date({ required_error: 'Effective date is required' }),
});

type AddRateFormValues = z.infer<typeof addRateSchema>;

export function PieceworkRatesManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [scope, setScope] = useState<'default' | 'product'>('default');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [productSearch, setProductSearch] = useState('');

  const addForm = useForm<AddRateFormValues>({
    resolver: zodResolver(addRateSchema),
    defaultValues: {
      job_id: '',
      applies_to: 'default',
      product_id: undefined,
      rate: 0,
      effective_date: new Date(),
    },
  });

  // Jobs
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs-simple'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('job_id, name')
        .order('name');
      if (error) throw error;
      return (data || []) as Job[];
    },
  });

  // Products (basic list; filtered client-side for search)
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products-simple'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('product_id, name, internal_code')
        .order('name')
        .limit(1000); // basic cap
      if (error) throw error;
      return (data || []) as Product[];
    },
  });

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.internal_code || '').toLowerCase().includes(q)
    );
  }, [products, productSearch]);

  // Rates for the selected scope
  const { data: rates = [], isLoading: ratesLoading, refetch: refetchRates } = useQuery({
    queryKey: ['piece-rates', selectedJobId, scope, selectedProductId],
    queryFn: async () => {
      if (!selectedJobId) return [] as PieceRate[];
      let query = supabase
        .from('piece_work_rates')
        .select('rate_id, job_id, product_id, rate, effective_date, end_date')
        .eq('job_id', parseInt(selectedJobId));
      if (scope === 'product') {
        if (!selectedProductId) return [] as PieceRate[];
        query = query.eq('product_id', parseInt(selectedProductId));
      } else {
        query = query.is('product_id', null);
      }
      const { data, error } = await query.order('effective_date', { ascending: false });
      if (error) throw error;
      return (data || []) as PieceRate[];
    },
  });

  // Add a new rate version
  const addRate = useMutation({
    mutationFn: async (values: AddRateFormValues) => {
      const jobId = parseInt(values.job_id);
      const productId = values.applies_to === 'product' && values.product_id ? parseInt(values.product_id) : null;
      const eff = values.effective_date.toISOString().split('T')[0];

      // Find next later rates to set end_date for the new row
      const { data: laterRates, error: laterErr } = await supabase
        .from('piece_work_rates')
        .select('*')
        .eq('job_id', jobId)
        .order('effective_date', { ascending: true })
        .gte('effective_date', eff)
        .maybeSingle();
      if (laterErr && laterErr.code !== 'PGRST116') throw laterErr; // ignore no rows

      let newEndDate: string | null = null;
      if (laterRates && (laterRates as any).effective_date) {
        const d = new Date((laterRates as any).effective_date);
        d.setDate(d.getDate() - 1);
        newEndDate = d.toISOString().split('T')[0];
      }

      // Narrow later/earlier queries to the same scope (product specific or default)
      const scopeFilter = (qb: any) =>
        productId == null ? qb.is('product_id', null) : qb.eq('product_id', productId);

      // Actually recompute later/earlier with correct scope
      const { data: laterScoped, error: laterScopedErr } = await scopeFilter(
        supabase
          .from('piece_work_rates')
          .select('*')
          .eq('job_id', jobId)
          .order('effective_date', { ascending: true })
          .gte('effective_date', eff)
      );
      if (laterScopedErr) throw laterScopedErr;
      newEndDate = null;
      if (laterScoped && laterScoped.length > 0) {
        const d = new Date(laterScoped[0].effective_date);
        d.setDate(d.getDate() - 1);
        newEndDate = d.toISOString().split('T')[0];
      }

      const { data: earlier, error: earlierErr } = await scopeFilter(
        supabase
          .from('piece_work_rates')
          .select('*')
          .eq('job_id', jobId)
          .lt('effective_date', eff)
          .order('effective_date', { ascending: false })
          .limit(1)
      );
      if (earlierErr) throw earlierErr;

      // Insert the new rate row
      const { data, error } = await supabase
        .from('piece_work_rates')
        .insert({
          job_id: jobId,
          product_id: productId,
          rate: values.rate,
          effective_date: eff,
          end_date: newEndDate,
        })
        .select();
      if (error) throw error;

      // Update end_date of the previous version if exists
      if (earlier && earlier.length > 0) {
        const prevEnd = new Date(values.effective_date);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const { error: updErr } = await supabase
          .from('piece_work_rates')
          .update({ end_date: prevEnd.toISOString().split('T')[0] })
          .eq('rate_id', earlier[0].rate_id);
        if (updErr) throw updErr;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['piece-rates'] });
      addForm.reset({ job_id: selectedJobId || '', applies_to: scope, product_id: scope === 'product' ? selectedProductId || '' : undefined, rate: 0, effective_date: new Date() });
      toast({ title: 'Success', description: 'Piecework rate added' });
      refetchRates();
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err?.message || 'Failed to add rate', variant: 'destructive' });
      console.error('Add piecework rate error:', err);
    },
  });

  const deleteRate = useMutation({
    mutationFn: async (rateId: number) => {
      const { error } = await supabase
        .from('piece_work_rates')
        .delete()
        .eq('rate_id', rateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['piece-rates'] });
      toast({ title: 'Success', description: 'Rate deleted' });
      refetchRates();
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: 'Failed to delete rate. It may be in use.', variant: 'destructive' });
      console.error('Delete piecework rate error:', err);
    },
  });

  // Keep add form synchronized with selection
  useEffect(() => {
    addForm.setValue('job_id', selectedJobId || '');
  }, [selectedJobId]);
  useEffect(() => {
    addForm.setValue('applies_to', scope);
  }, [scope]);
  useEffect(() => {
    addForm.setValue('product_id', scope === 'product' ? selectedProductId || '' : undefined);
  }, [selectedProductId, scope]);

  const onAddSubmit = (values: AddRateFormValues) => {
    if (values.applies_to === 'product' && !values.product_id) {
      addForm.setError('product_id', { type: 'manual', message: 'Product is required' });
      return;
    }
    addRate.mutate(values);
  };

  const currentScopeLabel = scope === 'default' ? 'All products (job default)' : 'Specific product';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Piecework Rates</CardTitle>
          <CardDescription>Manage per-piece rates by job and optional product override</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Form {...addForm}>
                <FormField
                  control={addForm.control}
                  name="job_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job</FormLabel>
                      <Select value={selectedJobId} onValueChange={(v) => { setSelectedJobId(v); }}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={jobsLoading ? 'Loading jobs...' : 'Select job'} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {jobs.map((j) => (
                            <SelectItem key={j.job_id} value={j.job_id.toString()}>{j.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Form>
            </div>

            <div>
              <Form {...addForm}>
                <FormField
                  control={addForm.control}
                  name="applies_to"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Applies To</FormLabel>
                      <Select value={scope} onValueChange={(v: 'default' | 'product') => setScope(v)}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Scope" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="default">All products (job default)</SelectItem>
                          <SelectItem value="product">Specific product</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </Form>
            </div>

            <div>
              {scope === 'product' && (
                <div className="space-y-2">
                  <Form {...addForm}>
                    <FormField
                      control={addForm.control}
                      name="product_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Product</FormLabel>
                          <Select value={selectedProductId} onValueChange={(v) => setSelectedProductId(v)}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={productsLoading ? 'Loading products...' : 'Select product'} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {/* Lightweight search */}
                              <div className="px-2 py-2">
                                <div className="flex items-center gap-2">
                                  <Search className="h-4 w-4 text-muted-foreground" />
                                  <Input placeholder="Search products" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
                                </div>
                              </div>
                              {filteredProducts.map((p) => (
                                <SelectItem key={p.product_id} value={p.product_id.toString()}>
                                  {(p.internal_code ? `${p.internal_code} — ` : '') + p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </Form>
                </div>
              )}
            </div>
          </div>

          {/* Rates table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Applies To</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Effective To</TableHead>
                  <TableHead className="w-[90px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!selectedJobId ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                      Select a job to view piecework rates
                    </TableCell>
                  </TableRow>
                ) : ratesLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6">Loading rates...</TableCell>
                  </TableRow>
                ) : rates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6">No rates for this selection</TableCell>
                  </TableRow>
                ) : (
                  rates.map((r) => {
                    const job = jobs.find(j => j.job_id === r.job_id);
                    const product = r.product_id ? products.find(p => p.product_id === r.product_id) : null;
                    return (
                      <TableRow key={r.rate_id}>
                        <TableCell>{job?.name || r.job_id}</TableCell>
                        <TableCell>{product ? ((product.internal_code ? `${product.internal_code} — ` : '') + product.name) : 'All products'}</TableCell>
                        <TableCell>R{r.rate.toFixed(2)}/pc</TableCell>
                        <TableCell>{format(new Date(r.effective_date), 'PPP')}</TableCell>
                        <TableCell>{r.end_date ? format(new Date(r.end_date), 'PPP') : 'Current'}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => {
                            if (confirm('Delete this rate version?')) deleteRate.mutate(r.rate_id);
                          }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Add rate version */}
          <Card>
            <CardHeader>
              <CardTitle className="text-md">Add Rate Version</CardTitle>
              <CardDescription>
                {selectedJobId ? `For ${currentScopeLabel}` : 'Select a job first'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...addForm}>
                <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={addForm.control}
                    name="rate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Piece Rate (R)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={addForm.control}
                    name="effective_date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Effective Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant={'outline'} className={cn('w-full pl-3 text-left font-normal', !field.value && 'text-muted-foreground')}>
                                {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date < new Date('1900-01-01')} initialFocus />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex items-end justify-end">
                    <Button type="submit" disabled={addRate.isPending || !selectedJobId || (scope === 'product' && !selectedProductId)}>
                      {addRate.isPending ? 'Adding...' : <><Plus className="h-4 w-4 mr-2" />Add Rate</>}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}


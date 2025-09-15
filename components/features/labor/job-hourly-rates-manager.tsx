'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type Job = { job_id: number; name: string };
type HourlyRate = { rate_id: number; job_id: number; hourly_rate: number; effective_date: string; end_date: string | null };

const addSchema = z.object({
  job_id: z.string().min(1, 'Job is required'),
  hourly_rate: z.coerce.number().min(0, 'Rate must be positive'),
  effective_date: z.date({ required_error: 'Effective date is required' }),
});
type AddFormValues = z.infer<typeof addSchema>;

export function JobHourlyRatesManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState<string>('');

  const addForm = useForm<AddFormValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { job_id: '', hourly_rate: 0, effective_date: new Date() },
  });

  // Jobs
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs-simple'],
    queryFn: async () => {
      const { data, error } = await supabase.from('jobs').select('job_id, name').order('name');
      if (error) throw error;
      return (data || []) as Job[];
    },
  });

  // Rates
  const { data: rates = [], isLoading: ratesLoading, refetch } = useQuery({
    queryKey: ['job-hourly-rates', selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return [] as HourlyRate[];
      const { data, error } = await supabase
        .from('job_hourly_rates')
        .select('rate_id, job_id, hourly_rate, effective_date, end_date')
        .eq('job_id', parseInt(selectedJobId))
        .order('effective_date', { ascending: false });
      if (error) throw error;
      return (data || []) as HourlyRate[];
    },
  });

  // Add
  const addRate = useMutation({
    mutationFn: async (values: AddFormValues) => {
      const jobId = parseInt(values.job_id);
      const eff = values.effective_date.toISOString().split('T')[0];

      // Determine end_date based on next later version
      const { data: later, error: laterErr } = await supabase
        .from('job_hourly_rates')
        .select('*')
        .eq('job_id', jobId)
        .gte('effective_date', eff)
        .order('effective_date', { ascending: true });
      if (laterErr) throw laterErr;
      let endDate: string | null = null;
      if (later && later.length > 0) {
        const d = new Date(later[0].effective_date);
        d.setDate(d.getDate() - 1);
        endDate = d.toISOString().split('T')[0];
      }

      // Previous version to close
      const { data: earlier, error: earlierErr } = await supabase
        .from('job_hourly_rates')
        .select('*')
        .eq('job_id', jobId)
        .lt('effective_date', eff)
        .order('effective_date', { ascending: false })
        .limit(1);
      if (earlierErr) throw earlierErr;

      const { data, error } = await supabase
        .from('job_hourly_rates')
        .insert({ job_id: jobId, hourly_rate: values.hourly_rate, effective_date: eff, end_date: endDate })
        .select();
      if (error) throw error;

      if (earlier && earlier.length > 0) {
        const prevEnd = new Date(values.effective_date);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const { error: updErr } = await supabase
          .from('job_hourly_rates')
          .update({ end_date: prevEnd.toISOString().split('T')[0] })
          .eq('rate_id', (earlier as any)[0].rate_id);
        if (updErr) throw updErr;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-hourly-rates'] });
      addForm.reset({ job_id: selectedJobId || '', hourly_rate: 0, effective_date: new Date() });
      refetch();
    },
  });

  const deleteRate = useMutation({
    mutationFn: async (rateId: number) => {
      const { error } = await supabase.from('job_hourly_rates').delete().eq('rate_id', rateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-hourly-rates'] });
      refetch();
      toast({ title: 'Deleted', description: 'Hourly rate removed' });
    },
  });

  useEffect(() => {
    addForm.setValue('job_id', selectedJobId || '');
  }, [selectedJobId]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Job Hourly Rates</CardTitle>
          <CardDescription>Versioned hourly rates per job</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Form {...addForm}>
              <FormField
                control={addForm.control}
                name="job_id"
                render={() => (
                  <FormItem>
                    <FormLabel>Job</FormLabel>
                    <Select value={selectedJobId} onValueChange={(v) => setSelectedJobId(v)}>
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

          {/* Rates table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Hourly Rate</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Effective To</TableHead>
                  <TableHead className="w-[90px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!selectedJobId ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Select a job to view rates</TableCell></TableRow>
                ) : ratesLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6">Loading...</TableCell></TableRow>
                ) : rates.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6">No rates</TableCell></TableRow>
                ) : (
                  rates.map((r) => (
                    <TableRow key={r.rate_id}>
                      <TableCell>{jobs.find(j => j.job_id === r.job_id)?.name || r.job_id}</TableCell>
                      <TableCell>R{r.hourly_rate.toFixed(2)}/hr</TableCell>
                      <TableCell>{format(new Date(r.effective_date), 'PPP')}</TableCell>
                      <TableCell>{r.end_date ? format(new Date(r.end_date), 'PPP') : 'Current'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm('Delete this rate version?')) deleteRate.mutate(r.rate_id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Add rate */}
          <Card>
            <CardHeader>
              <CardTitle className="text-md">Add Rate Version</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...addForm}>
                <form className="grid grid-cols-1 md:grid-cols-3 gap-4" onSubmit={addForm.handleSubmit((v) => addRate.mutate(v))}>
                  <FormField
                    control={addForm.control}
                    name="hourly_rate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hourly Rate (R)</FormLabel>
                        <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
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
                    <Button type="submit" disabled={addRate.isPending || !selectedJobId}>{addRate.isPending ? 'Adding...' : 'Add Rate'}</Button>
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

export default JobHourlyRatesManager;


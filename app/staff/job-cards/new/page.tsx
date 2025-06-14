'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { CalendarIcon, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const jobCardSchema = z.object({
  orderId: z.string().optional(),
  staffId: z.string().min(1, 'Staff member is required'),
  issueDate: z.date(),
  dueDate: z.date().optional(),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string().min(1, 'Product is required'),
      jobId: z.string().min(1, 'Job is required'),
      quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
      pieceRate: z.coerce.number().min(0, 'Piece rate must be a positive number'),
    })
  ).min(1, 'At least one item is required'),
});

type JobCardFormValues = z.infer<typeof jobCardSchema>;

export default function NewJobCardPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [pieceWorkRates, setPieceWorkRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const form = useForm<JobCardFormValues>({
    resolver: zodResolver(jobCardSchema),
    defaultValues: {
      issueDate: new Date(),
      items: [
        {
          productId: '',
          jobId: '',
          quantity: 1,
          pieceRate: 0,
        },
      ],
    },
  });

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch staff
        const { data: staffData, error: staffError } = await supabase
          .from('staff')
          .select('staff_id, first_name, last_name')
          .eq('is_active', true);
        
        if (staffError) throw staffError;
        setStaff(staffData || []);

        // Fetch orders
        const { data: ordersData, error: ordersError } = await supabase
          .from('orders')
          .select('order_id, order_number');
        
        if (ordersError) throw ordersError;
        setOrders(ordersData || []);

        // Fetch products
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('product_id, name, internal_code');
        
        if (productsError) throw productsError;
        setProducts(productsData || []);

        // Fetch jobs
        const { data: jobsData, error: jobsError } = await supabase
          .from('jobs')
          .select('job_id, name');
        
        if (jobsError) throw jobsError;
        setJobs(jobsData || []);

        // Fetch piece work rates
        const { data: ratesData, error: ratesError } = await supabase
          .from('piece_work_rates')
          .select('rate_id, job_id, product_id, rate')
          .is('end_date', null);
        
        if (ratesError) throw ratesError;
        setPieceWorkRates(ratesData || []);
      } catch (err: any) {
        console.error('Error fetching data:', err);
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Function to find piece rate for a product and job combination
  const findPieceRate = (productId: string, jobId: string) => {
    const rate = pieceWorkRates.find(
      (r) => r.product_id.toString() === productId && r.job_id.toString() === jobId
    );
    return rate ? rate.rate : 0;
  };

  // Update piece rate when product or job changes
  const updatePieceRate = (index: number, productId: string, jobId: string) => {
    if (productId && jobId) {
      const rate = findPieceRate(productId, jobId);
      const items = form.getValues('items');
      items[index].pieceRate = rate;
      form.setValue(`items.${index}.pieceRate`, rate);
    }
  };

  const addItem = () => {
    const items = form.getValues('items');
    form.setValue('items', [
      ...items,
      {
        productId: '',
        jobId: '',
        quantity: 1,
        pieceRate: 0,
      },
    ]);
  };

  const removeItem = (index: number) => {
    const items = form.getValues('items');
    if (items.length > 1) {
      form.setValue(
        'items',
        items.filter((_, i) => i !== index)
      );
    }
  };

  async function onSubmit(data: JobCardFormValues) {
    setIsSubmitting(true);
    setError(null);
    
    try {
      // Insert job card
      const { data: jobCardData, error: jobCardError } = await supabase
        .from('job_cards')
        .insert([
          {
            order_id: data.orderId ? parseInt(data.orderId) : null,
            staff_id: parseInt(data.staffId),
            issue_date: data.issueDate.toISOString().split('T')[0],
            due_date: data.dueDate ? data.dueDate.toISOString().split('T')[0] : null,
            notes: data.notes,
            status: 'pending',
          },
        ])
        .select();

      if (jobCardError) throw jobCardError;
      
      if (!jobCardData || jobCardData.length === 0) {
        throw new Error('Failed to create job card');
      }

      const jobCardId = jobCardData[0].job_card_id;

      // Insert job card items
      const jobCardItems = data.items.map((item) => ({
        job_card_id: jobCardId,
        product_id: parseInt(item.productId),
        job_id: parseInt(item.jobId),
        quantity: item.quantity,
        piece_rate: item.pieceRate,
        status: 'pending',
      }));

      const { error: itemsError } = await supabase
        .from('job_card_items')
        .insert(jobCardItems);

      if (itemsError) throw itemsError;
      
      router.push('/staff/job-cards');
      router.refresh();
    } catch (err: any) {
      console.error('Error creating job card:', err);
      setError(err.message || 'Failed to create job card');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" size="sm" asChild className="mr-2">
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Staff
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Create New Job Card</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job Card Details</CardTitle>
          <CardDescription>
            Assign work to a staff member by creating a job card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="staffId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Staff Member</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select staff member" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {staff.map((s) => (
                            <SelectItem key={s.staff_id} value={s.staff_id.toString()}>
                              {s.first_name} {s.last_name}
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
                  name="orderId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Related Order (Optional)</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select order" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {orders.map((o) => (
                            <SelectItem key={o.order_id} value={o.order_id.toString()}>
                              {o.order_number || `Order #${o.order_id}`}
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
                  name="issueDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Issue Date</FormLabel>
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
                
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Due Date (Optional)</FormLabel>
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
              </div>
              
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Additional notes or instructions" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium">Job Card Items</h3>
                  <Button type="button" variant="outline" size="sm" onClick={addItem}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Item
                  </Button>
                </div>
                
                {form.getValues('items').map((_, index) => (
                  <div key={index} className="border rounded-md p-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium">Item {index + 1}</h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        disabled={form.getValues('items').length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`items.${index}.productId`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Product</FormLabel>
                            <Select
                              onValueChange={(value) => {
                                field.onChange(value);
                                updatePieceRate(index, value, form.getValues(`items.${index}.jobId`));
                              }}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select product" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {products.map((p) => (
                                  <SelectItem key={p.product_id} value={p.product_id.toString()}>
                                    {p.internal_code} - {p.name}
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
                        name={`items.${index}.jobId`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Job</FormLabel>
                            <Select
                              onValueChange={(value) => {
                                field.onChange(value);
                                updatePieceRate(index, form.getValues(`items.${index}.productId`), value);
                              }}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select job" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {jobs.map((j) => (
                                  <SelectItem key={j.job_id} value={j.job_id.toString()}>
                                    {j.name}
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
                        name={`items.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Quantity</FormLabel>
                            <FormControl>
                              <Input type="number" min="1" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name={`items.${index}.pieceRate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Piece Rate ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" min="0" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="flex justify-end space-x-2">
                <Button variant="outline" type="button" onClick={() => router.push('/staff')}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Job Card'}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
} 
'use client';

import { useState } from 'react';
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { CalendarIcon, ArrowLeft } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { Alert, AlertDescription } from '@/components/ui/alert';

const staffFormSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  address: z.string().optional(),
  dateOfBirth: z.date().optional(),
  hireDate: z.date(),
  hourlyRate: z.coerce.number().min(0, 'Hourly rate must be a positive number'),
  weeklyHours: z.coerce.number().min(0, 'Weekly hours must be a positive number'),
});

type StaffFormValues = z.infer<typeof staffFormSchema>;

export default function NewStaffPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idFiles, setIdFiles] = useState<File[]>([]);
  const [idPreviews, setIdPreviews] = useState<string[]>([]);
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  const [bankPreviews, setBankPreviews] = useState<string[]>([]);

  function handleIdFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    setIdFiles(files);
    setIdPreviews(files.map(f => URL.createObjectURL(f)));
  }

  function handleBankFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    setBankFiles(files);
    setBankPreviews(files.map(f => URL.createObjectURL(f)));
  }

  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      address: '',
      hireDate: new Date(),
      hourlyRate: 0,
      weeklyHours: 40,
    },
  });

  async function onSubmit(data: StaffFormValues) {
    setIsSubmitting(true);
    setError(null);
    
    try {
      const { data: staffData, error: staffError } = await supabase
        .from('staff')
        .insert([
          {
            first_name: data.firstName,
            last_name: data.lastName,
            email: data.email,
            phone: data.phone,
            address: data.address,
            date_of_birth: data.dateOfBirth ? data.dateOfBirth.toISOString().split('T')[0] : null,
            hire_date: data.hireDate.toISOString().split('T')[0],
            hourly_rate: data.hourlyRate,
            weekly_hours: data.weeklyHours,
          },
        ])
        .select();

      if (staffError) throw staffError;

        // Upload attachments after staff created
        const staffId = staffData[0].staff_id;
        // ID Documents
        const idUrls: string[] = [];
        for (const file of idFiles) {
          const path = `Staff/${staffId}/${file.name}`;
          const { error: upErr } = await supabase.storage.from('QButton').upload(path, file);
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from('QButton').getPublicUrl(path);
          idUrls.push(urlData.publicUrl);
        }
        // Bank Documents
        const bankUrls: string[] = [];
        for (const file of bankFiles) {
          const path = `Staff/${staffId}/${file.name}`;
          const { error: upErr } = await supabase.storage.from('QButton').upload(path, file);
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from('QButton').getPublicUrl(path);
          bankUrls.push(urlData.publicUrl);
        }
        // Update staff row with URLs
        const { error: updErr } = await supabase.from('staff')
          .update({ id_document_urls: idUrls, bank_account_image_urls: bankUrls })
          .eq('staff_id', staffId);
        if (updErr) throw updErr;
      
      router.push('/staff');
      router.refresh();
    } catch (err: any) {
      console.error('Error creating staff member:', err);
      setError(err.message || 'Failed to create staff member');
    } finally {
      setIsSubmitting(false);
    }
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
        <h1 className="text-3xl font-bold tracking-tight">Add New Staff Member</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Staff Information</CardTitle>
          <CardDescription>
            Enter the details of the new staff member.
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
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john.doe@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="+1 (555) 123-4567" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="dateOfBirth"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Date of Birth</FormLabel>
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
                            disabled={(date) =>
                              date > new Date() || date < new Date("1900-01-01")
                            }
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
                  name="hireDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Hire Date</FormLabel>
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
                            disabled={(date) =>
                              date > new Date("2100-01-01") || date < new Date("1900-01-01")
                            }
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
                  name="hourlyRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hourly Rate (R)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="weeklyHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weekly Hours</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.5" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea placeholder="123 Main St, City, State, ZIP" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {/* Attachment Uploads */}
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Attachments</CardTitle>
                  <CardDescription>Upload staff identification and banking documents</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* ID Documents Section */}
                  <div>
                    <FormItem className="space-y-3">
                      <FormLabel className="text-base">ID Documents</FormLabel>
                      <FormDescription>Upload government-issued ID or other identification</FormDescription>
                      <div className="flex items-center gap-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-[200px] h-32 border-dashed flex flex-col items-center justify-center gap-1"
                          onClick={() => document.getElementById('id-upload')?.click()}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <span className="text-sm">Add Files</span>
                        </Button>
                        <input 
                          id="id-upload"
                          type="file" 
                          multiple 
                          accept="image/*" 
                          onChange={handleIdFilesChange} 
                          className="hidden"
                        />
                        {idPreviews.length > 0 && (
                          <div className="flex gap-2 overflow-x-auto pb-2">
                            {idPreviews.map((src, idx) => (
                              <div key={idx} className="relative group">
                                <div className="h-32 w-32 rounded-md overflow-hidden border border-border">
                                  <Image 
                                    src={src} 
                                    alt={`ID preview ${idx}`} 
                                    width={128} 
                                    height={128} 
                                    className="object-cover h-full w-full"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </FormItem>
                  </div>
                  
                  {/* Bank Documents Section */}
                  <div>
                    <FormItem className="space-y-3">
                      <FormLabel className="text-base">Bank Documents</FormLabel>
                      <FormDescription>Upload bank statements or account information</FormDescription>
                      <div className="flex items-center gap-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-[200px] h-32 border-dashed flex flex-col items-center justify-center gap-1"
                          onClick={() => document.getElementById('bank-upload')?.click()}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <span className="text-sm">Add Files</span>
                        </Button>
                        <input 
                          id="bank-upload"
                          type="file" 
                          multiple 
                          accept="image/*" 
                          onChange={handleBankFilesChange} 
                          className="hidden"
                        />
                        {bankPreviews.length > 0 && (
                          <div className="flex gap-2 overflow-x-auto pb-2">
                            {bankPreviews.map((src, idx) => (
                              <div key={idx} className="relative group">
                                <div className="h-32 w-32 rounded-md overflow-hidden border border-border">
                                  <Image 
                                    src={src} 
                                    alt={`Bank preview ${idx}`} 
                                    width={128} 
                                    height={128} 
                                    className="object-cover h-full w-full"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </FormItem>
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" type="button" onClick={() => router.push('/staff')}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save Staff Member'}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
} 
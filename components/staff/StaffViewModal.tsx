'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';

type StaffViewModalProps = {
  staff: {
    staff_id: number;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    job_description: string | null;
    hourly_rate: number;
    is_active: boolean;
    current_staff: boolean;
    date_of_birth?: string | null;
    hire_date?: string | null;
    address?: string | null;
    weekly_hours?: number | null;
    tax_number?: string | null;
    bank_account_image_urls?: string[];
    id_document_urls?: string[];
    airtable_id?: string | null;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function StaffViewModal({ staff, open, onOpenChange }: StaffViewModalProps) {
  const [activeTab, setActiveTab] = useState('details');

  if (!staff) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-4">
            <Avatar className="h-12 w-12">
              <AvatarFallback>{`${staff.first_name.charAt(0)}${staff.last_name.charAt(0)}`}</AvatarFallback>
            </Avatar>
            <div>
              {staff.first_name} {staff.last_name}
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={staff.is_active ? "success" : "outline"}>
                  {staff.is_active ? "Active" : "Inactive"}
                </Badge>
                {staff.job_description && (
                  <Badge variant="outline">{staff.job_description}</Badge>
                )}
              </div>
            </div>
          </DialogTitle>
          <DialogDescription>
            Staff ID: {staff.staff_id} {staff.airtable_id && `• Airtable ID: ${staff.airtable_id}`}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid grid-cols-3 mb-4">
            <TabsTrigger value="details">Personal Details</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Phone</h3>
                <p>{staff.phone || 'Not provided'}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Email</h3>
                <p>{staff.email || 'Not provided'}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Date of Birth</h3>
                <p>{staff.date_of_birth ? format(new Date(staff.date_of_birth), 'PPP') : 'Not provided'}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Tax Number</h3>
                <p>{staff.tax_number || 'Not provided'}</p>
              </div>
            </div>

            {staff.address && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Address</h3>
                <p className="whitespace-pre-line">{staff.address}</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="employment" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Job Description</h3>
                <p>{staff.job_description || 'Not assigned'}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Hire Date</h3>
                <p>{staff.hire_date ? format(new Date(staff.hire_date), 'PPP') : 'Not provided'}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Hourly Rate</h3>
                <p className="text-lg font-semibold">R{Number(staff.hourly_rate).toFixed(2)}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Weekly Hours</h3>
                <p>{staff.weekly_hours || '40'} hours</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Status</h3>
                <Badge variant={staff.is_active ? "success" : "outline"}>
                  {staff.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Current Staff</h3>
                <Badge variant={staff.current_staff ? "success" : "outline"}>
                  {staff.current_staff ? "Yes" : "No"}
                </Badge>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            {staff.bank_account_image_urls && staff.bank_account_image_urls.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Bank Account Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {staff.bank_account_image_urls.map((url, index) => (
                    <div key={`bank-${index}`} className="border rounded-md overflow-hidden">
                      <div className="relative h-64 w-full">
                        <Image 
                          src={url} 
                          alt="Bank account document" 
                          fill 
                          style={{ objectFit: 'contain' }} 
                        />
                      </div>
                      <div className="p-2 bg-muted flex justify-end">
                        <Button variant="ghost" size="sm" asChild>
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open Original
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {staff.id_document_urls && staff.id_document_urls.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>ID Documents</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {staff.id_document_urls.map((url, index) => (
                    <div key={`id-${index}`} className="border rounded-md overflow-hidden">
                      <div className="relative h-64 w-full">
                        <Image 
                          src={url} 
                          alt="ID document" 
                          fill 
                          style={{ objectFit: 'contain' }} 
                        />
                      </div>
                      <div className="p-2 bg-muted flex justify-end">
                        <Button variant="ghost" size="sm" asChild>
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open Original
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {(!staff.bank_account_image_urls || staff.bank_account_image_urls.length === 0) && 
             (!staff.id_document_urls || staff.id_document_urls.length === 0) && (
              <div className="text-center py-8 text-muted-foreground">
                No documents available for this staff member.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlusCircle, Users, ClipboardList, Clock, DollarSign } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { useRouter } from 'next/navigation';
import { StaffTable } from '@/components/staff/StaffTable';
import { Suspense } from 'react';

export default function StaffPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('staff');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Staff Management</h1>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/staff/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Staff Member
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/staff/job-cards/new">
              <ClipboardList className="mr-2 h-4 w-4" />
              Create Job Card
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="staff" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="staff">
            <Users className="mr-2 h-4 w-4" />
            Staff List
          </TabsTrigger>
          <TabsTrigger value="job-cards" onClick={() => router.push('/staff/job-cards')}>
            <ClipboardList className="mr-2 h-4 w-4" />
            Job Cards
          </TabsTrigger>
          <TabsTrigger value="hours" onClick={() => router.push('/staff/hours')}>
            <Clock className="mr-2 h-4 w-4" />
            Hours Tracking
          </TabsTrigger>
          <TabsTrigger value="payroll" onClick={() => router.push('/staff/payroll')}>
            <DollarSign className="mr-2 h-4 w-4" />
            Payroll
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="staff" className="space-y-4">
          <div className="rounded-md border">
            <div className="p-4">
              <h2 className="text-xl font-semibold">Staff Directory</h2>
              <p className="text-sm text-muted-foreground">
                Manage your staff members, view their details, and track their performance.
              </p>
            </div>
            <div className="p-4">
              <Suspense fallback={<div>Loading staff data...</div>}>
                <StaffTable />
              </Suspense>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="job-cards" className="space-y-4">
          <div className="rounded-md border">
            <div className="p-4">
              <h2 className="text-xl font-semibold">Job Cards</h2>
              <p className="text-sm text-muted-foreground">
                Manage job cards assigned to staff members and track their progress.
              </p>
            </div>
            <div className="p-4">
              {/* Job cards list will be loaded here */}
              <p className="text-muted-foreground">Loading job cards...</p>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="hours" className="space-y-4">
          <div className="rounded-md border">
            <div className="p-4">
              <h2 className="text-xl font-semibold">Hours Tracking</h2>
              <p className="text-sm text-muted-foreground">
                Track staff working hours and view time reports.
              </p>
            </div>
            <div className="p-4">
              {/* Hours tracking interface will be loaded here */}
              <p className="text-muted-foreground">Loading hours data...</p>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="payroll" className="space-y-4">
          <div className="rounded-md border">
            <div className="p-4">
              <h2 className="text-xl font-semibold">Payroll</h2>
              <p className="text-sm text-muted-foreground">
                Calculate and manage staff payroll based on hours worked and piece work completed.
              </p>
            </div>
            <div className="p-4">
              {/* Payroll interface will be loaded here */}
              <p className="text-muted-foreground">Loading payroll data...</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
} 
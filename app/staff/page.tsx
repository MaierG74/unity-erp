'use client';

/**
 * Staff Page
 *
 * REFACTORED: Uses PageToolbar for compact header layout.
 * - Removed separate h1 and button row
 * - Actions consolidated into PageToolbar
 * - Reduced vertical spacing
 * - Removed verbose descriptions in tab content
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlusCircle, Users, ClipboardList, Clock, DollarSign } from 'lucide-react';
import { useAuth } from '@/components/common/auth-provider';
import { useRouter } from 'next/navigation';
import { StaffTable } from '@/components/features/staff/StaffTable';
import { Suspense } from 'react';
import { PageToolbar } from '@/components/ui/page-toolbar';

export default function StaffPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('staff');

  return (
    // CHANGED: Reduced space-y from 6 to 2
    <div className="space-y-2">
      {/* NEW: PageToolbar replaces separate h1 and button row */}
      <PageToolbar
        title="Staff Management"
        actions={[
          {
            label: 'Add Staff',
            onClick: () => router.push('/staff/new'),
            icon: <PlusCircle className="h-4 w-4" />,
          },
          {
            label: 'Create Job Card',
            onClick: () => router.push('/staff/job-cards/new'),
            icon: <ClipboardList className="h-4 w-4" />,
            variant: 'outline',
          },
        ]}
      />

      {/* CHANGED: Reduced space-y from 4 to 2 */}
      <Tabs defaultValue="staff" value={activeTab} onValueChange={setActiveTab} className="space-y-2">
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

        {/* CHANGED: Reduced space-y, removed verbose description sections */}
        <TabsContent value="staff" className="space-y-2">
          <div className="rounded-md border">
            {/* CHANGED: Removed description paragraph for space */}
            <div className="p-4">
              <Suspense fallback={<div>Loading staff data...</div>}>
                <StaffTable />
              </Suspense>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="job-cards" className="space-y-2">
          <div className="rounded-md border">
            <div className="p-4">
              <p className="text-muted-foreground">Loading job cards...</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="hours" className="space-y-2">
          <div className="rounded-md border">
            <div className="p-4">
              <p className="text-muted-foreground">Loading hours data...</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="payroll" className="space-y-2">
          <div className="rounded-md border">
            <div className="p-4">
              <p className="text-muted-foreground">Loading payroll data...</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

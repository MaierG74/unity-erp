'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Clock, CalendarDays, BarChart3, Table as TableIcon } from 'lucide-react';
import Link from 'next/link';
import { DailyAttendanceGrid } from '@/components/features/staff/DailyAttendanceGrid';
import { WeeklySummary } from '@/components/features/staff/WeeklySummary';
import { StaffReports } from '@/components/features/staff/StaffReports';
import { WagesGrid } from '@/components/features/staff/WagesGrid';

export default function HoursTrackingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get tab from URL or default to 'daily'
  const tabParam = searchParams.get('tab');
  const validTabs = ['daily', 'wages-grid', 'weekly', 'reports'];
  const [activeTab, setActiveTab] = useState(
    tabParam && validTabs.includes(tabParam) ? tabParam : 'daily'
  );

  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', value);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" size="sm" asChild className="mr-2">
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Staff
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Hours Tracking</h1>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="daily" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Daily Attendance
          </TabsTrigger>
          <TabsTrigger value="wages-grid" className="flex items-center gap-2">
            <TableIcon className="h-4 w-4" />
            Quick Entry
          </TabsTrigger>
          <TabsTrigger value="weekly" className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Weekly Summary
          </TabsTrigger>
          <TabsTrigger value="reports" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="space-y-4">
          <DailyAttendanceGrid />
        </TabsContent>

        <TabsContent value="wages-grid" className="space-y-4">
          <WagesGrid />
        </TabsContent>

        <TabsContent value="weekly" className="space-y-4">
          <WeeklySummary />
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <StaffReports />
        </TabsContent>
      </Tabs>
    </div>
  );
}
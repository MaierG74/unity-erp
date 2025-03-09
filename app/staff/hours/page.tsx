'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Clock, Calendar as CalendarIcon, BarChart } from 'lucide-react';
import Link from 'next/link';
import { DailyAttendanceGrid } from '@/components/staff/DailyAttendanceGrid';
import { WeeklySummary } from '@/components/staff/WeeklySummary';
import { StaffReports } from '@/components/staff/StaffReports';

export default function HoursTrackingPage() {
  const [activeTab, setActiveTab] = useState('daily');

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

      <Tabs defaultValue="daily" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="daily">
            <Clock className="mr-2 h-4 w-4" />
            Daily Attendance
          </TabsTrigger>
          <TabsTrigger value="weekly">
            <CalendarIcon className="mr-2 h-4 w-4" />
            Weekly Summary
          </TabsTrigger>
          <TabsTrigger value="reports">
            <BarChart className="mr-2 h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="daily" className="space-y-4">
          <DailyAttendanceGrid />
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
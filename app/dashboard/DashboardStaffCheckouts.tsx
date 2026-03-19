'use client';

import { useEffect, useState } from 'react';
import { format, subDays } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';

type PendingStaffMember = {
  staff_id: number;
  first_name: string;
  last_name: string;
};

export function DashboardStaffCheckouts() {
  const [todayPending, setTodayPending] = useState<PendingStaffMember[]>([]);
  const [yesterdayPending, setYesterdayPending] = useState<PendingStaffMember[]>([]);
  const [showToday, setShowToday] = useState(true);
  const [showYesterday, setShowYesterday] = useState(true);

  useEffect(() => {
    async function fetchPending() {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const { data: todaySummaries, error: todayError } = await supabase
        .from('time_daily_summary')
        .select('staff_id')
        .eq('date_worked', todayStr)
        .eq('is_complete', false);

      if (!todayError && todaySummaries?.length) {
        const ids = todaySummaries.map((summary) => summary.staff_id);
        const { data: staffData } = await supabase
          .from('staff')
          .select('staff_id, first_name, last_name')
          .in('staff_id', ids);
        setTodayPending(staffData || []);
      }

      const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      const { data: yesterdaySummaries, error: yesterdayError } = await supabase
        .from('time_daily_summary')
        .select('staff_id')
        .eq('date_worked', yesterdayStr)
        .eq('is_complete', false);

      if (!yesterdayError && yesterdaySummaries?.length) {
        const ids = yesterdaySummaries.map((summary) => summary.staff_id);
        const { data: staffData } = await supabase
          .from('staff')
          .select('staff_id, first_name, last_name')
          .in('staff_id', ids);
        setYesterdayPending(staffData || []);
      }
    }

    fetchPending();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.2 }}
    >
      <Card className="shadow-md border-none">
        <CardHeader>
          <CardTitle>Pending Staff Check Outs</CardTitle>
          <CardDescription>Attendance exceptions still open for today and yesterday.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border p-4">
            <button
              onClick={() => setShowToday((value) => !value)}
              className="flex w-full items-center justify-between text-sm font-medium"
            >
              <div className="flex items-center space-x-2">
                <div
                  className={`h-2 w-2 rounded-full ${
                    todayPending.length > 0 ? 'bg-destructive' : 'bg-success'
                  }`}
                />
                <span>Still to Check-Out Today</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {todayPending.length}
                </span>
              </div>
              <ChevronRight
                className={`transform transition-transform duration-200 ${
                  showToday ? 'rotate-90' : ''
                }`}
              />
            </button>
            {showToday && todayPending.length > 0 ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {todayPending.map((staffMember) => (
                  <li
                    key={staffMember.staff_id}
                    className="flex items-center rounded bg-accent/50 p-2 text-sm"
                  >
                    <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {staffMember.first_name[0]}
                      {staffMember.last_name[0]}
                    </div>
                    {staffMember.first_name} {staffMember.last_name}
                  </li>
                ))}
              </ul>
            ) : null}
            {showToday && todayPending.length === 0 ? (
              <p className="mt-2 pl-4 text-sm text-muted-foreground">All clear for today.</p>
            ) : null}
          </div>

          <div className="rounded-lg border p-4">
            <button
              onClick={() => setShowYesterday((value) => !value)}
              className="flex w-full items-center justify-between text-sm font-medium"
            >
              <div className="flex items-center space-x-2">
                <div
                  className={`h-2 w-2 rounded-full ${
                    yesterdayPending.length > 0 ? 'bg-warning' : 'bg-success'
                  }`}
                />
                <span>Not Checked-Out Yesterday</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {yesterdayPending.length}
                </span>
              </div>
              <ChevronRight
                className={`transform transition-transform duration-200 ${
                  showYesterday ? 'rotate-90' : ''
                }`}
              />
            </button>
            {showYesterday && yesterdayPending.length > 0 ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {yesterdayPending.map((staffMember) => (
                  <li
                    key={staffMember.staff_id}
                    className="flex items-center rounded bg-accent/50 p-2 text-sm"
                  >
                    <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-warning/10 text-xs font-bold text-warning">
                      {staffMember.first_name[0]}
                      {staffMember.last_name[0]}
                    </div>
                    {staffMember.first_name} {staffMember.last_name}
                  </li>
                ))}
              </ul>
            ) : null}
            {showYesterday && yesterdayPending.length === 0 ? (
              <p className="mt-2 pl-4 text-sm text-muted-foreground">
                No pending check-outs from yesterday.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

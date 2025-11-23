'use client';

import { useAuth } from '@/components/common/auth-provider';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { format, subDays } from 'date-fns';
import { ChevronRight, Plus, FileText, Box, Users as UsersIcon } from 'lucide-react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import { useState, useEffect } from 'react';
import { DashboardStats } from './DashboardStats';
import { RecentActivityChart } from './RecentActivityChart';
import { LowStockAlerts } from './LowStockAlerts';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [todayPending, setTodayPending] = useState<{ staff_id: number, first_name: string, last_name: string }[]>([]);
  const [yesterdayPending, setYesterdayPending] = useState<{ staff_id: number, first_name: string, last_name: string }[]>([]);
  const [showToday, setShowToday] = useState(true);
  const [showYesterday, setShowYesterday] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function fetchPending() {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const { data: todaySummaries, error: err1 } = await supabase
        .from('time_daily_summary')
        .select('staff_id')
        .eq('date_worked', todayStr)
        .eq('is_complete', false);
      if (!err1 && todaySummaries) {
        const ids = todaySummaries.map(s => s.staff_id);
        if (ids.length) {
          const { data: staffData } = await supabase
            .from('staff')
            .select('staff_id, first_name, last_name')
            .in('staff_id', ids);
          setTodayPending(staffData || []);
        }
      }
      const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      const { data: yesterdaySummaries, error: err2 } = await supabase
        .from('time_daily_summary')
        .select('staff_id')
        .eq('date_worked', yesterdayStr)
        .eq('is_complete', false);
      if (!err2 && yesterdaySummaries) {
        const ids2 = yesterdaySummaries.map(s => s.staff_id);
        if (ids2.length) {
          const { data: staffData2 } = await supabase
            .from('staff')
            .select('staff_id, first_name, last_name')
            .in('staff_id', ids2);
          setYesterdayPending(staffData2 || []);
        }
      }
    }
    fetchPending();
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth');
    }
  }, [user, loading, router]);

  if (loading) return null;
  if (!user) return null;

  const quickActions = [
    { label: 'New Order', icon: FileText, href: '/orders/new', color: 'bg-blue-500' },
    { label: 'New Product', icon: Box, href: '/products/new', color: 'bg-purple-500' },
    { label: 'Add Customer', icon: UsersIcon, href: '/customers/new', color: 'bg-orange-500' },
  ];

  return (
    <div className="space-y-8 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">Dashboard</h2>
          <p className="text-muted-foreground">
            Welcome back, {user.email}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={() => router.push('/orders/new')}>
            <Plus className="mr-2 h-4 w-4" /> New Order
          </Button>
        </div>
      </div>

      <DashboardStats />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <RecentActivityChart />

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="col-span-3 space-y-4"
        >
          <Card className="shadow-md border-none h-full">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks you perform often</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {quickActions.map((action) => (
                <div
                  key={action.label}
                  className="flex items-center p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer group"
                  onClick={() => router.push(action.href)}
                >
                  <div className={`p-2 rounded-full ${action.color} bg-opacity-10 mr-4 group-hover:scale-110 transition-transform`}>
                    <action.icon className={`h-5 w-5 ${action.color.replace('bg-', 'text-')}`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{action.label}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>

        <LowStockAlerts />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <Card className="shadow-md border-none">
          <CardHeader>
            <CardTitle>Pending Staff Check Outs</CardTitle>
            <CardDescription>Staff members who haven't clocked out yet</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border p-4">
              <button onClick={() => setShowToday(!showToday)} className="flex items-center justify-between w-full text-sm font-medium">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${todayPending.length > 0 ? 'bg-red-500' : 'bg-green-500'}`}></div>
                  <span>Still to Check-Out Today</span>
                  <span className="px-2 py-0.5 rounded-full bg-muted text-xs">{todayPending.length}</span>
                </div>
                <ChevronRight className={`transform transition-transform duration-200 ${showToday ? 'rotate-90' : ''}`} />
              </button>
              {showToday && todayPending.length > 0 && (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {todayPending.map(s => (
                    <li key={s.staff_id} className="flex items-center p-2 rounded bg-accent/50 text-sm">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3 text-primary font-bold text-xs">
                        {s.first_name[0]}{s.last_name[0]}
                      </div>
                      {s.first_name} {s.last_name}
                    </li>
                  ))}
                </ul>
              )}
              {showToday && todayPending.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground pl-4">All clear for today!</p>
              )}
            </div>

            <div className="rounded-lg border p-4">
              <button onClick={() => setShowYesterday(!showYesterday)} className="flex items-center justify-between w-full text-sm font-medium">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${yesterdayPending.length > 0 ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                  <span>Not Checked-Out Yesterday</span>
                  <span className="px-2 py-0.5 rounded-full bg-muted text-xs">{yesterdayPending.length}</span>
                </div>
                <ChevronRight className={`transform transition-transform duration-200 ${showYesterday ? 'rotate-90' : ''}`} />
              </button>
              {showYesterday && yesterdayPending.length > 0 && (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {yesterdayPending.map(s => (
                    <li key={s.staff_id} className="flex items-center p-2 rounded bg-accent/50 text-sm">
                      <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center mr-3 text-orange-500 font-bold text-xs">
                        {s.first_name[0]}{s.last_name[0]}
                      </div>
                      {s.first_name} {s.last_name}
                    </li>
                  ))}
                </ul>
              )}
              {showYesterday && yesterdayPending.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground pl-4">No pending check-outs from yesterday.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
} 
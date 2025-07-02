'use client';

import { useAuth } from '@/components/common/auth-provider';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { format, subDays } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [todayPending, setTodayPending] = useState<{staff_id:number, first_name:string, last_name:string}[]>([]);
  const [yesterdayPending, setYesterdayPending] = useState<{staff_id:number, first_name:string, last_name:string}[]>([]);
  const [showToday, setShowToday] = useState(false);
  const [showYesterday, setShowYesterday] = useState(false);
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-accent-foreground">
          Welcome back, {user.email}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border-primary border bg-card p-6 shadow-sm">
          <h3 className="font-semibold text-accent-foreground">Total Orders</h3>
          <p className="text-2xl font-bold text-accent-foreground">0</p>
        </div>
        <div className="rounded-lg border-primary border bg-card p-6 shadow-sm">
          <h3 className="font-semibold text-accent-foreground">Revenue</h3>
          <p className="text-2xl font-bold text-accent-foreground">$0</p>
        </div>
        <div className="rounded-lg border-primary border bg-card p-6 shadow-sm">
          <h3 className="font-semibold text-accent-foreground">Products</h3>
          <p className="text-2xl font-bold text-accent-foreground">0</p>
        </div>
        <div className="rounded-lg border-primary border bg-card p-6 shadow-sm">
          <h3 className="font-semibold text-accent-foreground">Customers</h3>
          <p className="text-2xl font-bold text-accent-foreground">0</p>
        </div>
      </div>
      <Card className="mt-8 shadow-sm">
        <CardHeader>
          <CardTitle>Pending Staff Check Outs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <button onClick={() => setShowToday(!showToday)} className="flex items-center space-x-2 text-sm font-medium">
              <ChevronRight className={`transform transition-transform duration-200 ${showToday ? 'rotate-90' : ''}`} /><span>Still to Check-Out Today ({todayPending.length})</span>
            </button>
            {showToday && (
              <ul className="mt-2 list-disc list-inside text-sm transition-opacity duration-300">
                {todayPending.map(s => <li key={s.staff_id}>{s.first_name} {s.last_name}</li>)}
              </ul>
            )}
          </div>
          <div>
            <button onClick={() => setShowYesterday(!showYesterday)} className="flex items-center space-x-2 text-sm font-medium">
              <ChevronRight className={`transform transition-transform duration-200 ${showYesterday ? 'rotate-90' : ''}`} /><span>Not Checked-Out Yesterday ({yesterdayPending.length})</span>
            </button>
            {showYesterday && (
              <ul className="mt-2 list-disc list-inside text-sm transition-opacity duration-300">
                {yesterdayPending.map(s => <li key={s.staff_id}>{s.first_name} {s.last_name}</li>)}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 
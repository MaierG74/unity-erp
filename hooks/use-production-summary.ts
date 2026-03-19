'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';

export interface ProductionSummary {
  overdue: number;
  paused: number;
  dueToday: number;
  unscheduled: number;
  openJobCards: number;
  exceptionsTotal: number;
  isLoading: boolean;
}

export function useProductionSummary(): ProductionSummary {
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data, isLoading } = useQuery({
    queryKey: ['production-summary', today],
    queryFn: async () => {
      // Run all queries in parallel
      const [floorResult, pausedResult, dueTodayResult, unscheduledResult, openResult] =
        await Promise.all([
          // Overdue: floor jobs where auto_progress >= 100 (elapsed exceeds estimate)
          supabase
            .from('factory_floor_status')
            .select('assignment_id', { count: 'exact', head: true })
            .gte('auto_progress', 100),

          // Paused: assignments currently on hold
          supabase
            .from('labor_plan_assignments')
            .select('assignment_id', { count: 'exact', head: true })
            .eq('job_status', 'on_hold'),

          // Due today: job cards due today that aren't completed or cancelled
          supabase
            .from('job_cards')
            .select('job_card_id', { count: 'exact', head: true })
            .eq('due_date', today)
            .not('status', 'in', '("completed","cancelled")'),

          // Unscheduled: pending job cards (no assignment yet)
          supabase
            .from('job_cards')
            .select('job_card_id', { count: 'exact', head: true })
            .eq('status', 'pending'),

          // Open job cards: pending + in_progress (for Queue tab count)
          supabase
            .from('job_cards')
            .select('job_card_id', { count: 'exact', head: true })
            .in('status', ['pending', 'in_progress']),
        ]);

      const overdue = floorResult.count ?? 0;
      const paused = pausedResult.count ?? 0;

      return {
        overdue,
        paused,
        dueToday: dueTodayResult.count ?? 0,
        unscheduled: unscheduledResult.count ?? 0,
        openJobCards: openResult.count ?? 0,
        exceptionsTotal: overdue + paused,
      };
    },
    refetchInterval: 60_000,
  });

  return {
    overdue: data?.overdue ?? 0,
    paused: data?.paused ?? 0,
    dueToday: data?.dueToday ?? 0,
    unscheduled: data?.unscheduled ?? 0,
    openJobCards: data?.openJobCards ?? 0,
    exceptionsTotal: data?.exceptionsTotal ?? 0,
    isLoading,
  };
}

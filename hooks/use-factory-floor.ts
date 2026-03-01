'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchFactoryFloorData, updateProgressOverride } from '@/lib/queries/factoryFloor';

const QUERY_KEY = ['factory-floor'];
const REFRESH_INTERVAL_MS = 60_000; // refresh progress every 60s

export function useFactoryFloor() {
  const queryClient = useQueryClient();

  // Realtime subscription — invalidate on any labor_plan_assignments change
  useEffect(() => {
    const channel = supabase
      .channel('factory-floor-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'labor_plan_assignments' },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assignment_pause_events' },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchFactoryFloorData,
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const progressMutation = useMutation({
    mutationFn: ({ assignmentId, progress }: { assignmentId: number; progress: number | null }) =>
      updateProgressOverride(assignmentId, progress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  return {
    sections: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    updateProgress: progressMutation.mutate,
    isUpdatingProgress: progressMutation.isPending,
  };
}

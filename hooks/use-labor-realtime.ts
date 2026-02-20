'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Subscribe to Supabase Realtime changes on labor planning tables.
 * When any change arrives, invalidate the relevant TanStack Query caches
 * so the board, week strip, and order tree refresh automatically.
 */
export function useLaborRealtime() {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel('labor-board-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'labor_plan_assignments' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['labor-planning'] });
          queryClient.invalidateQueries({ queryKey: ['labor-planning-week-summary'] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'job_cards' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['labor-planning'] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'job_card_items' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['labor-planning'] });
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

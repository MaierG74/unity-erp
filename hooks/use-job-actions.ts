'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { PauseReason, EarningsSplitItem } from '@/components/factory-floor/types';

interface CompleteParams {
  assignmentId: number;
  items: { item_id: number; completed_quantity: number }[];
  actualStart?: string;
  actualEnd?: string;
  notes?: string;
}

interface PauseParams {
  assignmentId: number;
  reason: PauseReason;
  notes?: string;
}

interface TransferParams {
  assignmentId: number;
  newStaffId: number;
  notes?: string;
  earningsSplit?: EarningsSplitItem[];
}

const INVALIDATE_KEYS = [
  ['factory-floor'],
  ['laborAssignments'],
  ['laborPlanningPayload'],
  ['jobs-in-factory'],
  ['jobCards'],
  ['production-summary'],
];

export function useJobActions() {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    for (const key of INVALIDATE_KEYS) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const completeJob = useMutation({
    mutationFn: async ({ assignmentId, items, actualStart, actualEnd, notes }: CompleteParams) => {
      const { data, error } = await supabase.rpc('complete_assignment_with_card', {
        p_assignment_id: assignmentId,
        p_items: items,
        p_actual_start: actualStart ?? null,
        p_actual_end: actualEnd ?? null,
        p_notes: notes ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidateAll,
    onError: (error) => toast.error('Failed to complete job', { description: (error as Error).message }),
  });

  const pauseJob = useMutation({
    mutationFn: async ({ assignmentId, reason, notes }: PauseParams) => {
      const { error } = await supabase.rpc('pause_assignment', {
        p_assignment_id: assignmentId,
        p_reason: reason,
        p_notes: notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: (error) => toast.error('Failed to pause job', { description: (error as Error).message }),
  });

  const resumeJob = useMutation({
    mutationFn: async (assignmentId: number) => {
      const { error } = await supabase.rpc('resume_assignment', {
        p_assignment_id: assignmentId,
      });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: (error) => toast.error('Failed to resume job', { description: (error as Error).message }),
  });

  const transferJob = useMutation({
    mutationFn: async ({ assignmentId, newStaffId, notes, earningsSplit }: TransferParams) => {
      const { data, error } = await supabase.rpc('transfer_assignment', {
        p_assignment_id: assignmentId,
        p_new_staff_id: newStaffId,
        p_notes: notes ?? null,
        p_earnings_split: earningsSplit ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidateAll,
    onError: (error) => toast.error('Failed to transfer job', { description: (error as Error).message }),
  });

  return {
    completeJob,
    pauseJob,
    resumeJob,
    transferJob,
  };
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';

export interface OrgSettings {
  weekStartDay: number; // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  otThresholdMinutes: number;
}

const DEFAULTS: OrgSettings = {
  weekStartDay: 5,
  otThresholdMinutes: 30,
};

export function useOrgSettings(): OrgSettings & { isLoading: boolean } {
  const { user } = useAuth();
  const orgId = getOrgId(user);

  const { data, isLoading } = useQuery({
    queryKey: ['org-settings', orgId],
    queryFn: async () => {
      if (!orgId) return DEFAULTS;
      const { data, error } = await supabase
        .from('organizations')
        .select('week_start_day, ot_threshold_minutes')
        .eq('id', orgId)
        .single();
      if (error || !data) return DEFAULTS;
      return {
        weekStartDay: data.week_start_day ?? DEFAULTS.weekStartDay,
        otThresholdMinutes: data.ot_threshold_minutes ?? DEFAULTS.otThresholdMinutes,
      };
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  return { ...(data ?? DEFAULTS), isLoading };
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';

/**
 * Org-level configurator defaults.
 * All fields optional — missing fields fall back to template defaults.
 */
export interface ConfiguratorDefaults {
  materialThickness?: number;
  backMaterialThickness?: number;
  adjusterHeight?: number;
  topOverhangSides?: number;
  topOverhangBack?: number;
  baseOverhangSides?: number;
  baseOverhangBack?: number;
  backSlotDepth?: number;
  doorGap?: number;
  shelfSetback?: number;
  backRecess?: number;
  doorStyle?: 'none' | 'single' | 'double';
  shelfCount?: number;
  hasBack?: boolean;
}

export interface CutlistDefaults {
  minReusableOffcutDimensionMm?: number;
  preferredOffcutDimensionMm?: number;
  minReusableOffcutAreaMm2?: number;
}

export interface OrgSettings {
  weekStartDay: number; // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  otThresholdMinutes: number;
  configuratorDefaults: ConfiguratorDefaults;
  cutlistDefaults: CutlistDefaults;
}

const DEFAULTS: OrgSettings = {
  weekStartDay: 5,
  otThresholdMinutes: 30,
  configuratorDefaults: {},
  cutlistDefaults: {
    minReusableOffcutDimensionMm: 150,
    preferredOffcutDimensionMm: 300,
    minReusableOffcutAreaMm2: 100000,
  },
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
        .select('week_start_day, ot_threshold_minutes, configurator_defaults, cutlist_defaults')
        .eq('id', orgId)
        .single();
      if (error || !data) return DEFAULTS;
      const cutlistDefaults = (data.cutlist_defaults as CutlistDefaults | null) ?? {};
      return {
        weekStartDay: data.week_start_day ?? DEFAULTS.weekStartDay,
        otThresholdMinutes: data.ot_threshold_minutes ?? DEFAULTS.otThresholdMinutes,
        configuratorDefaults: (data.configurator_defaults as ConfiguratorDefaults) ?? {},
        cutlistDefaults: {
          minReusableOffcutDimensionMm:
            cutlistDefaults.minReusableOffcutDimensionMm ?? DEFAULTS.cutlistDefaults.minReusableOffcutDimensionMm,
          preferredOffcutDimensionMm:
            cutlistDefaults.preferredOffcutDimensionMm ?? DEFAULTS.cutlistDefaults.preferredOffcutDimensionMm,
          minReusableOffcutAreaMm2:
            cutlistDefaults.minReusableOffcutAreaMm2 ?? DEFAULTS.cutlistDefaults.minReusableOffcutAreaMm2,
        },
      };
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  return { ...(data ?? DEFAULTS), isLoading };
}

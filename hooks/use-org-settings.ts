'use client';

import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import type {
  CupboardBaseConstruction,
  CupboardTopConstruction,
} from '@/lib/configurator/templates/types';
import type { GrainOrientation } from '@/lib/cutlist/types';

/**
 * Org-level configurator defaults.
 * All fields optional — missing fields fall back to template defaults.
 */
export interface ConfiguratorDefaults {
  materialThickness?: number;
  topConstruction?: CupboardTopConstruction;
  baseConstruction?: CupboardBaseConstruction;
  backMaterialThickness?: number;
  adjusterHeight?: number;
  topOverhangSides?: number;
  topOverhangFront?: number;
  topOverhangBack?: number;
  baseOverhangSides?: number;
  baseOverhangFront?: number;
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
  minReusableOffcutLengthMm?: number;
  minReusableOffcutWidthMm?: number;
  minReusableOffcutGrain?: GrainOrientation;
  preferredOffcutDimensionMm?: number;
  sameBoardQuantityModel?: 'pieces-v0' | 'finished-v1';
}

interface LegacyCutlistDefaults {
  [key: string]: unknown;
}

export interface OrgSettings {
  weekStartDay: number; // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  standardWeekHours: number;
  otThresholdMinutes: number;
  configuratorDefaults: ConfiguratorDefaults;
  cutlistDefaults: CutlistDefaults;
}

const DEFAULTS: OrgSettings = {
  weekStartDay: 5,
  standardWeekHours: 44,
  otThresholdMinutes: 30,
  configuratorDefaults: {},
  cutlistDefaults: {
    minReusableOffcutLengthMm: 300,
    minReusableOffcutWidthMm: 300,
    minReusableOffcutGrain: 'any',
    preferredOffcutDimensionMm: 300,
    sameBoardQuantityModel: 'pieces-v0',
  },
};

const LEGACY_OFFCUT_DIMENSION_KEY = 'minReusableOffcut' + 'DimensionMm';

type OrgMembershipRow = {
  org_id: string;
  is_active: boolean | null;
  banned_until: string | null;
  inserted_at: string | null;
};

function isActiveMembership(row: Pick<OrgMembershipRow, 'is_active' | 'banned_until'>): boolean {
  if (!row.is_active) return false;
  if (!row.banned_until) return true;
  const bannedUntil = new Date(row.banned_until).getTime();
  return Number.isFinite(bannedUntil) && bannedUntil <= Date.now();
}

export function resolveOrgSettingsOrgId(
  memberships: OrgMembershipRow[],
  jwtOrgId?: string | null,
): string | null {
  const jwtMembership = jwtOrgId
    ? memberships.find((membership) => membership.org_id === jwtOrgId && isActiveMembership(membership))
    : null;
  if (jwtMembership) return jwtMembership.org_id;

  const firstActive = memberships.find((membership) => isActiveMembership(membership));
  return firstActive?.org_id ?? null;
}

export function normalizeCutlistDefaults(
  raw: Partial<CutlistDefaults & LegacyCutlistDefaults> | null | undefined,
): Required<CutlistDefaults> {
  const r = raw ?? {};
  const hasNewKey =
    r.minReusableOffcutLengthMm !== undefined ||
    r.minReusableOffcutWidthMm !== undefined;
  const legacyValue = r[LEGACY_OFFCUT_DIMENSION_KEY];
  const legacyDim = !hasNewKey && typeof legacyValue === 'number' ? legacyValue : undefined;
  return {
    minReusableOffcutLengthMm: r.minReusableOffcutLengthMm ?? legacyDim ?? 300,
    minReusableOffcutWidthMm: r.minReusableOffcutWidthMm ?? legacyDim ?? 300,
    minReusableOffcutGrain: r.minReusableOffcutGrain ?? 'any',
    preferredOffcutDimensionMm: r.preferredOffcutDimensionMm ?? 300,
    sameBoardQuantityModel:
      r.sameBoardQuantityModel === 'finished-v1' || r.same_board_quantity_model === 'finished-v1'
        ? 'finished-v1'
        : 'pieces-v0',
  };
}

export function useOrgSettings(): OrgSettings & { isLoading: boolean; refetch: UseQueryResult<OrgSettings>['refetch'] } {
  const { user } = useAuth();
  const jwtOrgId = (user?.app_metadata?.org_id as string | undefined)
    ?? (user?.user_metadata?.org_id as string | undefined)
    ?? null;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-settings', user?.id ?? null, jwtOrgId],
    queryFn: async () => {
      if (!user?.id) return DEFAULTS;

      const { data: memberships, error: membershipError } = await supabase
        .from('organization_members')
        .select('org_id, is_active, banned_until, inserted_at')
        .eq('user_id', user.id)
        .order('inserted_at', { ascending: true })
        .limit(20);
      if (membershipError) return DEFAULTS;

      const orgId = resolveOrgSettingsOrgId((memberships ?? []) as OrgMembershipRow[], jwtOrgId);
      if (!orgId) return DEFAULTS;

      const { data, error } = await supabase
        .from('organizations')
        .select('week_start_day, payroll_standard_week_hours, ot_threshold_minutes, configurator_defaults, cutlist_defaults')
        .eq('id', orgId)
        .single();
      if (error || !data) return DEFAULTS;
      const standardWeekHours = Number(data.payroll_standard_week_hours);
      return {
        weekStartDay: data.week_start_day ?? DEFAULTS.weekStartDay,
        standardWeekHours: Number.isFinite(standardWeekHours) ? standardWeekHours : DEFAULTS.standardWeekHours,
        otThresholdMinutes: data.ot_threshold_minutes ?? DEFAULTS.otThresholdMinutes,
        configuratorDefaults: (data.configurator_defaults as ConfiguratorDefaults) ?? {},
        cutlistDefaults: normalizeCutlistDefaults(
          data.cutlist_defaults as Partial<CutlistDefaults & LegacyCutlistDefaults> | null,
        ),
      };
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  return { ...(data ?? DEFAULTS), isLoading, refetch };
}

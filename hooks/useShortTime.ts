'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type ShortTimeStaff = {
  staff_id: number;
  first_name: string | null;
  last_name: string | null;
  current_staff?: boolean | null;
  is_active?: boolean | null;
};

export type ShortTimeEntry = {
  id: number;
  org_id: string;
  staff_id: number | null;
  start_date: string;
  end_date: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  staff: ShortTimeStaff | null;
};

type RawShortTimeEntry = Omit<ShortTimeEntry, 'staff'> & {
  staff?: ShortTimeStaff | ShortTimeStaff[] | null;
};

export type CreateShortTimeInput = {
  staffIds: number[] | null;
  startDate: string;
  endDate: string;
  note?: string | null;
};

const ADMIN_ROLES = new Set(['owner', 'admin']);

export const shortTimeQueryKey = (orgId: string | null) =>
  ['short-time', orgId ?? 'no-org'] as const;

export const shortTimeStaffQueryKey = (orgId: string | null) =>
  ['short-time-staff-options', orgId ?? 'no-org'] as const;

function normalizeRelatedStaff(
  staff: RawShortTimeEntry['staff'],
): ShortTimeStaff | null {
  if (Array.isArray(staff)) return staff[0] ?? null;
  return staff ?? null;
}

function normalizeShortTimeEntry(row: RawShortTimeEntry): ShortTimeEntry {
  return {
    ...row,
    staff: normalizeRelatedStaff(row.staff),
  };
}

function roleFromUser(user: User | null): string | null {
  return (
    (user?.app_metadata?.role as string | undefined) ??
    (user?.user_metadata?.role as string | undefined) ??
    null
  );
}

export function isAdminRole(role: string | null | undefined) {
  return Boolean(role && ADMIN_ROLES.has(role));
}

export function useShortTimeEntries(orgId: string | null) {
  return useQuery({
    queryKey: shortTimeQueryKey(orgId),
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from('staff_short_time')
        .select(
          `
          id,
          org_id,
          staff_id,
          start_date,
          end_date,
          note,
          created_at,
          updated_at,
          staff:staff_id (
            staff_id,
            first_name,
            last_name
          )
        `,
        )
        .eq('org_id', orgId)
        .order('start_date', { ascending: false })
        .order('id', { ascending: false });

      if (error) throw error;
      return ((data ?? []) as RawShortTimeEntry[]).map(normalizeShortTimeEntry);
    },
    enabled: Boolean(orgId),
  });
}

export function useShortTimeStaffOptions(orgId: string | null) {
  return useQuery({
    queryKey: shortTimeStaffQueryKey(orgId),
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name, current_staff, is_active')
        .eq('current_staff', true)
        .eq('is_active', true)
        .order('first_name', { ascending: true });

      if (error) throw error;
      return (data ?? []) as ShortTimeStaff[];
    },
    enabled: Boolean(orgId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateShortTimeEntry(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateShortTimeInput) => {
      if (!orgId) throw new Error('No organization context found.');

      const targetStaffIds: Array<number | null> =
        input.staffIds === null ? [null] : input.staffIds;

      if (targetStaffIds.length === 0) {
        throw new Error('Select at least one staff member.');
      }

      const rows = targetStaffIds.map((staffId) => ({
        org_id: orgId,
        staff_id: staffId,
        start_date: input.startDate,
        end_date: input.endDate,
        note: input.note?.trim() ? input.note.trim() : null,
      }));

      const { data, error } = await supabase
        .from('staff_short_time')
        .insert(rows)
        .select('id');

      if (error) throw error;
      return data ?? [];
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shortTimeQueryKey(orgId) });
    },
  });
}

export function useDeleteShortTimeEntry(orgId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (entryId: number) => {
      if (!orgId) throw new Error('No organization context found.');

      const { error } = await supabase
        .from('staff_short_time')
        .delete()
        .eq('id', entryId)
        .eq('org_id', orgId);

      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shortTimeQueryKey(orgId) });
    },
  });
}

export function useShortTimeAdminStatus(user: User | null, orgId: string | null) {
  const userRole = roleFromUser(user);

  return useQuery({
    queryKey: ['short-time-admin-status', user?.id ?? 'anonymous', orgId, userRole],
    queryFn: async () => {
      if (!user) return false;
      if (isAdminRole(userRole)) return true;

      const membershipPromise = orgId
        ? supabase
            .from('organization_members')
            .select('role')
            .eq('user_id', user.id)
            .eq('org_id', orgId)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [membershipResult, platformResult] = await Promise.all([
        membershipPromise,
        supabase
          .from('platform_admins')
          .select('user_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle(),
      ]);

      if (membershipResult.error && platformResult.error) return false;

      const membershipRole =
        typeof membershipResult.data?.role === 'string'
          ? membershipResult.data.role
          : null;

      return isAdminRole(membershipRole) || Boolean(platformResult.data?.user_id);
    },
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
}

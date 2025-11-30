'use client';

import { useQuery } from '@tanstack/react-query';

import { fetchProfiles, type ProfileSummary } from '@/lib/client/todos';

export function useProfiles() {
  return useQuery<ProfileSummary[]>({
    queryKey: ['profiles', 'all'],
    queryFn: fetchProfiles,
    staleTime: 1000 * 60 * 5,
  });
}

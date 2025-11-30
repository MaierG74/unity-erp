'use client';

import { useQuery } from '@tanstack/react-query';

import { fetchEntityLinks, type EntityLinkSearchResult } from '@/lib/client/entity-links';

export function useEntityLinks(query: string, enabled: boolean) {
  return useQuery<EntityLinkSearchResult>({
    queryKey: ['entity-links', query],
    queryFn: () => fetchEntityLinks(query),
    enabled,
  });
}

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  createSupportLink,
  updateSupportLink,
  deactivateSupportLink,
} from '@/lib/queries/staffSupport';

export function useSupportLinks() {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['support-links'] });

  const create = useMutation({
    mutationFn: createSupportLink,
    onSuccess: () => {
      invalidate();
      toast.success('Support link created');
    },
    onError: (err: Error) => toast.error(`Failed to create link: ${err.message}`),
  });

  const update = useMutation({
    mutationFn: ({ linkId, pct }: { linkId: number; pct: number }) =>
      updateSupportLink(linkId, pct),
    onSuccess: () => {
      invalidate();
      toast.success('Cost share updated');
    },
    onError: (err: Error) => toast.error(`Failed to update: ${err.message}`),
  });

  const deactivate = useMutation({
    mutationFn: deactivateSupportLink,
    onSuccess: () => {
      invalidate();
      toast.success('Support link deactivated');
    },
    onError: (err: Error) => toast.error(`Failed to deactivate: ${err.message}`),
  });

  return { create, update, deactivate };
}

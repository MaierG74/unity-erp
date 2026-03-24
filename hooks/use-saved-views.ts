import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import type { SavedView, ViewConfig } from '@/types/transaction-views';

export function useSavedViews(tableKey: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['saved-views', tableKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_table_views')
        .select('*')
        .eq('table_key', tableKey)
        .order('name');
      if (error) throw error;
      return data as SavedView[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

export function useSaveView(tableKey: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      config,
      isShared = false,
      viewId,
    }: {
      name: string;
      config: ViewConfig;
      isShared?: boolean;
      viewId?: string;
    }) => {
      if (!user) throw new Error('Not authenticated');

      // Get user's org_id
      const { data: membership, error: memError } = await supabase
        .from('organization_members')
        .select('org_id')
        .eq('user_id', user.id)
        .single();
      if (memError) throw memError;

      if (viewId) {
        // Update existing
        const { error } = await supabase
          .from('saved_table_views')
          .update({
            name,
            config: config as unknown as Record<string, unknown>,
            is_shared: isShared,
            updated_at: new Date().toISOString(),
          })
          .eq('view_id', viewId);
        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from('saved_table_views')
          .insert({
            org_id: membership.org_id,
            user_id: user.id,
            table_key: tableKey,
            name,
            config: config as unknown as Record<string, unknown>,
            is_shared: isShared,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-views', tableKey] });
    },
  });
}

export function useDeleteView(tableKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (viewId: string) => {
      const { error } = await supabase
        .from('saved_table_views')
        .delete()
        .eq('view_id', viewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-views', tableKey] });
    },
  });
}

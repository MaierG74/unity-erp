'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAuth } from '@/components/common/auth-provider';
import { supabase } from '@/lib/supabase';
import { getOrgId } from '@/lib/utils';
import {
  DASHBOARD_WIDGET_ORDER,
  type DashboardPresetId,
  type DashboardPreferences,
  type DashboardWidgetId,
  getDefaultDashboardPreferences,
  isDashboardPresetCustomized,
  normalizeDashboardPreferences,
} from '@/app/dashboard/dashboard-config';

const DEFAULT_SCOPE_KEY = 'default';

function orderWidgets(widgetIds: DashboardWidgetId[]) {
  const unique = new Set(widgetIds);
  return DASHBOARD_WIDGET_ORDER.filter((widgetId) => unique.has(widgetId));
}

export function useDashboardPreferences() {
  const { user } = useAuth();
  const orgId = getOrgId(user);
  const scopeKey = orgId ?? DEFAULT_SCOPE_KEY;
  const [preferences, setPreferences] = useState<DashboardPreferences>(
    getDefaultDashboardPreferences()
  );
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const persistedPreferences = useMemo(() => {
    const rawPreferences = user?.user_metadata?.dashboard_preferences;
    if (!rawPreferences || typeof rawPreferences !== 'object') {
      return null;
    }

    const byScope = rawPreferences as Record<string, unknown>;
    return byScope[scopeKey] ?? null;
  }, [scopeKey, user?.user_metadata]);

  useEffect(() => {
    const normalized = normalizeDashboardPreferences(persistedPreferences);
    setPreferences(normalized);
    setLastSavedAt(normalized.updatedAt);
  }, [persistedPreferences]);

  const persistPreferences = useCallback(
    async (nextPreferences: DashboardPreferences) => {
      if (!user) {
        setPreferences(nextPreferences);
        return;
      }

      const nextSavedAt = new Date().toISOString();
      const optimisticPreferences = {
        ...nextPreferences,
        updatedAt: nextSavedAt,
      } satisfies DashboardPreferences;
      const previousPreferences = preferences;

      setPreferences(optimisticPreferences);
      setIsSaving(true);

      try {
        const rawPreferences = user.user_metadata?.dashboard_preferences;
        const byScope =
          rawPreferences && typeof rawPreferences === 'object'
            ? { ...(rawPreferences as Record<string, unknown>) }
            : {};

        byScope[scopeKey] = optimisticPreferences;

        const { error } = await supabase.auth.updateUser({
          data: {
            ...user.user_metadata,
            dashboard_preferences: byScope,
          },
        });

        if (error) throw error;
        setLastSavedAt(nextSavedAt);
      } catch (error) {
        setPreferences(previousPreferences);
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to save dashboard preferences'
        );
      } finally {
        setIsSaving(false);
      }
    },
    [preferences, scopeKey, user]
  );

  const setPreset = useCallback(
    async (presetId: DashboardPresetId) => {
      await persistPreferences(getDefaultDashboardPreferences(presetId));
    },
    [persistPreferences]
  );

  const toggleWidget = useCallback(
    async (widgetId: DashboardWidgetId) => {
      const currentWidgetIds = preferences.widgetIds;
      const currentlyVisible = currentWidgetIds.includes(widgetId);
      const nextWidgetIds = currentlyVisible
        ? currentWidgetIds.filter((candidate) => candidate !== widgetId)
        : [...currentWidgetIds, widgetId];

      if (nextWidgetIds.length === 0) {
        return;
      }

      await persistPreferences({
        ...preferences,
        widgetIds: orderWidgets(nextWidgetIds),
      });
    },
    [persistPreferences, preferences]
  );

  const resetToPreset = useCallback(async () => {
    await persistPreferences(
      getDefaultDashboardPreferences(preferences.presetId)
    );
  }, [persistPreferences, preferences.presetId]);

  const visibleWidgetIds = useMemo(
    () => new Set(preferences.widgetIds),
    [preferences.widgetIds]
  );

  return {
    preferences,
    visibleWidgetIds,
    isCustomized: isDashboardPresetCustomized(preferences),
    isSaving,
    lastSavedAt,
    setPreset,
    toggleWidget,
    resetToPreset,
  };
}

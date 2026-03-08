'use client';

import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/common/auth-provider';
import { useOrgSettings } from '@/hooks/use-org-settings';
import { getOrgId } from '@/lib/utils';
import { toast } from 'sonner';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function PayrollSettingsPage() {
  const { user } = useAuth();
  const orgId = getOrgId(user);
  const queryClient = useQueryClient();
  const orgSettings = useOrgSettings();

  const [weekStartDay, setWeekStartDay] = useState(5);
  const [otThreshold, setOtThreshold] = useState(30);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Sync local state from org settings on load
  useEffect(() => {
    if (!orgSettings.isLoading && !initialized) {
      setWeekStartDay(orgSettings.weekStartDay);
      setOtThreshold(orgSettings.otThresholdMinutes);
      setInitialized(true);
    }
  }, [orgSettings.isLoading, orgSettings.weekStartDay, orgSettings.otThresholdMinutes, initialized]);

  const handleSave = async () => {
    if (!orgId) {
      toast.error('No organization found');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          week_start_day: weekStartDay,
          ot_threshold_minutes: otThreshold,
        })
        .eq('id', orgId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['org-settings'] });
      toast.success('Payroll settings saved');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save payroll settings';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (orgSettings.isLoading) {
    return (
      <div className="animate-pulse text-muted-foreground py-8">Loading settings...</div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-card shadow rounded-lg">
        <div className="px-6 py-4 border-b">
          <h1 className="text-lg font-semibold">Payroll Settings</h1>
          <p className="text-sm text-muted-foreground">
            Work week boundaries and overtime threshold
          </p>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Work Week Start Day */}
            <div>
              <label className="block text-sm font-medium mb-1">Work Week Starts On</label>
              <select
                className="w-full px-3 py-2 rounded border bg-background"
                value={weekStartDay}
                onChange={(e) => setWeekStartDay(Number(e.target.value))}
              >
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                The day your work week begins for payroll calculations
              </p>
            </div>

            {/* OT Threshold */}
            <div>
              <label className="block text-sm font-medium mb-1">OT Threshold (minutes)</label>
              <input
                type="number"
                className="w-full px-3 py-2 rounded border bg-background"
                value={otThreshold}
                onChange={(e) => setOtThreshold(Number(e.target.value))}
                min={0}
                max={600}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Minutes of overtime required before overtime pay applies
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded bg-primary text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Payroll Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

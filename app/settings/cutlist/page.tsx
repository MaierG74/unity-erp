'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrgSettings, type CutlistDefaults } from '@/hooks/use-org-settings';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function CutlistSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgSettings = useOrgSettings();

  const [cutlistDefaults, setCutlistDefaults] = useState<CutlistDefaults>({});
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  // Sync from orgSettings on load
  useEffect(() => {
    if (!orgSettings.isLoading && !initialized.current) {
      setCutlistDefaults(orgSettings.cutlistDefaults);
      initialized.current = true;
    }
  }, [orgSettings.isLoading, orgSettings.cutlistDefaults]);

  const updateCutlistDefault = (key: keyof CutlistDefaults, value: number | undefined) => {
    setCutlistDefaults(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const orgId = getOrgId(user);
    if (!orgId) return;
    setSaving(true);
    const cleaned: CutlistDefaults = {
      minReusableOffcutDimensionMm: Number(cutlistDefaults.minReusableOffcutDimensionMm) || 150,
      preferredOffcutDimensionMm: Number(cutlistDefaults.preferredOffcutDimensionMm) || 300,
      minReusableOffcutAreaMm2: Number(cutlistDefaults.minReusableOffcutAreaMm2) || 100000,
    };
    const { error } = await supabase
      .from('organizations')
      .update({ cutlist_defaults: cleaned })
      .eq('id', orgId);
    setSaving(false);
    if (error) {
      toast.error('Failed to save cutlist defaults');
    } else {
      toast.success('Cutlist defaults saved');
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Cutlist Defaults</h1>
        <p className="text-sm text-muted-foreground">
          Organization-wide rules for what counts as a reusable offcut
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Minimum reusable dimension (mm)</label>
          <Input
            type="number"
            min={1}
            value={cutlistDefaults.minReusableOffcutDimensionMm ?? 150}
            onChange={(e) => updateCutlistDefault('minReusableOffcutDimensionMm', Number(e.target.value) || undefined)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            Leftover pieces smaller than this are treated as too small to reuse.
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Preferred offcut dimension (mm)</label>
          <Input
            type="number"
            min={1}
            value={cutlistDefaults.preferredOffcutDimensionMm ?? 300}
            onChange={(e) => updateCutlistDefault('preferredOffcutDimensionMm', Number(e.target.value) || undefined)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            Bigger values push the optimizer toward larger, cleaner leftover pieces.
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Minimum reusable area (mm²)</label>
          <Input
            type="number"
            min={1}
            value={cutlistDefaults.minReusableOffcutAreaMm2 ?? 100000}
            onChange={(e) => updateCutlistDefault('minReusableOffcutAreaMm2', Number(e.target.value) || undefined)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            Prevents tiny odd-shaped leftovers from being counted as useful stock.
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Cutlist Defaults'}
        </Button>
      </div>
    </div>
  );
}

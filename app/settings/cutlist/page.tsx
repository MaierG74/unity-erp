'use client';

import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOrgSettings, type CutlistDefaults } from '@/hooks/use-org-settings';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { GrainOrientation } from '@/lib/cutlist/types';

const GRAIN_OPTIONS: { value: GrainOrientation; icon: string; label: string }[] = [
  { value: 'any', icon: '○', label: 'Any direction' },
  { value: 'length', icon: '↕', label: 'Grain along length' },
  { value: 'width', icon: '↔', label: 'Grain along width' },
];

function nextGrain(current: GrainOrientation): GrainOrientation {
  const order: GrainOrientation[] = ['any', 'length', 'width'];
  return order[(order.indexOf(current) + 1) % order.length];
}

function getGrainOption(value: GrainOrientation) {
  return GRAIN_OPTIONS.find((o) => o.value === value) ?? GRAIN_OPTIONS[0];
}

export default function CutlistSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgSettings = useOrgSettings();

  const [defaults, setDefaults] = useState<CutlistDefaults>({});
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!orgSettings.isLoading && !initialized.current) {
      setDefaults(orgSettings.cutlistDefaults);
      initialized.current = true;
    }
  }, [orgSettings.isLoading, orgSettings.cutlistDefaults]);

  const update = (key: keyof CutlistDefaults, value: number | GrainOrientation | undefined) => {
    setDefaults((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const orgId = getOrgId(user);
    if (!orgId) return;
    setSaving(true);
    const cleaned: CutlistDefaults = {
      minReusableOffcutLengthMm: Number(defaults.minReusableOffcutLengthMm) || 300,
      minReusableOffcutWidthMm: Number(defaults.minReusableOffcutWidthMm) || 300,
      minReusableOffcutGrain: defaults.minReusableOffcutGrain ?? 'any',
      preferredOffcutDimensionMm: Number(defaults.preferredOffcutDimensionMm) || 300,
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

  const grain = defaults.minReusableOffcutGrain ?? 'any';
  const grainOpt = getGrainOption(grain);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Cutlist Defaults</h1>
          <p className="text-sm text-muted-foreground">
            Organization-wide rules for what counts as a reusable offcut.
          </p>
        </div>

        <div className="space-y-2">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto]">
            <div>
              <label className="block text-sm font-medium mb-1">Minimum length (mm)</label>
              <Input
                type="number"
                min={1}
                placeholder="0"
                value={defaults.minReusableOffcutLengthMm ?? ''}
                onChange={(e) => update('minReusableOffcutLengthMm', e.target.value === '' ? undefined : Number(e.target.value))}
                onBlur={() => { if (!defaults.minReusableOffcutLengthMm) update('minReusableOffcutLengthMm', 300); }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Minimum width (mm)</label>
              <Input
                type="number"
                min={1}
                placeholder="0"
                value={defaults.minReusableOffcutWidthMm ?? ''}
                onChange={(e) => update('minReusableOffcutWidthMm', e.target.value === '' ? undefined : Number(e.target.value))}
                onBlur={() => { if (!defaults.minReusableOffcutWidthMm) update('minReusableOffcutWidthMm', 300); }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Grain</label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="outline" size="sm" onClick={() => update('minReusableOffcutGrain', nextGrain(grain))} className="min-w-12">
                    <span aria-hidden>{grainOpt.icon}</span>
                    <span className="sr-only">{grainOpt.label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{grainOpt.label}</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A leftover counts as reusable stock only if it meets both minimums. Pick a grain
            direction to require a specific orientation; leave on Any to accept either.
          </p>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:max-w-xs">
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium mb-1">
              Preferred offcut dimension (mm)
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What is preferred offcut dimension?">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-snug">
                  Nudge the optimizer toward larger, cleaner leftover strips. Sizes between the
                  minimum reusable and this value are mildly penalised during packing — a quality
                  preference, not a hard rule.
                </TooltipContent>
              </Tooltip>
            </label>
            <Input
              type="number"
              min={1}
              placeholder="0"
              value={defaults.preferredOffcutDimensionMm ?? ''}
              onChange={(e) => update('preferredOffcutDimensionMm', e.target.value === '' ? undefined : Number(e.target.value))}
              onBlur={() => { if (!defaults.preferredOffcutDimensionMm) update('preferredOffcutDimensionMm', 300); }}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Cutlist Defaults'}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}

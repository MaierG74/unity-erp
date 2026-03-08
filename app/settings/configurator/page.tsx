'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrgSettings, type ConfiguratorDefaults } from '@/hooks/use-org-settings';
import { useAuth } from '@/components/common/auth-provider';
import { getOrgId } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DEFAULT_CUPBOARD_CONFIG } from '@/lib/configurator/templates/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ConfiguratorSettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgSettings = useOrgSettings();

  const [configDefaults, setConfigDefaults] = useState<ConfiguratorDefaults>({});
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  // Sync from orgSettings on load
  useEffect(() => {
    if (!orgSettings.isLoading && !initialized.current) {
      setConfigDefaults(orgSettings.configuratorDefaults);
      initialized.current = true;
    }
  }, [orgSettings.isLoading, orgSettings.configuratorDefaults]);

  const updateConfigDefault = (key: keyof ConfiguratorDefaults, value: number | string | boolean | undefined) => {
    setConfigDefaults(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const orgId = getOrgId(user);
    if (!orgId) return;
    setSaving(true);
    // Strip undefined/empty values before saving
    const cleaned: ConfiguratorDefaults = {};
    for (const [k, v] of Object.entries(configDefaults)) {
      if (v !== undefined && v !== '') cleaned[k as keyof ConfiguratorDefaults] = v as never;
    }
    const { error } = await supabase
      .from('organizations')
      .update({ configurator_defaults: cleaned })
      .eq('id', orgId);
    setSaving(false);
    if (error) {
      toast.error('Failed to save configurator defaults');
    } else {
      toast.success('Configurator defaults saved');
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Configurator Defaults</h1>
        <p className="text-sm text-muted-foreground">
          Default dimensions and options for the Furniture Configurator
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        These values set the starting defaults when opening the Furniture Configurator.
        Users can still override any value per-session. Leave blank to use the built-in template default.
      </p>

      {/* Board measurements */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Board Thickness (mm)</label>
          <Input
            type="number"
            min={3}
            max={50}
            value={configDefaults.materialThickness ?? ''}
            placeholder={String(DEFAULT_CUPBOARD_CONFIG.materialThickness)}
            onChange={(e) => updateConfigDefault('materialThickness', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Back Panel Thickness (mm)</label>
          <Input
            type="number"
            min={3}
            max={50}
            value={configDefaults.backMaterialThickness ?? ''}
            placeholder={String(DEFAULT_CUPBOARD_CONFIG.backMaterialThickness)}
            onChange={(e) => updateConfigDefault('backMaterialThickness', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Adjuster Height (mm)</label>
          <Input
            type="number"
            min={0}
            max={100}
            value={configDefaults.adjusterHeight ?? ''}
            placeholder={String(DEFAULT_CUPBOARD_CONFIG.adjusterHeight)}
            onChange={(e) => updateConfigDefault('adjusterHeight', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
      </div>

      {/* Overhangs */}
      <div>
        <label className="block text-sm font-medium mb-2">Overhangs (mm)</label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Top — Sides</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={configDefaults.topOverhangSides ?? ''}
              placeholder={String(DEFAULT_CUPBOARD_CONFIG.topOverhangSides)}
              onChange={(e) => updateConfigDefault('topOverhangSides', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Top — Back</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={configDefaults.topOverhangBack ?? ''}
              placeholder={String(DEFAULT_CUPBOARD_CONFIG.topOverhangBack)}
              onChange={(e) => updateConfigDefault('topOverhangBack', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Base — Sides</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={configDefaults.baseOverhangSides ?? ''}
              placeholder={String(DEFAULT_CUPBOARD_CONFIG.baseOverhangSides)}
              onChange={(e) => updateConfigDefault('baseOverhangSides', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Base — Back</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={configDefaults.baseOverhangBack ?? ''}
              placeholder={String(DEFAULT_CUPBOARD_CONFIG.baseOverhangBack)}
              onChange={(e) => updateConfigDefault('baseOverhangBack', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
        </div>
      </div>

      {/* Gaps & Slots */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Door Gap (mm)</label>
          <Input
            type="number"
            min={0}
            max={20}
            value={configDefaults.doorGap ?? ''}
            placeholder={String(DEFAULT_CUPBOARD_CONFIG.doorGap)}
            onChange={(e) => updateConfigDefault('doorGap', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Shelf Setback (mm)</label>
          <Input
            type="number"
            min={0}
            max={50}
            value={configDefaults.shelfSetback ?? ''}
            placeholder={String(DEFAULT_CUPBOARD_CONFIG.shelfSetback)}
            onChange={(e) => updateConfigDefault('shelfSetback', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Back Slot Depth (mm)</label>
          <Input
            type="number"
            min={0}
            max={20}
            value={configDefaults.backSlotDepth ?? ''}
            placeholder={String(DEFAULT_CUPBOARD_CONFIG.backSlotDepth)}
            onChange={(e) => updateConfigDefault('backSlotDepth', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
      </div>

      {/* Door & Shelf defaults */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Default Door Style</label>
          <select
            className="w-full px-3 py-2 rounded border bg-background"
            value={configDefaults.doorStyle ?? ''}
            onChange={(e) => updateConfigDefault('doorStyle', e.target.value || undefined)}
          >
            <option value="">Template default ({DEFAULT_CUPBOARD_CONFIG.doorStyle})</option>
            <option value="none">None</option>
            <option value="single">Single Door</option>
            <option value="double">Double Doors</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Default Shelf Count</label>
          <Input
            type="number"
            min={0}
            max={10}
            value={configDefaults.shelfCount ?? ''}
            placeholder={String(DEFAULT_CUPBOARD_CONFIG.shelfCount)}
            onChange={(e) => updateConfigDefault('shelfCount', e.target.value ? Number(e.target.value) : undefined)}
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              checked={configDefaults.hasBack ?? DEFAULT_CUPBOARD_CONFIG.hasBack}
              onChange={(e) => updateConfigDefault('hasBack', e.target.checked)}
            />
            <span className="text-sm font-medium">Has Back Panel</span>
          </label>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Configurator Defaults'}
        </Button>
      </div>
    </div>
  );
}

'use client';

import { Settings2, Sparkles } from 'lucide-react';

import {
  DASHBOARD_PRESETS,
  DASHBOARD_WIDGET_META,
  type DashboardPresetId,
  type DashboardWidgetId,
} from '@/app/dashboard/dashboard-config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface DashboardCustomizationCardProps {
  presetId: DashboardPresetId;
  visibleWidgetIds: Set<DashboardWidgetId>;
  isCustomized: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  onPresetChange: (presetId: DashboardPresetId) => void | Promise<void>;
  onToggleWidget: (widgetId: DashboardWidgetId) => void | Promise<void>;
  onResetToPreset: () => void | Promise<void>;
}

export function DashboardCustomizationCard({
  presetId,
  visibleWidgetIds,
  isCustomized,
  isSaving,
  lastSavedAt,
  onPresetChange,
  onToggleWidget,
  onResetToPreset,
}: DashboardCustomizationCardProps) {
  const preset = DASHBOARD_PRESETS[presetId];
  const activeWidgetCount = visibleWidgetIds.size;
  const saveLabel = isSaving
    ? 'Saving preferences...'
    : lastSavedAt
      ? `Saved ${new Date(lastSavedAt).toLocaleTimeString('en-ZA', {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : 'Auto-saves to your profile';

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <CardTitle>Dashboard Focus</CardTitle>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3 w-3" />
                ERP-inspired
              </Badge>
            </div>
            <CardDescription>
              ERP dashboards usually bias toward role-based workspaces. This example
              starts with a purchasing-clerk preset instead of a one-size-fits-all homepage.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isCustomized ? 'default' : 'outline'}>
              {isCustomized ? 'Custom layout' : 'Preset layout'}
            </Badge>
            <Badge variant="outline">{activeWidgetCount} widgets visible</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Focus preset
            </label>
            <Select
              value={presetId}
              onValueChange={(value) => onPresetChange(value as DashboardPresetId)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DASHBOARD_PRESETS).map(([candidateId, candidate]) => (
                  <SelectItem key={candidateId} value={candidateId}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{preset.description}</p>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onResetToPreset()}
                disabled={isSaving || !isCustomized}
              >
                Reset to preset
              </Button>
              <span className="text-xs text-muted-foreground">{saveLabel}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Visible widgets
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              {(Object.entries(DASHBOARD_WIDGET_META) as Array<
                [DashboardWidgetId, (typeof DASHBOARD_WIDGET_META)[DashboardWidgetId]]
              >).map(([widgetId, widget]) => {
                const checked = visibleWidgetIds.has(widgetId);
                const disableToggle = checked && activeWidgetCount === 1;

                return (
                  <div
                    key={widgetId}
                    className="flex items-start justify-between rounded-lg border bg-background/80 p-3"
                  >
                    <div className="pr-4">
                      <p className="font-medium">{widget.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {widget.description}
                      </p>
                    </div>
                    <Switch
                      checked={checked}
                      onCheckedChange={() => onToggleWidget(widgetId)}
                      disabled={disableToggle || isSaving}
                      aria-label={`Toggle ${widget.label}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

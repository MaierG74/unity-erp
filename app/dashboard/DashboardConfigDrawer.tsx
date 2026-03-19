'use client';

import { Settings } from 'lucide-react';

import {
  DASHBOARD_PRESETS,
  DASHBOARD_WIDGET_META,
  type DashboardPresetId,
  type DashboardWidgetId,
} from '@/app/dashboard/dashboard-config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';

interface DashboardConfigDrawerProps {
  presetId: DashboardPresetId;
  visibleWidgetIds: Set<DashboardWidgetId>;
  isCustomized: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  onPresetChange: (presetId: DashboardPresetId) => void | Promise<void>;
  onToggleWidget: (widgetId: DashboardWidgetId) => void | Promise<void>;
  onResetToPreset: () => void | Promise<void>;
}

export function DashboardConfigDrawer({
  presetId,
  visibleWidgetIds,
  isCustomized,
  isSaving,
  lastSavedAt,
  onPresetChange,
  onToggleWidget,
  onResetToPreset,
}: DashboardConfigDrawerProps) {
  const preset = DASHBOARD_PRESETS[presetId];
  const activeWidgetCount = visibleWidgetIds.size;
  const saveLabel = isSaving
    ? 'Saving...'
    : lastSavedAt
      ? `Saved ${new Date(lastSavedAt).toLocaleTimeString('en-ZA', {
          hour: '2-digit',
          minute: '2-digit',
        })}`
      : 'Auto-saves';

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-border/50 bg-card/50 backdrop-blur-sm hover:bg-accent/50">
          <Settings className="h-4 w-4" />
          <span className="sr-only">Dashboard settings</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[380px] sm:w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Dashboard Settings</SheetTitle>
          <SheetDescription>
            Configure your dashboard layout and visible widgets.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Preset selector */}
          <div className="space-y-3">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Role Preset
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
          </div>

          {/* Status + Reset */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={isCustomized ? 'default' : 'outline'} className="text-xs">
                {isCustomized ? 'Customized' : 'Default'}
              </Badge>
              <span className="text-xs text-muted-foreground">{saveLabel}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onResetToPreset()}
              disabled={isSaving || !isCustomized}
            >
              Reset
            </Button>
          </div>

          {/* Widget toggles */}
          <div className="space-y-3">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Widgets ({activeWidgetCount} visible)
            </label>
            <div className="space-y-2">
              {(Object.entries(DASHBOARD_WIDGET_META) as Array<
                [DashboardWidgetId, (typeof DASHBOARD_WIDGET_META)[DashboardWidgetId]]
              >).map(([widgetId, widget]) => {
                const checked = visibleWidgetIds.has(widgetId);
                const disableToggle = checked && activeWidgetCount === 1;

                return (
                  <div
                    key={widgetId}
                    className="flex items-center justify-between rounded-lg border bg-background/80 p-3"
                  >
                    <div className="pr-4">
                      <p className="text-sm font-medium">{widget.label}</p>
                      <p className="text-xs text-muted-foreground">
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
      </SheetContent>
    </Sheet>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Clock, Plus, Trash2, Save } from 'lucide-react';
import type { ScheduleBreak } from '@/types/work-schedule';

interface ScheduleRow {
  schedule_id: number | null; // null for new rows
  org_id: string;
  day_group: string;
  start_minutes: number;
  end_minutes: number;
  breaks: ScheduleBreak[];
  display_order: number;
  is_active: boolean;
}

const DAY_GROUP_LABELS: Record<string, string> = {
  'mon-thu': 'Monday \u2013 Thursday',
  fri: 'Friday',
  'sat-sun': 'Saturday \u2013 Sunday',
};

const DAY_GROUP_ORDER = ['mon-thu', 'fri', 'sat-sun'];

const DEFAULT_SCHEDULES: Omit<ScheduleRow, 'org_id'>[] = [
  {
    schedule_id: null,
    day_group: 'mon-thu',
    start_minutes: 420,
    end_minutes: 1020,
    breaks: [
      { label: 'Morning tea', startMinutes: 600, endMinutes: 615 },
      { label: 'Lunch', startMinutes: 720, endMinutes: 750 },
      { label: 'Afternoon tea', startMinutes: 900, endMinutes: 915 },
    ],
    display_order: 1,
    is_active: true,
  },
  {
    schedule_id: null,
    day_group: 'fri',
    start_minutes: 420,
    end_minutes: 840,
    breaks: [],
    display_order: 2,
    is_active: true,
  },
  {
    schedule_id: null,
    day_group: 'sat-sun',
    start_minutes: 480,
    end_minutes: 840,
    breaks: [],
    display_order: 3,
    is_active: true,
  },
];

function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatAmPm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const normalized = h % 12 || 12;
  return `${normalized}:${m.toString().padStart(2, '0')} ${suffix}`;
}

export default function WorkSchedulesPage() {
  const queryClient = useQueryClient();
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['work-schedules', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_schedules')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return data as ScheduleRow[];
    },
  });

  // Initialize local state from fetched data
  useEffect(() => {
    if (!data) return;

    // Ensure all three day groups exist (fill in defaults for missing ones)
    const existing = new Map(data.map((row) => [row.day_group, row]));
    const merged = DAY_GROUP_ORDER.map((dayGroup, i) => {
      if (existing.has(dayGroup)) return existing.get(dayGroup)!;
      const defaults = DEFAULT_SCHEDULES.find((d) => d.day_group === dayGroup)!;
      return { ...defaults, org_id: '', display_order: i + 1 } as ScheduleRow;
    });
    setSchedules(merged);
    setDirty(false);
  }, [data]);

  const updateSchedule = useCallback(
    (dayGroup: string, patch: Partial<ScheduleRow>) => {
      setSchedules((prev) =>
        prev.map((s) => (s.day_group === dayGroup ? { ...s, ...patch } : s)),
      );
      setDirty(true);
    },
    [],
  );

  const updateBreak = useCallback(
    (dayGroup: string, breakIndex: number, patch: Partial<ScheduleBreak>) => {
      setSchedules((prev) =>
        prev.map((s) => {
          if (s.day_group !== dayGroup) return s;
          const breaks = [...s.breaks];
          breaks[breakIndex] = { ...breaks[breakIndex], ...patch };
          return { ...s, breaks };
        }),
      );
      setDirty(true);
    },
    [],
  );

  const addBreak = useCallback((dayGroup: string) => {
    setSchedules((prev) =>
      prev.map((s) => {
        if (s.day_group !== dayGroup) return s;
        return {
          ...s,
          breaks: [
            ...s.breaks,
            { label: 'Break', startMinutes: 600, endMinutes: 615 },
          ],
        };
      }),
    );
    setDirty(true);
  }, []);

  const removeBreak = useCallback((dayGroup: string, breakIndex: number) => {
    setSchedules((prev) =>
      prev.map((s) => {
        if (s.day_group !== dayGroup) return s;
        return { ...s, breaks: s.breaks.filter((_, i) => i !== breakIndex) };
      }),
    );
    setDirty(true);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const schedule of schedules) {
        const payload = {
          day_group: schedule.day_group,
          start_minutes: schedule.start_minutes,
          end_minutes: schedule.end_minutes,
          breaks: schedule.breaks,
          display_order: schedule.display_order,
          is_active: schedule.is_active,
        };

        if (schedule.schedule_id) {
          const { error } = await supabase
            .from('work_schedules')
            .update(payload)
            .eq('schedule_id', schedule.schedule_id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('work_schedules').insert(payload);
          if (error) throw error;
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['work-schedules'] }); // invalidates both 'active' and 'all' sub-keys
      setDirty(false);
      toast.success('Work schedules saved');
    } catch (err: any) {
      console.error('Failed to save work schedules:', err);
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-4xl space-y-6 py-8">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container mx-auto max-w-4xl py-8">
        <p className="text-sm text-destructive">Failed to load work schedules. Please refresh and try again.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Work Schedules</h1>
          <p className="text-sm text-muted-foreground">
            Configure shift hours and break times per day group. Changes apply to the labor planning board.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || !dirty}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving...' : 'Save All'}
        </Button>
      </div>

      <div className="space-y-4">
        {schedules.map((schedule) => (
          <Card key={schedule.day_group}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  {DAY_GROUP_LABELS[schedule.day_group] ?? schedule.day_group}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`active-${schedule.day_group}`} className="text-sm text-muted-foreground">
                    Active
                  </Label>
                  <Switch
                    id={`active-${schedule.day_group}`}
                    checked={schedule.is_active}
                    onCheckedChange={(checked) =>
                      updateSchedule(schedule.day_group, { is_active: checked })
                    }
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Shift hours */}
              <div className="flex items-end gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Shift start</Label>
                  <Input
                    type="time"
                    value={minutesToTimeString(schedule.start_minutes)}
                    onChange={(e) =>
                      updateSchedule(schedule.day_group, {
                        start_minutes: timeStringToMinutes(e.target.value),
                      })
                    }
                    className="w-32"
                    step={900}
                  />
                </div>
                <span className="pb-2 text-muted-foreground">–</span>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Shift end</Label>
                  <Input
                    type="time"
                    value={minutesToTimeString(schedule.end_minutes)}
                    onChange={(e) =>
                      updateSchedule(schedule.day_group, {
                        end_minutes: timeStringToMinutes(e.target.value),
                      })
                    }
                    className="w-32"
                    step={900}
                  />
                </div>
                <span className="pb-2 text-sm text-muted-foreground">
                  ({formatAmPm(schedule.start_minutes)} – {formatAmPm(schedule.end_minutes)})
                </span>
              </div>

              {/* Breaks */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Breaks</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => addBreak(schedule.day_group)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add Break
                  </Button>
                </div>

                {schedule.breaks.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">No breaks configured</p>
                )}

                {schedule.breaks.map((brk, i) => (
                  <div key={i} className="flex items-end gap-3 rounded-md border bg-muted/30 p-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Label</Label>
                      <Input
                        value={brk.label}
                        onChange={(e) =>
                          updateBreak(schedule.day_group, i, { label: e.target.value })
                        }
                        className="h-8 w-36 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Start</Label>
                      <Input
                        type="time"
                        value={minutesToTimeString(brk.startMinutes)}
                        onChange={(e) =>
                          updateBreak(schedule.day_group, i, {
                            startMinutes: timeStringToMinutes(e.target.value),
                          })
                        }
                        className="h-8 w-28 text-sm"
                        step={300}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">End</Label>
                      <Input
                        type="time"
                        value={minutesToTimeString(brk.endMinutes)}
                        onChange={(e) =>
                          updateBreak(schedule.day_group, i, {
                            endMinutes: timeStringToMinutes(e.target.value),
                          })
                        }
                        className="h-8 w-28 text-sm"
                        step={300}
                      />
                    </div>
                    <span className="pb-1 text-xs text-muted-foreground">
                      {brk.endMinutes - brk.startMinutes} min
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => removeBreak(schedule.day_group, i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { RefreshCw, Settings, Clock, X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';
import type { SectionWithStaff } from './types';
import type { ShiftInfoWithNow } from '@/hooks/use-shift-info';
import { minutesToTimeString, formatDuration } from '@/lib/shift-utils';

interface FloorHeaderProps {
  sections: SectionWithStaff[];
  isLoading: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  shiftInfo: ShiftInfoWithNow & {
    setOvertime: (args: { endMinutes: number; reason?: string }) => void;
    clearOvertime: () => void;
    isMutating: boolean;
  };
}

export function FloorHeader({ sections, isLoading, onRefresh, onOpenSettings, shiftInfo }: FloorHeaderProps) {
  const [overtimeOpen, setOvertimeOpen] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [reason, setReason] = useState('');

  const { totalActive, totalInProgress } = useMemo(() => {
    let active = 0;
    let inProgress = 0;
    for (const s of sections) {
      active += s.staffJobs.length;
      for (const j of s.staffJobs) {
        if (j.job_status === 'in_progress') inProgress++;
      }
    }
    return { totalActive: active, totalInProgress: inProgress };
  }, [sections]);

  const staleJobCount = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return sections.reduce((sum, s) => {
      return sum + s.staffJobs.filter((j) => {
        const ts = j.started_at ?? j.issued_at;
        return ts ? new Date(ts) < todayStart : false;
      }).length;
    }, 0);
  }, [sections]);

  const today = useMemo(
    () =>
      new Date().toLocaleDateString('en-ZA', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    [],
  );

  const handleSetOvertime = (endMinutes: number) => {
    shiftInfo.setOvertime({ endMinutes, reason: reason || undefined });
    setOvertimeOpen(false);
    setCustomTime('');
    setReason('');
    toast.success(`Shift extended to ${minutesToTimeString(endMinutes)}`);
  };

  const handleClearOvertime = () => {
    shiftInfo.clearOvertime();
    toast.success('Overtime cleared — shift back to normal');
  };

  const presets = [
    { label: '+1h', minutes: shiftInfo.normalEndMinutes + 60 },
    { label: '+2h', minutes: shiftInfo.normalEndMinutes + 120 },
  ];

  return (
    <div className="space-y-1.5">
      {/* Single compact row: title + stats | shift | buttons */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">Factory Floor</h1>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{today}</span>
          {totalActive > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
              <span><span className="text-foreground font-medium">{totalActive}</span> staff</span>
              {totalInProgress > 0 && (
                <span><span className="text-emerald-400 font-medium">{totalInProgress}</span> active</span>
              )}
            </div>
          )}
          <span className="text-muted-foreground/30">|</span>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
            <Clock className="h-3 w-3" />
            <span>
              {shiftInfo.shiftStartFormatted}–{shiftInfo.shiftEndFormatted}
            </span>
            {shiftInfo.hasOvertime && (
              <span className="text-blue-400 font-medium">
                +{formatDuration(shiftInfo.overtimeMinutes)}
              </span>
            )}
            <span className="text-muted-foreground/50">
              ({shiftInfo.minutesUntilShiftEnd > 0
                ? formatDuration(shiftInfo.minutesUntilShiftEnd)
                : 'ended'})
            </span>
            {shiftInfo.hasOvertime ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-muted-foreground"
                onClick={handleClearOvertime}
                disabled={shiftInfo.isMutating}
              >
                <X className="h-2.5 w-2.5 mr-0.5" />
                Clear
              </Button>
            ) : (
              <Popover open={overtimeOpen} onOpenChange={setOvertimeOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]">
                    Extend
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="start">
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Extend shift today</p>
                    <div className="flex gap-2">
                      {presets.map((p) => (
                        <Button
                          key={p.label}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleSetOvertime(p.minutes)}
                          disabled={shiftInfo.isMutating}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Custom end (24h)</label>
                      <div className="flex gap-2">
                        <Input
                          type="time"
                          value={customTime}
                          onChange={(e) => setCustomTime(e.target.value)}
                          className="h-8 text-sm"
                        />
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={!customTime || shiftInfo.isMutating}
                          onClick={() => {
                            const [h, m] = customTime.split(':').map(Number);
                            if (!isNaN(h) && !isNaN(m)) {
                              handleSetOvertime(h * 60 + m);
                            }
                          }}
                        >
                          Set
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Reason (optional)</label>
                      <Input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Rush order, etc."
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onOpenSettings}>
            <Settings className="h-3 w-3 mr-1" />
            Sections
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stale jobs warning — only row 2 when needed */}
      {staleJobCount > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          {staleJobCount} job{staleJobCount > 1 ? 's' : ''} from yesterday still active
        </div>
      )}
    </div>
  );
}

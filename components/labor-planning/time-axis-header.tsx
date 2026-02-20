'use client';

import { cn } from '@/lib/utils';
import type { TimeMarker } from './types';
import type { ScheduleBreak } from '@/types/work-schedule';

interface TimeAxisHeaderProps {
  markers: TimeMarker[];
  startMinutes: number;
  endMinutes: number;
  showMinorTicks?: boolean;
  timelineWidth?: number;
  /** Left offset (px) so header grid lines align with lane timelines. */
  staffColumnOffset?: number;
  /** Scheduled break windows to render as shaded zones. */
  breaks?: ScheduleBreak[];
  /** Current time in minutes from midnight. Only shown when viewing today. */
  nowMinutes?: number | null;
}

export function TimeAxisHeader({
  markers,
  startMinutes,
  endMinutes,
  showMinorTicks = true,
  timelineWidth,
  staffColumnOffset = 120,
  breaks = [],
  nowMinutes,
}: TimeAxisHeaderProps) {
  const totalMinutes = endMinutes - startMinutes;
  const visibleMarkers = showMinorTicks ? markers : markers.filter((marker) => marker.isMajor);

  // Use percentage if no fixed width, otherwise use pixel positioning
  const useFixedWidth = timelineWidth != null && timelineWidth > 0;
  const toPosition = (minutes: number) => {
    const ratio = (minutes - startMinutes) / totalMinutes;
    return useFixedWidth ? ratio * timelineWidth : ratio * 100;
  };

  return (
    <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="flex items-center justify-between px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Time</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-foreground/70">
          {formatMinutes(startMinutes)} – {formatMinutes(endMinutes)}
        </span>
      </div>
      <div
        className="relative h-8 pointer-events-none select-none"
        style={{
          marginLeft: staffColumnOffset,
          ...(useFixedWidth ? { width: timelineWidth } : {}),
        }}
      >
        {visibleMarkers.map((marker) => {
          const pos = toPosition(marker.minutes);

          return (
            <div
              key={`${marker.label}-${marker.minutes}`}
              className={cn(
                'absolute top-0 bottom-0 border-l',
                marker.isMajor ? 'border-border' : 'border-dashed border-muted-foreground/40',
              )}
              style={{ left: useFixedWidth ? pos : `${pos}%` }}
            >
              {marker.isMajor && (
                <div className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] text-foreground">
                  {marker.label}
                </div>
              )}
            </div>
          );
        })}
        {/* Break zone overlays */}
        {breaks.map((brk) => {
          const left = toPosition(brk.startMinutes);
          const right = toPosition(brk.endMinutes);
          const width = right - left;
          return (
            <div
              key={`break-${brk.startMinutes}`}
              className="absolute inset-y-0 bg-muted-foreground/10 border-x border-dashed border-muted-foreground/25"
              style={{
                left: useFixedWidth ? left : `${left}%`,
                width: useFixedWidth ? width : `${width}%`,
              }}
            >
              <span className="absolute bottom-0 left-1 truncate text-[8px] leading-tight text-muted-foreground/70">
                {brk.label}
              </span>
            </div>
          );
        })}

        <div
          className="absolute inset-y-0 border-l border-border"
          style={{ left: useFixedWidth ? timelineWidth : '100%' }}
        />

        {/* Now indicator */}
        {nowMinutes != null && nowMinutes >= startMinutes && nowMinutes <= endMinutes && (() => {
          const pos = toPosition(nowMinutes);
          const posStyle = useFixedWidth ? pos : `${pos}%`;
          return (
            <div
              className="pointer-events-none absolute inset-y-0 z-20"
              style={{ left: posStyle }}
            >
              <div className="absolute -top-3 -translate-x-1/2 h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_4px_1px_rgba(244,63,94,0.5)]" />
              <div className="absolute -top-7 -translate-x-1/2 whitespace-nowrap rounded bg-rose-500 px-1 py-px text-[8px] font-bold leading-tight text-white">
                {formatMinutes(nowMinutes)}
              </div>
              <div className="absolute inset-y-0 border-l-2 border-rose-500" />
            </div>
          );
        })()}
      </div>
    </div>
  );
}

const formatMinutes = (value: number) => {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const normalized = hours % 12 || 12;
  const paddedMinutes = minutes.toString().padStart(2, '0');
  return `${normalized}:${paddedMinutes} ${suffix}`;
};

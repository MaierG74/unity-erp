'use client';

import { cn } from '@/lib/utils';
import type { TimeMarker } from './types';

interface TimeAxisHeaderProps {
  markers: TimeMarker[];
  startMinutes: number;
  endMinutes: number;
  showMinorTicks?: boolean;
  timelineWidth?: number;
}

export function TimeAxisHeader({
  markers,
  startMinutes,
  endMinutes,
  showMinorTicks = true,
  timelineWidth,
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
        className="relative h-8 pointer-events-none select-none ml-[120px]"
        style={useFixedWidth ? { width: timelineWidth } : undefined}
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
        <div
          className="absolute inset-y-0 border-l border-border"
          style={{ left: useFixedWidth ? timelineWidth : '100%' }}
        />
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

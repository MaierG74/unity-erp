'use client';

import { cn } from '@/lib/utils';
import type { TimeMarker } from './types';

interface TimeAxisHeaderProps {
  markers: TimeMarker[];
  startMinutes: number;
  endMinutes: number;
  showMinorTicks?: boolean;
}

export function TimeAxisHeader({
  markers,
  startMinutes,
  endMinutes,
  showMinorTicks = true,
}: TimeAxisHeaderProps) {
  const totalMinutes = endMinutes - startMinutes;
  const visibleMarkers = showMinorTicks ? markers : markers.filter((marker) => marker.isMajor);

  return (
    <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Time axis</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">Shift view</span>
          <span className="rounded-full bg-muted px-2 py-1 text-foreground/70">
            {formatMinutes(startMinutes)} – {formatMinutes(endMinutes)}
          </span>
        </div>
      </div>
      <div className="relative h-10">
        {visibleMarkers.map((marker) => {
          const offset = ((marker.minutes - startMinutes) / totalMinutes) * 100;

          return (
            <div
              key={`${marker.label}-${marker.minutes}`}
              className={cn(
                'absolute top-0 bottom-0 border-l',
                marker.isMajor ? 'border-border' : 'border-dashed border-muted-foreground/40',
              )}
              style={{ left: `${offset}%` }}
            >
              <div
                className={cn(
                  'absolute -top-0.5 -translate-x-1/2 whitespace-nowrap text-[11px]',
                  marker.isMajor ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {marker.label}
              </div>
            </div>
          );
        })}
        <div className="absolute inset-y-0 right-0 border-l border-border" />
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

'use client';

import type { DragEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { minutesToClock } from '@/src/lib/laborScheduling';
import { Circle, GripHorizontal, X } from 'lucide-react';
import type { LaborDragPayload, StaffAssignment, StaffLane, TimeMarker } from './types';

interface StaffLaneListProps {
  staff: StaffLane[];
  markers: TimeMarker[];
  startMinutes: number;
  endMinutes: number;
  onDrop: (options: { staff: StaffLane; startMinutes: number; payload: LaborDragPayload }) => void;
  onUnassign?: (assignment: StaffAssignment) => void;
  compact?: boolean;
}

export function StaffLaneList({
  staff,
  markers,
  startMinutes,
  endMinutes,
  onDrop,
  onUnassign,
  compact = false,
}: StaffLaneListProps) {
  const totalMinutes = endMinutes - startMinutes;
  const laneHeightClass = compact ? 'h-24' : 'h-32';

  const toPercent = (value: number) => ((value - startMinutes) / totalMinutes) * 100;
  const widthPercent = (start: number, end: number) => ((end - start) / totalMinutes) * 100;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const isAvailable = (lane: StaffLane) => {
    const availability = lane.availability;
    if (!availability) return true;
    if (availability.isActive === false) return false;
    if (availability.isCurrent === false) return false;
    if (availability.isAvailableOnDate === false) return false;
    return true;
  };

  const parsePayload = (event: DragEvent<HTMLDivElement>): LaborDragPayload | null => {
    const raw = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LaborDragPayload;
    } catch {
      return null;
    }
  };

  const computeMinutesFromEvent = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = clamp(event.clientX - rect.left, 0, rect.width);
    const ratio = rect.width === 0 ? 0 : offset / rect.width;
    return Math.round(startMinutes + ratio * totalMinutes);
  };

  return (
    <div className="space-y-3 p-3">
      {staff.length === 0 && (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/60 text-sm text-muted-foreground">
          No staff available to accept drops for this date.
        </div>
      )}
      {staff.map((lane) => {
        const laneAvailable = isAvailable(lane);

        return (
          <div key={lane.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className={cn("flex items-center justify-between gap-3 border-b px-4", compact ? "py-2" : "py-3")}>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={cn("font-semibold", compact ? "text-[13px]" : "text-sm")}>{lane.name}</span>
                <Badge variant="secondary" className="text-[11px]">
                  {lane.role}
                </Badge>
                {!laneAvailable && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[11px] text-amber-900">
                    Off shift / unavailable
                  </Badge>
                )}
              </div>
              <p className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
                Capacity {lane.capacityHours}h • Window {lane.availableFrom ?? '07:00'} - {lane.availableTo ?? '19:00'}
              </p>
            </div>
            <div className={cn("flex items-center gap-2 text-muted-foreground", compact ? "text-[10px]" : "text-[11px]")}>
              <Circle className={cn('h-2.5 w-2.5', laneAvailable ? 'fill-emerald-500/70 text-emerald-500/70' : 'fill-amber-500/70 text-amber-500/70')} />
              <span>{laneAvailable ? 'Accepting drops' : 'Off shift'}</span>
            </div>
          </div>

          <div
            className={cn("relative bg-muted/40 group", laneHeightClass)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const payload = parsePayload(event);
              if (!payload) return;
              const dropMinutes = computeMinutesFromEvent(event);
              onDrop({ staff: lane, startMinutes: dropMinutes, payload });
            }}
          >
            <div className="pointer-events-none absolute inset-0">
              {markers.map((marker) => (
                <div
                  key={`${lane.id}-grid-${marker.minutes}`}
                  className={cn(
                    'absolute inset-y-0 border-l',
                    marker.isMajor ? 'border-border/80' : 'border-dashed border-muted-foreground/40',
                  )}
                  style={{ left: `${((marker.minutes - startMinutes) / totalMinutes) * 100}%` }}
                />
              ))}
            </div>

            <div className="absolute inset-0 flex items-center gap-3 px-3">
              {(lane.openSlots ?? defaultSlots()).map((slot, index) => (
                <div
                  key={`${lane.id}-slot-${index}`}
                  className={cn(
                    "relative flex-1 rounded-lg border border-dashed border-primary/40 bg-primary/5 text-[11px] text-primary transition hover:border-primary/80 hover:bg-primary/10",
                    compact ? "h-7 opacity-0 group-hover:opacity-60" : "h-9"
                  )}
                >
                  <span className="absolute left-3 top-1/2 -translate-y-1/2">
                    {slot.label ?? 'Open slot'}
                  </span>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-primary/80">
                    {slot.start} → {slot.end}
                  </span>
                </div>
              ))}
            </div>

            {lane.assignments.map((assignment) => {
              const left = toPercent(assignment.startMinutes);
              const width = widthPercent(assignment.startMinutes, assignment.endMinutes);
              const baseColor =
                assignment.color ??
                (assignment.status === 'overbooked'
                  ? '#fb7185'
                  : assignment.status === 'tentative'
                    ? '#60a5fa'
                    : '#34d399');

              return (
                <div
                  key={assignment.id}
                  className={cn(
                    'absolute top-14 flex h-11 items-center rounded-lg border bg-gradient-to-r px-3 text-xs font-medium text-foreground shadow-sm',
                    assignment.status === 'overbooked'
                      ? 'border-rose-300/80'
                      : assignment.status === 'tentative'
                        ? 'border-blue-300/70'
                        : 'border-emerald-300/70',
                  )}
                  draggable
                  onDragStart={(event) => {
                    const payload: LaborDragPayload = { type: 'assignment', assignment };
                    event.dataTransfer.setData('application/json', JSON.stringify(payload));
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    minWidth: compact ? '88px' : '96px',
                    background: `linear-gradient(90deg, ${baseColor} 0%, ${baseColor}cc 70%)`,
                    borderColor: baseColor,
                  }}
                >
                  {assignment.showHandles !== false && (
                    <>
                      <div
                        className="absolute left-0 top-0 flex h-full w-2 cursor-ew-resize items-center justify-center rounded-l bg-black/15"
                        draggable
                        onDragStart={(event) => {
                          const payload: LaborDragPayload = { type: 'resize-start', assignment };
                          event.dataTransfer.setData('application/json', JSON.stringify(payload));
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 text-white/70" />
                      </div>
                      <div
                        className="absolute right-0 top-0 flex h-full w-2 cursor-ew-resize items-center justify-center rounded-r bg-black/15"
                        draggable
                        onDragStart={(event) => {
                          const payload: LaborDragPayload = { type: 'resize-end', assignment };
                          event.dataTransfer.setData('application/json', JSON.stringify(payload));
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 text-white/70" />
                      </div>
                    </>
                  )}
                  <div className="flex flex-1 flex-col">
                    <span className="truncate">{assignment.label}</span>
                    <span className="text-[11px] text-white/90">
                      {minutesToClock(assignment.startMinutes)} → {minutesToClock(assignment.endMinutes)}
                    </span>
                  </div>
                  {onUnassign && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onUnassign(assignment);
                      }}
                      className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/15 text-white/80 transition hover:bg-black/25"
                      aria-label="Unassign job"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    })}
  </div>
  );
}

const defaultSlots = () => [
  { start: '08:00', end: '10:00', label: 'Drop job' },
  { start: '13:00', end: '15:00', label: 'Hold for rework' },
];

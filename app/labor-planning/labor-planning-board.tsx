'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { OrderTree } from '@/components/labor-planning/order-tree';
import { StaffLaneList } from '@/components/labor-planning/staff-lane-list';
import { TimeAxisHeader } from '@/components/labor-planning/time-axis-header';
import type {
  LaborDragPayload,
  PlanningJob,
  PlanningOrder,
  StaffAssignment,
  StaffLane,
  TimeMarker,
} from '@/components/labor-planning/types';
import { fetchLaborPlanningPayload } from '@/lib/queries/laborPlanning';
import {
  buildAssignmentLabel,
  calculateDurationMinutes,
  checkLaneConstraints,
  chooseSnapIncrement,
} from '@/src/lib/laborScheduling';
import { logSchedulingEvent } from '@/src/lib/analytics/scheduling';
import { useLaborPlanningMutations } from '@/src/lib/mutations/laborPlanning';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Minus, Plus, ZoomIn } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const START_MINUTES = 7 * 60;
const END_MINUTES = 19 * 60;
const MIN_DURATION = 30;
const TIME_MARKERS = buildTimeMarkers(START_MINUTES, END_MINUTES);

// Zoom levels: pixels per hour
const ZOOM_LEVELS = [80, 120, 180, 240] as const;
const ZOOM_STORAGE_KEY = 'labor-planning-zoom';

function getStoredZoom(): number {
  if (typeof window === 'undefined') return 1;
  const stored = localStorage.getItem(ZOOM_STORAGE_KEY);
  if (stored) {
    const idx = parseInt(stored, 10);
    if (idx >= 0 && idx < ZOOM_LEVELS.length) return idx;
  }
  return 1; // default to second level (120px/hr)
}

function storeZoom(index: number): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(index));
  }
}

export function LaborPlanningBoard() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(
    () => searchParams?.get('date') || format(new Date(), 'yyyy-MM-dd')
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const compactFromParams = searchParams?.get('compact') !== '0';
  const [compact, setCompact] = useState(compactFromParams);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set());
  const [zoomIndex, setZoomIndex] = useState(1);
  const swimlaneScrollRef = useRef<HTMLDivElement>(null);
  const queryKey = ['labor-planning', selectedDate] as const;

  // Load zoom from localStorage on mount
  useEffect(() => {
    setZoomIndex(getStoredZoom());
  }, []);

  const handleZoomChange = useCallback((delta: number) => {
    setZoomIndex((prev) => {
      const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, prev + delta));
      storeZoom(next);
      return next;
    });
  }, []);

  const handleDateChange = useCallback((newDate: string) => {
    setSelectedDate(newDate);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const today = format(new Date(), 'yyyy-MM-dd');
    if (newDate === today) {
      params.delete('date');
    } else {
      params.set('date', newDate);
    }
    const qs = params.toString();
    window.history.replaceState(null, '', pathname + (qs ? `?${qs}` : ''));
  }, [searchParams, pathname]);

  // Calculate timeline width based on zoom
  const totalHours = (END_MINUTES - START_MINUTES) / 60;
  const pixelsPerHour = ZOOM_LEVELS[zoomIndex];
  const timelineWidth = totalHours * pixelsPerHour;

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => fetchLaborPlanningPayload({ date: selectedDate }),
  });

  const { assignMutation, updateMutation, unassignMutation } = useLaborPlanningMutations(queryKey);

  const jobLookup = useMemo(
    () => buildJobLookup(data?.orders ?? []),
    [data?.orders]
  );

  const staffLanes = useMemo(
    () => buildStaffLanes(data, jobLookup),
    [data, jobLookup]
  );

  const roleGroups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; lanes: StaffLane[] }>();
    staffLanes.forEach((lane) => {
      const key = normalizeRoleKey(lane.role);
      const label = lane.role || 'General';
      if (!map.has(key)) map.set(key, { key, label, lanes: [] });
      map.get(key)!.lanes.push(lane);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [staffLanes]);

  const filteredRoles =
    selectedRoles.length === 0 ? roleGroups.map((group) => group.key) : selectedRoles;

  const filteredLanes = useMemo(
    () =>
      roleGroups
        .filter((group) => filteredRoles.includes(group.key))
        .flatMap((group) => group.lanes),
    [filteredRoles, roleGroups]
  );

  useEffect(() => {
    setCompact(compactFromParams);
  }, [compactFromParams]);


  const noStaffAvailable = useMemo(() => {
    if (!data) return false;
    if (!data.staff || data.staff.length === 0) return true;
    return data.staff.every((staff) => {
      const availability = staff.availability;
      if (!availability) return false;
      return availability.isActive === false || availability.isCurrent === false || availability.isAvailableOnDate === false;
    });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    if (noStaffAvailable) {
      logSchedulingEvent({
        type: 'missing_staff',
        date: selectedDate,
        reason: data.staff.length === 0 ? 'roster_empty' : 'no_available_staff',
        detail: `Staff rows: ${data.staff.length}`,
      });
    }
  }, [data, noStaffAvailable, selectedDate]);

  const handleDrop = useCallback(
    ({
      staff,
      startMinutes,
      payload,
    }: {
      staff: StaffLane;
      startMinutes: number;
      payload: LaborDragPayload;
    }) => {
      if (!data) return;
      const clampedStart = clampMinutes(startMinutes, START_MINUTES, END_MINUTES);
      const laneAssignments = staff.assignments ?? [];

      if (payload.type === 'job') {
        const jobMeta = jobLookup.get(payload.job.id) ?? { job: payload.job, order: undefined };
        const duration = Math.max(
          calculateDurationMinutes(jobMeta.job, { minimumMinutes: MIN_DURATION }),
          MIN_DURATION
        );
        const snap = chooseSnapIncrement(duration);
        const snappedStart = snapToGrid(clampedStart, snap, START_MINUTES, END_MINUTES - duration);
        const end = Math.min(snappedStart + duration, END_MINUTES);

        const constraints = checkLaneConstraints(
          laneAssignments.map((assignment) => ({
            id: assignment.id,
            startMinutes: assignment.startMinutes,
            endMinutes: assignment.endMinutes,
            label: assignment.label,
          })),
          { id: payload.job.id, startMinutes: snappedStart, endMinutes: end },
          {
            window: { startMinutes: START_MINUTES, endMinutes: END_MINUTES },
            availability: staff.availability,
          }
        );

        if (constraints.hasConflict) {
          const message = buildConstraintMessage(constraints, staff, laneAssignments);
          toast.error(message.title, { description: message.description });
          logSchedulingEvent({
            type: 'drop_blocked',
            jobKey: payload.job.id,
            jobLabel: jobMeta.job.name,
            staffId: staff.id,
            staffName: staff.name,
            date: selectedDate,
            startMinutes: snappedStart,
            endMinutes: end,
            reason: constraints.status,
            detail: message.description,
          });
          return;
        }

        logSchedulingEvent({
          type: 'drop_attempt',
          jobKey: payload.job.id,
          jobLabel: jobMeta.job.name,
          staffId: staff.id,
          staffName: staff.name,
          date: selectedDate,
          startMinutes: snappedStart,
          endMinutes: end,
        });

        assignMutation.mutate({
          job: jobMeta.job,
          staffId: Number(staff.id),
          startMinutes: snappedStart,
          endMinutes: end,
          assignmentDate: selectedDate,
        });
        return;
      }

      const assignment = payload.assignment;
      const duration =
        (assignment.endMinutes ?? 0) - (assignment.startMinutes ?? 0) || MIN_DURATION;
      const snap = chooseSnapIncrement(Math.abs(duration));

      let nextStart = assignment.startMinutes;
      let nextEnd = assignment.endMinutes;

      if (payload.type === 'assignment') {
        nextStart = snapToGrid(clampedStart, snap, START_MINUTES, END_MINUTES - duration);
        nextEnd = Math.min(nextStart + duration, END_MINUTES);
      } else if (payload.type === 'resize-start') {
        const maxStart = Math.min(assignment.endMinutes - 15, END_MINUTES - MIN_DURATION);
        nextStart = snapToGrid(clampedStart, snap, START_MINUTES, maxStart);
        nextEnd = assignment.endMinutes;
      } else if (payload.type === 'resize-end') {
        const minEnd = (assignment.startMinutes ?? START_MINUTES) + 15;
        nextEnd = snapToGrid(clampedStart, snap, minEnd, END_MINUTES);
        nextStart = assignment.startMinutes;
      }

      const constraints = checkLaneConstraints(
        laneAssignments
          .filter((existing) => existing.jobKey !== assignment.jobKey)
          .map((existing) => ({
            id: existing.id,
            startMinutes: existing.startMinutes,
            endMinutes: existing.endMinutes,
            label: existing.label,
          })),
        { id: assignment.id, startMinutes: nextStart, endMinutes: nextEnd },
        {
          window: { startMinutes: START_MINUTES, endMinutes: END_MINUTES },
          availability: staff.availability,
        }
      );

      if (constraints.hasConflict) {
        const message = buildConstraintMessage(constraints, staff, laneAssignments);
        toast.error(message.title, { description: message.description });
        logSchedulingEvent({
          type: 'drop_blocked',
          jobKey: assignment.jobKey,
          jobLabel: assignment.label,
          staffId: staff.id,
          staffName: staff.name,
          date: selectedDate,
          startMinutes: nextStart,
          endMinutes: nextEnd,
          reason: constraints.status,
          detail: message.description,
        });
        return;
      }

      logSchedulingEvent({
        type: 'drop_attempt',
        jobKey: assignment.jobKey,
        jobLabel: assignment.label,
        staffId: staff.id,
        staffName: staff.name,
        date: selectedDate,
        startMinutes: nextStart,
        endMinutes: nextEnd,
      });

      updateMutation.mutate({
        assignmentId: assignment.id,
        jobKey: assignment.jobKey,
        staffId: Number(staff.id),
        startMinutes: nextStart,
        endMinutes: nextEnd,
        assignmentDate: selectedDate,
        payType: assignment.payType,
        hourlyRateId: assignment.hourlyRateId,
        pieceRateId: assignment.pieceRateId,
        rateId: assignment.rateId,
        status: 'scheduled',
      });
    },
    [assignMutation, data, jobLookup, selectedDate, updateMutation]
  );

  const handleUnassign = useCallback(
    (assignment: StaffAssignment) => {
      unassignMutation.mutate({
        jobKey: assignment.jobKey,
        assignmentDate: selectedDate,
        assignmentId: assignment.id,
      });
    },
    [selectedDate, unassignMutation]
  );

  if (isLoading) {
    return (
      <div className="container mx-auto space-y-6 py-6">
        <div className="h-10 w-64 animate-pulse rounded-md bg-muted" />
        <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[360px_1fr]">
          <div className="h-full rounded-lg border bg-card shadow-sm" />
          <div className="h-full rounded-lg border bg-card shadow-sm" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="container mx-auto space-y-4 py-10">
        <h1 className="text-2xl font-semibold sr-only">Labor Planning Board</h1>
        <p className="text-muted-foreground">Failed to load planning data.</p>
      </div>
    );
  }

  // Height tuned so columns scroll independently while fitting in viewport
  // Account for: navbar (64px) + role filter bar (~42px) + grid gap (12px) + padding (8px)
  const columnHeight = 'calc(100vh - 130px)';

  return (
    <div className="w-full space-y-0 px-2 py-1">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-sm shadow-sm mb-2">
        <div className="flex items-center gap-1 mr-2 border-r pr-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => handleDateChange(format(subDays(new Date(selectedDate + 'T00:00:00'), 1), 'yyyy-MM-dd'))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs font-medium">
                {format(new Date(selectedDate + 'T00:00:00'), 'MMM d, yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={new Date(selectedDate + 'T00:00:00')}
                onSelect={(date) => {
                  if (date) {
                    handleDateChange(format(date, 'yyyy-MM-dd'));
                    setDatePickerOpen(false);
                  }
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => handleDateChange(format(addDays(new Date(selectedDate + 'T00:00:00'), 1), 'yyyy-MM-dd'))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {selectedDate !== format(new Date(), 'yyyy-MM-dd') && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => handleDateChange(format(new Date(), 'yyyy-MM-dd'))}
            >
              Today
            </Button>
          )}
        </div>
        <span className="text-muted-foreground">Filter by role:</span>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {roleGroups.map((group) => {
            const active = filteredRoles.includes(group.key);
            return (
              <Button
                key={group.key}
                size="sm"
                variant={active ? 'default' : 'outline'}
                className="h-7 whitespace-nowrap px-2 text-xs"
                onClick={() => {
                  setSelectedRoles((prev) => {
                    if (prev.length === 0) return [group.key];
                    if (prev.includes(group.key)) {
                      const next = prev.filter((key) => key !== group.key);
                      return next;
                    }
                    return [...prev, group.key];
                  });
                }}
              >
                {group.label}
              </Button>
            );
          })}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setSelectedRoles([])}
        >
          Reset
        </Button>
      </div>

      <div className="sr-only">
        <h1 className="text-3xl font-bold tracking-tight">Labor Planning Board</h1>
        <p className="text-sm text-muted-foreground">
          Drag jobs into swimlanes; move or resize bars to adjust. Compact view trims labels and grid clutter.
        </p>
      </div>

      {noStaffAvailable && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTitle>No staff available to schedule</AlertTitle>
          <AlertDescription>
            Import or activate staff records for this date before scheduling jobs. Off-shift team members cannot accept drops.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-2 lg:grid-cols-[200px_1fr]">
        <Card className="flex flex-col overflow-hidden" style={{ height: columnHeight, maxHeight: columnHeight }}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Orders</span>
            <span className="text-[11px] text-muted-foreground">{data.orders.length} open</span>
          </div>
          <div className="flex-1 overflow-auto px-1 py-1">
            <OrderTree orders={data.orders as PlanningOrder[]} />
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden" style={{ height: columnHeight, maxHeight: columnHeight }}>
          {/* Zoom controls bar */}
          <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ZoomIn className="h-3.5 w-3.5" />
              <span>Timeline zoom</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => handleZoomChange(-1)}
                disabled={zoomIndex === 0}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-16 text-center text-[11px] text-muted-foreground">
                {pixelsPerHour}px/hr
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => handleZoomChange(1)}
                disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <CardContent className="relative flex-1 overflow-hidden p-0">
            <div
              ref={swimlaneScrollRef}
              className="relative h-full overflow-auto rounded-b-lg"
            >
              <div style={{ minWidth: timelineWidth + 160 }}>
                <TimeAxisHeader
                  markers={TIME_MARKERS}
                  startMinutes={START_MINUTES}
                  endMinutes={END_MINUTES}
                  showMinorTicks={!compact}
                  timelineWidth={timelineWidth}
                />
                <div className="space-y-3 px-3 pb-3 pt-1">
                  {roleGroups
                    .filter((group) => filteredRoles.includes(group.key))
                    .map((group) => {
                      const collapsed = collapsedRoles.has(group.key);
                      return (
                        <div key={group.key} className="rounded-lg border bg-card shadow-sm">
                          <div className="flex items-center justify-between border-b px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold">{group.label}</span>
                              <Badge variant="secondary" className="h-5 text-[10px]">
                                {group.lanes.length} staff
                              </Badge>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() =>
                                setCollapsedRoles((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(group.key)) next.delete(group.key);
                                  else next.add(group.key);
                                  return next;
                                })
                              }
                            >
                              {collapsed ? 'Expand' : 'Collapse'}
                            </Button>
                          </div>
                          {!collapsed && (
                            <StaffLaneList
                              staff={group.lanes}
                              markers={TIME_MARKERS}
                              startMinutes={START_MINUTES}
                              endMinutes={END_MINUTES}
                              onDrop={handleDrop}
                              onUnassign={handleUnassign}
                              compact={compact}
                              timelineWidth={timelineWidth}
                            />
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function buildJobLookup(orders: PlanningOrder[]) {
  const lookup = new Map<
    string,
    { job: PlanningJob; order: PlanningOrder | null }
  >();

  orders.forEach((order) => {
    order.jobs.forEach((job) => lookup.set(job.id, { job, order }));
  });

  return lookup;
}

function buildStaffLanes(
  payload: Awaited<ReturnType<typeof fetchLaborPlanningPayload>> | undefined,
  lookup: Map<string, { job: PlanningJob; order: PlanningOrder | null }>
): StaffLane[] {
  if (!payload) return [];

  return payload.staff.map((staff) => {
    const assignmentsForStaff = payload.assignments.filter(
      (assignment) => assignment.staffId === staff.id && assignment.status !== 'unscheduled'
    );

    const assignments: StaffAssignment[] = assignmentsForStaff.map((assignment) => {
      const jobMeta = lookup.get(assignment.jobKey);
      const job = jobMeta?.job;
      const order = jobMeta?.order;
      const duration =
        assignment.startMinutes != null && assignment.endMinutes != null
          ? assignment.endMinutes - assignment.startMinutes
          : Math.max(calculateDurationMinutes(job ?? {}, { minimumMinutes: MIN_DURATION }), MIN_DURATION);
      const start = assignment.startMinutes ?? START_MINUTES;
      const end = assignment.endMinutes ?? start + duration;
      const label = buildAssignmentLabel({
        orderNumber: order?.orderNumber ?? order?.id,
        jobName: job?.name ?? 'Job',
        productName: job?.productName,
        categoryName: job?.categoryName,
        quantity: job?.quantity,
        payType: job?.payType,
      });

      return {
        id: assignment.assignmentId,
        jobKey: assignment.jobKey,
        orderId: order?.orderId ?? job?.orderId ?? null,
        orderNumber: order?.orderNumber ?? null,
        jobId: assignment.jobId ?? job?.jobId ?? null,
        jobName: job?.name ?? null,
        productName: job?.productName ?? null,
        label,
        startMinutes: start,
        endMinutes: end,
        color: job?.categoryColor ?? '#0ea5e9',
        status: assignment.status === 'unscheduled' ? 'unscheduled' : 'scheduled',
        payType: assignment.payType,
        hourlyRateId: assignment.hourlyRateId,
        pieceRateId: assignment.pieceRateId,
        rateId: assignment.rateId,
        bolId: assignment.bolId,
        // Time tracking fields
        jobStatus: assignment.jobStatus ?? undefined,
        issuedAt: assignment.issuedAt,
        startedAt: assignment.startedAt,
        assignmentDate: assignment.assignmentDate,
      };
    });

    return {
      id: String(staff.id),
      name: staff.name,
      role: staff.role ?? 'Team member',
      capacityHours: staff.capacityHours ?? 0,
      availability: staff.availability,
      assignments,
      availableFrom: formatRange(START_MINUTES),
      availableTo: formatRange(END_MINUTES),
    };
  });
}

function clampMinutes(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snapToGrid(value: number, increment: number, min: number, max: number) {
  const snapped = Math.round(value / increment) * increment;
  return clampMinutes(snapped, min, max);
}

function buildTimeMarkers(start: number, end: number): TimeMarker[] {
  const markers: TimeMarker[] = [];

  for (let minutes = start; minutes <= end; minutes += 60) {
    markers.push({ minutes, label: formatRange(minutes), isMajor: true });
    const half = minutes + 30;
    if (half < end) {
      markers.push({ minutes: half, label: formatHalf(half) });
    }
  }

  return markers;
}

function formatRange(value: number) {
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const normalized = hours % 12 || 12;
  return `${normalized}:${mins.toString().padStart(2, '0')} ${suffix}`;
}

function formatHalf(value: number) {
  const hours = Math.floor(value / 60);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const normalized = hours % 12 || 12;
  return `${normalized}:30 ${suffix}`;
}

function normalizeRoleKey(role?: string | null) {
  return (role ?? 'General').toLowerCase().trim() || 'general';
}

function buildConstraintMessage(
  constraints: ReturnType<typeof checkLaneConstraints>,
  staff: StaffLane,
  assignments: StaffAssignment[]
) {
  if (constraints.status === 'availability') {
    return {
      title: 'Staff unavailable',
      description: `${staff.name} is off-shift or inactive for the selected date.`,
    };
  }

  if (constraints.status === 'window') {
    return {
      title: 'Outside shift window',
      description: `Place this job within ${formatRange(START_MINUTES)} – ${formatRange(END_MINUTES)} for ${staff.name}.`,
    };
  }

  if (constraints.status === 'overlap') {
    const overlapping = constraints.overlaps[0];
    const conflicting = overlapping
      ? assignments.find((assignment) => assignment.id === overlapping.id)
      : undefined;

    const label = conflicting?.label ?? 'another assignment';
    const timing =
      conflicting && conflicting.startMinutes != null && conflicting.endMinutes != null
        ? `${formatRange(conflicting.startMinutes)} – ${formatRange(conflicting.endMinutes)}`
        : 'this window';

    return {
      title: 'Overlap detected',
      description: `This drop conflicts with ${label} (${timing}). Move the bar to an open slot.`,
    };
  }

  if (constraints.status === 'capacity' && constraints.overrunMinutes != null) {
    return {
      title: 'Lane capacity exceeded',
      description: `This schedule exceeds ${staff.name}'s capacity by ${constraints.overrunMinutes} minute${constraints.overrunMinutes === 1 ? '' : 's'}.`,
    };
  }

  return {
    title: 'Cannot place job',
    description: constraints.issues[0]?.message ?? 'Lane conflict detected.',
  };
}

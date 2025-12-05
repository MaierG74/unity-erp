'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
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

const START_MINUTES = 7 * 60;
const END_MINUTES = 19 * 60;
const MIN_DURATION = 30;
const TIME_MARKERS = buildTimeMarkers(START_MINUTES, END_MINUTES);

export function LaborPlanningBoard() {
  const [selectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [compact, setCompact] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set());
  const queryKey = ['labor-planning', selectedDate] as const;

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
        <h1 className="text-2xl font-semibold">Labor Planning Board</h1>
        <p className="text-muted-foreground">Failed to load planning data.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Labor Planning Board</h1>
          <p className="text-sm text-muted-foreground">
            Drag jobs into swimlanes; move or resize bars to adjust. Compact view trims labels and grid clutter.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
            <span className="text-muted-foreground">Compact lanes</span>
            <Switch checked={compact} onCheckedChange={setCompact} aria-label="Toggle compact lane density" />
          </div>
          <Badge variant="outline" className="bg-primary/10 text-primary">
            Prototype surface
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {formatRange(START_MINUTES)} – {formatRange(END_MINUTES)}
          </Badge>
        </div>
      </div>

      {noStaffAvailable && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTitle>No staff available to schedule</AlertTitle>
          <AlertDescription>
            Import or activate staff records for this date before scheduling jobs. Off-shift team members cannot accept drops.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[320px_1fr] xl:grid-cols-[300px_1fr]">
        <Card className="flex h-[72vh] flex-col">
          <CardHeader>
            <CardTitle>Orders ready for placement</CardTitle>
            <CardDescription>
              Expand an order to see its jobs, then drag jobs into swimlanes on the right.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <OrderTree orders={data.orders as PlanningOrder[]} />
          </CardContent>
        </Card>

        <Card className="flex h-[72vh] flex-col">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Staff swimlanes</CardTitle>
              <CardDescription>
                Time-scaled grid with sticky header and drop targets for scheduling.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-muted text-xs">
                Drag to adjust run-times
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <div className="flex items-center gap-2 px-4 pb-2 text-sm">
              <span className="text-muted-foreground">Filter by role:</span>
              <div className="flex flex-wrap gap-1">
                {roleGroups.map((group) => {
                  const active = filteredRoles.includes(group.key);
                  return (
                    <Button
                      key={group.key}
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      className="h-7 px-2 text-xs"
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedRoles([])}
                >
                  Reset
                </Button>
              </div>
            </div>
            <div className="relative h-full overflow-auto rounded-b-lg">
              <TimeAxisHeader
                markers={TIME_MARKERS}
                startMinutes={START_MINUTES}
                endMinutes={END_MINUTES}
                showMinorTicks={!compact}
              />
              <div className="space-y-4 px-4 pb-4 pt-2">
                {roleGroups
                  .filter((group) => filteredRoles.includes(group.key))
                  .map((group) => {
                    const collapsed = collapsedRoles.has(group.key);
                    return (
                      <div key={group.key} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                        <div className="flex items-center justify-between border-b px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{group.label}</span>
                            <Badge variant="secondary" className="text-[11px]">
                              {group.lanes.length} staff
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
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
                          />
                        )}
                      </div>
                    );
                  })}
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

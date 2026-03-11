'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { OrderTree } from '@/components/labor-planning/order-tree';
import { StaffLaneList } from '@/components/labor-planning/staff-lane-list';
import { TimeAxisHeader } from '@/components/labor-planning/time-axis-header';
import { WeekStrip } from '@/components/labor-planning/week-strip';
import type {
  LaborDragPayload,
  PlanningJob,
  PlanningOrder,
  StaffAssignment,
  StaffLane,
  TimeMarker,
} from '@/components/labor-planning/types';
import { fetchLaborPlanningPayload, findScheduledDate } from '@/lib/queries/laborPlanning';
import {
  breakOverlapMinutes,
  buildAssignmentLabel,
  calculateDurationMinutes,
  checkLaneConstraints,
  stretchForBreaks,
} from '@/src/lib/laborScheduling';
import { useWorkSchedule } from '@/hooks/use-work-schedule';
import type { ScheduleBreak } from '@/types/work-schedule';
import { logSchedulingEvent } from '@/src/lib/analytics/scheduling';
import { useLaborPlanningMutations } from '@/src/lib/mutations/laborPlanning';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, ChevronLeft, ChevronRight, Filter, Loader2, Minus, Plus, Search, ZoomIn } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { format, addDays, subDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const MIN_DURATION = 15;

/** Format minutes-from-midnight as 12-hour time (e.g. 810 → "1:30 PM") */
function formatMinutesAsTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const h12 = h24 % 12 || 12;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

// Zoom levels: pixels per hour
const ZOOM_LEVELS = [80, 120, 180, 240] as const;

// Left offset (px) so the time-axis header grid lines align with lane timelines.
// Accounts for: px-3 wrapper (12) + role-group border (1) + StaffLaneList p-2 (8)
// + lane-row border (1) + staff column w-[120px] (120) + border-r (1)
const LANE_TIMELINE_OFFSET = 143;
const ZOOM_STORAGE_KEY = 'labor-planning-zoom';
const PRINT_AFTER_ISSUE_STORAGE_KEY = 'labor-planning-print-after-issue';

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

function getStoredPrintAfterIssue(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem(PRINT_AFTER_ISSUE_STORAGE_KEY);
  if (stored == null) return true;
  return stored !== 'false';
}

function storePrintAfterIssue(enabled: boolean): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(PRINT_AFTER_ISSUE_STORAGE_KEY, String(enabled));
  }
}

interface LaborPlanningBoardProps {
  /** Extra pixels to subtract from viewport height for column sizing. Default 130. */
  heightOffset?: number;
}

export function LaborPlanningBoard({ heightOffset = 130 }: LaborPlanningBoardProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(
    () => searchParams?.get('date') || format(new Date(), 'yyyy-MM-dd')
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // "Now" indicator — only shown when the selected date is today
  const [nowMinutes, setNowMinutes] = useState<number | null>(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    if (selectedDate !== today) return null;
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    if (selectedDate !== today) {
      setNowMinutes(null);
      return;
    }
    const update = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [selectedDate]);

  const schedule = useWorkSchedule(selectedDate);
  const START_MINUTES = schedule.startMinutes;
  const END_MINUTES = schedule.endMinutes;
  const scheduleBreaks = schedule.breaks;
  const TIME_MARKERS = useMemo(
    () => buildTimeMarkers(START_MINUTES, END_MINUTES),
    [START_MINUTES, END_MINUTES],
  );
  const compactFromParams = searchParams?.get('compact') !== '0';
  const [compact, setCompact] = useState(compactFromParams);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set());
  const [zoomIndex, setZoomIndex] = useState(1);
  const [orderSearch, setOrderSearch] = useState('');
  const [showOnlyWithJobs, setShowOnlyWithJobs] = useState(true);
  const swimlaneScrollRef = useRef<HTMLDivElement>(null);
  const queryKey = ['labor-planning', selectedDate] as const;

  // Issue-and-schedule dialog state (for pool-sourced jobs)
  const [issueDialogState, setIssueDialogState] = useState<{
    job: PlanningJob;
    staffLane: StaffLane;
    snappedStart: number;
    wallEnd: number;
  } | null>(null);

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

  // Keyboard date navigation — left/right arrow keys (ignore when focus is in an input)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') {
        handleDateChange(format(subDays(new Date(selectedDate + 'T00:00:00'), 1), 'yyyy-MM-dd'));
      } else if (e.key === 'ArrowRight') {
        handleDateChange(format(addDays(new Date(selectedDate + 'T00:00:00'), 1), 'yyyy-MM-dd'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedDate, handleDateChange]);

  // Calculate timeline width based on zoom
  const totalHours = (END_MINUTES - START_MINUTES) / 60;
  const pixelsPerHour = ZOOM_LEVELS[zoomIndex];
  const timelineWidth = totalHours * pixelsPerHour;

  const { data, isLoading, isFetching, isPlaceholderData, isError } = useQuery({
    queryKey,
    queryFn: () => fetchLaborPlanningPayload({ date: selectedDate }),
    placeholderData: keepPreviousData,
  });

  const { assignMutation, updateMutation, unassignMutation } = useLaborPlanningMutations(queryKey);

  // Warn if work pool queries failed (pool orders may show stale BOL data)
  const poolErrorShown = useRef(false);
  useEffect(() => {
    if (data?.workPoolError && !poolErrorShown.current) {
      poolErrorShown.current = true;
      toast.warning('Work pool data failed to load — some orders may show outdated job data');
    } else if (!data?.workPoolError) {
      poolErrorShown.current = false;
    }
  }, [data?.workPoolError]);

  const jobLookup = useMemo(
    () => buildJobLookup(data?.orders ?? []),
    [data?.orders]
  );

  // Filter orders for the order tree panel
  const filteredOrders = useMemo(() => {
    let orders = data?.orders ?? [];

    if (showOnlyWithJobs) {
      orders = orders.filter((o) => o.jobs.length > 0);
    }

    if (orderSearch.trim()) {
      const q = orderSearch.toLowerCase().trim();
      orders = orders.filter(
        (o) =>
          (o.orderNumber ?? o.id).toLowerCase().includes(q) ||
          o.customer.toLowerCase().includes(q),
      );
    }

    return orders;
  }, [data?.orders, showOnlyWithJobs, orderSearch]);

  const staffLanes = useMemo(
    () => buildStaffLanes(data, jobLookup, START_MINUTES, END_MINUTES),
    [data, jobLookup, START_MINUTES, END_MINUTES]
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

  // Capacity for the week strip: (shift - breaks) * active staff
  const staffCapacityMinutes = useMemo(() => {
    const shiftMinutes = END_MINUTES - START_MINUTES;
    const totalBreakMinutes = scheduleBreaks.reduce(
      (sum, brk) => sum + (brk.endMinutes - brk.startMinutes),
      0,
    );
    const activeCount = (data?.staff ?? []).filter(
      (s) => s.availability?.isActive && s.availability?.isAvailableOnDate,
    ).length;
    return (shiftMinutes - totalBreakMinutes) * activeCount;
  }, [END_MINUTES, START_MINUTES, scheduleBreaks, data?.staff]);

  // Click a job in the order tree → scroll to its assignment bar (or jump to the scheduled date)
  const handleJobClick = useCallback(async (job: PlanningJob) => {
    const el = swimlaneScrollRef.current?.querySelector<HTMLElement>(
      `[data-job-key="${CSS.escape(job.id)}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      // Use outline instead of ring — ring uses box-shadow which is overridden by the bar's inline styles
      el.style.outline = '3px solid hsl(142, 71%, 45%)';
      el.style.outlineOffset = '2px';
      setTimeout(() => {
        el.style.outline = '';
        el.style.outlineOffset = '';
      }, 1500);
      return;
    }

    // Not on this day — check if it's scheduled on another date
    const scheduledDate = await findScheduledDate(job.id);
    if (scheduledDate && scheduledDate !== selectedDate) {
      const formatted = format(new Date(scheduledDate + 'T00:00:00'), 'EEE, MMM d');
      toast.info(`Jumping to ${formatted}`, { description: `${job.name} is scheduled there.` });
      handleDateChange(scheduledDate);
      return;
    }

    toast.info('Job not yet scheduled — drag it onto a staff lane first');
  }, [selectedDate, handleDateChange]);

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
    async ({
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
        const workMinutes = Math.max(
          calculateDurationMinutes(jobMeta.job, { minimumMinutes: MIN_DURATION }),
          MIN_DURATION
        );
        // startMinutes arrives pre-snapped (15-min grid) from the UI drag indicator,
        // so we only clamp — no re-snap that could shift to a different grid.
        const snappedStart = clampMinutes(clampedStart, START_MINUTES, END_MINUTES - MIN_DURATION);
        const stretched = stretchForBreaks(snappedStart, workMinutes, scheduleBreaks);
        const end = Math.min(stretched.wallEnd, END_MINUTES);

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
          const message = buildConstraintMessage(constraints, staff, laneAssignments, START_MINUTES, END_MINUTES);
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

        // Guard: prevent scheduling the same job on multiple dates
        const existingDate = await findScheduledDate(payload.job.id, selectedDate);
        if (existingDate) {
          const formatted = format(new Date(existingDate + 'T00:00:00'), 'EEE, MMM d');
          toast.error('Job already scheduled', {
            description: `This job is already on ${formatted}. Unassign it there first.`,
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

        // Pool-sourced jobs: open issue dialog instead of direct assign
        if (jobMeta.job.poolId != null) {
          setIssueDialogState({
            job: jobMeta.job,
            staffLane: staff,
            snappedStart,
            wallEnd: end,
          });
          return;
        }

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

      // startMinutes arrives pre-snapped (15-min grid) from the UI drag indicator,
      // so we only clamp — no re-snap that could shift to a different grid.
      let nextStart = assignment.startMinutes;
      let nextEnd = assignment.endMinutes;

      if (payload.type === 'assignment') {
        // Compute net work time by stripping any break overlap from the current position
        const currentBreakOverlap = breakOverlapMinutes(
          assignment.startMinutes ?? 0,
          assignment.endMinutes ?? 0,
          scheduleBreaks,
        );
        const netWork = Math.max(duration - currentBreakOverlap, MIN_DURATION);
        nextStart = clampMinutes(clampedStart, START_MINUTES, END_MINUTES - netWork);
        const stretched = stretchForBreaks(nextStart, netWork, scheduleBreaks);
        nextEnd = Math.min(stretched.wallEnd, END_MINUTES);
      } else if (payload.type === 'resize-start') {
        const maxStart = Math.min(assignment.endMinutes - 15, END_MINUTES - MIN_DURATION);
        nextStart = clampMinutes(clampedStart, START_MINUTES, maxStart);
        nextEnd = assignment.endMinutes;
      } else if (payload.type === 'resize-end') {
        const minEnd = (assignment.startMinutes ?? START_MINUTES) + 15;
        nextEnd = clampMinutes(clampedStart, minEnd, END_MINUTES);
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
        const message = buildConstraintMessage(constraints, staff, laneAssignments, START_MINUTES, END_MINUTES);
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
    [assignMutation, data, jobLookup, selectedDate, updateMutation, START_MINUTES, END_MINUTES, scheduleBreaks]
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

  if (isLoading && !data) {
    return (
      <div className="container mx-auto space-y-6 py-6">
        <div className="h-10 w-64 animate-pulse rounded-md bg-muted" />
        <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[360px_1fr]">
          <div className="h-full rounded-lg border bg-card shadow-xs" />
          <div className="h-full rounded-lg border bg-card shadow-xs" />
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
  // When embedded in the production hub, pass heightOffset=170 for the tab bar
  const columnHeight = `calc(100vh - ${heightOffset}px)`;

  return (
    <div className="w-full space-y-0 px-2 py-1">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-sm shadow-xs mb-2">
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
          {isPlaceholderData && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
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

      <WeekStrip
        selectedDate={selectedDate}
        onDateSelect={handleDateChange}
        staffCapacityMinutes={staffCapacityMinutes}
      />

      {noStaffAvailable && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTitle>No staff available to schedule</AlertTitle>
          <AlertDescription>
            Import or activate staff records for this date before scheduling jobs. Off-shift team members cannot accept drops.
          </AlertDescription>
        </Alert>
      )}

      <div className={cn("grid gap-2 lg:grid-cols-[200px_1fr] transition-opacity duration-150", isPlaceholderData && "opacity-50 pointer-events-none")}>
        <Card className="flex flex-col overflow-hidden" style={{ height: columnHeight, maxHeight: columnHeight }}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Orders</span>
            <span className="text-[11px] text-muted-foreground">
              {filteredOrders.length}{filteredOrders.length !== data.orders.length ? ` / ${data.orders.length}` : ''} open
            </span>
          </div>
          {/* Compact filter strip */}
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <div className="relative flex-1">
              <Search className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="Filter orders..."
                className="h-6 pl-6 text-[11px] rounded-sm"
              />
            </div>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showOnlyWithJobs ? 'default' : 'ghost'}
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => setShowOnlyWithJobs((v) => !v)}
                  >
                    <Filter className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {showOnlyWithJobs
                    ? 'Show all orders'
                    : 'Only orders with outstanding jobs'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex-1 overflow-auto px-1 py-1">
            <OrderTree orders={filteredOrders as PlanningOrder[]} onJobClick={handleJobClick} stalePoolOrderIds={data?.stalePoolOrderIds} />
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden" style={{ height: columnHeight, maxHeight: columnHeight }}>
          {/* Zoom controls bar */}
          <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ZoomIn className="h-3.5 w-3.5" />
              <span>Timeline zoom</span>
              {data && data.unscheduledJobs.length > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-px text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {data.unscheduledJobs.length} unscheduled
                </span>
              )}
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
                  staffColumnOffset={LANE_TIMELINE_OFFSET}
                  breaks={scheduleBreaks}
                  nowMinutes={nowMinutes}
                />
                <div className="space-y-3 px-3 pb-3 pt-1">
                  {roleGroups
                    .filter((group) => filteredRoles.includes(group.key))
                    .map((group) => {
                      const collapsed = collapsedRoles.has(group.key);
                      return (
                        <div key={group.key} className="rounded-lg border bg-card shadow-xs">
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
                              breaks={scheduleBreaks}
                              nowMinutes={nowMinutes}
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

      {/* Issue-and-schedule dialog for pool-sourced jobs */}
      {issueDialogState && (
        <IssueAndScheduleDialog
          job={issueDialogState.job}
          staffLane={issueDialogState.staffLane}
          snappedStart={issueDialogState.snappedStart}
          selectedDate={selectedDate}
          scheduleBreaks={scheduleBreaks}
          startMinutes={START_MINUTES}
          endMinutes={END_MINUTES}
          onClose={() => setIssueDialogState(null)}
          onIssued={(cardId, issuedQty, jobKey, computedEnd) => {
            const assignJob: PlanningJob = {
              ...issueDialogState.job,
              id: jobKey,
              quantity: issuedQty,
            };
            assignMutation.mutate({
              job: assignJob,
              staffId: Number(issueDialogState.staffLane.id),
              startMinutes: issueDialogState.snappedStart,
              endMinutes: computedEnd,
              assignmentDate: selectedDate,
            });
            setIssueDialogState(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Issue & Schedule Dialog (pool-sourced jobs)                        */
/* ------------------------------------------------------------------ */

function IssueAndScheduleDialog({
  job,
  staffLane,
  snappedStart,
  selectedDate,
  scheduleBreaks,
  startMinutes: shiftStart,
  endMinutes: shiftEnd,
  onClose,
  onIssued,
}: {
  job: PlanningJob;
  staffLane: StaffLane;
  snappedStart: number;
  selectedDate: string;
  scheduleBreaks: ScheduleBreak[];
  startMinutes: number;
  endMinutes: number;
  onClose: () => void;
  onIssued: (cardId: number, qty: number, jobKey: string, computedEnd: number) => void;
}) {
  const remaining = job.remainingQty ?? job.quantity ?? 1;
  const [qty, setQty] = useState(1);
  const [overrideReason, setOverrideReason] = useState('');
  const [printAfterIssue, setPrintAfterIssue] = useState(() => getStoredPrintAfterIssue());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    storePrintAfterIssue(printAfterIssue);
  }, [printAfterIssue]);

  const isOverIssue = qty > remaining;
  const timePerUnit = job.timePerUnit ?? job.durationMinutes ?? null;
  const estMinutes = timePerUnit != null ? timePerUnit * qty : null;
  const estHours = estMinutes != null ? Math.floor(estMinutes / 60) : null;
  const estMins = estMinutes != null ? Math.round(estMinutes % 60) : null;

  // Recompute end time based on current qty (stretch for breaks)
  const workMinutes = Math.max(estMinutes ?? MIN_DURATION, MIN_DURATION);
  const stretched = stretchForBreaks(snappedStart, workMinutes, scheduleBreaks);
  const computedEnd = Math.min(stretched.wallEnd, shiftEnd);

  const canSubmit =
    qty >= 1 && (!isOverIssue || overrideReason.trim().length > 0) && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit || job.poolId == null) return;

    // Re-check lane constraints with the qty-based duration
    const laneAssignments = staffLane.assignments ?? [];
    const constraints = checkLaneConstraints(
      laneAssignments.map((a) => ({
        id: a.id,
        startMinutes: a.startMinutes,
        endMinutes: a.endMinutes,
        label: a.label,
      })),
      { id: `pool-${job.poolId}`, startMinutes: snappedStart, endMinutes: computedEnd },
      {
        window: { startMinutes: shiftStart, endMinutes: shiftEnd },
        availability: staffLane.availability,
      },
    );

    if (constraints.hasConflict) {
      toast.error('Cannot fit job in this slot', {
        description: constraints.issues[0]?.message ?? 'Lane conflict with adjusted duration.',
      });
      return;
    }

    const printWindow = printAfterIssue ? window.open('about:blank', '_blank') : null;
    setIsSubmitting(true);

    try {
      const { data: cardId, error } = await supabase.rpc('issue_job_card_from_pool', {
        p_pool_id: job.poolId,
        p_quantity: qty,
        p_staff_id: parseInt(staffLane.id),
        p_allow_overissue: isOverIssue,
        p_override_reason: isOverIssue ? overrideReason.trim() : null,
      });

      if (error) throw error;

      const jobKey = `pool-${job.poolId}:card-${cardId}`;
      const reopenPrint = () => window.open(`/staff/job-cards/${cardId}?print=1`, '_blank');
      toast.success('Job card issued & scheduled', {
        description: printAfterIssue
          ? `Card #${cardId} — ${qty} units of ${job.name} assigned to ${staffLane.name}. Print opened.`
          : `Card #${cardId} — ${qty} units of ${job.name} assigned to ${staffLane.name}.`,
        action: {
          label: printAfterIssue ? 'Reopen print' : 'Print now',
          onClick: reopenPrint,
        },
      });
      if (printAfterIssue) {
        if (printWindow) {
          printWindow.location.href = `/staff/job-cards/${cardId}?print=1`;
        } else {
          reopenPrint();
        }
      }
      onIssued(cardId as number, qty, jobKey, computedEnd);
    } catch (err: any) {
      printWindow?.close();
      toast.error('Failed to issue job card', { description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Issue & Schedule</DialogTitle>
          <DialogDescription>
            Issue a job card from the work pool and schedule it on {staffLane.name}&apos;s lane.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-muted-foreground">Job</div>
            <div className="font-medium">{job.name}</div>
            {job.productName && (
              <>
                <div className="text-muted-foreground">Product</div>
                <div className="font-medium">{job.productName}</div>
              </>
            )}
            <div className="text-muted-foreground">Staff</div>
            <div className="font-medium">{staffLane.name}</div>
            <div className="text-muted-foreground">Remaining in pool</div>
            <div className="font-medium">{remaining}</div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-qty">Quantity to issue</Label>
            <Input
              id="issue-qty"
              type="number"
              min={1}
              value={qty || ''}
              placeholder="0"
              onChange={(e) => setQty(parseInt(e.target.value) || 0)}
              onBlur={() => { if (!qty || qty < 1) setQty(1); }}
            />
          </div>

          <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
            <Checkbox
              id="issue-print-after"
              checked={printAfterIssue}
              onCheckedChange={(checked) => setPrintAfterIssue(Boolean(checked))}
              disabled={isSubmitting}
            />
            <div className="space-y-0.5">
              <Label htmlFor="issue-print-after" className="text-sm font-medium">
                Print job card after issue
              </Label>
              <p className="text-xs text-muted-foreground">
                Opens a print-ready job card in a new tab as soon as this card is issued.
              </p>
            </div>
          </div>

          {/* Schedule time preview — updates live as quantity changes */}
          <div className="rounded-md border bg-muted/50 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Start</span>
              <span className="font-medium tabular-nums">{formatMinutesAsTime(snappedStart)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Finish</span>
              <span className="font-medium tabular-nums">{formatMinutesAsTime(computedEnd)}</span>
            </div>
            <div className="flex items-center justify-between text-sm border-t pt-1.5">
              <span className="text-muted-foreground">Block</span>
              <span className="font-medium tabular-nums">{computedEnd - snappedStart} min</span>
            </div>
            {estMinutes != null && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Actual work</span>
                  <span className="font-medium tabular-nums">
                    {estHours != null && estHours > 0 ? `${estHours}h ` : ''}{estMins} min
                    {timePerUnit != null && (
                      <span className="ml-1 text-muted-foreground font-normal">({timePerUnit} min × {qty})</span>
                    )}
                  </span>
                </div>
                {estMinutes < MIN_DURATION && (
                  <p className="text-[11px] text-muted-foreground/70">
                    Scheduled as {MIN_DURATION} min — minimum block size for the timeline grid.
                  </p>
                )}
              </>
            )}
          </div>

          {isOverIssue && (
            <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Over-issuance: {qty - remaining} units beyond remaining
              </div>
              <p className="text-xs text-muted-foreground">
                This will create an acknowledged production exception. A reason is required.
              </p>
              <Textarea
                placeholder="Reason for over-issuance..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={2}
              />
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Issue & Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  lookup: Map<string, { job: PlanningJob; order: PlanningOrder | null }>,
  startMinutes: number,
  endMinutes: number,
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
      const start = assignment.startMinutes ?? startMinutes;
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
        quantity: job?.quantity ?? null,
        productId: job?.productId ?? null,
        // Time tracking fields
        jobStatus: assignment.jobStatus ?? job?.jobStatus ?? undefined,
        issuedAt: assignment.issuedAt,
        startedAt: assignment.startedAt,
        assignmentDate: assignment.assignmentDate,
        customerName: order?.customer ?? null,
        dueDate: order?.dueDate ?? null,
      };
    });

    return {
      id: String(staff.id),
      name: staff.name,
      role: staff.role ?? 'Team member',
      capacityHours: staff.capacityHours ?? 0,
      availability: staff.availability,
      assignments,
      availableFrom: formatRange(startMinutes),
      availableTo: formatRange(endMinutes),
    };
  });
}

function clampMinutes(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
  assignments: StaffAssignment[],
  shiftStart?: number,
  shiftEnd?: number,
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
      description: `Place this job within ${formatRange(shiftStart ?? 420)} – ${formatRange(shiftEnd ?? 1140)} for ${staff.name}.`,
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

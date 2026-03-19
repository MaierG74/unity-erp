import { executionStatusMeta } from '@/components/production/execution-status';

export interface FactorySection {
  section_id: number;
  name: string;
  display_order: number;
  category_id: number | null;
  color: string;
  grid_span: number;
  is_active: boolean;
}

export interface FloorStaffJob {
  assignment_id: number;
  job_instance_id: string;
  order_id: number | null;
  order_number: string | null;
  order_detail_id: number | null;
  bol_id: number | null;
  job_id: number | null;
  job_name: string | null;
  category_id: number | null;
  category_name: string | null;
  section_id: number | null;
  section_name: string | null;
  section_color: string | null;
  section_order: number | null;
  section_grid_span: number | null;
  staff_id: number;
  staff_name: string;
  staff_role: string | null;
  assignment_date: string | null;
  start_minutes: number | null;
  end_minutes: number | null;
  job_status: 'issued' | 'in_progress' | 'on_hold';
  pay_type: 'hourly' | 'piece' | null;
  issued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  quantity: number | null;
  unit_minutes: number | null;
  estimated_minutes: number | null;
  minutes_elapsed: number;
  auto_progress: number;
  progress_override: number | null;
  total_paused_minutes: number;
  is_paused: boolean;
  pause_reason: string | null;
  job_card_id: number | null;
  product_name: string | null;
  product_code: string | null;
}

export interface SectionWithStaff {
  section: FactorySection;
  staffJobs: FloorStaffJob[];
}

export type ProgressStatus = 'on-track' | 'slightly-behind' | 'behind';
export type ScheduleProgressState = 'upcoming' | 'active' | 'elapsed';

interface FloorProgressSnapshot {
  progress: number;
  autoProgress: number;
  minutesElapsed: number;
  source: 'actual' | 'scheduled';
  scheduleState: ScheduleProgressState | null;
}

export const statusColors: Record<ProgressStatus, string> = {
  'on-track': 'bg-emerald-500',
  'slightly-behind': 'bg-amber-500',
  'behind': 'bg-red-500',
};

export const statusTrackColors: Record<ProgressStatus, string> = {
  'on-track': 'bg-emerald-500/20',
  'slightly-behind': 'bg-amber-500/20',
  'behind': 'bg-red-500/20',
};

export const statusDotClass: Record<FloorStaffJob['job_status'], string> = {
  in_progress: executionStatusMeta.in_progress.dotClassName,
  issued: executionStatusMeta.issued.dotClassName,
  on_hold: executionStatusMeta.on_hold.dotClassName,
};

export const statusBadgeConfig: Record<ProgressStatus, { label: string; className: string }> = {
  'on-track': { label: 'On Track', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  'slightly-behind': { label: 'Slightly Behind', className: 'bg-amber-600 hover:bg-amber-600 text-white' },
  'behind': { label: 'Behind', className: 'bg-red-600 hover:bg-red-600 text-white' },
};

export const PAUSE_REASONS = [
  { value: 'waiting_materials', label: 'Waiting for Materials' },
  { value: 'machine_breakdown', label: 'Machine Breakdown' },
  { value: 'break', label: 'Break' },
  { value: 'quality_issue', label: 'Quality Issue' },
  { value: 'other', label: 'Other' },
] as const;

export type PauseReason = typeof PAUSE_REASONS[number]['value'];

export interface EarningsSplitItem {
  item_id: number;
  original_amount: number;
}

function getSastNowParts(now: Date = new Date()): { dateKey: string; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minutesOfDay: Number(values.hour ?? 0) * 60 + Number(values.minute ?? 0),
  };
}

function getIssuedScheduleProgress(job: FloorStaffJob, now: Date = new Date()): FloorProgressSnapshot | null {
  if (
    job.job_status !== 'issued' ||
    !job.assignment_date ||
    job.start_minutes == null ||
    job.end_minutes == null
  ) {
    return null;
  }

  const scheduledDuration = Math.max(job.end_minutes - job.start_minutes, 0);
  if (scheduledDuration <= 0) return null;

  const { dateKey, minutesOfDay } = getSastNowParts(now);

  let fraction = 0;
  let scheduleState: ScheduleProgressState = 'upcoming';

  if (job.assignment_date < dateKey) {
    fraction = 1;
    scheduleState = 'elapsed';
  } else if (job.assignment_date === dateKey) {
    if (minutesOfDay <= job.start_minutes) {
      fraction = 0;
      scheduleState = 'upcoming';
    } else if (minutesOfDay >= job.end_minutes) {
      fraction = 1;
      scheduleState = 'elapsed';
    } else {
      fraction = (minutesOfDay - job.start_minutes) / scheduledDuration;
      scheduleState = 'active';
    }
  }

  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const baselineMinutes =
    job.estimated_minutes != null && job.estimated_minutes > 0
      ? job.estimated_minutes
      : scheduledDuration;
  const autoProgress = Math.round(clampedFraction * 100);
  const minutesElapsed = Math.round(baselineMinutes * clampedFraction);

  return {
    progress: job.progress_override ?? autoProgress,
    autoProgress,
    minutesElapsed,
    source: 'scheduled',
    scheduleState,
  };
}

export function getFloorProgressSnapshot(job: FloorStaffJob, now: Date = new Date()): FloorProgressSnapshot {
  const scheduledSnapshot = getIssuedScheduleProgress(job, now);
  if (scheduledSnapshot) return scheduledSnapshot;

  return {
    progress: job.progress_override ?? job.auto_progress,
    autoProgress: job.auto_progress,
    minutesElapsed: job.minutes_elapsed,
    source: 'actual',
    scheduleState: null,
  };
}

export function getDisplayProgress(job: FloorStaffJob, now: Date = new Date()): number {
  return getFloorProgressSnapshot(job, now).progress;
}

export function getEffectiveMinutesElapsed(job: FloorStaffJob, now: Date = new Date()): number {
  return getFloorProgressSnapshot(job, now).minutesElapsed;
}

export function getScheduleProgressState(
  job: FloorStaffJob,
  now: Date = new Date(),
): ScheduleProgressState | null {
  return getFloorProgressSnapshot(job, now).scheduleState;
}

export function minutesToClock(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return '--:--';
  const wholeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(wholeMinutes / 60)
    .toString()
    .padStart(2, '0');
  const remainder = Math.floor(wholeMinutes % 60)
    .toString()
    .padStart(2, '0');
  return `${hours}:${remainder}`;
}

export function getProgressStatus(job: FloorStaffJob, now: Date = new Date()): ProgressStatus {
  const snapshot = getFloorProgressSnapshot(job, now);
  const display = snapshot.progress;
  const auto = snapshot.autoProgress;
  // If override is set and it's ahead, they're on track
  if (job.progress_override !== null) {
    if (job.progress_override >= auto - 10) return 'on-track';
    if (job.progress_override >= auto - 30) return 'slightly-behind';
    return 'behind';
  }
  // Auto progress: if elapsed > estimated, they're behind
  if (auto >= 100 && display < 100) return 'behind';
  return 'on-track';
}

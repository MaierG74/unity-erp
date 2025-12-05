export type TimeUnit = 'hours' | 'minutes' | 'seconds';
export type PayType = 'hourly' | 'piece';

export interface JobEffortInput {
  durationMinutes?: number | null;
  timeRequired?: number | null;
  timeUnit?: TimeUnit | string | null;
  quantity?: number | null;
  payType?: PayType | string | null;
  minutesPerPieceEstimate?: number | null;
}

export interface DurationOptions {
  defaultMinutesPerPiece?: number;
  minimumMinutes?: number;
}

export interface SnapOptions {
  increments?: number[];
  defaultIncrement?: number;
}

export interface UnscheduledStateOptions extends DurationOptions {
  startMinutes?: number;
  snap?: SnapOptions;
}

export interface UnscheduledBarState {
  durationMinutes: number;
  snapIncrement: number;
  startMinutes: number;
  endMinutes: number;
  status: 'unscheduled';
}

export interface AssignmentBlock {
  id: string;
  startMinutes: number;
  endMinutes: number;
  laneId?: string;
  label?: string;
  categoryId?: number | string | null;
  categoryName?: string | null;
}

export interface LaneWindow {
  startMinutes: number;
  endMinutes: number;
}

export interface LaneAvailability {
  isActive?: boolean;
  isCurrent?: boolean;
  isAvailableOnDate?: boolean;
}

export interface LaneConstraints {
  window?: LaneWindow;
  capacityMinutes?: number;
  availability?: LaneAvailability;
}

export type ConstraintIssueType = 'overlap' | 'window' | 'capacity' | 'availability';

export interface ConstraintIssue {
  type: ConstraintIssueType;
  message: string;
}

export interface ConstraintResult {
  hasConflict: boolean;
  status: 'ok' | ConstraintIssueType;
  issues: ConstraintIssue[];
  overlaps: AssignmentBlock[];
  overrunMinutes?: number;
}

export const LABOR_CATEGORY_COLORS = ['#0ea5e9', '#22c55e', '#a855f7', '#f97316', '#e11d48', '#14b8a6'] as const;

export function calculateDurationMinutes(effort: JobEffortInput, options: DurationOptions = {}): number {
  const quantity = normalizeNumber(effort.quantity) ?? 1;
  const baseMinutes = resolveBaseMinutes(effort);
  const payType = normalizePayType(effort.payType);
  const minimum = options.minimumMinutes ?? 0;

  if (payType === 'piece') {
    const perPiece = baseMinutes ?? effort.minutesPerPieceEstimate ?? options.defaultMinutesPerPiece ?? 5;
    return Math.max(perPiece * quantity, minimum);
  }

  if (baseMinutes != null) {
    return Math.max(baseMinutes * quantity, minimum);
  }

  return minimum || 0;
}

export function chooseSnapIncrement(durationMinutes: number, options: SnapOptions = {}): number {
  const increments = (options.increments ?? [5, 10, 15, 30, 60]).filter((value) => value > 0).sort((a, b) => a - b);
  const fallback = options.defaultIncrement ?? 15;
  if (!Number.isFinite(durationMinutes) || increments.length === 0) return fallback;

  const target = durationMinutes / 3;
  for (const increment of increments) {
    if (increment >= target) return increment;
  }

  return increments[increments.length - 1] ?? fallback;
}

export function buildUnscheduledBarState(effort: JobEffortInput, options: UnscheduledStateOptions = {}): UnscheduledBarState {
  const durationMinutes = calculateDurationMinutes(effort, options);
  const snapIncrement = chooseSnapIncrement(durationMinutes, options.snap);
  const start = options.startMinutes ?? 8 * 60;

  return {
    durationMinutes,
    snapIncrement,
    startMinutes: start,
    endMinutes: start + durationMinutes,
    status: 'unscheduled',
  };
}

export function checkLaneConstraints(
  existing: AssignmentBlock[],
  candidate: AssignmentBlock,
  constraints: LaneConstraints = {}
): ConstraintResult {
  const overlaps = existing.filter((block) => rangesOverlap(block.startMinutes, block.endMinutes, candidate.startMinutes, candidate.endMinutes));
  const issues: ConstraintIssue[] = [];

  if (constraints.availability && !isLaneAvailable(constraints.availability)) {
    issues.push({ type: 'availability', message: 'Staff member is not available for scheduling on this date.' });
  }

  if (constraints.window && !isWithinWindow(candidate, constraints.window)) {
    issues.push({ type: 'window', message: 'Assignment extends outside the allowed shift window.' });
  }

  if (overlaps.length > 0) {
    issues.push({ type: 'overlap', message: 'Assignment overlaps with an existing booking in this lane.' });
  }

  let overrunMinutes: number | undefined;
  if (constraints.capacityMinutes != null) {
    const usedMinutes = existing.reduce((total, block) => total + Math.max(0, block.endMinutes - block.startMinutes), 0);
    const projected = usedMinutes + Math.max(0, candidate.endMinutes - candidate.startMinutes);
    if (projected > constraints.capacityMinutes) {
      overrunMinutes = projected - constraints.capacityMinutes;
      issues.push({
        type: 'capacity',
        message: `Planned time exceeds lane capacity by ${overrunMinutes} minute${overrunMinutes === 1 ? '' : 's'}.`,
      });
    }
  }

  const status = deriveStatus(issues);
  return {
    hasConflict: status !== 'ok',
    status,
    issues,
    overlaps,
    overrunMinutes,
  };
}

export function getCategoryColor(categoryIdOrName: number | string | null | undefined): string | null {
  if (categoryIdOrName == null) return null;
  const palette = [...LABOR_CATEGORY_COLORS];
  const key = typeof categoryIdOrName === 'number' ? categoryIdOrName : hashString(String(categoryIdOrName));
  return palette[Math.abs(key) % palette.length];
}

export function buildAssignmentLabel(input: {
  orderNumber?: string | null;
  jobName?: string | null;
  productName?: string | null;
  categoryName?: string | null;
  quantity?: number | null;
  payType?: PayType | string | null;
}): string {
  const parts: string[] = [];
  if (input.orderNumber) parts.push(input.orderNumber);
  if (input.jobName) parts.push(input.jobName);

  const context: string[] = [];
  if (input.productName) context.push(input.productName);
  else if (input.categoryName) context.push(input.categoryName);

  const qty = normalizeNumber(input.quantity);
  if (qty && qty > 1) {
    const suffix = normalizePayType(input.payType) === 'piece' ? `${qty} pcs` : `x${qty}`;
    context.push(suffix);
  }

  if (context.length > 0) parts.push(context.join(' · '));
  return parts.join(' • ');
}

export function clockToMinutes(value: string): number {
  const [hoursRaw, minutesRaw] = value.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

export function minutesToClock(value: number): string {
  if (!Number.isFinite(value)) return '00:00';
  const hours = Math.floor(value / 60);
  const minutes = Math.max(0, Math.round(value - hours * 60));
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function normalizeNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizePayType(value: PayType | string | null | undefined): PayType | null {
  if (!value) return null;
  const normalized = String(value).toLowerCase();
  if (normalized === 'piece') return 'piece';
  if (normalized === 'hourly') return 'hourly';
  return null;
}

function resolveBaseMinutes(effort: JobEffortInput): number | null {
  if (effort.durationMinutes != null && Number.isFinite(effort.durationMinutes)) return Number(effort.durationMinutes);
  if (effort.timeRequired == null) return null;

  const numeric = Number(effort.timeRequired);
  if (!Number.isFinite(numeric)) return null;

  const unit = (effort.timeUnit ?? 'hours').toString().toLowerCase() as TimeUnit;
  if (unit === 'minutes') return numeric;
  if (unit === 'seconds') return numeric / 60;
  return numeric * 60;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function isWithinWindow(block: AssignmentBlock, window: LaneWindow): boolean {
  return block.startMinutes >= window.startMinutes && block.endMinutes <= window.endMinutes;
}

function isLaneAvailable(availability: LaneAvailability): boolean {
  if (availability.isActive === false) return false;
  if (availability.isCurrent === false) return false;
  if (availability.isAvailableOnDate === false) return false;
  return true;
}

function deriveStatus(issues: ConstraintIssue[]): ConstraintResult['status'] {
  if (issues.length === 0) return 'ok';
  const priority: ConstraintIssueType[] = ['availability', 'window', 'overlap', 'capacity'];
  const sorted = [...issues].sort(
    (a, b) => priority.indexOf(a.type) - priority.indexOf(b.type)
  );
  return sorted[0]?.type ?? 'ok';
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

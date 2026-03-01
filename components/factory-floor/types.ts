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
  'in_progress': 'bg-emerald-400',
  'issued': 'bg-blue-400',
  'on_hold': 'bg-amber-400',
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

export function getDisplayProgress(job: FloorStaffJob): number {
  return job.progress_override ?? job.auto_progress;
}

export function getProgressStatus(job: FloorStaffJob): ProgressStatus {
  const display = getDisplayProgress(job);
  const auto = job.auto_progress;
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

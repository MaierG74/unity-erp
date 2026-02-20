export interface ScheduleBreak {
  label: string;
  startMinutes: number;
  endMinutes: number;
}

export interface WorkScheduleRow {
  schedule_id: number;
  org_id: string;
  day_group: string;
  start_minutes: number;
  end_minutes: number;
  breaks: ScheduleBreak[];
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkScheduleForDate {
  startMinutes: number;
  endMinutes: number;
  breaks: ScheduleBreak[];
  dayGroup: string;
}

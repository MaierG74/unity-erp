// /lib/types/attendance.ts

// Represents a single clock-in, clock-out, or break event
export interface ClockEvent {
  id: string;
  staff_id: number;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  event_time: string; // ISO 8601 format
  verification_method: 'facial' | 'manual' | 'system';
  break_type?: 'lunch' | 'tea' | 'other' | 'work' | null;
  confidence_score?: number | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

// Represents a calculated segment of time (either work or break)
// This is derived from pairs of ClockEvents
export interface TimeSegment {
  id: string;
  staff_id: number;
  date_worked: string;
  start_time: string; // ISO 8601 format
  end_time: string; // ISO 8601 format
  segment_type: 'work' | 'break';
  duration_minutes: number;
  break_type?: 'lunch' | 'tea' | 'other' | null;
}

// Represents the daily summary calculated from all segments
export interface DailySummary {
  id: string;
  staff_id: number;
  date_worked: string;
  total_work_minutes: number;
  total_break_minutes: number;
  first_clock_in: string | null; // ISO 8601 format
  last_clock_out: string | null; // ISO 8601 format
  is_complete: boolean;
  lunch_break_minutes: number;
  other_breaks_minutes: number | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

// Represents a basic staff member record
export interface Staff {
  staff_id: number;
  first_name: string;
  last_name: string;
  job_description: string | null;
  is_active: boolean;
  current_staff: boolean;
}

// Represents a public holiday
export interface PublicHoliday {
  holiday_id: number;
  holiday_date: string;
  holiday_name: string;
}

// Represents the final record used to render the attendance grid UI
export type AttendanceRecord = {
  staff_id: number;
  first_name: string;
  last_name: string;
  job_description: string | null;
  is_active: boolean;
  current_staff: boolean;
  present: boolean;
  staff_name: string;
  isEditing: boolean;
  hours_id?: string; // from DailySummary id
  date_worked: string;
  hours_worked: number;
  start_time: string | null;
  end_time: string | null;
  break_duration: number;
  lunch_break_taken: boolean;
  morning_break_taken: boolean;
  afternoon_break_taken: boolean;
  is_holiday: boolean;
  overtime_hours: number;
  overtime_rate: number;
  notes: string | null;
};

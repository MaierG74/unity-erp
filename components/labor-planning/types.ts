export type PlanningJobStatus = 'ready' | 'in-progress' | 'blocked';
export type PlanningJobScheduleStatus = 'scheduled' | 'unscheduled';

export interface PlanningJob {
  id: string;
  name: string;
  status: PlanningJobStatus;
  durationHours: number;
  owner?: string;
  start?: string;
  end?: string;
  durationMinutes?: number | null;
  quantity?: number;
  payType?: 'hourly' | 'piece';
  categoryName?: string | null;
  categoryColor?: string | null;
  jobId?: number | null;
  bolId?: number | null;
  orderId?: number | null;
  orderDetailId?: number | null;
  productId?: number | null;
  productName?: string | null;
  timeUnit?: 'hours' | 'minutes' | 'seconds';
  rateId?: number | null;
  hourlyRateId?: number | null;
  pieceRateId?: number | null;
  scheduleStatus?: PlanningJobScheduleStatus;
}

export interface PlanningOrder {
  id: string;
  customer: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string | null;
  orderId?: number;
  orderNumber?: string;
  statusName?: string | null;
  jobs: PlanningJob[];
}

export interface StaffAssignment {
  id: string;
  jobKey: string;
  orderId?: number | string | null;
  orderNumber?: string | null;
  jobId?: number | null;
  jobName?: string | null;
  productName?: string | null;
  label: string;
  startMinutes: number;
  endMinutes: number;
  color: string;
  status: 'scheduled' | 'unscheduled' | 'tentative' | 'overbooked';
  payType?: 'hourly' | 'piece';
  hourlyRateId?: number | null;
  pieceRateId?: number | null;
  rateId?: number | null;
  bolId?: number | null;
  showHandles?: boolean;
  // Time tracking fields
  jobStatus?: 'scheduled' | 'issued' | 'in_progress' | 'completed' | 'on_hold';
  issuedAt?: string | null;
  startedAt?: string | null;
  assignmentDate?: string | null;
}

export interface StaffOpenSlot {
  start: string;
  end: string;
  label?: string;
}

export interface StaffLane {
  id: string;
  name: string;
  role: string;
  capacityHours: number;
  assignments: StaffAssignment[];
  availableFrom?: string;
  availableTo?: string;
  openSlots?: StaffOpenSlot[];
  availability?: {
    isActive: boolean;
    isCurrent: boolean;
    hasSummaryOnDate: boolean;
    isAvailableOnDate: boolean;
  };
}

export interface TimeMarker {
  minutes: number;
  label: string;
  isMajor?: boolean;
}

export type JobStatus = 'scheduled' | 'issued' | 'in_progress' | 'completed' | 'on_hold';

export interface LaborPlanAssignment {
  assignmentId: string;
  jobKey: string;
  orderId: number | null;
  orderDetailId: number | null;
  bolId: number | null;
  jobId: number | null;
  staffId: number | null;
  startMinutes: number | null;
  endMinutes: number | null;
  status: PlanningJobScheduleStatus;
  payType: 'hourly' | 'piece';
  rateId: number | null;
  hourlyRateId: number | null;
  pieceRateId: number | null;
  assignmentDate: string | null;
  // Time tracking fields
  jobStatus: JobStatus | null;
  issuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export type LaborDragPayload =
  | { type: 'job'; job: PlanningJob; order?: Partial<PlanningOrder> }
  | { type: 'assignment'; assignment: StaffAssignment }
  | { type: 'resize-start' | 'resize-end'; assignment: StaffAssignment };

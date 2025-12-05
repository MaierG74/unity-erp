import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LaborPlanAssignment, PlanningJob } from '@/components/labor-planning/types';
import type { LaborPlanningPayload } from '@/lib/queries/laborPlanning';
import { logSchedulingEvent } from '@/src/lib/analytics/scheduling';
import { supabase } from '@/lib/supabase';

const TABLE_NAME = 'labor_plan_assignments';

export interface AssignJobInput {
  job: PlanningJob;
  staffId: number;
  startMinutes: number;
  endMinutes: number;
  assignmentDate: string;
}

export interface UpdateJobScheduleInput {
  assignmentId?: string;
  jobKey: string;
  staffId?: number | null;
  startMinutes?: number | null;
  endMinutes?: number | null;
  assignmentDate: string;
  status?: 'scheduled' | 'unscheduled';
  payType?: 'hourly' | 'piece';
  rateId?: number | null;
  hourlyRateId?: number | null;
  pieceRateId?: number | null;
}

export interface UnassignJobInput {
  assignmentId?: string;
  jobKey: string;
  assignmentDate: string;
}

type LaborPlanningCache = LaborPlanningPayload;

export function useLaborPlanningMutations(queryKey: QueryKey) {
  const queryClient = useQueryClient();

  const unassignMutation = useMutation({
    mutationFn: (input: UnassignJobInput) => unassignJob(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<LaborPlanningCache>(queryKey);

      queryClient.setQueryData<LaborPlanningCache>(queryKey, (current) => {
        if (!current) return current;
        const job = findJob(current, input.jobKey);
        return {
          ...current,
          assignments: current.assignments.filter((assignment) => assignment.jobKey !== input.jobKey),
          orders: markJobSchedule(current.orders, input.jobKey, 'unscheduled'),
          unscheduledJobs: addJobIfMissing(current.unscheduledJobs, job),
        };
      });

      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error('Failed to unassign job', { description: (error as Error).message });
      logSchedulingEvent({
        type: 'mutation_failed',
        jobKey: variables.jobKey,
        date: variables.assignmentDate,
        reason: 'unassign_failed',
        detail: (error as Error).message,
      });
    },
    onSuccess: (result) => {
      toast.message('Job returned to unscheduled', {
        description: `You can drag ${result.jobKey} back onto a lane when ready.`,
      });
      logSchedulingEvent({
        type: 'unassigned',
        jobKey: result.jobKey,
        date: result.assignmentDate ?? undefined,
        staffId: result.staffId,
        startMinutes: result.startMinutes,
        endMinutes: result.endMinutes,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const assignMutation = useMutation({
    mutationFn: (input: AssignJobInput) => assignJobToStaff(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<LaborPlanningCache>(queryKey);
      const optimisticAssignment = buildOptimisticAssignment(input);

      queryClient.setQueryData<LaborPlanningCache>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          assignments: [
            ...current.assignments.filter((assignment) => assignment.jobKey !== optimisticAssignment.jobKey),
            optimisticAssignment,
          ],
          orders: markJobSchedule(current.orders, optimisticAssignment.jobKey, 'scheduled'),
          unscheduledJobs: current.unscheduledJobs.filter((job) => job.id !== optimisticAssignment.jobKey),
        };
      });

      return { previous, optimisticId: optimisticAssignment.assignmentId };
    },
    onError: (error, variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error('Could not schedule job', { description: (error as Error).message });
      logSchedulingEvent({
        type: 'mutation_failed',
        jobKey: variables.job.id,
        jobLabel: variables.job.name,
        staffId: variables.staffId,
        date: variables.assignmentDate,
        reason: 'assign_failed',
        detail: (error as Error).message,
      });
    },
    onSuccess: (assignment, variables) => {
      queryClient.setQueryData<LaborPlanningCache>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          assignments: [
            ...current.assignments.filter((a) => a.jobKey !== assignment.jobKey),
            assignment,
          ],
          orders: markJobSchedule(current.orders, assignment.jobKey, 'scheduled'),
          unscheduledJobs: current.unscheduledJobs.filter((job) => job.id !== assignment.jobKey),
        };
      });

      toast.success('Job scheduled', {
        description: `${variables.job.name} assigned to staff ${variables.staffId}`,
        action: {
          label: 'Undo',
          onClick: () =>
            unassignMutation.mutate({
              jobKey: variables.job.id,
              assignmentDate: variables.assignmentDate,
              assignmentId: assignment.assignmentId,
            }),
        },
      });
      logSchedulingEvent({
        type: 'assigned',
        jobKey: assignment.jobKey,
        jobLabel: variables.job.name,
        staffId: variables.staffId,
        date: variables.assignmentDate,
        startMinutes: assignment.startMinutes,
        endMinutes: assignment.endMinutes,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateJobScheduleInput) => updateJobSchedule(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<LaborPlanningCache>(queryKey);

      queryClient.setQueryData<LaborPlanningCache>(queryKey, (current) => {
        if (!current) return current;
        const existing = current.assignments.find((a) => a.jobKey === input.jobKey);
        const updated: LaborPlanAssignment = {
          ...(existing ?? {
            assignmentId: input.assignmentId ?? `optimistic-${Date.now()}`,
            jobKey: input.jobKey,
            orderId: null,
            orderDetailId: null,
            bolId: null,
            jobId: null,
            staffId: input.staffId ?? null,
            startMinutes: input.startMinutes ?? null,
            endMinutes: input.endMinutes ?? null,
            status: input.status ?? 'scheduled',
            payType: (input.payType ?? 'hourly') as 'hourly' | 'piece',
            rateId: input.rateId ?? null,
            hourlyRateId: input.hourlyRateId ?? null,
            pieceRateId: input.pieceRateId ?? null,
            assignmentDate: input.assignmentDate,
          }),
          staffId: input.staffId ?? existing?.staffId ?? null,
          startMinutes: input.startMinutes ?? existing?.startMinutes ?? null,
          endMinutes: input.endMinutes ?? existing?.endMinutes ?? null,
          status: input.status ?? existing?.status ?? 'scheduled',
          payType: (input.payType ?? existing?.payType ?? 'hourly') as 'hourly' | 'piece',
          rateId: input.rateId ?? existing?.rateId ?? null,
          hourlyRateId: input.hourlyRateId ?? existing?.hourlyRateId ?? null,
          pieceRateId: input.pieceRateId ?? existing?.pieceRateId ?? null,
          assignmentDate: input.assignmentDate ?? existing?.assignmentDate ?? null,
        };

        return {
          ...current,
          assignments: [
            ...current.assignments.filter((a) => a.jobKey !== updated.jobKey),
            updated,
          ],
        };
      });

      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error('Could not update schedule', { description: (error as Error).message });
      logSchedulingEvent({
        type: 'mutation_failed',
        jobKey: variables.jobKey,
        staffId: variables.staffId,
        date: variables.assignmentDate,
        reason: 'update_failed',
        detail: (error as Error).message,
      });
    },
    onSuccess: (assignment) => {
      queryClient.setQueryData<LaborPlanningCache>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          assignments: [
            ...current.assignments.filter((a) => a.jobKey !== assignment.jobKey),
            assignment,
          ],
        };
      });
      logSchedulingEvent({
        type: 'updated',
        jobKey: assignment.jobKey,
        staffId: assignment.staffId,
        date: assignment.assignmentDate ?? undefined,
        startMinutes: assignment.startMinutes,
        endMinutes: assignment.endMinutes,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return { assignMutation, updateMutation, unassignMutation };
}

export async function assignJobToStaff(input: AssignJobInput): Promise<LaborPlanAssignment> {
  const payload = buildAssignmentPayload(input.job, input);
  return upsertAssignment(payload, input.job.id, input.assignmentDate);
}

export async function updateJobSchedule(input: UpdateJobScheduleInput): Promise<LaborPlanAssignment> {
  const { assignmentId, jobKey, assignmentDate, ...rest } = input;
  const updatePayload = {
    staff_id: rest.staffId ?? null,
    start_minutes: rest.startMinutes != null ? Math.round(rest.startMinutes) : null,
    end_minutes: rest.endMinutes != null ? Math.round(rest.endMinutes) : null,
    status: rest.status ?? 'scheduled',
    pay_type: rest.payType ?? 'hourly',
    rate_id: rest.rateId ?? null,
    hourly_rate_id: rest.hourlyRateId ?? null,
    piece_rate_id: rest.pieceRateId ?? null,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from(TABLE_NAME)
    .update(updatePayload)
    .eq('job_instance_id', jobKey)
    .eq('assignment_date', assignmentDate);

  if (assignmentId) {
    query = query.or(`assignment_id.eq.${assignmentId},job_instance_id.eq.${jobKey}`);
  }

  const { data, error } = await query.select().maybeSingle();
  if (error || !data) {
    return upsertAssignment(
      { ...updatePayload, job_instance_id: jobKey, assignment_date: assignmentDate },
      jobKey,
      assignmentDate
    );
  }

  return normalizeAssignmentRow(data);
}

export async function unassignJob(input: UnassignJobInput): Promise<LaborPlanAssignment> {
  let query = supabase
    .from(TABLE_NAME)
    .update({
      staff_id: null,
      status: 'unscheduled',
      start_minutes: null,
      end_minutes: null,
      updated_at: new Date().toISOString(),
    })
    .eq('job_instance_id', input.jobKey)
    .eq('assignment_date', input.assignmentDate);

  if (input.assignmentId) {
    query = query.or(`assignment_id.eq.${input.assignmentId},job_instance_id.eq.${input.jobKey}`);
  }

  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;

  if (data) return normalizeAssignmentRow(data);
  return {
    assignmentId: input.assignmentId ?? input.jobKey,
    jobKey: input.jobKey,
    orderId: null,
    orderDetailId: null,
    bolId: null,
    jobId: null,
    staffId: null,
    startMinutes: null,
    endMinutes: null,
    status: 'unscheduled',
    payType: 'hourly',
    rateId: null,
    hourlyRateId: null,
    pieceRateId: null,
    assignmentDate: input.assignmentDate,
  };
}

function buildAssignmentPayload(job: PlanningJob, input: AssignJobInput) {
  return {
    job_instance_id: job.id,
    order_id: job.orderId ?? null,
    order_detail_id: job.orderDetailId ?? null,
    bol_id: job.bolId ?? null,
    job_id: job.jobId ?? null,
    staff_id: input.staffId,
    assignment_date: input.assignmentDate,
    start_minutes: Math.round(input.startMinutes),
    end_minutes: Math.round(input.endMinutes),
    status: 'scheduled',
    pay_type: job.payType ?? 'hourly',
    rate_id: job.rateId ?? job.hourlyRateId ?? null,
    hourly_rate_id: job.hourlyRateId ?? job.rateId ?? null,
    piece_rate_id: job.pieceRateId ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function upsertAssignment(payload: Record<string, any>, jobKey: string, assignmentDate: string) {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: 'job_instance_id,assignment_date' })
    .select()
    .maybeSingle();

  if (error) {
    if (isConflictError(error)) {
      const { data: existing, error: updateError } = await supabase
        .from(TABLE_NAME)
        .update(payload)
        .eq('job_instance_id', jobKey)
        .eq('assignment_date', assignmentDate)
        .select()
        .maybeSingle();

      if (!updateError && existing) {
        return normalizeAssignmentRow(existing);
      }
    }

    throw error;
  }

  if (!data) {
    throw new Error('Assignment upsert did not return data');
  }

  return normalizeAssignmentRow(data);
}

function normalizeAssignmentRow(row: any): LaborPlanAssignment {
  const status =
    String(row?.status ?? 'scheduled').toLowerCase() === 'unscheduled' ? 'unscheduled' : 'scheduled';
  const payType = (row?.pay_type ?? 'hourly').toLowerCase() === 'piece' ? 'piece' : 'hourly';

  return {
    assignmentId: row?.assignment_id ? String(row.assignment_id) : String(row?.job_instance_id ?? 'pending'),
    jobKey: row?.job_instance_id ? String(row.job_instance_id) : '',
    orderId: toNumber(row?.order_id),
    orderDetailId: toNumber(row?.order_detail_id),
    bolId: toNumber(row?.bol_id),
    jobId: toNumber(row?.job_id),
    staffId: toNumber(row?.staff_id),
    startMinutes: toNumber(row?.start_minutes),
    endMinutes: toNumber(row?.end_minutes),
    status,
    payType,
    rateId: toNumber(row?.rate_id),
    hourlyRateId: toNumber(row?.hourly_rate_id),
    pieceRateId: toNumber(row?.piece_rate_id),
    assignmentDate: row?.assignment_date ?? null,
  };
}

function toNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isConflictError(error: any) {
  return error?.code === '23505' || /duplicate key|conflict/i.test(error?.message ?? '');
}

function markJobSchedule(orders: LaborPlanningCache['orders'], jobKey: string, status: 'scheduled' | 'unscheduled') {
  return orders.map((order) => ({
    ...order,
    jobs: order.jobs.map((job) =>
      job.id === jobKey ? { ...job, scheduleStatus: status } : job
    ),
  }));
}

function findJob(cache: LaborPlanningCache, jobKey: string) {
  for (const order of cache.orders) {
    const match = order.jobs.find((job: PlanningJob) => job.id === jobKey);
    if (match) return match;
  }
  return undefined;
}

function addJobIfMissing(list: PlanningJob[], job?: PlanningJob) {
  if (!job) return list;
  if (list.some((existing) => existing.id === job.id)) return list;
  return [...list, { ...job, scheduleStatus: 'unscheduled' }];
}

function buildOptimisticAssignment(input: AssignJobInput): LaborPlanAssignment {
  return {
    assignmentId: `optimistic-${Date.now()}`,
    jobKey: input.job.id,
    orderId: input.job.orderId ?? null,
    orderDetailId: input.job.orderDetailId ?? null,
    bolId: input.job.bolId ?? null,
    jobId: input.job.jobId ?? null,
    staffId: input.staffId,
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes,
    status: 'scheduled',
    payType: input.job.payType ?? 'hourly',
    rateId: input.job.rateId ?? input.job.hourlyRateId ?? null,
    hourlyRateId: input.job.hourlyRateId ?? input.job.rateId ?? null,
    pieceRateId: input.job.pieceRateId ?? null,
    assignmentDate: input.assignmentDate,
  };
}

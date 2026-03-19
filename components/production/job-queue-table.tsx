'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/date-utils';
import { Plus, Clock, XCircle, Loader2 } from 'lucide-react';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { minutesToClock } from '@/src/lib/laborScheduling';
import { getExecutionStatusMeta } from '@/components/production/execution-status';

export type JobCardStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type AssignmentJobStatus = 'issued' | 'in_progress' | 'completed' | 'on_hold';
type QueueStatus = JobCardStatus | 'issued' | 'on_hold';
const issuedMeta = getExecutionStatusMeta('issued')!;
const inProgressMeta = getExecutionStatusMeta('in_progress')!;
const onHoldMeta = getExecutionStatusMeta('on_hold')!;
const completedMeta = getExecutionStatusMeta('completed')!;
const IssuedIcon = issuedMeta.icon;
const InProgressIcon = inProgressMeta.icon;
const OnHoldIcon = onHoldMeta.icon;
const CompletedIcon = completedMeta.icon;

interface JobCardItem {
  item_id: number;
  quantity: number;
  jobs: { name: string } | null;
  products: { name: string } | null;
}

interface JobCard {
  job_card_id: number;
  order_id: number | null;
  staff_id: number | null;
  issue_date: string;
  due_date: string | null;
  completion_date: string | null;
  status: JobCardStatus;
  notes: string | null;
  created_at: string;
  staff: {
    first_name: string;
    last_name: string;
  } | null;
  orders: {
    order_number: string;
    customers: {
      name: string;
    } | null;
  } | null;
  job_card_items: JobCardItem[];
  scheduledAssignment?: ScheduledAssignment | null;
}

interface ScheduledAssignment {
  assignment_id: number;
  job_instance_id: string;
  order_id: number | null;
  staff_id: number | null;
  assignment_date: string | null;
  start_minutes: number | null;
  end_minutes: number | null;
  job_status: AssignmentJobStatus | null;
  staff?: {
    first_name: string;
    last_name: string;
  } | null;
}

interface FloorAssignmentRow {
  job_card_id: number;
  assignment_id: number;
  staff_id: number | null;
  assignment_date: string | null;
  start_minutes: number | null;
  end_minutes: number | null;
  job_status: AssignmentJobStatus | null;
}

const statusConfig: Record<QueueStatus, { label: string; className: string; icon: React.ReactNode }> = {
  pending: {
    label: 'Pending',
    className: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary',
    icon: <Clock className="h-3 w-3" />,
  },
  issued: {
    label: issuedMeta.label,
    className: issuedMeta.badgeClassName,
    icon: <IssuedIcon className="h-3 w-3" />,
  },
  in_progress: {
    label: inProgressMeta.label,
    className: inProgressMeta.badgeClassName,
    icon: <InProgressIcon className="h-3 w-3" />,
  },
  on_hold: {
    label: onHoldMeta.label,
    className: onHoldMeta.badgeClassName,
    icon: <OnHoldIcon className="h-3 w-3" />,
  },
  completed: {
    label: completedMeta.label,
    className: completedMeta.badgeClassName,
    icon: <CompletedIcon className="h-3 w-3" />,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive',
    icon: <XCircle className="h-3 w-3" />,
  },
};

type StatusFilter = 'all' | 'open' | QueueStatus;

function getEffectiveQueueStatus(jobCard: JobCard): QueueStatus {
  if (jobCard.status === 'completed' || jobCard.status === 'cancelled') {
    return jobCard.status;
  }

  const assignmentStatus = jobCard.scheduledAssignment?.job_status;
  if (assignmentStatus === 'issued' || assignmentStatus === 'in_progress' || assignmentStatus === 'on_hold') {
    return assignmentStatus;
  }

  return jobCard.status;
}

interface JobQueueTableProps {
  /** Default status filter. 'open' = pending + in_progress. Defaults to 'all'. */
  defaultStatusFilter?: StatusFilter;
  /** Show the PageToolbar header with title and create button. Defaults to true. */
  showHeader?: boolean;
  /** Custom row click handler. Defaults to navigating to job card detail page. */
  onRowClick?: (id: number) => void;
}

export function JobQueueTable({
  defaultStatusFilter = 'all',
  showHeader = true,
  onRowClick,
}: JobQueueTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(defaultStatusFilter);
  const [staffFilter, setStaffFilter] = useState<string>('all');

  const handleRowClick = (id: number) => {
    if (onRowClick) {
      onRowClick(id);
    } else {
      router.push(`/staff/job-cards/${id}`);
    }
  };

  const getDisplayStaff = (jobCard: JobCard) => {
    const scheduledStaff = jobCard.scheduledAssignment?.staff;
    if (scheduledStaff) {
      return `${scheduledStaff.first_name} ${scheduledStaff.last_name}`.trim();
    }
    if (jobCard.staff) {
      return `${jobCard.staff.first_name} ${jobCard.staff.last_name}`.trim();
    }
    return '-';
  };

  const getDisplayStaffId = (jobCard: JobCard) =>
    jobCard.scheduledAssignment?.staff_id ?? jobCard.staff_id ?? null;

  const { data: baseJobCards = [], isLoading } = useQuery({
    queryKey: ['jobCards', 'base', statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('job_cards')
        .select(`
          job_card_id,
          order_id,
          staff_id,
          issue_date,
          due_date,
          completion_date,
          status,
          notes,
          created_at,
          staff:staff_id(first_name, last_name),
          orders:order_id(order_number, customers(name)),
          job_card_items!job_card_items_job_card_id_fkey(item_id, quantity, jobs:job_id(name), products:product_id(name))
        `)
        .order('issue_date', { ascending: false });

      if (statusFilter === 'open' || statusFilter === 'pending' || statusFilter === 'issued' || statusFilter === 'in_progress' || statusFilter === 'on_hold') {
        query = query.in('status', ['pending', 'in_progress']);
      } else if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as JobCard[];
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const queueCardIds = useMemo(
    () => new Set(baseJobCards.map((jc) => jc.job_card_id)),
    [baseJobCards],
  );
  const queueOrderIds = useMemo(
    () =>
      [...new Set(baseJobCards
        .map((jc) => jc.order_id)
        .filter((id): id is number => typeof id === 'number'))],
    [baseJobCards],
  );

  const { data: scheduledByCard = new Map<number, ScheduledAssignment>() } = useQuery({
    queryKey: ['jobCards', 'schedule-enrichment', statusFilter, queueOrderIds],
    enabled: queueCardIds.size > 0 && queueOrderIds.length > 0,
    queryFn: async () => {
      const scheduledMap = new Map<number, ScheduledAssignment>();

      const { data: floorRows, error: floorError } = await supabase
        .from('factory_floor_status')
        .select('job_card_id, assignment_id, staff_id, assignment_date, start_minutes, end_minutes, job_status')
        .in('job_card_id', [...queueCardIds]);

      if (floorError) {
        console.warn('[job-queue] Failed to load floor-status assignments for queue enrichment', floorError);
      } else {
        for (const row of ((floorRows || []) as FloorAssignmentRow[])) {
          if (!queueCardIds.has(row.job_card_id) || scheduledMap.has(row.job_card_id)) continue;
          scheduledMap.set(row.job_card_id, {
            assignment_id: row.assignment_id,
            job_instance_id: `card-${row.job_card_id}`,
            order_id: null,
            staff_id: row.staff_id,
            assignment_date: row.assignment_date,
            start_minutes: row.start_minutes,
            end_minutes: row.end_minutes,
            job_status: normalizeAssignmentJobStatus(row.job_status),
            staff: null,
          });
        }
      }

      const { data: assignmentRows, error: assignmentError } = await supabase
        .from('labor_plan_assignments')
        .select(`
          assignment_id,
          job_instance_id,
          order_id,
          staff_id,
          assignment_date,
          start_minutes,
          end_minutes,
          job_status,
          status,
          staff:staff_id(first_name, last_name)
        `)
        .in('order_id', queueOrderIds)
        .neq('status', 'unscheduled')
        .order('assignment_date', { ascending: true })
        .order('start_minutes', { ascending: true });

      if (assignmentError) {
        console.warn('[job-queue] Failed to load scheduler assignments for queue enrichment', assignmentError);
        return scheduledMap;
      }

      for (const row of ((assignmentRows || []) as Array<ScheduledAssignment & { status: string }>)) {
        const cardId = extractJobCardId(row.job_instance_id);
        if (cardId == null || !queueCardIds.has(cardId) || scheduledMap.has(cardId)) continue;
        scheduledMap.set(cardId, {
          ...row,
          job_status: normalizeAssignmentJobStatus(row.job_status),
          staff: row.staff ?? null,
        });
      }

      return scheduledMap;
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  // Fetch staff for filter dropdown
  const { data: staffList = [] } = useQuery({
    queryKey: ['staffList'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name')
        .eq('is_active', true)
        .order('first_name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60_000,
  });

  const jobCards = useMemo(
    () =>
      baseJobCards.map((jc) => ({
        ...jc,
        scheduledAssignment: scheduledByCard.get(jc.job_card_id) ?? null,
      })),
    [baseJobCards, scheduledByCard],
  );

  const filteredJobCards = useMemo(() => {
    let results = [...jobCards];

    if (statusFilter !== 'all') {
      results = results.filter((jc) => {
        const effectiveStatus = getEffectiveQueueStatus(jc);
        if (statusFilter === 'open') {
          return effectiveStatus !== 'completed' && effectiveStatus !== 'cancelled';
        }
        return effectiveStatus === statusFilter;
      });
    }

    if (staffFilter !== 'all') {
      const selectedStaffId = parseInt(staffFilter, 10);
      results = results.filter((jc) => getDisplayStaffId(jc) === selectedStaffId);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      results = results.filter((jc) => {
        const staffName = getDisplayStaff(jc).toLowerCase();
        const orderNum = jc.orders?.order_number?.toLowerCase() || '';
        const customerName = jc.orders?.customers?.name?.toLowerCase() || '';
        return staffName.includes(searchLower) ||
               orderNum.includes(searchLower) ||
               customerName.includes(searchLower) ||
               jc.job_card_id.toString().includes(searchLower);
      });
    }

    return results;
  }, [jobCards, search, staffFilter, statusFilter]);

  const getItemsCount = (jobCard: JobCard) => {
    return jobCard.job_card_items?.length ?? 0;
  };

  const getJobSummary = (jobCard: JobCard) => {
    const items = jobCard.job_card_items ?? [];
    if (items.length === 0) return null;
    // Show first item's job + product, with "+N more" if multiple
    const first = items[0];
    const jobName = (first.jobs as any)?.name ?? null;
    const productName = (first.products as any)?.name ?? null;
    return { jobName, productName, qty: first.quantity, extra: items.length - 1 };
  };

  return (
    <div className="space-y-4">
      {showHeader && (
        <PageToolbar
          title="Job Cards"
          actions={[
            {
              label: 'Create Job Card',
              onClick: () => router.push('/staff/job-cards/new'),
              icon: <Plus className="h-4 w-4" />,
            },
          ]}
        />
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Input
          placeholder="Search by ID, staff, order, customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={staffFilter} onValueChange={setStaffFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Staff Member" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Staff</SelectItem>
            {staffList.map((s) => (
              <SelectItem key={s.staff_id} value={s.staff_id.toString()}>
                {s.first_name} {s.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">ID</TableHead>
              <TableHead>Staff Member</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Job / Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-center">Items</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  <p className="text-muted-foreground mt-2">Loading job cards...</p>
                </TableCell>
              </TableRow>
            ) : filteredJobCards.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  {statusFilter === 'open' || statusFilter === 'pending'
                    ? 'All caught up — no open job cards'
                    : 'No job cards found'}
                </TableCell>
              </TableRow>
            ) : (
              filteredJobCards.map((jobCard) => {
                const status = statusConfig[getEffectiveQueueStatus(jobCard)] || statusConfig.pending;
                return (
                  <TableRow
                    key={jobCard.job_card_id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(jobCard.job_card_id)}
                  >
                    <TableCell className="font-mono text-sm">
                      #{jobCard.job_card_id}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div>{getDisplayStaff(jobCard)}</div>
                        {jobCard.scheduledAssignment && (
                          <div className="text-xs text-muted-foreground">
                            From schedule
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {jobCard.orders ? (
                        <div>
                          <div className="font-medium">{jobCard.orders.order_number}</div>
                          {jobCard.orders.customers && (
                            <div className="text-sm text-muted-foreground">
                              {jobCard.orders.customers.name}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No order</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const summary = getJobSummary(jobCard);
                        if (!summary) return <span className="text-muted-foreground">-</span>;
                        return (
                          <div>
                            <div className="font-medium">{summary.jobName || 'Unknown job'}</div>
                            {summary.productName && (
                              <div className="text-sm text-muted-foreground">{summary.productName}{summary.qty > 1 ? ` × ${summary.qty}` : ''}</div>
                            )}
                            {!summary.productName && summary.qty > 1 && (
                              <div className="text-sm text-muted-foreground">× {summary.qty}</div>
                            )}
                            {summary.extra > 0 && (
                              <div className="text-xs text-muted-foreground">+{summary.extra} more</div>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge className={`gap-1 ${status.className}`}>
                          {status.icon}
                          {status.label}
                        </Badge>
                        {jobCard.scheduledAssignment?.assignment_date &&
                          jobCard.scheduledAssignment.start_minutes != null &&
                          jobCard.scheduledAssignment.end_minutes != null && (
                            <div className="text-xs text-muted-foreground">
                              Scheduled {formatDate(jobCard.scheduledAssignment.assignment_date)} · {minutesToClock(jobCard.scheduledAssignment.start_minutes)}-{minutesToClock(jobCard.scheduledAssignment.end_minutes)}
                            </div>
                          )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {formatDate(jobCard.issue_date)}
                    </TableCell>
                    <TableCell>
                      {jobCard.due_date
                        ? formatDate(jobCard.due_date)
                        : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{getItemsCount(jobCard)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(jobCard.job_card_id);
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
      {!isLoading && filteredJobCards.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {filteredJobCards.length} job card{filteredJobCards.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

function extractJobCardId(jobInstanceId: string | null | undefined): number | null {
  if (!jobInstanceId) return null;
  const match = jobInstanceId.match(/:card-(\d+)$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAssignmentJobStatus(value: unknown): AssignmentJobStatus | null {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'issued' || normalized === 'in_progress' || normalized === 'completed' || normalized === 'on_hold') {
    return normalized;
  }
  return null;
}

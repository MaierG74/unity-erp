'use client';

import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { AlertTriangle, Archive, CalendarClock, ChevronRight, Flame, GripVertical } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { PlanningOrder, PlanningJob } from './types';
import { formatDateShort } from '@/lib/date-utils';
import { getExecutionStatusMeta } from '@/components/production/execution-status';

const ESTIMATED_ROW_HEIGHT = 48;

interface OrderTreeProps {
  orders: PlanningOrder[];
  windowSize?: number;
  onJobDragStart?: (event: React.DragEvent<HTMLDivElement>, job: PlanningJob, order: PlanningOrder) => void;
  onJobClick?: (job: PlanningJob, order: PlanningOrder) => void;
  stalePoolOrderIds?: Set<number>;
}

const priorityStyles: Record<PlanningOrder['priority'], string> = {
  high: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  medium: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
  low: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
};

const jobStatusStyles: Record<PlanningJob['status'], string> = {
  ready: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/40',
  'in-progress': 'bg-blue-500/10 text-blue-700 border-blue-500/40',
  blocked: 'bg-rose-500/10 text-rose-700 border-rose-500/40',
};

const jobStatusLabel: Record<PlanningJob['status'], string> = {
  ready: 'Ready to place',
  'in-progress': 'In progress',
  blocked: 'Blocked',
};

const formatDueDate = (input?: string | null) => {
  if (!input) return 'No due date';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return 'No due date';
  return formatDateShort(parsed);
};

/** Format duration as human-readable time. Returns empty string for 0/unknown. */
function formatDuration(durationHours: number): string {
  const totalMinutes = Math.round(durationHours * 60);
  if (totalMinutes <= 0) return '';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Build a compact summary of job states for the order header */
function orderJobSummary(jobs: PlanningJob[]): string {
  let pool = 0;
  let issued = 0;
  let scheduled = 0;
  let inProgress = 0;
  let completed = 0;
  for (const j of jobs) {
    if (j.jobStatus === 'completed') completed++;
    else if (j.jobStatus === 'in_progress') inProgress++;
    else if (j.scheduleStatus === 'scheduled') scheduled++;
    else if (j.jobStatus === 'issued') issued++;
    else if (j.poolId != null && (j.remainingQty ?? 0) > 0) pool++;
    else issued++; // legacy BOL jobs without pool
  }
  const parts: string[] = [];
  if (pool > 0) parts.push(`${pool} pool`);
  if (issued > 0) parts.push(`${issued} issued`);
  if (scheduled > 0) parts.push(`${scheduled} scheduled`);
  if (inProgress > 0) parts.push(`${inProgress} in progress`);
  if (completed > 0) parts.push(`${completed} completed`);
  return parts.join(' · ');
}

/** Build the second-line description for a job card */
function jobCardDetail(job: PlanningJob): { label: string; className: string; icon?: React.ComponentType<{ className?: string }> } {
  const time = formatDuration(job.durationHours);
  const timeSuffix = time ? ` · ${time}` : '';
  const qtySuffix = job.quantity ? ` · qty ${job.quantity}` : '';
  const lifecycleMeta = getExecutionStatusMeta(job.jobStatus);
  const scheduleSuffix = job.scheduleStatus === 'scheduled' && job.jobStatus !== 'completed'
    ? ' · scheduled'
    : '';

  if (lifecycleMeta) {
    return {
      label: `${lifecycleMeta.label}${scheduleSuffix}${qtySuffix}${timeSuffix}`,
      className: lifecycleMeta.textClassName,
      icon: lifecycleMeta.icon,
    };
  }
  if (job.scheduleStatus === 'scheduled') {
    return { label: `Scheduled${qtySuffix}${timeSuffix}`, className: 'text-violet-600 dark:text-violet-400', icon: CalendarClock };
  }
  // Pool demand — skip time (aggregate is misleading for multi-unit pool)
  if (job.poolId != null && (job.remainingQty ?? 0) > 0) {
    return { label: `Pool · ${job.remainingQty} remaining`, className: 'text-purple-600 dark:text-purple-400', icon: Archive };
  }
  // Fallback: legacy BOL job
  const fallbackTime = time || 'Ready';
  return { label: fallbackTime, className: 'text-muted-foreground' };
}

/** Categorise a job into pool / active / completed */
function jobTier(job: PlanningJob): 'pool' | 'active' | 'completed' {
  if (job.jobStatus === 'completed') return 'completed';
  if (job.poolId != null && (job.remainingQty ?? 0) > 0) return 'pool';
  return 'active';
}

/** Render a single job row */
function JobRow({
  job,
  order,
  onJobClick,
  onJobDragStart,
}: {
  job: PlanningJob;
  order: PlanningOrder;
  onJobClick?: (job: PlanningJob, order: PlanningOrder) => void;
  onJobDragStart?: (event: React.DragEvent<HTMLDivElement>, job: PlanningJob, order: PlanningOrder) => void;
}) {
  const detail = jobCardDetail(job);
  const Icon = detail.icon;
  return (
    <div
      key={job.id}
      className="group flex items-center gap-1.5 rounded border border-dashed border-muted-foreground/30 bg-muted/50 px-1.5 py-1 cursor-grab active:cursor-grabbing hover:border-primary/50 hover:bg-muted"
      draggable
      onClick={() => onJobClick?.(job, order)}
      onDragStart={(event) => {
        const payload = {
          type: 'job',
          job,
          order: {
            id: order.orderId ?? order.id,
            orderNumber: order.orderNumber ?? order.id,
            customer: order.customer,
          },
        };
        event.dataTransfer.setData('application/json', JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'move';
        onJobDragStart?.(event, job, order);
      }}
    >
      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/70 group-hover:text-foreground" />
      <div
        className="h-5 w-1 shrink-0 rounded-full"
        style={{ background: job.categoryColor ?? '#0ea5e9' }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium">
          {job.productName && job.productName !== job.name ? job.productName : job.name}
        </p>
        {job.productName && job.productName !== job.name && (
          <p className="truncate text-[10px] text-muted-foreground/70">{job.name}</p>
        )}
        <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium', detail.className)}>
          {Icon && <Icon className="h-3 w-3" />}
          {detail.label}
        </span>
      </div>
    </div>
  );
}

/** Collapsible section divider for pool / completed tiers */
function SectionDivider({
  label,
  count,
  colorClass,
  defaultOpen,
  children,
}: {
  label: string;
  count: string;
  colorClass: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-1 py-0.5 group/section"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn(
            'h-2.5 w-2.5 shrink-0 transition-transform',
            colorClass,
            open ? 'rotate-90' : 'rotate-0',
          )}
        />
        <span className={cn('text-[9px] font-semibold uppercase tracking-wide', colorClass)}>
          {label}
        </span>
        <div className={cn('flex-1 h-px', `bg-current opacity-20`, colorClass)} />
        <span className={cn('text-[9px]', colorClass, 'opacity-70')}>{count}</span>
      </button>
      {open && <div className="space-y-1 mt-1">{children}</div>}
    </div>
  );
}

export function OrderTree({ orders, windowSize = 12, onJobDragStart, onJobClick, stalePoolOrderIds }: OrderTreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [openOrders, setOpenOrders] = useState<Set<string>>(() => new Set());

  const { visibleOrders, paddingTop, paddingBottom } = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / ESTIMATED_ROW_HEIGHT));
    const endIndex = Math.min(orders.length, startIndex + windowSize);

    return {
      visibleOrders: orders.slice(startIndex, endIndex),
      paddingTop: startIndex * ESTIMATED_ROW_HEIGHT,
      paddingBottom: Math.max(orders.length - endIndex, 0) * ESTIMATED_ROW_HEIGHT,
    };
  }, [orders, scrollTop, windowSize]);

  const toggleOrder = (orderId: string) => {
    setOpenOrders((prev) => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  };

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-y-auto pr-1"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ paddingTop, paddingBottom }} className="space-y-1">
        {visibleOrders.map((order) => {
          const isOpen = openOrders.has(order.id);

          // Split jobs into three tiers
          const poolJobs: PlanningJob[] = [];
          const activeJobs: PlanningJob[] = [];
          const completedJobs: PlanningJob[] = [];
          for (const job of order.jobs) {
            const tier = jobTier(job);
            if (tier === 'pool') poolJobs.push(job);
            else if (tier === 'completed') completedJobs.push(job);
            else activeJobs.push(job);
          }

          const totalRemaining = poolJobs.reduce((sum, j) => sum + (j.remainingQty ?? 0), 0);

          return (
            <Collapsible key={order.id} open={isOpen} onOpenChange={() => toggleOrder(order.id)}>
              <div className="rounded-md border bg-card shadow-xs transition hover:border-primary/40">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition hover:bg-muted/60"
                  >
                    <ChevronRight
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                        isOpen ? 'rotate-90' : 'rotate-0',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold">{order.orderNumber ?? order.id}</span>
                        {stalePoolOrderIds?.has(order.orderId ?? 0) && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                <p className="text-xs">Work pool quantities out of date — update on order page</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <Badge
                          variant="outline"
                          className={cn(
                            'h-4 shrink-0 border px-1 text-[10px] font-medium',
                            priorityStyles[order.priority],
                          )}
                        >
                          {order.priority === 'high' && <Flame className="h-2.5 w-2.5" />}
                          {order.priority !== 'high' && order.priority.charAt(0).toUpperCase()}
                        </Badge>
                      </div>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {order.customer} • {order.jobs.length} jobs • {formatDueDate(order.dueDate)}
                      </p>
                      {isOpen && (
                        <p className="truncate text-[9px] text-muted-foreground/70 mt-0.5">
                          {orderJobSummary(order.jobs)}
                        </p>
                      )}
                    </div>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-2 px-2 pb-2">
                    {/* Pool section — collapsible, default collapsed */}
                    {poolJobs.length > 0 && (
                      <SectionDivider
                        label="Pool"
                        count={`${poolJobs.length} · ${totalRemaining} remaining`}
                        colorClass="text-purple-600 dark:text-purple-400"
                        defaultOpen={false}
                      >
                        {poolJobs.map((job) => (
                          <JobRow key={job.id} job={job} order={order} onJobClick={onJobClick} onJobDragStart={onJobDragStart} />
                        ))}
                      </SectionDivider>
                    )}

                    {/* Issued / Active section — always visible, inline divider */}
                    {activeJobs.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 px-1 py-0.5">
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                            Active
                          </span>
                          <div className="flex-1 h-px bg-blue-600/20 dark:bg-blue-400/20" />
                          <span className="text-[9px] text-blue-600/70 dark:text-blue-400/70">
                            {activeJobs.length} {activeJobs.length === 1 ? 'card' : 'cards'}
                          </span>
                        </div>
                        <div className="space-y-1 mt-1">
                          {activeJobs.map((job) => (
                            <JobRow key={job.id} job={job} order={order} onJobClick={onJobClick} onJobDragStart={onJobDragStart} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Completed section — collapsible, default closed */}
                    {completedJobs.length > 0 && (
                      <SectionDivider
                        label="Done"
                        count={`${completedJobs.length} ${completedJobs.length === 1 ? 'job' : 'jobs'}`}
                        colorClass="text-emerald-600 dark:text-emerald-400"
                        defaultOpen={false}
                      >
                        {completedJobs.map((job) => (
                          <JobRow key={job.id} job={job} order={order} onJobClick={onJobClick} onJobDragStart={onJobDragStart} />
                        ))}
                      </SectionDivider>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

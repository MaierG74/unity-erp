'use client';

import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { CalendarClock, CheckCircle2, ChevronRight, Clock3, Flame, GripVertical, Loader2, Sparkles } from 'lucide-react';
import type { PlanningOrder, PlanningJob } from './types';

const ESTIMATED_ROW_HEIGHT = 96;

interface OrderTreeProps {
  orders: PlanningOrder[];
  windowSize?: number;
  onJobDragStart?: (event: React.DragEvent<HTMLDivElement>, job: PlanningJob, order: PlanningOrder) => void;
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

const formatDate = (input?: string | null) => {
  if (!input) return 'No due date';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return 'No due date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed);
};

export function OrderTree({ orders, windowSize = 12, onJobDragStart }: OrderTreeProps) {
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
      <div style={{ paddingTop, paddingBottom }} className="space-y-2">
        {visibleOrders.map((order) => {
          const isOpen = openOrders.has(order.id);

          return (
            <Collapsible key={order.id} open={isOpen} onOpenChange={() => toggleOrder(order.id)}>
              <div className="rounded-lg border bg-card shadow-sm transition hover:border-primary/40">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-muted/60"
                  >
                    <div className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 transition-transform',
                          isOpen ? 'rotate-90' : 'rotate-0',
                        )}
                      />
                    </div>
                    <div className="flex flex-1 items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold tracking-tight">{order.id}</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              'border text-xs font-medium',
                              priorityStyles[order.priority],
                            )}
                          >
                            {order.priority === 'high' && <Flame className="mr-1 h-3 w-3" />}
                            {order.priority === 'low' && <Loader2 className="mr-1 h-3 w-3" />}
                            {order.priority === 'medium' && <Sparkles className="mr-1 h-3 w-3" />}
                            {order.priority.charAt(0).toUpperCase() + order.priority.slice(1)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {order.customer} • {order.jobs.length} jobs
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <div className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          <span>Due {formatDate(order.dueDate)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-2 px-3 pb-3">
                    {order.jobs.map((job) => (
                      <div
                        key={job.id}
                        className="group flex items-start gap-3 rounded-md border border-dashed border-muted-foreground/30 bg-muted/50 px-3 py-2"
                        draggable
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
                        <GripVertical className="mt-1 h-4 w-4 text-muted-foreground/70 group-hover:text-foreground" />
                        <div className="flex flex-1 items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">{job.name}</p>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'border text-[11px]',
                                  jobStatusStyles[job.status],
                                )}
                              >
                                {jobStatusLabel[job.status]}
                              </Badge>
                              {job.scheduleStatus && (
                                <Badge
                                  variant={job.scheduleStatus === 'scheduled' ? 'default' : 'outline'}
                                  className={cn(
                                    'border text-[11px]',
                                    job.scheduleStatus === 'scheduled'
                                      ? 'bg-emerald-500/10 text-emerald-700'
                                      : 'border-dashed border-muted-foreground/50 text-muted-foreground'
                                  )}
                                >
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                  {job.scheduleStatus === 'scheduled' ? 'Scheduled' : 'Unscheduled'}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Est. {job.durationHours}h{' '}
                              {job.owner ? `• ${job.owner}` : '• Unassigned'}{' '}
                              {job.payType === 'piece' ? '• Piecework' : ''}
                            </p>
                            {(job.start || job.end) && (
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <CalendarClock className="h-3 w-3" />
                                <span>{job.start ?? 'TBD'} → {job.end ?? 'TBD'}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <div
                              className="h-7 w-1 rounded-full bg-gradient-to-b from-primary/80 to-primary/40"
                              style={job.categoryColor ? { background: job.categoryColor } : undefined}
                            />
                            <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">
                              Drag to schedule
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
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

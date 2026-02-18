'use client';

import { useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { CalendarClock, CheckCircle2, ChevronRight, Clock3, Flame, GripVertical, Loader2, Sparkles } from 'lucide-react';
import type { PlanningOrder, PlanningJob } from './types';

const ESTIMATED_ROW_HEIGHT = 48;

interface OrderTreeProps {
  orders: PlanningOrder[];
  windowSize?: number;
  onJobDragStart?: (event: React.DragEvent<HTMLDivElement>, job: PlanningJob, order: PlanningOrder) => void;
  onJobClick?: (job: PlanningJob, order: PlanningOrder) => void;
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

export function OrderTree({ orders, windowSize = 12, onJobDragStart, onJobClick }: OrderTreeProps) {
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

          return (
            <Collapsible key={order.id} open={isOpen} onOpenChange={() => toggleOrder(order.id)}>
              <div className="rounded-md border bg-card shadow-sm transition hover:border-primary/40">
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
                        <span className="truncate text-xs font-semibold">{order.id}</span>
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
                        {order.customer} • {order.jobs.length} jobs • {formatDate(order.dueDate)}
                      </p>
                    </div>
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-1 px-2 pb-2">
                    {order.jobs.map((job) => (
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
                          <p className="truncate text-[11px] font-medium">{job.name}</p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {job.durationHours}h • {job.status === 'ready' ? 'Ready' : job.status}
                            {job.scheduleStatus === 'scheduled' && ' • Scheduled'}
                          </p>
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

'use client';

import { useProductionSummary } from '@/hooks/use-production-summary';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, PauseCircle, CalendarClock, Inbox } from 'lucide-react';

interface ProductionHeaderProps {
  onBadgeClick?: (view: string) => void;
}

export function ProductionHeader({ onBadgeClick }: ProductionHeaderProps) {
  const { overdue, paused, dueToday, unscheduled, isLoading } = useProductionSummary();

  const badges = [
    {
      label: 'Overdue',
      count: overdue,
      icon: AlertTriangle,
      className: 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border-red-500/20',
      view: 'exceptions',
    },
    {
      label: 'Paused',
      count: paused,
      icon: PauseCircle,
      className: 'bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 border-yellow-500/20',
      view: 'exceptions',
    },
    {
      label: 'Due Today',
      count: dueToday,
      icon: CalendarClock,
      className: 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border-blue-500/20',
      view: 'queue',
    },
    {
      label: 'Unscheduled',
      count: unscheduled,
      icon: Inbox,
      className: 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border-amber-500/20',
      view: 'queue',
    },
  ];

  return (
    <div className="flex items-center justify-between px-1 pb-2">
      <h1 className="text-2xl font-bold">Production</h1>
      {!isLoading && (
        <div className="flex items-center gap-2">
          {badges.map((b) => {
            if (b.count === 0) return null;
            const Icon = b.icon;
            return (
              <Badge
                key={b.label}
                variant="outline"
                className={`cursor-pointer gap-1.5 px-2.5 py-1 text-xs font-medium ${b.className}`}
                onClick={() => onBadgeClick?.(b.view)}
              >
                <Icon className="h-3 w-3" />
                {b.count} {b.label}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

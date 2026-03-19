import type { LucideIcon } from 'lucide-react';
import { CheckCircle2, ClipboardList, Pause, Play } from 'lucide-react';

export type ExecutionLifecycleStatus = 'issued' | 'in_progress' | 'on_hold' | 'completed';

export interface ExecutionStatusMeta {
  label: string;
  icon: LucideIcon;
  badgeClassName: string;
  textClassName: string;
  dotClassName: string;
  stripeColor: string;
}

export const executionStatusMeta: Record<ExecutionLifecycleStatus, ExecutionStatusMeta> = {
  issued: {
    label: 'Issued',
    icon: ClipboardList,
    badgeClassName: 'border-transparent bg-blue-600 text-white hover:bg-blue-600',
    textClassName: 'text-blue-600 dark:text-blue-400',
    dotClassName: 'bg-blue-400',
    stripeColor: 'rgba(96,165,250,0.5)',
  },
  in_progress: {
    label: 'In Progress',
    icon: Play,
    badgeClassName: 'border-transparent bg-amber-500 text-white hover:bg-amber-500',
    textClassName: 'text-amber-600 dark:text-amber-400',
    dotClassName: 'bg-amber-400',
    stripeColor: 'rgba(251,191,36,0.5)',
  },
  on_hold: {
    label: 'On Hold',
    icon: Pause,
    badgeClassName: 'border-transparent bg-orange-600 text-white hover:bg-orange-600',
    textClassName: 'text-orange-600 dark:text-orange-400',
    dotClassName: 'bg-orange-400',
    stripeColor: 'rgba(251,146,60,0.5)',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    badgeClassName: 'border-transparent bg-emerald-600 text-white hover:bg-emerald-600',
    textClassName: 'text-emerald-600 dark:text-emerald-400',
    dotClassName: 'bg-emerald-400',
    stripeColor: 'rgba(52,211,153,0.5)',
  },
};

export function getExecutionStatusMeta(
  status: ExecutionLifecycleStatus | null | undefined,
): ExecutionStatusMeta | null {
  if (!status) return null;
  return executionStatusMeta[status] ?? null;
}

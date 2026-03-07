import type { TodoItem } from '@/lib/db/todos';

// ---------------------------------------------------------------------------
// Shared initials helper
// ---------------------------------------------------------------------------

export function initials(name?: string | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// ---------------------------------------------------------------------------
// Priority configuration
// ---------------------------------------------------------------------------

export const PRIORITY_CONFIG: Record<
  string,
  { label: string; dotColor: string; className: string }
> = {
  urgent: {
    label: 'Urgent',
    dotColor: 'bg-red-500',
    className: 'bg-red-500/20 text-red-300 border-red-500/30',
  },
  high: {
    label: 'High',
    dotColor: 'bg-orange-500',
    className: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  },
  medium: {
    label: 'Medium',
    dotColor: 'bg-blue-500',
    className: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  },
  low: {
    label: 'Low',
    dotColor: 'bg-gray-400',
    className: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  },
};

// ---------------------------------------------------------------------------
// Status configuration
// ---------------------------------------------------------------------------

export const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  open: {
    label: 'Open',
    className: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  },
  blocked: {
    label: 'Blocked',
    className: 'bg-red-500/20 text-red-300 border-red-500/30',
  },
  done: {
    label: 'Done',
    className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  },
  archived: {
    label: 'Archived',
    className: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  },
};

// ---------------------------------------------------------------------------
// Chip base class
// ---------------------------------------------------------------------------

export const chipBase =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border cursor-pointer hover:bg-muted/50 transition-colors select-none';

// ---------------------------------------------------------------------------
// Context label extraction
// ---------------------------------------------------------------------------

export function getContextLabel(todo: TodoItem): string | null {
  if (!todo.contextPath) return null;
  if (
    todo.contextSnapshot &&
    typeof todo.contextSnapshot === 'object' &&
    'label' in todo.contextSnapshot
  ) {
    return String(todo.contextSnapshot.label);
  }
  return todo.contextPath;
}

// ---------------------------------------------------------------------------
// File size formatting
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

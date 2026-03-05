// components/features/todos/TaskMetadataChips.tsx
'use client';

import { useState } from 'react';
import { parseISO, format } from 'date-fns';
import { CalendarIcon, Circle, Link2, Loader2, X, Plus, User } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { TODO_STATUSES, TODO_PRIORITIES } from '@/lib/db/todos';
import type { TodoItem } from '@/lib/db/todos';

interface Profile {
  id: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface TaskMetadataChipsProps {
  todo: TodoItem;
  profiles: Profile[];
  onUpdate: (field: string, value: unknown) => void;
  onNavigateToLink?: () => void;
  onClearLink?: () => void;
  onOpenLinkPicker?: () => void;
  saving?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-gray-500/20 text-gray-300 border-gray-500/30' },
  in_progress: { label: 'In Progress', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  blocked: { label: 'Blocked', className: 'bg-red-500/20 text-red-300 border-red-500/30' },
  done: { label: 'Done', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  archived: { label: 'Archived', className: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
};

const PRIORITY_CONFIG: Record<string, { label: string; dotColor: string; className: string }> = {
  urgent: { label: 'Urgent', dotColor: 'bg-red-500', className: 'bg-red-500/20 text-red-300 border-red-500/30' },
  high: { label: 'High', dotColor: 'bg-orange-500', className: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  medium: { label: 'Medium', dotColor: 'bg-blue-500', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  low: { label: 'Low', dotColor: 'bg-gray-400', className: 'bg-gray-500/20 text-gray-300 border-gray-500/30' },
};

function initials(name?: string | null): string {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
}

const chipBase = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border cursor-pointer hover:bg-muted/50 transition-colors select-none';

export function TaskMetadataChips({
  todo,
  profiles,
  onUpdate,
  onNavigateToLink,
  onClearLink,
  onOpenLinkPicker,
  saving,
}: TaskMetadataChipsProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const statusCfg = STATUS_CONFIG[todo.status] ?? STATUS_CONFIG.open;
  const priorityCfg = PRIORITY_CONFIG[todo.priority] ?? PRIORITY_CONFIG.medium;
  const assigneeName = todo.assignee?.username ?? todo.assignee?.displayName ?? 'Unassigned';

  const contextLabel = todo.contextSnapshot
    ? (typeof todo.contextSnapshot === 'object' && 'label' in todo.contextSnapshot
        ? String(todo.contextSnapshot.label)
        : todo.contextPath)
    : todo.contextPath;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Status chip */}
      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger asChild>
          <button className={cn(chipBase, statusCfg.className)}>
            <Circle className="h-2.5 w-2.5 fill-current" />
            {statusCfg.label}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-1" align="start">
          {TODO_STATUSES.map(s => {
            const cfg = STATUS_CONFIG[s] ?? STATUS_CONFIG.open;
            return (
              <button
                key={s}
                onClick={() => { onUpdate('status', s); setStatusOpen(false); }}
                className={cn(
                  'w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-muted transition-colors',
                  todo.status === s && 'bg-muted font-medium',
                )}
              >
                <Circle className="h-2.5 w-2.5 fill-current" style={{ color: `hsl(var(--${s === 'done' ? 'primary' : 'muted-foreground'}))` }} />
                {cfg.label}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {/* Priority chip */}
      <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
        <PopoverTrigger asChild>
          <button className={cn(chipBase, priorityCfg.className)}>
            <span className={cn('h-2 w-2 rounded-full', priorityCfg.dotColor)} />
            {priorityCfg.label}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-36 p-1" align="start">
          {TODO_PRIORITIES.map(p => {
            const cfg = PRIORITY_CONFIG[p] ?? PRIORITY_CONFIG.medium;
            return (
              <button
                key={p}
                onClick={() => { onUpdate('priority', p); setPriorityOpen(false); }}
                className={cn(
                  'w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-muted transition-colors',
                  todo.priority === p && 'bg-muted font-medium',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', cfg.dotColor)} />
                {cfg.label}
              </button>
            );
          })}
        </PopoverContent>
      </Popover>

      {/* Assignee chip */}
      <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
        <PopoverTrigger asChild>
          <button className={cn(chipBase, 'border-border')}>
            <Avatar className="h-4 w-4">
              <AvatarFallback className="text-[8px] bg-muted">{initials(assigneeName)}</AvatarFallback>
            </Avatar>
            <span className="max-w-[100px] truncate">{assigneeName}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start">
          <button
            onClick={() => { onUpdate('assignedTo', null); setAssigneeOpen(false); }}
            className={cn(
              'w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-muted transition-colors',
              !todo.assignedTo && 'bg-muted font-medium',
            )}
          >
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            Unassigned
          </button>
          {profiles.map(p => (
            <button
              key={p.id}
              onClick={() => { onUpdate('assignedTo', p.id); setAssigneeOpen(false); }}
              className={cn(
                'w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-muted transition-colors',
                todo.assignedTo === p.id && 'bg-muted font-medium',
              )}
            >
              <Avatar className="h-4 w-4">
                <AvatarFallback className="text-[8px] bg-muted">{initials(p.display_name ?? p.username)}</AvatarFallback>
              </Avatar>
              {p.display_name ?? p.username ?? 'Unknown'}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Due date chip */}
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <button className={cn(chipBase, 'border-border')}>
            <CalendarIcon className="h-3 w-3" />
            {todo.dueAt ? format(parseISO(todo.dueAt), 'MMM d, yyyy') : 'No date'}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={todo.dueAt ? parseISO(todo.dueAt) : undefined}
            onSelect={(date: Date | undefined) => {
              onUpdate('dueAt', date ? new Date(date.setHours(23, 59, 59, 999)).toISOString() : null);
              setDateOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>

      {/* Entity link chip */}
      {todo.contextPath ? (
        <button
          className={cn(chipBase, 'border-primary/30 bg-primary/10 text-primary')}
          onClick={onNavigateToLink}
        >
          <Link2 className="h-3 w-3" />
          <span className="max-w-[150px] truncate">{contextLabel}</span>
          <span
            role="button"
            className="ml-0.5 hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onClearLink?.(); }}
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      ) : onOpenLinkPicker ? (
        <button
          className={cn(chipBase, 'border-dashed border-border text-muted-foreground')}
          onClick={onOpenLinkPicker}
        >
          <Plus className="h-3 w-3" />
          Link
        </button>
      ) : null}

      {/* Saving indicator */}
      {saving && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </span>
      )}
    </div>
  );
}

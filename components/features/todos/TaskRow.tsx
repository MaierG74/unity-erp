// components/features/todos/TaskRow.tsx
'use client';

import { isBefore, parseISO, isToday } from 'date-fns';
import { formatDateShort } from '@/lib/date-utils';
import { Link2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useUpdateTodo } from '@/hooks/useTodosApi';
import { PRIORITY_CONFIG, initials, getContextLabel } from '@/components/features/todos/task-utils';
import type { TodoItem } from '@/lib/db/todos';

interface TaskRowProps {
  todo: TodoItem;
  isActive: boolean;
  isFocused: boolean;
  onSelect: (id: string) => void;
}

export function TaskRow({ todo, isActive, isFocused, onSelect }: TaskRowProps) {
  const updateMutation = useUpdateTodo(todo.id);
  const isDone = todo.status === 'done' || todo.status === 'archived';

  const overdue = (() => {
    if (!todo.dueAt || isDone) return false;
    try { return isBefore(parseISO(todo.dueAt), new Date()) && !isToday(parseISO(todo.dueAt)); }
    catch { return false; }
  })();

  const toggleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = isDone ? 'open' as const : 'done' as const;
    updateMutation.mutate({ status: newStatus });
  };

  const dueLabel = todo.dueAt
    ? formatDateShort(todo.dueAt)
    : null;

  const contextLabel = getContextLabel(todo);

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onSelect(todo.id)}
      className={cn(
        'flex items-center gap-3 px-3 py-2 border-b border-border/40 cursor-pointer transition-all select-none',
        'hover:bg-muted/30',
        isActive && 'bg-primary/10 border-l-2 border-l-primary',
        isFocused && !isActive && 'bg-muted/20',
        isDone && 'opacity-50',
      )}
    >
      {/* Checkbox */}
      <div onClick={toggleComplete} className="flex-shrink-0">
        <Checkbox checked={isDone} className="h-4 w-4" />
      </div>

      {/* Title */}
      <span className={cn(
        'flex-1 text-sm font-medium truncate min-w-0',
        isDone && 'line-through text-muted-foreground',
      )}>
        {todo.title}
      </span>

      {/* Priority dot */}
      <span
        className={cn('h-2 w-2 rounded-full flex-shrink-0', PRIORITY_CONFIG[todo.priority]?.dotColor ?? PRIORITY_CONFIG.medium.dotColor)}
        title={todo.priority}
      />

      {/* Assignee */}
      {todo.assignee && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-[9px] bg-muted">
              {initials(todo.assignee.username)}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground truncate max-w-[80px] hidden sm:inline">
            {todo.assignee.username}
          </span>
        </div>
      )}

      {/* Due date */}
      {dueLabel && (
        <span className={cn(
          'text-xs flex-shrink-0 tabular-nums',
          overdue ? 'text-red-500 font-medium' : 'text-muted-foreground',
        )}>
          {dueLabel}
        </span>
      )}

      {/* Entity link icon */}
      {todo.contextPath && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">{contextLabel}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

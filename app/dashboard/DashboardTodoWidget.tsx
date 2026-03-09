'use client';

import Link from 'next/link';
import { formatDistanceToNowStrict, isPast, parseISO } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { fetchTodoList } from '@/lib/client/todos';
import type { TodoItem } from '@/lib/db/todos';

function isOverdue(todo: TodoItem) {
  if (!todo.dueAt) return false;
  if (todo.status === 'done' || todo.status === 'archived') return false;
  return isPast(parseISO(todo.dueAt));
}

function priorityBorder(priority: TodoItem['priority']) {
  switch (priority) {
    case 'urgent':
    case 'high':
      return 'border-l-2 border-l-destructive';
    case 'medium':
      return 'border-l-2 border-l-warning';
    case 'low':
      return 'border-l-2 border-l-success';
    default:
      return '';
  }
}

export function DashboardTodoWidget() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'todos', 'assigned'],
    queryFn: async () =>
      fetchTodoList({
        scope: 'assigned',
        includeCompleted: false,
        limit: 6,
      }),
  });

  const todos = (data?.todos ?? []).filter(
    (todo) => todo.status !== 'done' && todo.status !== 'archived'
  );

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">My Tasks</h3>
        <Link
          href="/todos"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open Inbox <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="divide-y">
        {isLoading ? (
          <>
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-3">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-3 w-28 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </>
        ) : error ? (
          <div className="p-4 text-sm text-destructive">
            Failed to load assigned tasks.
          </div>
        ) : todos.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No assigned tasks are currently open.
          </div>
        ) : (
          todos.slice(0, 5).map((todo) => {
            const overdue = isOverdue(todo);
            const dueLabel = todo.dueAt
              ? overdue
                ? `Overdue by ${formatDistanceToNowStrict(parseISO(todo.dueAt))}`
                : `Due in ${formatDistanceToNowStrict(parseISO(todo.dueAt))}`
              : null;

            return (
              <Link
                key={todo.id}
                href={`/todos/${todo.id}`}
                className={`block px-4 py-2.5 transition-colors hover:bg-accent/40 ${priorityBorder(todo.priority)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{todo.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {overdue ? (
                        <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                          Overdue
                        </Badge>
                      ) : null}
                      <span className={`text-xs ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {dueLabel ?? (
                          <span className="italic text-muted-foreground/60">No due date</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant={
                      todo.priority === 'urgent' || todo.priority === 'high'
                        ? 'destructive'
                        : 'secondary'
                    }
                    className="shrink-0 text-[10px]"
                  >
                    {todo.priority}
                  </Badge>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

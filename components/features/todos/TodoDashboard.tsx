'use client';

import { useEffect, useMemo, useState } from 'react';
import { isBefore, parseISO } from 'date-fns';
import { CheckCircle2, Clock, Loader2, Plus, Search, Users as UsersIcon } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/date-utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { TODO_PRIORITIES, TODO_STATUSES, type TodoItem } from '@/lib/db/todos';
import { useTodoList, useCreateTodo } from '@/hooks/useTodosApi';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/components/common/auth-provider';

import { TodoCreateDialog } from './TodoCreateDialog';
import { TodoDetailDialog } from './TodoDetailDialog';

type Scope = 'assigned' | 'created' | 'watching' | 'all';
type StatusFilter = 'all' | typeof TODO_STATUSES[number];

const scopeOptions: { value: Scope; label: string }[] = [
  { value: 'assigned', label: 'Assigned to me' },
  { value: 'created', label: 'Created by me' },
  { value: 'watching', label: 'Watching' },
  { value: 'all', label: 'All visibility' },
];

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  ...TODO_STATUSES.map(status => ({ value: status, label: status.replace(/_/g, ' ') })),
];

function statusBadge(status: string) {
  const normalized = status.toLowerCase();

  const statusConfig = {
    done: {
      variant: 'success' as const,
      label: 'Done',
      icon: <CheckCircle2 className="h-3 w-3" />
    },
    blocked: {
      variant: 'destructive' as const,
      label: 'Blocked',
      icon: <span className="text-xs">🚫</span>
    },
    in_progress: {
      variant: 'secondary' as const,
      label: 'In Progress',
      icon: <Loader2 className="h-3 w-3 animate-spin" />
    },
    archived: {
      variant: 'outline' as const,
      label: 'Archived',
      icon: <span className="text-xs">📦</span>
    },
    open: {
      variant: 'outline' as const,
      label: 'Open',
      icon: <span className="text-xs">⚪</span>
    }
  };

  const config = statusConfig[normalized as keyof typeof statusConfig] || statusConfig.open;

  return (
    <Badge variant={config.variant} className="inline-flex items-center gap-1.5 font-medium">
      {config.icon}
      {config.label}
    </Badge>
  );
}

function priorityBadge(priority: string) {
  const normalized = priority.toLowerCase();

  const priorityConfig = {
    urgent: {
      variant: 'destructive' as const,
      label: 'Urgent',
      className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
    },
    high: {
      variant: 'secondary' as const,
      label: 'High',
      className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200'
    },
    medium: {
      variant: 'outline' as const,
      label: 'Medium',
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
    },
    low: {
      variant: 'outline' as const,
      label: 'Low',
      className: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
    }
  };

  const config = priorityConfig[normalized as keyof typeof priorityConfig] || priorityConfig.medium;

  return (
    <Badge variant={config.variant} className={`font-medium ${config.className}`}>
      {config.label}
    </Badge>
  );
}

function formatDueDate(dueAt: string | null) {
  if (!dueAt) return 'No due date';
  return formatDate(dueAt);
}

function isOverdue(todo: TodoItem) {
  if (!todo.dueAt) return false;
  if (todo.status === 'done' || todo.status === 'archived') return false;
  try {
    return isBefore(parseISO(todo.dueAt), new Date());
  } catch {
    return false;
  }
}

function initials(name?: string | null) {
  if (!name) return '?';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function TodoDashboard() {
  const [scope, setScope] = useState<Scope>('assigned');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickTaskTitle, setQuickTaskTitle] = useState('');
  const debouncedSearch = useDebounce(searchInput, 250);
  const { toast } = useToast();
  const { user } = useAuth();
  const createMutation = useCreateTodo();

  const filters = useMemo(
    () => ({
      scope,
      status: status !== 'all' ? status : undefined,
      includeCompleted,
      search: debouncedSearch || undefined,
    }),
    [scope, status, includeCompleted, debouncedSearch]
  );

  const { data, isLoading, error, refetch } = useTodoList(filters);

  useEffect(() => {
    if (error) {
      toast({
        title: 'Failed to load tasks',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  const todos = data?.todos ?? [];

  const handleQuickCreate = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && quickTaskTitle.trim()) {
      try {
        await createMutation.mutateAsync({
          title: quickTaskTitle.trim(),
          priority: 'medium',
          assignedTo: user?.id,
        });
        setQuickTaskTitle('');
        toast({ title: 'Task created' });
        refetch();
      } catch (error) {
        console.error('Failed to create task', error);
        toast({
          title: 'Failed to create task',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    } else if (e.key === 'Escape') {
      setQuickTaskTitle('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">To-Do Dashboard</h1>
          <p className="text-muted-foreground">Assign, track, and close out cross-team tasks.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Task
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs value={scope} onValueChange={value => setScope(value as Scope)}>
              <TabsList>
                {scopeOptions.map(option => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center md:justify-end">
              <div className="relative md:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={event => setSearchInput(event.target.value)}
                  placeholder="Search title, description, link..."
                  className="pl-9"
                />
              </div>

              <Select value={status} onValueChange={value => setStatus(value as StatusFilter)}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={includeCompleted ? 'with-completed' : 'active-only'}
                onValueChange={value => setIncludeCompleted(value === 'with-completed')}
              >
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active-only">Active only</SelectItem>
                  <SelectItem value="with-completed">Include done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center space-x-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load tasks. <button className="underline" onClick={() => refetch()}>Try again</button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead className="hidden md:table-cell">Assignee</TableHead>
                  <TableHead className="hidden xl:table-cell">Priority</TableHead>
                  <TableHead className="hidden lg:table-cell">Due</TableHead>
                  <TableHead className="hidden xl:table-cell">Watchers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Quick Add Row */}
                <TableRow className="bg-muted/30 hover:bg-muted/50">
                  <TableCell colSpan={6} className="py-3">
                    <div className="flex items-center gap-3">
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <Input
                        value={quickTaskTitle}
                        onChange={(e) => setQuickTaskTitle(e.target.value)}
                        onKeyDown={handleQuickCreate}
                        placeholder="Quick add task (press Enter to save, Esc to cancel)"
                        className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                    </div>
                  </TableCell>
                </TableRow>

                {todos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-16 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-4xl">📋</div>
                        <p className="text-lg font-medium">No tasks yet</p>
                        <p className="text-sm">Create one to get started</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  todos.map(todo => {
                    const priorityColor = {
                      high: 'border-l-red-500',
                      medium: 'border-l-orange-500',
                      low: 'border-l-gray-400'
                    }[todo.priority] || 'border-l-gray-400';

                    return (
                      <TableRow
                        key={todo.id}
                        className={`border-l-4 ${priorityColor} transition-all hover:bg-muted/70 hover:shadow-sm`}
                      >
                        <TableCell className="py-5">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                // Toggle between open and done
                                const newStatus = todo.status === 'done' ? 'open' : 'done';
                                // Call update mutation
                                fetch(`/api/todos/${todo.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: newStatus }),
                                })
                                  .then(() => refetch())
                                  .catch(err => {
                                    console.error('Failed to update status', err);
                                    toast({
                                      title: 'Failed to update status',
                                      description: 'Please try again',
                                      variant: 'destructive',
                                    });
                                  });
                              }}
                              className={cn(
                                "group relative h-5 w-5 rounded-md border-2 transition-all duration-200 flex items-center justify-center",
                                todo.status === 'done'
                                  ? "bg-primary border-primary"
                                  : "border-muted-foreground/30 hover:border-primary/50"
                              )}
                            >
                              {todo.status === 'done' && (
                                <svg
                                  className="h-3.5 w-3.5 text-primary-foreground"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={3}
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                            <div className="cursor-pointer" onClick={() => setSelectedId(todo.id)}>
                              {statusBadge(todo.status)}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-5 cursor-pointer" onClick={() => setSelectedId(todo.id)}>
                          <div className="space-y-2">
                            <div className="font-semibold text-base leading-tight text-foreground">{todo.title}</div>
                            {todo.description ? (
                              <p className="text-sm text-muted-foreground line-clamp-2">{todo.description}</p>
                            ) : null}
                            {todo.contextPath ? (
                              <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                {todo.contextPath}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell py-5 cursor-pointer" onClick={() => setSelectedId(todo.id)}>
                          {todo.assignee ? (
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 ring-2 ring-background">
                                {todo.assignee?.avatarUrl ? (
                                  <AvatarImage src={todo.assignee.avatarUrl} alt={todo.assignee.username ?? 'Assignee'} />
                                ) : null}
                                <AvatarFallback className="text-sm font-semibold">{initials(todo.assignee?.username)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="text-sm font-medium">{todo.assignee?.username ?? 'Assigned'}</div>
                                <p className="text-xs text-muted-foreground">Owner</p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell py-5 cursor-pointer" onClick={() => setSelectedId(todo.id)}>{priorityBadge(todo.priority)}</TableCell>
                        <TableCell className="hidden lg:table-cell py-5 cursor-pointer" onClick={() => setSelectedId(todo.id)}>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span className={isOverdue(todo) ? 'text-destructive font-semibold' : 'text-sm'}>{formatDueDate(todo.dueAt)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell py-5 cursor-pointer" onClick={() => setSelectedId(todo.id)}>
                          <div className="flex -space-x-2">
                            {todo.watchers.slice(0, 5).map(watcher => (
                              <Avatar key={watcher.userId} className="h-9 w-9 border-2 border-background ring-1 ring-gray-200 dark:ring-gray-700">
                                {watcher.profile?.avatarUrl ? (
                                  <AvatarImage src={watcher.profile.avatarUrl} alt={watcher.profile.username ?? 'Watcher'} />
                                ) : null}
                              <AvatarFallback>{initials(watcher.profile?.username)}</AvatarFallback>
                            </Avatar>
                          ))}
                          {todo.watchers.length > 5 ? (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium ring-1 ring-gray-200 dark:ring-gray-700">
                              +{todo.watchers.length - 5}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <TodoCreateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <TodoDetailDialog
        todoId={selectedId}
        open={Boolean(selectedId)}
        onOpenChange={open => {
          if (!open) setSelectedId(null);
        }}
      />
    </div>
  );
}

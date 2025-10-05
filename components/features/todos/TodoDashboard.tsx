'use client';

import { useEffect, useMemo, useState } from 'react';
import { format, isBefore, parseISO } from 'date-fns';
import { CheckCircle, Clock, Loader2, Plus, Search, Users as UsersIcon } from 'lucide-react';

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

import { TODO_PRIORITIES, TODO_STATUSES, type TodoItem } from '@/lib/db/todos';
import { useTodoList } from '@/hooks/useTodosApi';
import { useDebounce } from '@/hooks/use-debounce';

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
  switch (normalized) {
    case 'done':
      return <Badge variant="success">Done</Badge>;
    case 'blocked':
      return <Badge variant="destructive">Blocked</Badge>;
    case 'in_progress':
      return <Badge variant="secondary">In Progress</Badge>;
    case 'archived':
      return <Badge variant="outline">Archived</Badge>;
    default:
      return <Badge variant="outline">Open</Badge>;
  }
}

function priorityBadge(priority: string) {
  const normalized = priority.toLowerCase();
  switch (normalized) {
    case 'urgent':
      return <Badge variant="destructive">Urgent</Badge>;
    case 'high':
      return <Badge variant="secondary">High</Badge>;
    case 'low':
      return <Badge variant="outline">Low</Badge>;
    default:
      return <Badge variant="outline">Medium</Badge>;
  }
}

function formatDueDate(dueAt: string | null) {
  if (!dueAt) return 'No due date';
  try {
    const date = parseISO(dueAt);
    return format(date, 'PP');
  } catch {
    return dueAt;
  }
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
  const debouncedSearch = useDebounce(searchInput, 250);
  const { toast } = useToast();

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
                {todos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No tasks yet. Create one to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  todos.map(todo => (
                    <TableRow
                      key={todo.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedId(todo.id)}
                    >
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          {statusBadge(todo.status)}
                          <span className="text-xs text-muted-foreground">
                            {todo.updatedAt ? `Updated ${format(parseISO(todo.updatedAt), 'PPpp')}` : ''}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium leading-tight text-foreground">{todo.title}</div>
                          {todo.description ? (
                            <p className="text-sm text-muted-foreground line-clamp-2">{todo.description}</p>
                          ) : null}
                          {todo.contextPath ? (
                            <p className="text-xs text-blue-600">{todo.contextPath}</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {todo.assignee ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              {todo.assignee?.avatarUrl ? (
                                <AvatarImage src={todo.assignee.avatarUrl} alt={todo.assignee.username ?? 'Assignee'} />
                              ) : null}
                              <AvatarFallback>{initials(todo.assignee?.username)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="text-sm font-medium">{todo.assignee?.username ?? 'Assigned'}</div>
                              <p className="text-xs text-muted-foreground">Owner</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">{priorityBadge(todo.priority)}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className={isOverdue(todo) ? 'text-destructive font-medium' : ''}>{formatDueDate(todo.dueAt)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex -space-x-2">
                          {todo.watchers.slice(0, 5).map(watcher => (
                            <Avatar key={watcher.userId} className="h-8 w-8 border-2 border-background">
                              {watcher.profile?.avatarUrl ? (
                                <AvatarImage src={watcher.profile.avatarUrl} alt={watcher.profile.username ?? 'Watcher'} />
                              ) : null}
                              <AvatarFallback>{initials(watcher.profile?.username)}</AvatarFallback>
                            </Avatar>
                          ))}
                          {todo.watchers.length > 5 ? (
                            <span className="ml-2 text-xs text-muted-foreground">+{todo.watchers.length - 5}</span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
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

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isBefore, parseISO, format } from 'date-fns';
import { CheckCircle2, Clock, Loader2, Plus, Search, AlertCircle, Circle, Flag, CalendarIcon, User, MoreVertical, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/date-utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { TODO_PRIORITIES, TODO_STATUSES, type TodoItem } from '@/lib/db/todos';
import { useTodoList, useCreateTodo, useUpdateTodo } from '@/hooks/useTodosApi';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/components/common/auth-provider';
import { useProfiles } from '@/hooks/useProfiles';

import { TodoCreateDialog } from './TodoCreateDialog';

type Scope = 'assigned' | 'created' | 'watching' | 'all';
type StatusFilter = 'all' | typeof TODO_STATUSES[number];
type SortBy = 'dueDate' | 'priority' | 'status' | 'assignee';

const scopeOptions: { value: Scope; label: string }[] = [
  { value: 'assigned', label: 'Assigned to me' },
  { value: 'created', label: 'Created by me' },
  { value: 'watching', label: 'Watching' },
  { value: 'all', label: 'All tasks' },
];

function statusBadgeConfig(status: string) {
  const normalized = status.toLowerCase();

  const configs = {
    done: {
      variant: 'default' as const,
      label: 'Done',
      className: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200 border-green-200 dark:border-green-800',
      icon: CheckCircle2,
    },
    blocked: {
      variant: 'destructive' as const,
      label: 'Blocked',
      className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border-red-200 dark:border-red-800',
      icon: AlertCircle,
    },
    in_progress: {
      variant: 'secondary' as const,
      label: 'In Progress',
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border-blue-200 dark:border-blue-800',
      icon: Loader2,
    },
    archived: {
      variant: 'outline' as const,
      label: 'Archived',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700',
      icon: Circle,
    },
    open: {
      variant: 'outline' as const,
      label: 'Open',
      className: 'bg-gray-50 text-gray-700 dark:bg-gray-900 dark:text-gray-300 border-gray-200 dark:border-gray-700',
      icon: Circle,
    }
  };

  return configs[normalized as keyof typeof configs] || configs.open;
}

function priorityConfig(priority: string) {
  const normalized = priority.toLowerCase();

  const configs = {
    urgent: {
      label: 'Urgent',
      className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border-red-300',
      dotColor: 'bg-red-500',
      icon: '🔥'
    },
    high: {
      label: 'High',
      className: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200 border-orange-300',
      dotColor: 'bg-orange-500',
      icon: '⬆️'
    },
    medium: {
      label: 'Medium',
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border-blue-300',
      dotColor: 'bg-blue-500',
      icon: '➡️'
    },
    low: {
      label: 'Low',
      className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-300',
      dotColor: 'bg-gray-400',
      icon: '⬇️'
    }
  };

  return configs[normalized as keyof typeof configs] || configs.medium;
}

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
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

export function TodoDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [scope, setScope] = useState<Scope>('assigned');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('dueDate');
  const [createOpen, setCreateOpen] = useState(false);

  // Quick add state
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDueDate, setQuickDueDate] = useState<Date | null>(null);
  const [quickPriority, setQuickPriority] = useState<string>('medium');
  const [quickAssignee, setQuickAssignee] = useState<string | null>(user?.id ?? null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const debouncedSearch = useDebounce(searchInput, 250);
  const { toast } = useToast();
  const createMutation = useCreateTodo();
  const profilesQuery = useProfiles();
  const profiles = profilesQuery.data ?? [];

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

  // Sort todos
  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => {
      switch (sortBy) {
        case 'dueDate':
          if (!a.dueAt) return 1;
          if (!b.dueAt) return -1;
          return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
        case 'priority':
          const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
          return (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 2) - (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 2);
        case 'status':
          return a.status.localeCompare(b.status);
        case 'assignee':
          return (a.assignee?.username ?? '').localeCompare(b.assignee?.username ?? '');
        default:
          return 0;
      }
    });
  }, [todos, sortBy]);

  // Quick add task
  const handleQuickAdd = async () => {
    if (!quickTitle.trim()) return;

    try {
      await createMutation.mutateAsync({
        title: quickTitle.trim(),
        description: null,
        priority: quickPriority as any,
        status: 'open',
        dueAt: quickDueDate?.toISOString() ?? null,
        assignedTo: quickAssignee === '__unassigned__' ? null : quickAssignee,
        watchers: [],
        contextPath: null,
        contextType: null,
        contextId: null,
      });

      // Clear form
      setQuickTitle('');
      setQuickDueDate(null);
      setQuickPriority('medium');
      setQuickAssignee(user?.id ?? null);

      toast({ title: 'Task created successfully' });
    } catch (err) {
      console.error('Failed to create task:', err);
      toast({
        title: 'Failed to create task',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-6xl mx-auto px-4 py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage and track your team's work</p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            size="lg"
            className="shadow-sm"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Task
          </Button>
        </div>

        {/* Quick Add Bar */}
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Add new task..."
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && quickTitle.trim()) {
                    handleQuickAdd();
                  }
                }}
                className="flex-1 min-w-[200px] text-sm h-9"
              />

              {/* Date Picker */}
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 text-xs">
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {quickDueDate ? format(quickDueDate, 'MMM d') : 'Due date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={quickDueDate ?? undefined}
                    onSelect={(date) => {
                      setQuickDueDate(date ?? null);
                      setDatePickerOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* Priority Select */}
              <Select value={quickPriority} onValueChange={setQuickPriority}>
                <SelectTrigger className="h-9 w-[110px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TODO_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      <Badge variant="outline" className={cn('text-xs', priorityConfig(p).className)}>
                        {p}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Assignee Select */}
              <Select
                value={quickAssignee ?? '__unassigned__'}
                onValueChange={(value) => setQuickAssignee(value === '__unassigned__' ? null : value)}
              >
                <SelectTrigger className="h-9 w-[140px] text-xs">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__" className="text-xs">Unassigned</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.username ?? p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                size="sm"
                onClick={handleQuickAdd}
                disabled={!quickTitle.trim() || createMutation.isPending}
                className="h-9"
              >
                {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Filters & Sort */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Scope Filters */}
          <div className="flex flex-wrap gap-2">
            {scopeOptions.map(option => (
              <Button
                key={option.value}
                variant={scope === option.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setScope(option.value)}
                className="rounded-full h-8 text-xs"
              >
                {option.label}
              </Button>
            ))}
          </div>

          {/* Sort & Active Filter */}
          <div className="flex items-center gap-2">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dueDate" className="text-xs">Sort by: Due date</SelectItem>
                <SelectItem value="priority" className="text-xs">Sort by: Priority</SelectItem>
                <SelectItem value="status" className="text-xs">Sort by: Status</SelectItem>
                <SelectItem value="assignee" className="text-xs">Sort by: Assignee</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant={includeCompleted ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIncludeCompleted(!includeCompleted)}
              className="h-8 text-xs rounded-full"
            >
              {includeCompleted ? 'All' : 'Active Only'}
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="Search tasks by title or description..."
            className="pl-10 h-9 text-sm"
          />
        </div>

        {/* Task Cards */}
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-3 space-y-2">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-4/5" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : sortedTodos.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12">
              <div className="text-center space-y-3">
                <div className="text-5xl">📋</div>
                <div>
                  <h3 className="text-base font-semibold">No tasks found</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {searchInput ? 'Try adjusting your search or filters' : 'Create your first task to get started'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sortedTodos.map(todo => (
              <TaskCard key={todo.id} todo={todo} profiles={profiles} onNavigate={() => router.push(`/todos/${todo.id}`)} />
            ))}
          </div>
        )}
      </div>

      <TodoCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// Task Card Component
function TaskCard({ todo, profiles, onNavigate }: { todo: TodoItem; profiles: any[]; onNavigate: () => void }) {
  const updateMutation = useUpdateTodo(todo.id);
  const { toast } = useToast();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const prioConfig = priorityConfig(todo.priority);
  const overdue = isOverdue(todo);

  const toggleStatus = async (checked: boolean) => {
    try {
      await updateMutation.mutateAsync({
        status: checked ? 'done' : 'open',
      } as any);
    } catch (err) {
      toast({ title: 'Failed to update status', variant: 'destructive' });
    }
  };

  const updateDueDate = async (date: Date | undefined) => {
    try {
      await updateMutation.mutateAsync({
        dueAt: date?.toISOString() ?? null,
      } as any);
      setDatePickerOpen(false);
    } catch (err) {
      toast({ title: 'Failed to update date', variant: 'destructive' });
    }
  };

  const updateAssignee = async (assigneeId: string) => {
    try {
      await updateMutation.mutateAsync({
        assignedTo: assigneeId === '__unassigned__' ? null : assigneeId,
      } as any);
    } catch (err) {
      toast({ title: 'Failed to update assignee', variant: 'destructive' });
    }
  };

  const confirmArchive = async () => {
    try {
      await updateMutation.mutateAsync({
        status: 'archived',
      } as any);
      toast({ title: 'Task archived successfully' });
      setArchiveDialogOpen(false);
    } catch (err) {
      toast({ title: 'Failed to archive task', variant: 'destructive' });
    }
  };

  return (
    <Card className="p-3 text-sm flex flex-col gap-1 hover:bg-muted/50 transition group">
      {/* Title & Actions Row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <Checkbox
            checked={todo.status === 'done'}
            onCheckedChange={toggleStatus}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0 cursor-pointer" onClick={onNavigate}>
            <p className="font-medium leading-tight truncate">{todo.title}</p>
          </div>
          <Badge variant="outline" className={cn('text-xs flex-shrink-0', prioConfig.className)}>
            {prioConfig.label}
          </Badge>
        </div>

        {/* Inline Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {/* Date Picker */}
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <CalendarIcon className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={todo.dueAt ? parseISO(todo.dueAt) : undefined}
                onSelect={updateDueDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          {/* Assignee Selector */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7">
                <User className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="end">
              <div className="space-y-1">
                <button
                  onClick={() => updateAssignee('__unassigned__')}
                  className={cn(
                    "w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors",
                    (!todo.assignedTo) && "bg-muted font-medium"
                  )}
                >
                  Unassigned
                </button>
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => updateAssignee(p.id)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors",
                      (todo.assignedTo === p.id) && "bg-muted font-medium"
                    )}
                  >
                    {p.username ?? p.email}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Archive Button */}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={(e) => {
              e.stopPropagation();
              setArchiveDialogOpen(true);
            }}
            title="Archive task"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Description */}
      {todo.description && (
        <p className="text-muted-foreground text-xs truncate leading-tight pl-6">{todo.description}</p>
      )}

      {/* Footer: Assignee & Due Date */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground pl-6 mt-1">
        {todo.assignee && (
          <>
            <Avatar className="h-4 w-4">
              {todo.assignee.avatarUrl && <AvatarImage src={todo.assignee.avatarUrl} />}
              <AvatarFallback className="text-[8px]">{initials(todo.assignee.username)}</AvatarFallback>
            </Avatar>
            <span className="truncate max-w-[100px]">{todo.assignee.username ?? 'Assigned'}</span>
            <span>•</span>
          </>
        )}
        <span className={cn(overdue && 'text-red-600 font-medium')}>
          {todo.dueAt ? format(parseISO(todo.dueAt), 'dd/MM/yyyy') : 'No due date'}
        </span>
      </div>

      {/* Archive Confirmation Dialog */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive "{todo.title}". You can restore it later from archived tasks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

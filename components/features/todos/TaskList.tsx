// components/features/todos/TaskList.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  isBefore,
  parseISO,
  isToday,
  addDays,
  startOfDay,
} from 'date-fns';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { useTodoList, useCreateTodo, useUpdateTodo } from '@/hooks/useTodosApi';
import { useDebounce } from '@/hooks/use-debounce';
import { useTaskKeyboard } from '@/hooks/useTaskKeyboard';
import { TaskRow } from '@/components/features/todos/TaskRow';
import { TaskSidePanel } from '@/components/features/todos/TaskSidePanel';
import { TaskQuickCreate } from '@/components/features/todos/TaskQuickCreate';

import type { TodoItem, TodoPriority } from '@/lib/db/todos';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Scope = 'assigned' | 'created' | 'watching' | 'all';
type GroupBy = 'dueDate' | 'priority' | 'assignee' | 'status' | 'none';
type SortBy = 'priority' | 'dueDate' | 'status';
type UrlSyncMode = 'push' | 'replace';

interface TodoGroup {
  key: string;
  label: string;
  todos: TodoItem[];
}

interface TodoUrlState {
  scope: Scope;
  search: string;
  groupBy: GroupBy;
  sortBy: SortBy;
  includeCompleted: boolean;
  taskId: string | null;
}

// ---------------------------------------------------------------------------
// Scope pill config
// ---------------------------------------------------------------------------

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'assigned', label: 'Assigned to me' },
  { value: 'created', label: 'Created by me' },
  { value: 'watching', label: 'Watching' },
  { value: 'all', label: 'All tasks' },
];

// ---------------------------------------------------------------------------
// Priority ordering (urgent first)
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<TodoPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const STATUS_ORDER: Record<string, number> = {
  open: 0,
  in_progress: 1,
  blocked: 2,
  done: 3,
  archived: 4,
};

const DEFAULT_SCOPE: Scope = 'assigned';
const DEFAULT_GROUP_BY: GroupBy = 'dueDate';
const DEFAULT_SORT_BY: SortBy = 'priority';

function isScope(value: string | null): value is Scope {
  return value === 'assigned' || value === 'created' || value === 'watching' || value === 'all';
}

function isGroupBy(value: string | null): value is GroupBy {
  return value === 'dueDate' || value === 'priority' || value === 'assignee' || value === 'status' || value === 'none';
}

function isSortBy(value: string | null): value is SortBy {
  return value === 'priority' || value === 'dueDate' || value === 'status';
}

function parseBooleanParam(value: string | null): boolean {
  return value === '1' || value === 'true';
}

function parseTodoUrlState(searchParamsString: string): TodoUrlState {
  const params = new URLSearchParams(searchParamsString);

  return {
    scope: isScope(params.get('scope')) ? params.get('scope')! : DEFAULT_SCOPE,
    search: params.get('q') ?? '',
    groupBy: isGroupBy(params.get('groupBy')) ? params.get('groupBy')! : DEFAULT_GROUP_BY,
    sortBy: isSortBy(params.get('sortBy')) ? params.get('sortBy')! : DEFAULT_SORT_BY,
    includeCompleted: parseBooleanParam(params.get('includeCompleted')),
    taskId: params.get('task')?.trim() || null,
  };
}

function applyTodoUrlState(
  params: URLSearchParams,
  state: Partial<Omit<TodoUrlState, 'taskId'>> & { taskId?: string | null },
) {
  if (state.scope !== undefined) {
    if (state.scope !== DEFAULT_SCOPE) params.set('scope', state.scope);
    else params.delete('scope');
  }

  if (state.search !== undefined) {
    const search = state.search.trim();
    if (search) params.set('q', search);
    else params.delete('q');
  }

  if (state.groupBy !== undefined) {
    if (state.groupBy !== DEFAULT_GROUP_BY) params.set('groupBy', state.groupBy);
    else params.delete('groupBy');
  }

  if (state.sortBy !== undefined) {
    if (state.sortBy !== DEFAULT_SORT_BY) params.set('sortBy', state.sortBy);
    else params.delete('sortBy');
  }

  if (state.includeCompleted !== undefined) {
    if (state.includeCompleted) params.set('includeCompleted', '1');
    else params.delete('includeCompleted');
  }

  if (state.taskId !== undefined) {
    const taskId = state.taskId?.trim();
    if (taskId) params.set('task', taskId);
    else params.delete('task');
  }
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

export function groupTodos(todos: TodoItem[], groupBy: GroupBy): TodoGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'All Tasks', todos }];
  }

  if (groupBy === 'dueDate') {
    const now = startOfDay(new Date());
    const weekEnd = addDays(now, 7);

    const buckets: Record<string, TodoItem[]> = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
      noDueDate: [],
    };

    for (const t of todos) {
      if (!t.dueAt) {
        buckets.noDueDate.push(t);
      } else {
        try {
          const d = parseISO(t.dueAt);
          const isDone = t.status === 'done' || t.status === 'archived';
          if (isToday(d)) {
            buckets.today.push(t);
          } else if (isBefore(d, now) && !isDone) {
            buckets.overdue.push(t);
          } else if (isBefore(d, weekEnd)) {
            buckets.thisWeek.push(t);
          } else {
            buckets.later.push(t);
          }
        } catch {
          buckets.noDueDate.push(t);
        }
      }
    }

    const groups: TodoGroup[] = [];
    if (buckets.overdue.length) groups.push({ key: 'overdue', label: 'Overdue', todos: buckets.overdue });
    if (buckets.today.length) groups.push({ key: 'today', label: 'Today', todos: buckets.today });
    if (buckets.thisWeek.length) groups.push({ key: 'thisWeek', label: 'This Week', todos: buckets.thisWeek });
    if (buckets.later.length) groups.push({ key: 'later', label: 'Later', todos: buckets.later });
    if (buckets.noDueDate.length) groups.push({ key: 'noDueDate', label: 'No Due Date', todos: buckets.noDueDate });
    return groups;
  }

  if (groupBy === 'priority') {
    const order: TodoPriority[] = ['urgent', 'high', 'medium', 'low'];
    const labels: Record<TodoPriority, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
    const map = new Map<TodoPriority, TodoItem[]>();
    for (const p of order) map.set(p, []);
    for (const t of todos) {
      const bucket = map.get(t.priority) ?? map.get('medium')!;
      bucket.push(t);
    }
    return order
      .filter(p => (map.get(p) ?? []).length > 0)
      .map(p => ({ key: p, label: labels[p], todos: map.get(p)! }));
  }

  if (groupBy === 'assignee') {
    const map = new Map<string, { label: string; todos: TodoItem[] }>();
    const unassigned: TodoItem[] = [];
    for (const t of todos) {
      const name = t.assignee?.username;
      if (!name) {
        unassigned.push(t);
        continue;
      }
      if (!map.has(name)) map.set(name, { label: name, todos: [] });
      map.get(name)!.todos.push(t);
    }
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const groups: TodoGroup[] = sorted.map(([key, val]) => ({ key, label: val.label, todos: val.todos }));
    if (unassigned.length) groups.push({ key: 'unassigned', label: 'Unassigned', todos: unassigned });
    return groups;
  }

  if (groupBy === 'status') {
    const order = ['open', 'in_progress', 'blocked', 'done'] as const;
    const labels: Record<string, string> = { open: 'Open', in_progress: 'In Progress', blocked: 'Blocked', done: 'Done' };
    const map = new Map<string, TodoItem[]>();
    for (const s of order) map.set(s, []);
    for (const t of todos) {
      const key = t.status === 'archived' ? 'done' : t.status;
      const bucket = map.get(key) ?? map.get('open')!;
      bucket.push(t);
    }
    return order
      .filter(s => (map.get(s) ?? []).length > 0)
      .map(s => ({ key: s, label: labels[s], todos: map.get(s)! }));
  }

  return [{ key: 'all', label: 'All Tasks', todos }];
}

// ---------------------------------------------------------------------------
// Sort within groups
// ---------------------------------------------------------------------------

function sortWithinGroup(todos: TodoItem[], sortBy: SortBy): TodoItem[] {
  return [...todos].sort((a, b) => {
    if (sortBy === 'dueDate') {
      // Tasks with no due date go last
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      const diff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (diff !== 0) return diff;
    } else if (sortBy === 'status') {
      const sa = STATUS_ORDER[a.status] ?? 0;
      const sb = STATUS_ORDER[b.status] ?? 0;
      if (sa !== sb) return sa - sb;
    } else {
      // Default: priority (urgent first)
      const pa = PRIORITY_ORDER[a.priority] ?? 2;
      const pb = PRIORITY_ORDER[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
    }

    // Secondary: created_at desc
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

// ---------------------------------------------------------------------------
// Flatten groups into a single ordered list for keyboard navigation
// ---------------------------------------------------------------------------

function flattenGroups(groups: TodoGroup[], collapsed: Set<string>): TodoItem[] {
  const result: TodoItem[] = [];
  for (const g of groups) {
    if (!collapsed.has(g.key)) {
      result.push(...g.todos);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// TaskList component
// ---------------------------------------------------------------------------

export function TaskList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams?.toString() || '';
  const urlState = useMemo(() => parseTodoUrlState(searchParamsString), [searchParamsString]);
  const { toast } = useToast();
  const syncingFromUrlRef = useRef(false);
  const lastSearchParamsRef = useRef(searchParamsString);
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());

  // Filter / view state
  const [scope, setScope] = useState<Scope>(() => urlState.scope);
  const [searchInput, setSearchInput] = useState(() => urlState.search);
  const [groupBy, setGroupBy] = useState<GroupBy>(() => urlState.groupBy);
  const [sortBy, setSortBy] = useState<SortBy>(() => urlState.sortBy);
  const [includeCompleted, setIncludeCompleted] = useState(() => urlState.includeCompleted);

  // Selection / keyboard state
  const [selectedId, setSelectedId] = useState<string | null>(() => urlState.taskId);
  const [focusedId, setFocusedId] = useState<string | null>(() => urlState.taskId);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Quick-add state
  const [quickTitle, setQuickTitle] = useState('');

  // Dialog state
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  // Quick-add input ref (for focus management)
  const quickAddRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    if (lastSearchParamsRef.current === searchParamsString) {
      return;
    }

    lastSearchParamsRef.current = searchParamsString;

    if (
      scope === urlState.scope &&
      searchInput === urlState.search &&
      groupBy === urlState.groupBy &&
      sortBy === urlState.sortBy &&
      includeCompleted === urlState.includeCompleted &&
      selectedId === urlState.taskId
    ) {
      return;
    }

    syncingFromUrlRef.current = true;
    setScope(urlState.scope);
    setSearchInput(urlState.search);
    setGroupBy(urlState.groupBy);
    setSortBy(urlState.sortBy);
    setIncludeCompleted(urlState.includeCompleted);
    setSelectedId(urlState.taskId);
  }, [groupBy, includeCompleted, scope, searchInput, searchParamsString, selectedId, sortBy, urlState]);

  // Fetch data
  const { data, isLoading, error } = useTodoList({
    scope,
    search: debouncedSearch || undefined,
    includeCompleted,
  });

  const createMutation = useCreateTodo();

  const todos = data?.todos ?? [];

  // Group and sort
  const groups = useMemo(() => {
    const grouped = groupTodos(todos, groupBy);
    return grouped.map(g => ({
      ...g,
      todos: sortWithinGroup(g.todos, sortBy),
    }));
  }, [todos, groupBy, sortBy]);

  // Flat list for keyboard nav
  const flatList = useMemo(() => flattenGroups(groups, collapsedGroups), [groups, collapsedGroups]);

  // O(1) index lookup for render loop
  const flatIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    flatList.forEach((t, i) => map.set(t.id, i));
    return map;
  }, [flatList]);

  const todoIdSet = useMemo(() => new Set(todos.map((todo) => todo.id)), [todos]);
  const focusedIndex = focusedId ? (flatIndexMap.get(focusedId) ?? -1) : -1;
  const focusedTodo = focusedIndex >= 0 ? flatList[focusedIndex] ?? null : null;

  // For toggle complete on focused item
  const focusedUpdateMutation = useUpdateTodo(focusedTodo?.id ?? null);

  const updateUrl = useCallback(
    (
      update: (params: URLSearchParams) => void,
      mode: UrlSyncMode = 'replace',
    ) => {
      const params = new URLSearchParams(searchParams?.toString() || '');
      update(params);

      const query = params.toString();
      const url = query ? `${pathname}?${query}` : (pathname || '/todos');

      if (mode === 'push') {
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (syncingFromUrlRef.current) {
      syncingFromUrlRef.current = false;
      return;
    }

    const normalizedSearch = debouncedSearch.trim();

    if (
      urlState.scope === scope &&
      urlState.search === normalizedSearch &&
      urlState.groupBy === groupBy &&
      urlState.sortBy === sortBy &&
      urlState.includeCompleted === includeCompleted
    ) {
      return;
    }

    updateUrl((params) => {
      applyTodoUrlState(params, {
        scope,
        search: normalizedSearch,
        groupBy,
        sortBy,
        includeCompleted,
      });
    });
  }, [debouncedSearch, groupBy, includeCompleted, scope, sortBy, updateUrl, urlState]);

  // Collapse toggle
  const toggleCollapse = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    setCollapsedGroups((prev) => (prev.size === 0 ? prev : new Set()));
  }, [groupBy]);

  useEffect(() => {
    if (!selectedId || isLoading || !!error || todoIdSet.has(selectedId)) {
      return;
    }

    setSelectedId(null);
    updateUrl((params) => {
      applyTodoUrlState(params, { taskId: null });
    });
  }, [error, isLoading, selectedId, todoIdSet, updateUrl]);

  useEffect(() => {
    if (selectedId && flatIndexMap.has(selectedId) && focusedId !== selectedId) {
      setFocusedId(selectedId);
    }
  }, [flatIndexMap, focusedId, selectedId]);

  useEffect(() => {
    if (flatList.length === 0) {
      if (focusedId !== null) {
        setFocusedId(null);
      }
      return;
    }

    if (focusedId && flatIndexMap.has(focusedId)) {
      return;
    }

    const fallbackId =
      (selectedId && flatIndexMap.has(selectedId) ? selectedId : null) ??
      flatList[0]?.id ??
      null;

    if (fallbackId !== focusedId) {
      setFocusedId(fallbackId);
    }
  }, [flatIndexMap, flatList, focusedId, selectedId]);

  useEffect(() => {
    if (!focusedId) {
      return;
    }

    rowRefs.current.get(focusedId)?.scrollIntoView({
      block: 'nearest',
    });
  }, [focusedId]);

  const setRowRef = useCallback((todoId: string, node: HTMLDivElement | null) => {
    if (node) {
      rowRefs.current.set(todoId, node);
    } else {
      rowRefs.current.delete(todoId);
    }
  }, []);

  const moveFocus = useCallback((direction: -1 | 1) => {
    if (flatList.length === 0) {
      return;
    }

    const currentIndex = focusedId ? (flatIndexMap.get(focusedId) ?? -1) : -1;
    const fallbackIndex = direction > 0 ? 0 : flatList.length - 1;
    const nextIndex = currentIndex === -1
      ? fallbackIndex
      : Math.min(flatList.length - 1, Math.max(0, currentIndex + direction));

    const nextTodo = flatList[nextIndex];
    if (nextTodo) {
      setFocusedId(nextTodo.id);
    }
  }, [flatIndexMap, flatList, focusedId]);

  const openTask = useCallback((todoId: string, mode: UrlSyncMode = 'push') => {
    setSelectedId(todoId);
    setFocusedId(todoId);

    if (selectedId === todoId && urlState.taskId === todoId) {
      return;
    }

    updateUrl((params) => {
      applyTodoUrlState(params, { taskId: todoId });
    }, mode);
  }, [selectedId, updateUrl, urlState.taskId]);

  const closeTask = useCallback((mode: UrlSyncMode = 'push') => {
    setSelectedId(null);

    if (!selectedId && !urlState.taskId) {
      return;
    }

    updateUrl((params) => {
      applyTodoUrlState(params, { taskId: null });
    }, mode);
  }, [selectedId, updateUrl, urlState.taskId]);

  // Quick-add handler
  const handleQuickAdd = useCallback(async () => {
    const title = quickTitle.trim();
    if (!title) return;
    try {
      await createMutation.mutateAsync({ title });
      setQuickTitle('');
      toast({ title: 'Task created' });
    } catch (err: unknown) {
      toast({ title: 'Failed to create task', variant: 'destructive' });
    }
  }, [quickTitle, createMutation, toast]);

  // Keyboard shortcuts
  useTaskKeyboard(
    {
      onNewTask: () => {
        quickAddRef.current?.focus();
      },
      onNavigateUp: () => {
        moveFocus(-1);
      },
      onNavigateDown: () => {
        moveFocus(1);
      },
      onOpenPanel: () => {
        if (focusedTodo) openTask(focusedTodo.id);
      },
      onClosePanel: () => {
        if (quickCreateOpen) {
          setQuickCreateOpen(false);
          return;
        }

        if (selectedId) {
          closeTask();
        }
      },
      onToggleComplete: () => {
        if (!focusedTodo) return;
        const isDone = focusedTodo.status === 'done' || focusedTodo.status === 'archived';
        focusedUpdateMutation.mutate({ status: isDone ? 'open' : 'done' });
      },
      onEditTask: () => {
        if (focusedTodo) openTask(focusedTodo.id);
      },
    },
    !selectedId, // Disable when panel is open
  );

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Left: list pane */}
      <div
        className={cn(
          'flex-1 min-w-0 flex flex-col overflow-hidden',
          selectedId && 'hidden md:flex md:max-w-[calc(100%-30rem)]',
        )}
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <h1 className="text-lg font-semibold">Tasks</h1>
          <Button size="sm" onClick={() => setQuickCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Task
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border/40">
          {/* Scope pills */}
          <div className="flex items-center gap-1">
            {SCOPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setScope(opt.value)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full transition-colors',
                  scope === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-[280px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="h-7 pl-7 text-xs"
            />
          </div>

          {/* Group by */}
          <Select value={groupBy} onValueChange={v => setGroupBy(v as GroupBy)}>
            <SelectTrigger className="h-7 w-[130px] text-xs">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dueDate">Due Date</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="assignee">Assignee</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort by */}
          <Select value={sortBy} onValueChange={v => setSortBy(v as SortBy)}>
            <SelectTrigger className="h-7 w-[110px] text-xs">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="dueDate">Due Date</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>

          {/* Active / All toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setIncludeCompleted(prev => !prev)}
          >
            {includeCompleted ? 'All' : 'Active'}
          </Button>
        </div>

        {/* Inline quick-add */}
        <div className="px-4 py-2 border-b border-border/40">
          <Input
            ref={quickAddRef}
            placeholder="Add a task... (press Enter)"
            value={quickTitle}
            onChange={e => setQuickTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleQuickAdd();
              }
            }}
            disabled={createMutation.isPending}
            className="h-8 text-sm"
          />
        </div>

        {/* Scrollable grouped list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading tasks...
            </div>
          )}

          {error && (
            <div className="px-4 py-8 text-center text-sm text-destructive">
              Failed to load tasks. Please try again.
            </div>
          )}

          {!isLoading && !error && flatList.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No tasks found.
            </div>
          )}

          {!isLoading && !error && groups.map(group => {
            const isCollapsed = collapsedGroups.has(group.key);
            return (
              <div key={group.key}>
                {/* Group header */}
                <button
                  onClick={() => toggleCollapse(group.key)}
                  className="flex items-center gap-2 w-full px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 sticky top-0 bg-background z-10 border-b border-border/20"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  {group.label}
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
                    {group.todos.length}
                  </Badge>
                </button>

                {/* Group rows */}
                {!isCollapsed &&
                  group.todos.map(todo => {
                    const globalIdx = flatIndexMap.get(todo.id) ?? -1;
                    return (
                      <TaskRow
                        key={todo.id}
                        todo={todo}
                        isActive={selectedId === todo.id}
                        isFocused={focusedIndex === globalIdx}
                        onFocusRow={setFocusedId}
                        onSelect={openTask}
                        rowRef={(node) => setRowRef(todo.id, node)}
                      />
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Side panel */}
      {selectedId && (
        <TaskSidePanel
          todoId={selectedId}
          onClose={() => closeTask()}
        />
      )}

      {/* Create dialog */}
      <TaskQuickCreate
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
      />
    </div>
  );
}

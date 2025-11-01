import type { SupabaseClient } from '@supabase/supabase-js';

export const TODO_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'archived'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export const TODO_ACTIVITY_TYPES = [
  'created',
  'status_changed',
  'comment',
  'due_date_changed',
  'assignment_changed',
  'acknowledged',
] as const;
export type TodoActivityType = (typeof TODO_ACTIVITY_TYPES)[number];

export const TODO_RELATION_QUERY = `
  *,
  creator:profiles!todo_items_created_by_fkey ( id, username, avatar_url ),
  assignee:profiles!todo_items_assigned_to_fkey ( id, username, avatar_url ),
  completer:profiles!todo_items_completed_by_fkey ( id, username, avatar_url ),
  watchers:todo_watchers (
    user_id,
    created_at,
    profile:profiles!todo_watchers_user_id_fkey ( id, username, avatar_url )
  )
`;

export const TODO_ACTIVITY_QUERY = `
  *,
  actor:profiles!todo_activity_performed_by_fkey ( id, username, avatar_url )
`;

export const TODO_COMMENT_QUERY = `
  *,
  author:profiles!todo_comments_created_by_fkey ( id, username, avatar_url )
`;

export const TODO_ATTACHMENT_QUERY = `
  *,
  uploader:profiles!todo_attachments_uploaded_by_fkey ( id, username, avatar_url )
`;

export interface ProfileSummary {
  id: string;
  username?: string | null;
  avatarUrl?: string | null;
}

export interface TodoWatcher {
  userId: string;
  addedAt: string | null;
  profile?: ProfileSummary | null;
}

export interface TodoItem {
  id: string;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt: string | null;
  createdBy: string;
  assignedTo: string;
  entityId: string | null;
  contextType: string | null;
  contextId: string | null;
  contextPath: string | null;
  contextSnapshot: Record<string, unknown> | null;
  completedAt: string | null;
  completedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: ProfileSummary | null;
  assignee?: ProfileSummary | null;
  completer?: ProfileSummary | null;
  watchers: TodoWatcher[];
  statusLabel: string | null;
  statusColor: string | null;
  reminderOffsetMinutes: number | null;
  notifyEmail: boolean;
  notifyInApp: boolean;
}

export interface TodoActivity {
  id: string;
  todoId: string;
  eventType: TodoActivityType;
  payload: Record<string, unknown> | null;
  note: string | null;
  performedBy: string;
  createdAt: string;
  actor?: ProfileSummary | null;
}

export interface TodoComment {
  id: string;
  todoId: string;
  body: string;
  createdBy: string;
  createdAt: string;
  author?: ProfileSummary | null;
}

export interface TodoAttachment {
  id: string;
  todoId: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number | null;
  uploadedBy: string;
  createdAt: string;
  uploader?: ProfileSummary | null;
}

const toProfile = (row: any | null | undefined): ProfileSummary | null => {
  if (!row) return null;
  if (typeof row !== 'object') return null;
  return {
    id: String(row.id),
    username: row.username ?? null,
    avatarUrl: row.avatar_url ?? null,
  };
};

const toWatcher = (row: any): TodoWatcher | null => {
  if (!row) return null;
  const userId = row.user_id ? String(row.user_id) : null;
  if (!userId) return null;
  return {
    userId,
    addedAt: row.created_at ?? null,
    profile: toProfile(row.profile),
  };
};

const toTodo = (row: any): TodoItem => {
  return {
    id: String(row.id),
    title: row.title ?? '',
    description: row.description ?? null,
    status: row.status as TodoStatus,
    priority: row.priority as TodoPriority,
    dueAt: row.due_at ?? null,
    createdBy: String(row.created_by),
    assignedTo: String(row.assigned_to),
    entityId: row.entity_id ?? null,
    contextType: row.context_type ?? null,
    contextId: row.context_id ?? null,
    contextPath: row.context_path ?? null,
    contextSnapshot: row.context_snapshot ?? null,
    completedAt: row.completed_at ?? null,
    completedBy: row.completed_by ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    creator: toProfile(row.creator),
    assignee: toProfile(row.assignee),
    completer: toProfile(row.completer),
    watchers: Array.isArray(row.watchers)
      ? (row.watchers.map(toWatcher).filter(Boolean) as TodoWatcher[])
      : [],
    statusLabel: row.status_label ?? null,
    statusColor: row.status_color ?? null,
    reminderOffsetMinutes:
      typeof row.reminder_offset_minutes === 'number'
        ? row.reminder_offset_minutes
        : row.reminder_offset_minutes === null
          ? null
          : null,
    notifyEmail: Boolean(row.notify_email),
    notifyInApp: Boolean(row.notify_in_app),
  };
};

const toActivity = (row: any): TodoActivity => ({
  id: String(row.id),
  todoId: String(row.todo_id),
  eventType: row.event_type as TodoActivityType,
  payload: row.payload ?? null,
  note: row.note ?? null,
  performedBy: String(row.performed_by),
  createdAt: row.created_at,
  actor: toProfile(row.actor),
});

const toComment = (row: any): TodoComment => ({
  id: String(row.id),
  todoId: String(row.todo_id),
  body: row.body ?? '',
  createdBy: String(row.created_by),
  createdAt: row.created_at,
  author: toProfile(row.author),
});

const toAttachment = (row: any): TodoAttachment => ({
  id: String(row.id),
  todoId: String(row.todo_id),
  fileName: row.file_name ?? '',
  filePath: row.file_path ?? '',
  mimeType: row.mime_type ?? '',
  fileSize: row.file_size ?? null,
  uploadedBy: String(row.uploaded_by),
  createdAt: row.created_at,
  uploader: toProfile(row.uploader),
});

export interface TodoListFilters {
  userId: string;
  scope?: 'assigned' | 'created' | 'watching' | 'all';
  status?: TodoStatus;
  search?: string;
  includeCompleted?: boolean;
  limit?: number;
  offset?: number;
}

export async function listTodos(
  client: SupabaseClient,
  filters: TodoListFilters
): Promise<TodoItem[]> {
  const scope = filters.scope ?? 'assigned';

  let baseQuery = client
    .from('todo_items')
    .select(TODO_RELATION_QUERY)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (!filters.includeCompleted) {
    baseQuery = baseQuery.not('status', 'in', '(done,archived)');
  }

  if (filters.status) {
    baseQuery = baseQuery.eq('status', filters.status);
  }

  const isFiniteNumber = (value: number | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value);

  if (isFiniteNumber(filters.limit)) {
    baseQuery = baseQuery.limit(filters.limit!);
  }
  if (isFiniteNumber(filters.offset)) {
    baseQuery = baseQuery.range(filters.offset!, (filters.offset! + (filters.limit ?? 50)) - 1);
  }

  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    baseQuery = baseQuery.or(
      `title.ilike.${term},description.ilike.${term}`
    );
  }

  if (scope === 'assigned') {
    baseQuery = baseQuery.eq('assigned_to', filters.userId);
  } else if (scope === 'created') {
    baseQuery = baseQuery.eq('created_by', filters.userId);
  } else if (scope === 'watching') {
    const { data: watcherRows, error: watcherError } = await client
      .from('todo_watchers')
      .select('todo_id')
      .eq('user_id', filters.userId);

    if (watcherError) throw watcherError;

    const todoIds = (watcherRows ?? [])
      .map(row => row?.todo_id)
      .filter((id): id is string => typeof id === 'string');

    if (todoIds.length === 0) {
      return [];
    }

    baseQuery = baseQuery.in('id', todoIds);
  }

  const { data, error } = await baseQuery;
  if (error) throw error;

  return (data ?? []).map(toTodo);
}

export async function fetchTodo(client: SupabaseClient, todoId: string): Promise<TodoItem | null> {
  const { data, error } = await client
    .from('todo_items')
    .select(TODO_RELATION_QUERY)
    .eq('id', todoId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return toTodo(data);
}

export async function fetchTodoActivities(
  client: SupabaseClient,
  todoId: string
): Promise<TodoActivity[]> {
  const { data, error } = await client
    .from('todo_activity')
    .select(TODO_ACTIVITY_QUERY)
    .eq('todo_id', todoId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(toActivity);
}

export async function fetchTodoComments(
  client: SupabaseClient,
  todoId: string
): Promise<TodoComment[]> {
  const { data, error } = await client
    .from('todo_comments')
    .select(TODO_COMMENT_QUERY)
    .eq('todo_id', todoId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(toComment);
}

export async function listWatcherIds(client: SupabaseClient, todoId: string): Promise<string[]> {
  const { data, error } = await client
    .from('todo_watchers')
    .select('user_id')
    .eq('todo_id', todoId);

  if (error) throw error;
  return (data ?? [])
    .map(row => row?.user_id)
    .filter((id): id is string => typeof id === 'string');
}

export async function fetchTodoAttachments(
  client: SupabaseClient,
  todoId: string
): Promise<TodoAttachment[]> {
  const { data, error } = await client
    .from('todo_attachments')
    .select(TODO_ATTACHMENT_QUERY)
    .eq('todo_id', todoId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(toAttachment);
}

'use client';

import { supabase } from '@/lib/supabase';
import type { TodoItem, TodoStatus, TodoPriority, TodoActivity, TodoComment } from '@/lib/db/todos';

type ListScope = 'assigned' | 'created' | 'watching' | 'all';

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return token;
}

type FetchOptions = RequestInit & { headers?: HeadersInit };

async function authorizedFetch(input: RequestInfo | URL, init?: FetchOptions) {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}

export interface TodoListFilters {
  scope?: ListScope;
  status?: TodoStatus;
  search?: string;
  includeCompleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface TodoListResponse {
  todos: TodoItem[];
}

export async function fetchTodoList(filters: TodoListFilters = {}): Promise<TodoListResponse> {
  const params = new URLSearchParams();
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('q', filters.search);
  if (filters.includeCompleted) params.set('includeCompleted', 'true');
  if (typeof filters.limit === 'number') params.set('limit', String(filters.limit));
  if (typeof filters.offset === 'number') params.set('offset', String(filters.offset));

  const url = `/api/todos${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await authorizedFetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Failed to load todos (${res.status})`);
  }

  const json = await res.json();
  return {
    todos: Array.isArray(json?.todos) ? (json.todos as TodoItem[]) : [],
  };
}

export interface CreateTodoPayload {
  title: string;
  description?: string | null;
  priority?: TodoPriority;
  dueAt?: string | null;
  assignedTo?: string;
  watchers?: string[];
  entityId?: string | null;
  contextType?: string | null;
  contextId?: string | null;
  contextPath?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
}

export interface TodoDetailResponse {
  todo: TodoItem | null;
  activities: TodoActivity[];
  comments: TodoComment[];
}

export async function createTodo(payload: CreateTodoPayload): Promise<TodoDetailResponse> {
  const res = await authorizedFetch('/api/todos', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to create task');
  }

  const json = await res.json();
  return {
    todo: json?.todo ?? null,
    activities: Array.isArray(json?.activities) ? (json.activities as TodoActivity[]) : [],
    comments: Array.isArray(json?.comments) ? (json.comments as TodoComment[]) : [],
  };
}

export async function fetchTodoDetail(todoId: string): Promise<TodoDetailResponse> {
  const res = await authorizedFetch(`/api/todos/${todoId}`, { method: 'GET' });
  if (res.status === 404) {
    return { todo: null, activities: [], comments: [] };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to load task');
  }
  const json = await res.json();
  return {
    todo: json?.todo ?? null,
    activities: Array.isArray(json?.activities) ? (json.activities as TodoActivity[]) : [],
    comments: Array.isArray(json?.comments) ? (json.comments as TodoComment[]) : [],
  };
}

export type UpdateTodoPayload = Partial<{
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt: string | null;
  assignedTo: string;
  entityId: string | null;
  contextType: string | null;
  contextId: string | null;
  contextPath: string | null;
  contextSnapshot: Record<string, unknown> | null;
  watchers: string[];
}>;

export async function updateTodo(todoId: string, payload: UpdateTodoPayload): Promise<TodoDetailResponse> {
  const res = await authorizedFetch(`/api/todos/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to update task');
  }

  const json = await res.json();
  return {
    todo: json?.todo ?? null,
    activities: Array.isArray(json?.activities) ? (json.activities as TodoActivity[]) : [],
    comments: Array.isArray(json?.comments) ? (json.comments as TodoComment[]) : [],
  };
}

export async function addTodoComment(todoId: string, body: string) {
  const res = await authorizedFetch(`/api/todos/${todoId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to add comment');
  }

  const json = await res.json();
  return {
    comment: json?.comment ?? null,
    comments: Array.isArray(json?.comments) ? (json.comments as TodoComment[]) : [],
  };
}

export async function acknowledgeTodo(todoId: string, note?: string) {
  const res = await authorizedFetch(`/api/todos/${todoId}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to acknowledge task');
  }

  const json = await res.json();
  return {
    todo: json?.todo ?? null,
    activities: Array.isArray(json?.activities) ? (json.activities as TodoActivity[]) : [],
    comments: Array.isArray(json?.comments) ? (json.comments as TodoComment[]) : [],
  };
}

export interface ProfileSummary {
  id: string;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
  display_name: string;
}

export async function fetchProfiles(): Promise<ProfileSummary[]> {
  const res = await authorizedFetch('/api/profiles', { method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to load profiles');
  }
  const json = await res.json();
  return Array.isArray(json?.profiles) ? (json.profiles as ProfileSummary[]) : [];
}

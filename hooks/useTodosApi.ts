'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

import type { TodoListFilters } from '@/lib/client/todos';
import {
  acknowledgeTodo,
  addTodoComment,
  createTodo,
  fetchTodoDetail,
  fetchTodoList,
  updateTodo,
  type CreateTodoPayload,
  type TodoDetailResponse,
  type UpdateTodoPayload,
} from '@/lib/client/todos';

const listKey = (filters: TodoListFilters) => ['todos', 'list', filters];
const detailKey = (todoId: string | null) => ['todos', 'detail', todoId];

export function useTodoList(filters: TodoListFilters) {
  return useQuery({
    queryKey: listKey(filters),
    queryFn: () => fetchTodoList(filters),
    staleTime: 1000 * 30,
  });
}

export function useTodoDetail(todoId: string | null) {
  return useQuery<TodoDetailResponse>({
    queryKey: detailKey(todoId),
    queryFn: () => fetchTodoDetail(todoId as string),
    enabled: Boolean(todoId),
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTodoPayload) => createTodo(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
    },
  });
}

export function useUpdateTodo(todoId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTodoPayload) => {
      if (!todoId) throw new Error('Missing todo id');
      return updateTodo(todoId, payload);
    },
    onSuccess: (_data, _variables, _context) => {
      queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
      queryClient.invalidateQueries({ queryKey: detailKey(todoId) });
    },
  });
}

export function useAddTodoComment(todoId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => {
      if (!todoId) throw new Error('Missing todo id');
      return addTodoComment(todoId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey(todoId) });
    },
  });
}

export function useAcknowledgeTodo(todoId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) => {
      if (!todoId) throw new Error('Missing todo id');
      return acknowledgeTodo(todoId, note);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey(todoId) });
      queryClient.invalidateQueries({ queryKey: ['todos', 'list'] });
    },
  });
}

export function useUploadTodoAttachment(todoId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      if (!todoId) throw new Error('Missing todo id');

      // Get auth token
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const token = data?.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/todos/${todoId}/attachments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to upload attachment');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey(todoId) });
    },
  });
}

export function useDeleteTodoAttachment(todoId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      if (!todoId) throw new Error('Missing todo id');

      // Get auth token
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const token = data?.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/todos/${todoId}/attachments/${attachmentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Failed to delete attachment');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey(todoId) });
    },
  });
}

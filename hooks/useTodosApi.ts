'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

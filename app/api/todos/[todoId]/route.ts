import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getRouteClient } from '@/lib/supabase-route';
import { TODO_PRIORITIES, TODO_STATUSES, fetchTodo, fetchTodoActivities, fetchTodoComments, type TodoItem } from '@/lib/db/todos';

const paramsSchema = z.object({
  todoId: z.string().uuid(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(TODO_STATUSES).optional(),
  priority: z.enum(TODO_PRIORITIES).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  assignedTo: z.string().uuid().optional(),
  entityId: z.string().uuid().nullable().optional(),
  contextType: z.string().max(64).nullable().optional(),
  contextId: z.string().uuid().nullable().optional(),
  contextPath: z.string().max(255).nullable().optional(),
  contextSnapshot: z.record(z.any()).nullable().optional(),
  watchers: z.array(z.string().uuid()).optional(),
});

export async function GET(_req: NextRequest, context: { params: { todoId: string } }) {
  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const ctx = await getRouteClient(_req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const [todo, activities, comments] = await Promise.all([
      fetchTodo(ctx.supabase, parsedParams.data.todoId),
      fetchTodoActivities(ctx.supabase, parsedParams.data.todoId),
      fetchTodoComments(ctx.supabase, parsedParams.data.todoId),
    ]);

    if (!todo) {
      return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ todo, activities, comments });
  } catch (error) {
    console.error('[todo-detail][GET] Failed to fetch todo', error);
    return NextResponse.json({ error: 'Failed to load task detail' }, { status: 500 });
  }
}

function watchedIds(todo: TodoItem): Set<string> {
  return new Set(todo.watchers.map(w => w.userId));
}

export async function PATCH(req: NextRequest, context: { params: { todoId: string } }) {
  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const todoId = parsedParams.data.todoId;
  const body = await req.json().catch(() => null);
  const parsedBody = updateSchema.safeParse(body ?? {});

  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 400 });
  }

  try {
    const existing = await fetchTodo(ctx.supabase, todoId);
    if (!existing) {
      return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    const activityEntries: Array<{ event_type: string; payload?: Record<string, unknown> | null }> = [];

    const payload = parsedBody.data;

    if (payload.title && payload.title !== existing.title) {
      updates.title = payload.title;
    }

    if (payload.description !== undefined && payload.description !== existing.description) {
      updates.description = payload.description ?? null;
    }

    if (payload.priority && payload.priority !== existing.priority) {
      updates.priority = payload.priority;
    }

    if (payload.status && payload.status !== existing.status) {
      updates.status = payload.status;
      activityEntries.push({
        event_type: 'status_changed',
        payload: { from: existing.status, to: payload.status },
      });

      if (payload.status === 'done') {
        const finishedAt = new Date().toISOString();
        updates.completed_at = finishedAt;
        updates.completed_by = ctx.user.id;
      } else if (existing.status === 'done') {
        updates.completed_at = null;
        updates.completed_by = null;
      }
    }

    if (payload.dueAt !== undefined && payload.dueAt !== existing.dueAt) {
      updates.due_at = payload.dueAt ?? null;
      activityEntries.push({
        event_type: 'due_date_changed',
        payload: { from: existing.dueAt, to: payload.dueAt ?? null },
      });
    }

    if (payload.assignedTo && payload.assignedTo !== existing.assignedTo) {
      updates.assigned_to = payload.assignedTo;
      activityEntries.push({
        event_type: 'assignment_changed',
        payload: { from: existing.assignedTo, to: payload.assignedTo },
      });
    }

    if (payload.entityId !== undefined && payload.entityId !== existing.entityId) {
      updates.entity_id = payload.entityId ?? null;
    }

    if (payload.contextType !== undefined && payload.contextType !== existing.contextType) {
      updates.context_type = payload.contextType ?? null;
    }

    if (payload.contextId !== undefined && payload.contextId !== existing.contextId) {
      updates.context_id = payload.contextId ?? null;
    }

    if (payload.contextPath !== undefined && payload.contextPath !== existing.contextPath) {
      updates.context_path = payload.contextPath ?? null;
    }

    if (payload.contextSnapshot !== undefined) {
      updates.context_snapshot = payload.contextSnapshot ?? null;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await ctx.supabase
        .from('todo_items')
        .update(updates)
        .eq('id', todoId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }
    }

    if (payload.watchers) {
      const requested = new Set(payload.watchers);
      requested.delete(ctx.user.id);
      requested.delete(payload.assignedTo ?? existing.assignedTo);
      const existingWatchers = watchedIds(existing);

      const toAdd = Array.from(requested).filter(id => !existingWatchers.has(id));
      const toRemove = Array.from(existingWatchers).filter(id => !requested.has(id));

      if (toAdd.length > 0) {
        const { error: addError } = await ctx.supabase
          .from('todo_watchers')
          .insert(toAdd.map(userId => ({ todo_id: todoId, user_id: userId })));
        if (addError) {
          console.warn('[todo-detail][PATCH] Failed to add watchers', addError);
        }
      }

      if (toRemove.length > 0) {
        const { error: removeError } = await ctx.supabase
          .from('todo_watchers')
          .delete()
          .eq('todo_id', todoId)
          .in('user_id', toRemove);
        if (removeError) {
          console.warn('[todo-detail][PATCH] Failed to remove watchers', removeError);
        }
      }
    }

    if (activityEntries.length > 0) {
      const rows = activityEntries.map(entry => ({
        todo_id: todoId,
        event_type: entry.event_type,
        payload: entry.payload ?? null,
        performed_by: ctx.user.id,
      }));
      const { error: activityError } = await ctx.supabase.from('todo_activity').insert(rows);
      if (activityError) {
        console.warn('[todo-detail][PATCH] Failed to log activity', activityError);
      }
    }

    const [updatedTodo, activities, comments] = await Promise.all([
      fetchTodo(ctx.supabase, todoId),
      fetchTodoActivities(ctx.supabase, todoId),
      fetchTodoComments(ctx.supabase, todoId),
    ]);

    return NextResponse.json({ todo: updatedTodo, activities, comments });
  } catch (error) {
    console.error('[todo-detail][PATCH] Unexpected error', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

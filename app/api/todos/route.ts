import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getRouteClient } from '@/lib/supabase-route';
import { TODO_PRIORITIES, TODO_STATUSES, fetchTodo, fetchTodoActivities, listTodos } from '@/lib/db/todos';

const createTodoSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  priority: z.enum(TODO_PRIORITIES).default('medium'),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  assignedTo: z.string().uuid().optional(),
  watchers: z.array(z.string().uuid()).optional(),
  entityId: z.string().uuid().nullable().optional(),
  contextType: z.string().max(64).nullable().optional(),
  contextId: z.string().uuid().nullable().optional(),
  contextPath: z.string().max(255).nullable().optional(),
  contextSnapshot: z.record(z.any()).nullable().optional(),
});

const listQuerySchema = z.object({
  scope: z.enum(['assigned', 'created', 'watching', 'all']).optional(),
  status: z.enum(TODO_STATUSES).optional(),
  q: z.string().optional(),
  includeCompleted: z
    .enum(['true', 'false'])
    .optional()
    .transform(value => value === 'true'),
  limit: z
    .string()
    .optional()
    .transform(value => {
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }),
  offset: z
    .string()
    .optional()
    .transform(value => {
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }),
});

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const url = new URL(req.url);
  const parsedQuery = listQuerySchema.safeParse({
    scope: url.searchParams.get('scope') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    includeCompleted: url.searchParams.get('includeCompleted') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid query params', details: parsedQuery.error.flatten() }, { status: 400 });
  }

  const { scope, status, q, includeCompleted, limit, offset } = parsedQuery.data;

  try {
    const todos = await listTodos(ctx.supabase, {
      userId: ctx.user.id,
      scope,
      status,
      search: q,
      includeCompleted,
      limit,
      offset,
    });

    return NextResponse.json({ todos });
  } catch (error) {
    console.error('[todos][GET] Failed to list todos', error);
    return NextResponse.json({ error: 'Failed to load todos' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const body = await req.json().catch(() => null);
  const parsedBody = createTodoSchema.safeParse(body ?? {});

  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 400 });
  }

  const payload = parsedBody.data;
  const assignedTo = payload.assignedTo ?? ctx.user.id;

  try {
    const { data: inserted, error: insertError } = await ctx.supabase
      .from('todo_items')
      .insert({
        title: payload.title,
        description: payload.description ?? null,
        priority: payload.priority,
        due_at: payload.dueAt ?? null,
        created_by: ctx.user.id,
        assigned_to: assignedTo,
        entity_id: payload.entityId ?? null,
        context_type: payload.contextType ?? null,
        context_id: payload.contextId ?? null,
        context_path: payload.contextPath ?? null,
        context_snapshot: payload.contextSnapshot ?? null,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        { error: insertError?.message ?? 'Failed to create task' },
        { status: insertError?.code === '42501' ? 403 : 500 }
      );
    }

    const todoId = inserted.id as string;

    const watcherIds = new Set(payload.watchers ?? []);
    watcherIds.delete(ctx.user.id);
    watcherIds.delete(assignedTo);

    if (watcherIds.size > 0) {
      const records = Array.from(watcherIds).map(userId => ({ todo_id: todoId, user_id: userId }));
      const { error: watcherError } = await ctx.supabase.from('todo_watchers').insert(records);
      if (watcherError) {
        console.warn('[todos][POST] Failed to add watchers', watcherError);
      }
    }

    const { error: activityError } = await ctx.supabase.from('todo_activity').insert({
      todo_id: todoId,
      event_type: 'created',
      payload: {
        assigned_to: assignedTo,
        priority: payload.priority,
        due_at: payload.dueAt ?? null,
      },
      performed_by: ctx.user.id,
    });

    if (activityError) {
      console.warn('[todos][POST] Failed to log creation activity', activityError);
    }

    const [todo, activities] = await Promise.all([
      fetchTodo(ctx.supabase, todoId),
      fetchTodoActivities(ctx.supabase, todoId),
    ]);

    return NextResponse.json({ todo, activities }, { status: 201 });
  } catch (error) {
    console.error('[todos][POST] Unexpected error', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getRouteClient } from '@/lib/supabase-route';
import { fetchTodo, fetchTodoActivities, fetchTodoComments } from '@/lib/db/todos';

const paramsSchema = z.object({
  todoId: z.string().uuid(),
});

const acknowledgeSchema = z.object({
  note: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, context: { params: { todoId: string } }) {
  const parsedParams = paramsSchema.safeParse(context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsedBody = acknowledgeSchema.safeParse(body ?? {});
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 400 });
  }

  const todoId = parsedParams.data.todoId;

  try {
    const todo = await fetchTodo(ctx.supabase, todoId);
    if (!todo) {
      return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
    }

    if (todo.createdBy !== ctx.user.id) {
      return NextResponse.json({ error: 'Only the creator can acknowledge completion' }, { status: 403 });
    }

    if (todo.status !== 'done') {
      return NextResponse.json({ error: 'Task must be marked done before acknowledgement' }, { status: 409 });
    }

    const nowIso = new Date().toISOString();

    const { error: updateError } = await ctx.supabase
      .from('todo_items')
      .update({ acknowledged_at: nowIso })
      .eq('id', todoId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    const { error: activityError } = await ctx.supabase.from('todo_activity').insert({
      todo_id: todoId,
      event_type: 'acknowledged',
      note: parsedBody.data.note ?? null,
      payload: { status: todo.status },
      performed_by: ctx.user.id,
    });

    if (activityError) {
      console.warn('[todo-ack][POST] Failed to log acknowledgement activity', activityError);
    }

    const [updatedTodo, activities, comments] = await Promise.all([
      fetchTodo(ctx.supabase, todoId),
      fetchTodoActivities(ctx.supabase, todoId),
      fetchTodoComments(ctx.supabase, todoId),
    ]);

    return NextResponse.json({ todo: updatedTodo, activities, comments });
  } catch (error) {
    console.error('[todo-ack][POST] Unexpected error', error);
    return NextResponse.json({ error: 'Failed to acknowledge task' }, { status: 500 });
  }
}

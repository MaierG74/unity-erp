import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getRouteClient } from '@/lib/supabase-route';
import { fetchTodo, fetchTodoComments } from '@/lib/db/todos';

const paramsSchema = z.object({
  todoId: z.string().uuid(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(4000),
});

export async function GET(req: NextRequest, context: { params: Promise<{ todoId: string }> }) {
  const params = await context.params;
  const parsedParams = paramsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const comments = await fetchTodoComments(ctx.supabase, parsedParams.data.todoId);
    return NextResponse.json({ comments });
  } catch (error) {
    console.error('[todo-comments][GET] Failed to load comments', error);
    return NextResponse.json({ error: 'Failed to load comments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ todoId: string }> }) {
  const params = await context.params;
  const parsedParams = paramsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid todo id' }, { status: 400 });
  }

  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const body = await req.json().catch(() => null);
  const parsedBody = commentSchema.safeParse(body ?? {});

  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 400 });
  }

  const todoId = parsedParams.data.todoId;

  try {
    const todo = await fetchTodo(ctx.supabase, todoId);
    if (!todo) {
      return NextResponse.json({ error: 'Task not found or access denied' }, { status: 404 });
    }

    const { data: inserted, error: insertError } = await ctx.supabase
      .from('todo_comments')
      .insert({
        todo_id: todoId,
        body: parsedBody.data.body,
        created_by: ctx.user.id,
      })
      .select(
        `*, author:profiles!todo_comments_created_by_fkey ( id, username, avatar_url )`
      )
      .single();

    if (insertError || !inserted) {
      return NextResponse.json({ error: insertError?.message ?? 'Failed to add comment' }, { status: 400 });
    }

    const { error: activityError } = await ctx.supabase.from('todo_activity').insert({
      todo_id: todoId,
      event_type: 'comment',
      note: parsedBody.data.body,
      payload: null,
      performed_by: ctx.user.id,
    });

    if (activityError) {
      console.warn('[todo-comments][POST] Failed to log comment activity', activityError);
    }

    const comments = await fetchTodoComments(ctx.supabase, todoId);

    return NextResponse.json({ comment: inserted, comments }, { status: 201 });
  } catch (error) {
    console.error('[todo-comments][POST] Unexpected error', error);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}

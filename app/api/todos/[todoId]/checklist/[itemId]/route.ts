import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRouteClient } from '@/lib/supabase-route';

export const dynamic = 'force-dynamic';

const updateChecklistItemSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    isCompleted: z.boolean().optional(),
    position: z.number().int().optional(),
});

export async function PATCH(
    req: NextRequest,
    { params }: { params: { todoId: string; itemId: string } }
) {
    const ctx = await getRouteClient(req);
    if ('error' in ctx) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    const { todoId, itemId } = params;
    const body = await req.json().catch(() => null);
    const parsedBody = updateChecklistItemSchema.safeParse(body ?? {});

    if (!parsedBody.success) {
        return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 400 });
    }

    try {
        const updates: Record<string, any> = {};
        if (parsedBody.data.title !== undefined) updates.title = parsedBody.data.title;
        if (parsedBody.data.isCompleted !== undefined) updates.is_completed = parsedBody.data.isCompleted;
        if (parsedBody.data.position !== undefined) updates.position = parsedBody.data.position;

        const { data, error } = await ctx.supabase
            .from('todo_checklist_items')
            .update(updates)
            .eq('id', itemId)
            .eq('todo_id', todoId) // Ensure item belongs to todo
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ item: data });
    } catch (error) {
        console.error('Failed to update checklist item', error);
        return NextResponse.json({ error: 'Failed to update checklist item' }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { todoId: string; itemId: string } }
) {
    const ctx = await getRouteClient(req);
    if ('error' in ctx) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    const { todoId, itemId } = params;

    try {
        const { error } = await ctx.supabase
            .from('todo_checklist_items')
            .delete()
            .eq('id', itemId)
            .eq('todo_id', todoId);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete checklist item', error);
        return NextResponse.json({ error: 'Failed to delete checklist item' }, { status: 500 });
    }
}

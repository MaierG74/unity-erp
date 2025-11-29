import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRouteClient } from '@/lib/supabase-route';


export const dynamic = 'force-dynamic';

const createChecklistItemSchema = z.object({
    title: z.string().min(1).max(255),
});

export async function POST(
    req: NextRequest,
    { params }: { params: { todoId: string } }
) {
    const ctx = await getRouteClient(req);
    if ('error' in ctx) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    const todoId = params.todoId;
    const body = await req.json().catch(() => null);
    const parsedBody = createChecklistItemSchema.safeParse(body ?? {});

    if (!parsedBody.success) {
        return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 400 });
    }

    try {
        // Verify access (using RLS via Supabase client is safest, but we can also check explicitly)
        // Since we are using the authenticated client, RLS on the table will handle permissions.

        // Get max position
        const { data: maxPosData } = await ctx.supabase
            .from('todo_checklist_items')
            .select('position')
            .eq('todo_id', todoId)
            .order('position', { ascending: false })
            .limit(1)
            .single();

        const nextPosition = (maxPosData?.position ?? -1) + 1;

        const { data, error } = await ctx.supabase
            .from('todo_checklist_items')
            .insert({
                todo_id: todoId,
                title: parsedBody.data.title,
                position: nextPosition,
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ item: data });
    } catch (error) {
        console.error('Failed to create checklist item', error);
        return NextResponse.json({ error: 'Failed to create checklist item' }, { status: 500 });
    }
}

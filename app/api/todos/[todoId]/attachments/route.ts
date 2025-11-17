import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { fetchTodoAttachments } from '@/lib/db/todos';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ todoId: string }> }
) {
  try {
    const { todoId } = await context.params;
    const ctx = await getRouteClient(request);
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    const attachments = await fetchTodoAttachments(ctx.supabase, todoId);
    return NextResponse.json(attachments);
  } catch (error) {
    console.error('Error fetching attachments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch attachments' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ todoId: string }> }
) {
  try {
    const { todoId } = await context.params;
    const ctx = await getRouteClient(request);
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Upload to Supabase storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${todoId}/${Date.now()}.${fileExt}`;
    const filePath = `todos/${fileName}`;

    const { error: uploadError, data } = await ctx.supabase.storage
      .from('QButton')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload file' },
        { status: 500 }
      );
    }

    // Save attachment record to database
    const { data: attachment, error: dbError } = await ctx.supabase
      .from('todo_attachments')
      .insert({
        todo_id: todoId,
        file_name: file.name,
        file_path: filePath,
        mime_type: file.type,
        file_size: file.size,
        uploaded_by: ctx.user.id,
      })
      .select('*, uploader:profiles!todo_attachments_uploaded_by_fkey(id, username, avatar_url)')
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Clean up uploaded file
      await ctx.supabase.storage.from('QButton').remove([filePath]);
      return NextResponse.json(
        { error: 'Failed to save attachment' },
        { status: 500 }
      );
    }

    return NextResponse.json(attachment);
  } catch (error) {
    console.error('Error uploading attachment:', error);
    return NextResponse.json(
      { error: 'Failed to upload attachment' },
      { status: 500 }
    );
  }
}

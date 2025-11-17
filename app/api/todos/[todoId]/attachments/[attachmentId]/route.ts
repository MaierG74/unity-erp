import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ todoId: string; attachmentId: string }> }
) {
  try {
    const { todoId, attachmentId } = await context.params;
    const ctx = await getRouteClient(request);
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    // Get attachment details
    const { data: attachment, error: fetchError } = await ctx.supabase
      .from('todo_attachments')
      .select('file_path, uploaded_by')
      .eq('id', attachmentId)
      .eq('todo_id', todoId)
      .single();

    if (fetchError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Check if user is the uploader or todo manager
    const { data: todo } = await ctx.supabase
      .from('todo_items')
      .select('created_by, assigned_to')
      .eq('id', todoId)
      .single();

    const canDelete =
      attachment.uploaded_by === ctx.user.id ||
      todo?.created_by === ctx.user.id ||
      todo?.assigned_to === ctx.user.id;

    if (!canDelete) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete from storage
    const { error: storageError } = await ctx.supabase.storage
      .from('QButton')
      .remove([attachment.file_path]);

    if (storageError) {
      console.error('Storage deletion error:', storageError);
    }

    // Delete from database
    const { error: deleteError } = await ctx.supabase
      .from('todo_attachments')
      .delete()
      .eq('id', attachmentId);

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to delete attachment' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting attachment:', error);
    return NextResponse.json(
      { error: 'Failed to delete attachment' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ todoId: string; attachmentId: string }> }
) {
  try {
    const { todoId, attachmentId } = await context.params;
    const ctx = await getRouteClient(request);
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
    }

    // Get attachment details
    const { data: attachment, error: fetchError } = await ctx.supabase
      .from('todo_attachments')
      .select('file_path')
      .eq('id', attachmentId)
      .eq('todo_id', todoId)
      .single();

    if (fetchError || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Get signed URL for download
    const { data, error } = await ctx.supabase.storage
      .from('QButton')
      .createSignedUrl(attachment.file_path, 60); // 60 seconds expiry

    if (error || !data) {
      return NextResponse.json(
        { error: 'Failed to generate download URL' },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch (error) {
    console.error('Error getting attachment URL:', error);
    return NextResponse.json(
      { error: 'Failed to get attachment' },
      { status: 500 }
    );
  }
}

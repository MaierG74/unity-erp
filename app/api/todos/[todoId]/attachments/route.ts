import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { fetchTodoAttachments } from '@/lib/db/todos';

export async function GET(
  request: NextRequest,
  { params }: { params: { todoId: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const attachments = await fetchTodoAttachments(supabase, params.todoId);
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
  { params }: { params: { todoId: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Upload to Supabase storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${params.todoId}/${Date.now()}.${fileExt}`;
    const filePath = `todos/${fileName}`;

    const { error: uploadError, data } = await supabase.storage
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
    const { data: attachment, error: dbError } = await supabase
      .from('todo_attachments')
      .insert({
        todo_id: params.todoId,
        file_name: file.name,
        file_path: filePath,
        mime_type: file.type,
        file_size: file.size,
        uploaded_by: user.id,
      })
      .select('*, uploader:profiles!todo_attachments_uploaded_by_fkey(id, username, avatar_url)')
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Clean up uploaded file
      await supabase.storage.from('QButton').remove([filePath]);
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

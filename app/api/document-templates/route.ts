import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateType = searchParams.get('type');
    const category = searchParams.get('category');

    let query = supabaseAdmin
      .from('document_templates')
      .select('*')
      .eq('is_active', true)
      .order('template_category')
      .order('name');

    if (templateType) {
      query = query.eq('template_type', templateType);
    }

    if (category) {
      query = query.eq('template_category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching templates:', error);
      return NextResponse.json(
        { error: 'Failed to fetch templates' },
        { status: 500 }
      );
    }

    return NextResponse.json({ templates: data });
  } catch (error) {
    console.error('Error in GET /api/document-templates:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { template_id, template_type, content, name } = body;

    if (!template_type && !template_id) {
      return NextResponse.json(
        { error: 'template_type or template_id is required' },
        { status: 400 }
      );
    }

    if (content === undefined) {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { content, updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;

    let query = supabaseAdmin
      .from('document_templates')
      .update(updates);

    if (template_id) {
      query = query.eq('template_id', template_id);
    } else {
      query = query.eq('template_type', template_type);
    }

    const { data, error } = await query.select().single();

    if (error) {
      console.error('Error updating template:', error);
      return NextResponse.json(
        { error: 'Failed to update template' },
        { status: 500 }
      );
    }

    return NextResponse.json({ template: data });
  } catch (error) {
    console.error('Error in PUT /api/document-templates:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, content, template_type, template_category } = body;

    if (!name || content === undefined || !template_type || !template_category) {
      return NextResponse.json(
        { error: 'name, content, template_type, and template_category are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('document_templates')
      .insert({
        name,
        content,
        template_type,
        template_category,
        is_active: true,
        placeholders: [],
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating template:', error);
      return NextResponse.json(
        { error: 'Failed to create template' },
        { status: 500 }
      );
    }

    return NextResponse.json({ template: data }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/document-templates:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('id');

    if (!templateId) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from('document_templates')
      .delete()
      .eq('template_id', parseInt(templateId, 10));

    if (error) {
      console.error('Error deleting template:', error);
      return NextResponse.json(
        { error: 'Failed to delete template' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/document-templates:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

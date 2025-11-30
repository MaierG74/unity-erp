import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/settings - fetch company settings (single row id=1)
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('quote_company_settings')
      .select('*')
      .eq('setting_id', 1)
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch settings', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ settings: data });
  } catch (err: any) {
    return NextResponse.json({ error: 'Unexpected error', details: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}

// PUT /api/settings - update company settings
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    // Only allow writable fields
    const allowed = ['company_name','company_logo_path','address_line1','address_line2','city','postal_code','country','phone','email','website','vat_number','bank_details','terms_conditions','fg_auto_consume_on_add'];
    const updates: Record<string, any> = {};
    for (const k of allowed) {
      if (k in body) updates[k] = body[k];
    }

    const { data, error } = await supabaseAdmin
      .from('quote_company_settings')
      .update(updates)
      .eq('setting_id', 1)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update settings', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ settings: data });
  } catch (err: any) {
    return NextResponse.json({ error: 'Unexpected error', details: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}

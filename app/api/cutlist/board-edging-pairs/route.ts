import { NextRequest, NextResponse } from 'next/server';

import { requireProductsAccess } from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

function parsePositiveNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const url = new URL(request.url);
  const boardComponentId = parsePositiveNumber(url.searchParams.get('boardComponentId'));
  const thicknessMm = parsePositiveNumber(url.searchParams.get('thicknessMm'));

  if (!boardComponentId || !thicknessMm) {
    return NextResponse.json({ error: 'boardComponentId and thicknessMm are required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('board_edging_pairs')
    .select('board_component_id, thickness_mm, edging_component_id')
    .eq('org_id', auth.orgId)
    .eq('board_component_id', boardComponentId)
    .eq('thickness_mm', thicknessMm)
    .maybeSingle();

  if (error) {
    console.error('[cutlist/board-edging-pairs GET] error', error);
    return NextResponse.json({ error: 'Failed to load board edging pair' }, { status: 500 });
  }

  let edgingName: string | null = null;
  if (data?.edging_component_id) {
    const { data: component } = await supabaseAdmin
      .from('components')
      .select('internal_code, description')
      .eq('org_id', auth.orgId)
      .eq('component_id', data.edging_component_id)
      .maybeSingle();
    edgingName = component?.description ?? component?.internal_code ?? null;
  }

  return NextResponse.json({
    pair: data
      ? {
          board_component_id: data.board_component_id,
          thickness_mm: Number(data.thickness_mm),
          edging_component_id: data.edging_component_id,
          edging_component_name: edgingName,
        }
      : null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const boardComponentId = Number(body?.board_component_id);
  const thicknessMm = Number(body?.thickness_mm);
  const edgingComponentId = Number(body?.edging_component_id);

  if (
    !Number.isFinite(boardComponentId) ||
    boardComponentId <= 0 ||
    !Number.isFinite(thicknessMm) ||
    thicknessMm <= 0 ||
    !Number.isFinite(edgingComponentId) ||
    edgingComponentId <= 0
  ) {
    return NextResponse.json({ error: 'Valid board, thickness, and edging are required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('board_edging_pairs')
    .upsert(
      {
        org_id: auth.orgId,
        board_component_id: boardComponentId,
        thickness_mm: thicknessMm,
        edging_component_id: edgingComponentId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,board_component_id,thickness_mm' }
    );

  if (error) {
    console.error('[cutlist/board-edging-pairs POST] error', error);
    return NextResponse.json({ error: 'Failed to save board edging pair' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

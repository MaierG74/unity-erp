import type { SupabaseClient } from '@supabase/supabase-js';

import {
  boardEdgingPairKey,
  type BoardEdgingPairLookup,
  type CutlistLineMaterial,
} from '@/lib/orders/snapshot-types';

export async function loadCutlistLineMaterial(
  supabaseAdmin: SupabaseClient<any, any, any>,
  componentId: unknown,
  orgId: string
): Promise<CutlistLineMaterial> {
  const id = Number(componentId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { data, error } = await supabaseAdmin
    .from('components')
    .select('component_id, internal_code, description')
    .eq('org_id', orgId)
    .eq('component_id', id)
    .maybeSingle();

  if (error) throw error;
  const component = data as any;
  if (!component) return null;

  return {
    component_id: component.component_id,
    component_name: component.description ?? component.internal_code ?? null,
  };
}

export async function loadBoardEdgingPairLookup(
  supabaseAdmin: SupabaseClient<any, any, any>,
  orgId: string
): Promise<BoardEdgingPairLookup> {
  const { data, error } = await supabaseAdmin
    .from('board_edging_pairs')
    .select('board_component_id, thickness_mm, edging_component_id')
    .eq('org_id', orgId);

  if (error) throw error;
  const rows = data ?? [];
  const edgingIds = Array.from(new Set(rows.map((row: any) => Number(row.edging_component_id)).filter(Boolean)));
  const names = new Map<number, string | null>();

  if (edgingIds.length > 0) {
    const { data: components, error: componentError } = await supabaseAdmin
      .from('components')
      .select('component_id, internal_code, description')
      .eq('org_id', orgId)
      .in('component_id', edgingIds);
    if (componentError) throw componentError;
    for (const component of (components ?? []) as any[]) {
      names.set(component.component_id, component.description ?? component.internal_code ?? null);
    }
  }

  return new Map(
    (rows as any[]).map((row: any) => [
      boardEdgingPairKey(Number(row.board_component_id), Number(row.thickness_mm)),
      {
        component_id: Number(row.edging_component_id),
        component_name: names.get(Number(row.edging_component_id)) ?? null,
      },
    ])
  );
}

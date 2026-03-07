import type { SupabaseClient } from '@supabase/supabase-js';

type InventoryRow = {
  quantity_on_hand?: number | string | null;
  reorder_level?: number | string | null;
  location?: string | null;
};

export type AssistantComponentSearchRow = {
  component_id: number;
  internal_code: string | null;
  description: string | null;
  inventory?: InventoryRow | InventoryRow[] | null;
};

export type AssistantComponentLookupResult =
  | {
      kind: 'resolved';
      component: AssistantComponentSearchRow;
    }
  | {
      kind: 'ambiguous';
      component_ref: string;
      candidates: Array<{
        component_id: number;
        internal_code: string;
        description: string | null;
      }>;
    }
  | {
      kind: 'not_found';
      component_ref: string;
    };

export function getRelationRecord<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function escapeIlikeTerm(value: string) {
  return value.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenizeReference(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function scoreCandidate(row: AssistantComponentSearchRow, rawReference: string, tokens: string[]) {
  const ref = rawReference.toLowerCase();
  const code = (row.internal_code ?? '').toLowerCase();
  const description = (row.description ?? '').toLowerCase();
  let score = 0;

  if (code === ref) score += 120;
  if (description === ref) score += 110;
  if (code.startsWith(ref)) score += 80;
  if (description.startsWith(ref)) score += 70;
  if (code.includes(ref)) score += 60;
  if (description.includes(ref)) score += 55;

  for (const token of tokens) {
    if (code === token) score += 35;
    else if (code.startsWith(token)) score += 22;
    else if (code.includes(token)) score += 16;

    if (description === token) score += 28;
    else if (description.startsWith(token)) score += 18;
    else if (description.includes(token)) score += 12;
  }

  return score;
}

export async function resolveAssistantComponent(
  supabase: SupabaseClient,
  componentRef: string
): Promise<AssistantComponentLookupResult> {
  const normalizedRef = escapeIlikeTerm(componentRef);
  if (!normalizedRef) {
    return { kind: 'not_found', component_ref: componentRef };
  }

  const tokens = Array.from(new Set(tokenizeReference(normalizedRef))).slice(0, 5);
  const orTerms = Array.from(new Set([normalizedRef, ...tokens]))
    .filter(Boolean)
    .flatMap(term => [`internal_code.ilike.%${term}%`, `description.ilike.%${term}%`]);

  const { data, error } = await supabase
    .from('components')
    .select('component_id, internal_code, description, inventory(quantity_on_hand, reorder_level, location)')
    .or(orTerms.join(','))
    .order('internal_code')
    .limit(25);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as AssistantComponentSearchRow[];
  if (rows.length === 0) {
    return { kind: 'not_found', component_ref: componentRef };
  }

  const scored = rows
    .map(row => ({ row, score: scoreCandidate(row, normalizedRef.toLowerCase(), tokens) }))
    .sort((a, b) => b.score - a.score);

  const [top, second] = scored;
  if (!top || top.score < 20) {
    return { kind: 'not_found', component_ref: componentRef };
  }

  const topCode = (top.row.internal_code ?? '').toLowerCase();
  const topDescription = (top.row.description ?? '').toLowerCase();
  const exactMatch =
    topCode === normalizedRef.toLowerCase() || topDescription === normalizedRef.toLowerCase();

  if (!exactMatch && second && second.score >= top.score - 8) {
    return {
      kind: 'ambiguous',
      component_ref: componentRef,
      candidates: scored.slice(0, 4).map(({ row }) => ({
        component_id: row.component_id,
        internal_code: row.internal_code ?? `Component ${row.component_id}`,
        description: row.description ?? null,
      })),
    };
  }

  return { kind: 'resolved', component: top.row };
}

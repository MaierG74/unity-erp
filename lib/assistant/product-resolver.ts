import type { SupabaseClient } from '@supabase/supabase-js';

type AssistantProductSearchRow = {
  product_id: number;
  internal_code: string | null;
  name: string | null;
  description: string | null;
};

export type AssistantProductLookupResult =
  | {
      kind: 'resolved';
      product: AssistantProductSearchRow;
    }
  | {
      kind: 'ambiguous';
      product_ref: string;
      candidates: Array<{
        product_id: number;
        internal_code: string | null;
        name: string | null;
      }>;
    }
  | {
      kind: 'not_found';
      product_ref: string;
    };

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

function scoreCandidate(row: AssistantProductSearchRow, rawReference: string, tokens: string[]) {
  const ref = rawReference.toLowerCase();
  const code = (row.internal_code ?? '').toLowerCase();
  const name = (row.name ?? '').toLowerCase();
  const description = (row.description ?? '').toLowerCase();
  let score = 0;

  if (code === ref) score += 140;
  if (name === ref) score += 130;
  if (description === ref) score += 110;
  if (code.startsWith(ref)) score += 90;
  if (name.startsWith(ref)) score += 80;
  if (description.startsWith(ref)) score += 70;
  if (code.includes(ref)) score += 70;
  if (name.includes(ref)) score += 62;
  if (description.includes(ref)) score += 48;

  for (const token of tokens) {
    if (code === token) score += 40;
    else if (code.startsWith(token)) score += 24;
    else if (code.includes(token)) score += 18;

    if (name === token) score += 32;
    else if (name.startsWith(token)) score += 22;
    else if (name.includes(token)) score += 16;

    if (description === token) score += 18;
    else if (description.startsWith(token)) score += 12;
    else if (description.includes(token)) score += 8;
  }

  return score;
}

export async function resolveAssistantProduct(
  supabase: SupabaseClient,
  productRef: string
): Promise<AssistantProductLookupResult> {
  const normalizedRef = escapeIlikeTerm(productRef);
  if (!normalizedRef) {
    return { kind: 'not_found', product_ref: productRef };
  }

  const tokens = Array.from(new Set(tokenizeReference(normalizedRef))).slice(0, 5);
  const orTerms = Array.from(new Set([normalizedRef, ...tokens]))
    .filter(Boolean)
    .flatMap(term => [
      `internal_code.ilike.%${term}%`,
      `name.ilike.%${term}%`,
      `description.ilike.%${term}%`,
    ]);

  const { data, error } = await supabase
    .from('products')
    .select('product_id, internal_code, name, description')
    .or(orTerms.join(','))
    .order('internal_code')
    .limit(25);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as AssistantProductSearchRow[];
  if (rows.length === 0) {
    return { kind: 'not_found', product_ref: productRef };
  }

  const scored = rows
    .map(row => ({ row, score: scoreCandidate(row, normalizedRef.toLowerCase(), tokens) }))
    .sort((a, b) => b.score - a.score);

  const [top, second] = scored;
  if (!top || top.score < 24) {
    return { kind: 'not_found', product_ref: productRef };
  }

  const topCode = (top.row.internal_code ?? '').toLowerCase();
  const topName = (top.row.name ?? '').toLowerCase();
  const exactMatch = topCode === normalizedRef.toLowerCase() || topName === normalizedRef.toLowerCase();

  if (!exactMatch && second && second.score >= top.score - 8) {
    return {
      kind: 'ambiguous',
      product_ref: productRef,
      candidates: scored.slice(0, 4).map(({ row }) => ({
        product_id: row.product_id,
        internal_code: row.internal_code ?? null,
        name: row.name ?? null,
      })),
    };
  }

  return {
    kind: 'resolved',
    product: top.row,
  };
}

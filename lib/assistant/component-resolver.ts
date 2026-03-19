import type { SupabaseClient } from '@supabase/supabase-js';

import type { AssistantActionLink, AssistantCard } from '@/lib/assistant/prompt-suggestions';

type InventoryRow = {
  quantity_on_hand?: number | string | null;
  reorder_level?: number | string | null;
  location?: string | null;
};

type CategoryRow = {
  categoryname?: string | null;
};

export type AssistantComponentSearchRow = {
  component_id: number;
  internal_code: string | null;
  description: string | null;
  category?: CategoryRow | CategoryRow[] | null;
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

function normalizeComparableText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseComparableText(value: string) {
  return normalizeComparableText(value).replace(/\s+/g, '');
}

function singularizeToken(token: string) {
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith('s') && token.length > 4 && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenizeReference(value: string) {
  const rawTokens = normalizeComparableText(value)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);

  return Array.from(
    new Set(
      rawTokens.flatMap(token => {
        const singular = singularizeToken(token);
        return singular !== token ? [token, singular] : [token];
      })
    )
  );
}

type CandidateScore = {
  score: number;
  matched_token_count: number;
  matched_description_tokens: number;
  matched_code_tokens: number;
  exact_code_match: boolean;
  exact_description_match: boolean;
};

function scoreCandidate(
  row: AssistantComponentSearchRow,
  rawReference: string,
  normalizedReferencePhrase: string,
  tokens: string[]
): CandidateScore {
  const codeText = normalizeComparableText(row.internal_code ?? '');
  const descriptionText = normalizeComparableText(row.description ?? '');
  const collapsedReference = collapseComparableText(rawReference);
  const collapsedCode = collapseComparableText(row.internal_code ?? '');
  let score = 0;
  let matchedDescriptionTokens = 0;
  let matchedCodeTokens = 0;

  const exactCodeMatch = collapsedCode.length > 0 && collapsedCode === collapsedReference;
  const exactDescriptionMatch =
    descriptionText.length > 0 && descriptionText === normalizedReferencePhrase;

  if (exactCodeMatch) score += 150;
  if (exactDescriptionMatch) score += 140;

  if (!exactCodeMatch && collapsedReference.length > 1) {
    if (collapsedCode.startsWith(collapsedReference)) score += 95;
    else if (collapsedCode.includes(collapsedReference)) score += 70;
  }

  if (!exactDescriptionMatch && normalizedReferencePhrase.length > 1) {
    if (descriptionText.startsWith(normalizedReferencePhrase)) score += 90;
    else if (descriptionText.includes(normalizedReferencePhrase)) score += 72;
  }

  for (const token of tokens) {
    if (token.length < 2) continue;

    if (collapsedCode === token) {
      matchedCodeTokens += 1;
      score += 38;
    } else if (collapsedCode.startsWith(token)) {
      matchedCodeTokens += 1;
      score += 24;
    } else if (collapsedCode.includes(token)) {
      matchedCodeTokens += 1;
      score += 14;
    }

    if (descriptionText === token) {
      matchedDescriptionTokens += 1;
      score += 34;
    } else if (descriptionText.startsWith(token)) {
      matchedDescriptionTokens += 1;
      score += 24;
    } else if (descriptionText.includes(token)) {
      matchedDescriptionTokens += 1;
      score += 18;
    }
  }

  const matchedTokenCount = Math.max(matchedDescriptionTokens, matchedCodeTokens);

  if (tokens.length > 1 && matchedDescriptionTokens === tokens.length) {
    score += 24;
  } else if (tokens.length > 1 && matchedTokenCount === tokens.length) {
    score += 14;
  }

  if (!exactCodeMatch && matchedCodeTokens > 0 && matchedDescriptionTokens === 0) {
    score -= 6;
  }

  return {
    score,
    matched_token_count: matchedTokenCount,
    matched_description_tokens: matchedDescriptionTokens,
    matched_code_tokens: matchedCodeTokens,
    exact_code_match: exactCodeMatch,
    exact_description_match: exactDescriptionMatch,
  };
}

function isLikelyCategorySearch(rawReference: string) {
  const normalized = normalizeComparableText(rawReference);
  if (!normalized || /\d/.test(normalized)) {
    return false;
  }

  return normalized
    .split(/\s+/)
    .some(token => token.length > 4 && token.endsWith('s') && !token.endsWith('ss'));
}

export function shouldUseAssistantComponentSearch(rawReference: string) {
  const normalized = normalizeComparableText(rawReference);
  if (!normalized) {
    return false;
  }

  const collapsed = normalized.replace(/\s+/g, '');
  if (!normalized.includes(' ') && /^[a-z0-9-]{2,12}$/.test(collapsed) && !isLikelyCategorySearch(rawReference)) {
    return false;
  }

  if (/\d/.test(normalized)) {
    return false;
  }

  return isLikelyCategorySearch(rawReference) || normalized.split(/\s+/).length >= 2;
}

export function formatAssistantComponentCandidate(candidate: {
  internal_code: string;
  description: string | null;
}) {
  return candidate.description?.trim()
    ? `${candidate.internal_code} - ${candidate.description.trim()}`
    : candidate.internal_code;
}

export function buildAssistantComponentClarifyAnswer(
  componentRef: string,
  candidates: Array<{
    internal_code: string;
    description: string | null;
  }>
) {
  const lines = [
    `I found multiple possible components for "${componentRef}". Which one did you mean?`,
  ];

  if (candidates.length > 0) {
    lines.push('');
    lines.push('Possible matches:');
    for (const candidate of candidates) {
      lines.push(`- ${formatAssistantComponentCandidate(candidate)}`);
    }
  }

  return lines.join('\n');
}

export function buildAssistantComponentClarifyCard(
  componentRef: string,
  candidates: Array<{
    component_id: number;
    internal_code: string;
    description: string | null;
  }>,
  options: {
    buildPrompt: (internalCode: string) => string;
    primaryActionLabel?: string;
    description?: string;
  }
): AssistantCard {
  const rowActions: AssistantActionLink[][] = candidates.map(candidate => [
    {
      label: options.primaryActionLabel ?? 'Use this',
      kind: 'ask',
      prompt: options.buildPrompt(candidate.internal_code),
    },
    {
      label: 'Open inventory',
      kind: 'navigate',
      href: `/inventory?tab=components&q=${encodeURIComponent(candidate.internal_code)}`,
    },
  ]);

  return {
    type: 'table',
    title: `Component options for "${componentRef}"`,
    description:
      options.description ??
      'Pick the exact component you want to use for this question, or open it in Inventory.',
    metrics: [
      {
        label: 'Matches',
        value: String(candidates.length),
      },
    ],
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Description' },
    ],
    rows: candidates.map(candidate => ({
      code: candidate.internal_code,
      description: candidate.description?.trim() || 'No description',
    })),
    rowActions,
    footer: 'Click a row or use the action buttons to continue with one exact component.',
  };
}

function buildSearchTerms(componentRef: string) {
  const normalizedRef = escapeIlikeTerm(componentRef);
  const tokens = Array.from(new Set(tokenizeReference(normalizedRef))).slice(0, 5);
  const normalizedReferencePhrase = Array.from(new Set(tokens.map(token => singularizeToken(token)))).join(' ');
  const orTerms = Array.from(new Set([normalizedRef, ...tokens]))
    .filter(Boolean)
    .flatMap(term => [`internal_code.ilike.%${term}%`, `description.ilike.%${term}%`]);

  return {
    normalizedRef,
    normalizedReferencePhrase,
    tokens,
    orTerms,
  };
}

function sortScoredRows(rows: AssistantComponentSearchRow[], normalizedRef: string, normalizedReferencePhrase: string, tokens: string[]) {
  return rows
    .map(row => ({
      row,
      ...scoreCandidate(row, normalizedRef, normalizedReferencePhrase, tokens),
    }))
    .sort((a, b) => b.score - a.score || b.matched_description_tokens - a.matched_description_tokens);
}

export async function searchAssistantComponents(
  supabase: SupabaseClient,
  componentRef: string,
  limit = 8
) {
  const { normalizedRef, normalizedReferencePhrase, tokens, orTerms } = buildSearchTerms(componentRef);
  if (!normalizedRef || orTerms.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('components')
    .select(
      'component_id, internal_code, description, category:component_categories(categoryname), inventory(quantity_on_hand, reorder_level, location)'
    )
    .or(orTerms.join(','))
    .order('internal_code')
    .limit(Math.max(limit, 25));

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as AssistantComponentSearchRow[];
  return sortScoredRows(rows, normalizedRef, normalizedReferencePhrase, tokens)
    .filter(candidate => candidate.score >= 14 && candidate.matched_token_count > 0)
    .slice(0, limit)
    .map(candidate => candidate.row);
}

export async function resolveAssistantComponent(
  supabase: SupabaseClient,
  componentRef: string
): Promise<AssistantComponentLookupResult> {
  const { normalizedRef, normalizedReferencePhrase, tokens, orTerms } = buildSearchTerms(componentRef);
  if (!normalizedRef) {
    return { kind: 'not_found', component_ref: componentRef };
  }

  const { data, error } = await supabase
    .from('components')
    .select(
      'component_id, internal_code, description, category:component_categories(categoryname), inventory(quantity_on_hand, reorder_level, location)'
    )
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

  const broadCategorySearch = isLikelyCategorySearch(normalizedRef);
  const scored = sortScoredRows(rows, normalizedRef, normalizedReferencePhrase, tokens);

  const [top, second] = scored;
  if (!top || top.score < 20) {
    return { kind: 'not_found', component_ref: componentRef };
  }

  const exactMatch = top.exact_code_match || top.exact_description_match;
  const strongCandidates = scored.filter(candidate => candidate.score >= 22 && candidate.matched_token_count > 0);
  const broadAmbiguity =
    !exactMatch &&
    strongCandidates.length >= 2 &&
    ((broadCategorySearch &&
      strongCandidates[1]?.matched_token_count >= Math.max(1, tokens.length - 1)) ||
      tokens.length === 1 ||
      top.matched_description_tokens < tokens.length);

  if ((!exactMatch && second && second.score >= top.score - 8) || broadAmbiguity) {
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

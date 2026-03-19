import type { SupabaseClient } from '@supabase/supabase-js';

import type { AssistantActionLink, AssistantCard } from '@/lib/assistant/prompt-suggestions';

export type AssistantEntityKind = 'customer' | 'supplier' | 'product' | 'component';

export type AssistantEntityCandidate = {
  kind: AssistantEntityKind;
  id: number;
  label: string;
  code: string | null;
  description: string | null;
  score: number;
};

export type AssistantEntityLookupResult =
  | {
      kind: 'resolved';
      candidate: AssistantEntityCandidate;
    }
  | {
      kind: 'ambiguous';
      query: string;
      candidates: AssistantEntityCandidate[];
    }
  | {
      kind: 'not_found';
      query: string;
    };

export type AssistantScopedEntityLookupResult =
  | {
      kind: 'resolved';
      candidate: AssistantEntityCandidate;
      candidates: AssistantEntityCandidate[];
      primaryCandidates: AssistantEntityCandidate[];
      secondaryCandidates: AssistantEntityCandidate[];
    }
  | {
      kind: 'clarify';
      query: string;
      candidates: AssistantEntityCandidate[];
      primaryCandidates: AssistantEntityCandidate[];
      secondaryCandidates: AssistantEntityCandidate[];
    }
  | {
      kind: 'not_found';
      query: string;
      candidates: AssistantEntityCandidate[];
      primaryCandidates: AssistantEntityCandidate[];
      secondaryCandidates: AssistantEntityCandidate[];
    };

type AssistantEntityLookupOptions = {
  preferredKinds?: AssistantEntityKind[];
  allowedKinds?: AssistantEntityKind[];
  limitPerKind?: number;
  strictPreferredKinds?: boolean;
  fallbackToOtherKinds?: boolean;
};

type AssistantScopedEntityLookupOptions = AssistantEntityLookupOptions & {
  primaryKinds: AssistantEntityKind[];
  secondaryKinds?: AssistantEntityKind[];
  ambiguityGap?: number;
};

type AssistantEntityClarifyCardOptions = {
  title?: string;
  description?: string;
  buildPrimaryPrompt: (candidate: AssistantEntityCandidate) => string | null;
  buildPrimaryLabel?: (candidate: AssistantEntityCandidate) => string;
  buildSecondaryAction?: (candidate: AssistantEntityCandidate) => AssistantActionLink | null;
};

type CustomerLookupRow = {
  id: number;
  name?: string | null;
};

type SupplierLookupRow = {
  supplier_id: number;
  name?: string | null;
};

type ProductLookupRow = {
  product_id: number;
  internal_code?: string | null;
  name?: string | null;
  description?: string | null;
};

type ComponentLookupRow = {
  component_id: number;
  internal_code?: string | null;
  description?: string | null;
};

const DEFAULT_KINDS: AssistantEntityKind[] = ['customer', 'supplier', 'product', 'component'];
const DEFAULT_LIMIT_PER_KIND = 8;
const MIN_SCORE_BY_KIND: Record<AssistantEntityKind, number> = {
  customer: 70,
  supplier: 70,
  product: 32,
  component: 32,
};
const AMBIGUITY_GAP = 10;

function formatAssistantEntityKind(kind: AssistantEntityKind) {
  switch (kind) {
    case 'customer':
      return 'Customer';
    case 'supplier':
      return 'Supplier';
    case 'product':
      return 'Product';
    case 'component':
      return 'Component';
    default:
      return 'Entity';
  }
}

export function formatAssistantEntityCandidate(candidate: AssistantEntityCandidate) {
  const label = candidate.label.trim();
  const code = candidate.code?.trim();

  if (!code || code.toLowerCase() === label.toLowerCase()) {
    return label || `${formatAssistantEntityKind(candidate.kind)} ${candidate.id}`;
  }

  return `${label} (${code})`;
}

export function buildAssistantEntityClarifyAnswer(
  query: string,
  candidates: AssistantEntityCandidate[],
  options?: { leadIn?: string }
) {
  const lines = [
    options?.leadIn ?? `I found multiple possible matches for "${query}". Which one did you mean?`,
  ];

  if (candidates.length > 0) {
    lines.push('');
    lines.push('Possible matches:');
    for (const candidate of candidates) {
      lines.push(`- ${formatAssistantEntityKind(candidate.kind)}: ${formatAssistantEntityCandidate(candidate)}`);
    }
  }

  return lines.join('\n');
}

export function buildAssistantEntityClarifyCard(
  query: string,
  candidates: AssistantEntityCandidate[],
  options: AssistantEntityClarifyCardOptions
): AssistantCard {
  const rowActions: AssistantActionLink[][] = candidates.map(candidate => {
    const actions: AssistantActionLink[] = [];
    const primaryPrompt = options.buildPrimaryPrompt(candidate);

    if (primaryPrompt) {
      actions.push({
        label:
          options.buildPrimaryLabel?.(candidate) ??
          `Use ${formatAssistantEntityKind(candidate.kind).toLowerCase()}`,
        kind: 'ask',
        prompt: primaryPrompt,
      });
    }

    const secondaryAction = options.buildSecondaryAction?.(candidate);
    if (secondaryAction) {
      actions.push(secondaryAction);
    }

    return actions;
  });

  return {
    type: 'table',
    title: options.title ?? `Choose what "${query}" refers to`,
    description:
      options.description ??
      'I found matches in more than one Unity data area. Pick the one you meant so I can keep going.',
    metrics: [
      {
        label: 'Matches',
        value: String(candidates.length),
      },
    ],
    columns: [
      { key: 'kind', label: 'Type' },
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Code' },
    ],
    rows: candidates.map(candidate => ({
      kind: formatAssistantEntityKind(candidate.kind),
      name: candidate.label,
      code: candidate.code?.trim() || '—',
    })),
    rowActions,
    footer: 'Click a row or use the action button to continue with the right Unity record.',
  };
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

function scoreEntityCandidate(
  candidate: { code?: string | null; label: string; description?: string | null },
  rawReference: string,
  normalizedReferencePhrase: string,
  tokens: string[]
) {
  const codeText = normalizeComparableText(candidate.code ?? '');
  const labelText = normalizeComparableText(candidate.label);
  const descriptionText = normalizeComparableText(candidate.description ?? '');
  const collapsedReference = collapseComparableText(rawReference);
  const collapsedCode = collapseComparableText(candidate.code ?? '');
  let score = 0;
  let matchedLabelTokens = 0;
  let matchedCodeTokens = 0;
  let matchedDescriptionTokens = 0;

  if (collapsedCode.length > 0 && collapsedCode === collapsedReference) {
    score += 150;
  }

  if (labelText.length > 0 && labelText === normalizedReferencePhrase) {
    score += 140;
  }

  if (descriptionText.length > 0 && descriptionText === normalizedReferencePhrase) {
    score += 110;
  }

  if (collapsedReference.length > 1 && collapsedCode.length > 0) {
    if (collapsedCode.startsWith(collapsedReference)) score += 95;
    else if (collapsedCode.includes(collapsedReference)) score += 70;
  }

  if (normalizedReferencePhrase.length > 1) {
    if (labelText.startsWith(normalizedReferencePhrase)) score += 90;
    else if (labelText.includes(normalizedReferencePhrase)) score += 72;

    if (descriptionText.startsWith(normalizedReferencePhrase)) score += 62;
    else if (descriptionText.includes(normalizedReferencePhrase)) score += 40;
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

    if (labelText === token) {
      matchedLabelTokens += 1;
      score += 34;
    } else if (labelText.startsWith(token)) {
      matchedLabelTokens += 1;
      score += 24;
    } else if (labelText.includes(token)) {
      matchedLabelTokens += 1;
      score += 18;
    }

    if (descriptionText === token) {
      matchedDescriptionTokens += 1;
      score += 20;
    } else if (descriptionText.startsWith(token)) {
      matchedDescriptionTokens += 1;
      score += 12;
    } else if (descriptionText.includes(token)) {
      matchedDescriptionTokens += 1;
      score += 8;
    }
  }

  const strongestTokenCoverage = Math.max(
    matchedLabelTokens,
    matchedCodeTokens,
    matchedDescriptionTokens
  );

  if (tokens.length > 1 && matchedLabelTokens === tokens.length) {
    score += 24;
  } else if (tokens.length > 1 && strongestTokenCoverage === tokens.length) {
    score += 12;
  }

  return score;
}

async function searchCustomers(
  supabase: SupabaseClient,
  query: string,
  limitPerKind: number
): Promise<AssistantEntityCandidate[]> {
  const escapedQuery = escapeIlikeTerm(query);
  if (!escapedQuery) {
    return [];
  }

  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .ilike('name', `%${escapedQuery}%`)
    .limit(limitPerKind);

  if (error) {
    throw error;
  }

  const normalizedReference = normalizeComparableText(query);
  const tokens = tokenizeReference(query);

  return ((data ?? []) as CustomerLookupRow[])
    .map(row => {
      const label = row.name?.trim() ?? '';
      return {
        kind: 'customer' as const,
        id: row.id,
        label,
        code: null,
        description: null,
        score: scoreEntityCandidate(
          { label },
          query,
          normalizedReference,
          tokens
        ),
      };
    })
    .filter(candidate => candidate.label);
}

async function searchSuppliers(
  supabase: SupabaseClient,
  query: string,
  limitPerKind: number
): Promise<AssistantEntityCandidate[]> {
  const escapedQuery = escapeIlikeTerm(query);
  if (!escapedQuery) {
    return [];
  }

  const { data, error } = await supabase
    .from('suppliers')
    .select('supplier_id, name')
    .ilike('name', `%${escapedQuery}%`)
    .limit(limitPerKind);

  if (error) {
    throw error;
  }

  const normalizedReference = normalizeComparableText(query);
  const tokens = tokenizeReference(query);

  return ((data ?? []) as SupplierLookupRow[])
    .map(row => {
      const label = row.name?.trim() ?? '';
      return {
        kind: 'supplier' as const,
        id: row.supplier_id,
        label,
        code: null,
        description: null,
        score: scoreEntityCandidate(
          { label },
          query,
          normalizedReference,
          tokens
        ),
      };
    })
    .filter(candidate => candidate.label);
}

async function searchProducts(
  supabase: SupabaseClient,
  query: string,
  limitPerKind: number
): Promise<AssistantEntityCandidate[]> {
  const escapedQuery = escapeIlikeTerm(query);
  if (!escapedQuery) {
    return [];
  }

  const tokens = tokenizeReference(query).slice(0, 5);
  const orTerms = Array.from(new Set([escapedQuery, ...tokens]))
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
    .limit(limitPerKind);

  if (error) {
    throw error;
  }

  const normalizedReference = normalizeComparableText(query);

  return ((data ?? []) as ProductLookupRow[])
    .map(row => {
      const label = row.name?.trim() || row.internal_code?.trim() || `Product ${row.product_id}`;
      return {
        kind: 'product' as const,
        id: row.product_id,
        label,
        code: row.internal_code?.trim() ?? null,
        description: row.description?.trim() ?? null,
        score: scoreEntityCandidate(
          {
            code: row.internal_code ?? null,
            label,
            description: row.description ?? null,
          },
          query,
          normalizedReference,
          tokens
        ),
      };
    })
    .filter(candidate => candidate.label);
}

async function searchComponents(
  supabase: SupabaseClient,
  query: string,
  limitPerKind: number
): Promise<AssistantEntityCandidate[]> {
  const escapedQuery = escapeIlikeTerm(query);
  if (!escapedQuery) {
    return [];
  }

  const tokens = tokenizeReference(query).slice(0, 5);
  const orTerms = Array.from(new Set([escapedQuery, ...tokens]))
    .filter(Boolean)
    .flatMap(term => [
      `internal_code.ilike.%${term}%`,
      `description.ilike.%${term}%`,
    ]);

  const { data, error } = await supabase
    .from('components')
    .select('component_id, internal_code, description')
    .or(orTerms.join(','))
    .limit(limitPerKind);

  if (error) {
    throw error;
  }

  const normalizedReference = normalizeComparableText(query);

  return ((data ?? []) as ComponentLookupRow[])
    .map(row => {
      const label =
        row.internal_code?.trim() ||
        row.description?.trim() ||
        `Component ${row.component_id}`;
      return {
        kind: 'component' as const,
        id: row.component_id,
        label,
        code: row.internal_code?.trim() ?? null,
        description: row.description?.trim() ?? null,
        score: scoreEntityCandidate(
          {
            code: row.internal_code ?? null,
            label,
            description: row.description ?? null,
          },
          query,
          normalizedReference,
          tokens
        ),
      };
    })
    .filter(candidate => candidate.label);
}

export async function searchAssistantEntities(
  supabase: SupabaseClient,
  query: string,
  options: AssistantEntityLookupOptions = {}
) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const allowedKinds = options.allowedKinds?.length ? options.allowedKinds : DEFAULT_KINDS;
  const limitPerKind = options.limitPerKind ?? DEFAULT_LIMIT_PER_KIND;
  const searches: Array<Promise<AssistantEntityCandidate[]>> = [];

  if (allowedKinds.includes('customer')) {
    searches.push(searchCustomers(supabase, normalizedQuery, limitPerKind));
  }

  if (allowedKinds.includes('supplier')) {
    searches.push(searchSuppliers(supabase, normalizedQuery, limitPerKind));
  }

  if (allowedKinds.includes('product')) {
    searches.push(searchProducts(supabase, normalizedQuery, limitPerKind));
  }

  if (allowedKinds.includes('component')) {
    searches.push(searchComponents(supabase, normalizedQuery, limitPerKind));
  }

  const nestedCandidates = await Promise.all(searches);
  const deduped = new Map<string, AssistantEntityCandidate>();

  for (const candidate of nestedCandidates.flat()) {
    const key = `${candidate.kind}:${candidate.id}`;
    const existing = deduped.get(key);
    if (!existing || candidate.score > existing.score) {
      deduped.set(key, candidate);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.label.localeCompare(right.label);
  });
}

export async function resolveAssistantEntity(
  supabase: SupabaseClient,
  query: string,
  options: AssistantEntityLookupOptions = {}
): Promise<AssistantEntityLookupResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { kind: 'not_found', query };
  }

  const preferredKinds = options.preferredKinds ?? [];
  const fallbackToOtherKinds = options.fallbackToOtherKinds ?? true;
  const candidates = await searchAssistantEntities(supabase, normalizedQuery, options);
  if (candidates.length === 0) {
    return { kind: 'not_found', query };
  }

  const preferredCandidates = preferredKinds.length
    ? candidates.filter(candidate => preferredKinds.includes(candidate.kind))
    : candidates;

  let resolutionPool = preferredCandidates;
  if (resolutionPool.length === 0) {
    if (options.strictPreferredKinds || !fallbackToOtherKinds) {
      return { kind: 'not_found', query };
    }

    resolutionPool = candidates;
  }

  const [top, second] = resolutionPool;
  if (!top || top.score < MIN_SCORE_BY_KIND[top.kind]) {
    return { kind: 'not_found', query };
  }

  if (second && second.score >= top.score - AMBIGUITY_GAP) {
    return {
      kind: 'ambiguous',
      query,
      candidates: resolutionPool.slice(0, 5),
    };
  }

  return {
    kind: 'resolved',
    candidate: top,
  };
}

export async function resolveAssistantEntityForIntent(
  supabase: SupabaseClient,
  query: string,
  options: AssistantScopedEntityLookupOptions
): Promise<AssistantScopedEntityLookupResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      kind: 'not_found',
      query,
      candidates: [],
      primaryCandidates: [],
      secondaryCandidates: [],
    };
  }

  const primaryKinds = options.primaryKinds;
  const secondaryKinds = options.secondaryKinds ?? [];
  const allowedKinds = Array.from(
    new Set(
      options.allowedKinds?.length
        ? options.allowedKinds
        : [...primaryKinds, ...secondaryKinds]
    )
  );
  const ambiguityGap = options.ambiguityGap ?? AMBIGUITY_GAP;
  const candidates = await searchAssistantEntities(supabase, normalizedQuery, {
    ...options,
    allowedKinds,
  });
  const primaryCandidates = candidates.filter(candidate =>
    primaryKinds.includes(candidate.kind)
  );
  const secondaryCandidates = candidates.filter(candidate =>
    secondaryKinds.includes(candidate.kind)
  );
  const topPrimary = primaryCandidates[0];
  const topSecondary = secondaryCandidates[0];

  if (!topPrimary || topPrimary.score < MIN_SCORE_BY_KIND[topPrimary.kind]) {
    if (topSecondary && topSecondary.score >= MIN_SCORE_BY_KIND[topSecondary.kind]) {
      return {
        kind: 'clarify',
        query,
        candidates: candidates.slice(0, 5),
        primaryCandidates,
        secondaryCandidates,
      };
    }

    return {
      kind: 'not_found',
      query,
      candidates: candidates.slice(0, 5),
      primaryCandidates,
      secondaryCandidates,
    };
  }

  const ambiguousPrimaryCandidates = primaryCandidates.filter(
    candidate =>
      candidate.score >= MIN_SCORE_BY_KIND[candidate.kind] &&
      candidate.score >= topPrimary.score - ambiguityGap
  );

  if (ambiguousPrimaryCandidates.length > 1) {
    return {
      kind: 'clarify',
      query,
      candidates: [...ambiguousPrimaryCandidates, ...secondaryCandidates].slice(0, 5),
      primaryCandidates,
      secondaryCandidates,
    };
  }

  if (
    topSecondary &&
    topSecondary.score >= MIN_SCORE_BY_KIND[topSecondary.kind] &&
    topSecondary.score >= topPrimary.score - ambiguityGap
  ) {
    return {
      kind: 'clarify',
      query,
      candidates: [...primaryCandidates.slice(0, 2), ...secondaryCandidates.slice(0, 3)].slice(
        0,
        5
      ),
      primaryCandidates,
      secondaryCandidates,
    };
  }

  return {
    kind: 'resolved',
    candidate: topPrimary,
    candidates: candidates.slice(0, 5),
    primaryCandidates,
    secondaryCandidates,
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';

import type { AssistantDetailItem, AssistantTableCard } from '@/lib/assistant/prompt-suggestions';
import { resolveAssistantProduct, type AssistantProductLookupResult } from '@/lib/assistant/product-resolver';

type EffectiveBomItem = {
  component_id: number;
  quantity_required?: number | null;
  suppliercomponents?: { price?: number | null } | null;
  component_description?: string | null;
};

type EffectiveBolItem = {
  job_name?: string | null;
  category_name?: string | null;
  pay_type?: 'hourly' | 'piece' | null;
  time_required?: number | null;
  time_unit?: 'hours' | 'minutes' | 'seconds' | null;
  quantity?: number | null;
  hourly_rate?: number | null;
  piece_rate?: number | null;
};

type OverheadItem = {
  quantity?: number | null;
  override_value?: number | null;
  element?: {
    code?: string | null;
    name?: string | null;
    cost_type?: 'fixed' | 'percentage' | null;
    default_value?: number | null;
    percentage_basis?: 'materials' | 'labor' | 'total' | null;
  } | null;
};

type CostDriver = {
  name: string;
  category: 'Materials' | 'Labor' | 'Overhead';
  amount: number;
};

export type AssistantProductCostSummary =
  | {
      kind: 'summary';
      product: {
        product_id: number;
        internal_code: string | null;
        name: string | null;
        description: string | null;
      };
      materials_cost: number;
      labor_cost: number;
      overhead_cost: number;
      total_cost: number;
      missing_material_prices: number;
      material_count: number;
      labor_count: number;
      overhead_count: number;
      top_drivers: CostDriver[];
      material_details: AssistantDetailItem[];
      labor_details: AssistantDetailItem[];
      overhead_details: AssistantDetailItem[];
    }
  | Exclude<AssistantProductLookupResult, { kind: 'resolved' }>;

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatCurrency(value: number) {
  return `R${value.toFixed(2)}`;
}

function toHours(value: number, unit: 'hours' | 'minutes' | 'seconds') {
  if (unit === 'hours') return value;
  if (unit === 'minutes') return value / 60;
  return value / 3600;
}

function stripTrailingQuestion(value: string) {
  return value.replace(/\?+$/g, '').trim();
}

export function detectProductCostIntent(message: string) {
  return /\b(cost|costing|unit cost|cost breakdown|cost driver|expensive|margin)\b/i.test(message)
    ? 'product_cost'
    : null;
}

export function extractProductCostReference(message: string) {
  const normalized = message.trim();
  const patterns = [
    /\b(?:cost|costing|cost breakdown)\s+(?:of|for)\s+(.+)$/i,
    /^what(?:'s| is)?\s+the\s+cost(?:ing)?(?:\s+breakdown)?\s+(?:of|for)\s+(.+)$/i,
    /^what\s+does\s+(.+?)\s+cost\??$/i,
    /^why\s+is\s+(.+?)\s+expensive\??$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const captured = match?.[1]?.trim();
    if (captured) {
      return stripTrailingQuestion(captured);
    }
  }

  return null;
}

async function fetchProductToolJson<T>(
  origin: string,
  path: string,
  auth: { cookieHeader?: string | null; authorizationHeader?: string | null }
) {
  const headers: Record<string, string> = {};
  if (auth.cookieHeader?.trim()) {
    headers.cookie = auth.cookieHeader.trim();
  }
  if (auth.authorizationHeader?.trim()) {
    headers.authorization = auth.authorizationHeader.trim();
  }

  const response = await fetch(`${origin}${path}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;
  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

export async function getProductCostSummary(
  supabase: SupabaseClient,
  productRef: string,
  options: {
    origin: string;
    cookieHeader?: string | null;
    authorizationHeader?: string | null;
  }
): Promise<AssistantProductCostSummary> {
  const resolved = await resolveAssistantProduct(supabase, productRef);
  if (resolved.kind !== 'resolved') {
    return resolved;
  }

  const product = resolved.product;
  const productId = product.product_id;

  const [effectiveBomPayload, effectiveBolPayload, overheadPayload] = await Promise.all([
    fetchProductToolJson<{ items?: EffectiveBomItem[] }>(
      options.origin,
      `/api/products/${productId}/effective-bom`,
      options
    ),
    fetchProductToolJson<{ items?: EffectiveBolItem[] }>(
      options.origin,
      `/api/products/${productId}/effective-bol`,
      options
    ),
    fetchProductToolJson<{ items?: OverheadItem[] }>(
      options.origin,
      `/api/products/${productId}/overhead`,
      options
    ),
  ]);

  const bomItems = Array.isArray(effectiveBomPayload?.items) ? effectiveBomPayload.items : [];
  const bolItems = Array.isArray(effectiveBolPayload?.items) ? effectiveBolPayload.items : [];
  const overheadItems = Array.isArray(overheadPayload?.items) ? overheadPayload.items : [];

  const componentIds = Array.from(
    new Set(
      bomItems
        .map(item => Number(item.component_id))
        .filter(componentId => Number.isFinite(componentId) && componentId > 0)
    )
  );

  const componentMetaById = new Map<number, { internal_code: string | null; description: string | null }>();
  if (componentIds.length > 0) {
    const { data, error } = await supabase
      .from('components')
      .select('component_id, internal_code, description')
      .in('component_id', componentIds);

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      componentMetaById.set(Number(row.component_id), {
        internal_code: row.internal_code ?? null,
        description: row.description ?? null,
      });
    }
  }

  const materialRows = bomItems.map(item => {
    const quantity = toNumber(item.quantity_required);
    const unitPrice = item.suppliercomponents?.price == null ? null : toNumber(item.suppliercomponents.price);
    const lineTotal = unitPrice == null ? null : quantity * unitPrice;
    const componentMeta = componentMetaById.get(Number(item.component_id));
    const code = componentMeta?.internal_code?.trim() || `Component ${item.component_id}`;
    const description = componentMeta?.description?.trim() || item.component_description?.trim() || '';

    return {
      code,
      description,
      lineTotal,
    };
  });

  const materialsCost = materialRows.reduce((sum, row) => sum + (row.lineTotal ?? 0), 0);
  const missingMaterialPrices = materialRows.filter(row => row.lineTotal == null).length;

  const laborRows = bolItems.map(item => {
    const quantity = toNumber(item.quantity) || 1;
    if (item.pay_type === 'piece') {
      const pieceRate = toNumber(item.piece_rate);
      return {
        name: item.job_name?.trim() || item.category_name?.trim() || 'Labor item',
        lineTotal: pieceRate * quantity,
      };
    }

    const hours = toHours(toNumber(item.time_required), item.time_unit ?? 'hours');
    const hourlyRate = toNumber(item.hourly_rate);
    return {
      name: item.job_name?.trim() || item.category_name?.trim() || 'Labor item',
      lineTotal: hours * quantity * hourlyRate,
    };
  });

  const laborCost = laborRows.reduce((sum, row) => sum + row.lineTotal, 0);

  const overheadRows = overheadItems.map(item => {
    const quantity = toNumber(item.quantity) || 1;
    const value = item.override_value == null ? toNumber(item.element?.default_value) : toNumber(item.override_value);
    const basis =
      item.element?.percentage_basis === 'materials'
        ? materialsCost
        : item.element?.percentage_basis === 'labor'
          ? laborCost
          : materialsCost + laborCost;

    const lineTotal =
      item.element?.cost_type === 'percentage'
        ? (basis * value * quantity) / 100
        : value * quantity;

    return {
      name: item.element?.name?.trim() || item.element?.code?.trim() || 'Overhead item',
      lineTotal,
    };
  });

  const overheadCost = overheadRows.reduce((sum, row) => sum + row.lineTotal, 0);
  const totalCost = materialsCost + laborCost + overheadCost;

  const topDrivers: CostDriver[] = [
    ...materialRows
      .filter(row => (row.lineTotal ?? 0) > 0)
      .map(row => ({
        name: row.description ? `${row.code} - ${row.description}` : row.code,
        category: 'Materials' as const,
        amount: row.lineTotal ?? 0,
      })),
    ...laborRows
      .filter(row => row.lineTotal > 0)
      .map(row => ({
        name: row.name,
        category: 'Labor' as const,
        amount: row.lineTotal,
      })),
    ...overheadRows
      .filter(row => row.lineTotal > 0)
      .map(row => ({
        name: row.name,
        category: 'Overhead' as const,
        amount: row.lineTotal,
      })),
  ]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const materialDetails: AssistantDetailItem[] =
    materialRows.length > 0
      ? materialRows
          .map(row => ({
            label: row.description ? `${row.code} - ${row.description}` : row.code,
            value: row.lineTotal == null ? 'No supplier price' : formatCurrency(row.lineTotal),
          }))
          .sort((a, b) => {
            const aValue = a.value === 'No supplier price' ? -1 : Number.parseFloat(a.value.replace(/[^\d.-]/g, ''));
            const bValue = b.value === 'No supplier price' ? -1 : Number.parseFloat(b.value.replace(/[^\d.-]/g, ''));
            return (Number.isFinite(bValue) ? bValue : -1) - (Number.isFinite(aValue) ? aValue : -1);
          })
      : [{ label: 'No material line items', value: 'R0.00' }];

  const laborDetails: AssistantDetailItem[] =
    laborRows.length > 0
      ? laborRows
          .map(row => ({
            label: row.name,
            value: formatCurrency(row.lineTotal),
          }))
          .sort((a, b) => Number.parseFloat(b.value.replace(/[^\d.-]/g, '')) - Number.parseFloat(a.value.replace(/[^\d.-]/g, '')))
      : [{ label: 'No labor line items', value: 'R0.00' }];

  const overheadDetails: AssistantDetailItem[] =
    overheadRows.length > 0
      ? overheadRows
          .map(row => ({
            label: row.name,
            value: formatCurrency(row.lineTotal),
          }))
          .sort((a, b) => Number.parseFloat(b.value.replace(/[^\d.-]/g, '')) - Number.parseFloat(a.value.replace(/[^\d.-]/g, '')))
      : [{ label: 'No overhead line items', value: 'R0.00' }];

  return {
    kind: 'summary',
    product,
    materials_cost: materialsCost,
    labor_cost: laborCost,
    overhead_cost: overheadCost,
    total_cost: totalCost,
    missing_material_prices: missingMaterialPrices,
    material_count: materialRows.length,
    labor_count: laborRows.length,
    overhead_count: overheadRows.length,
    top_drivers: topDrivers,
    material_details: materialDetails,
    labor_details: laborDetails,
    overhead_details: overheadDetails,
  };
}

export function buildProductCostAnswer(result: AssistantProductCostSummary) {
  if (result.kind === 'ambiguous') {
    const options = result.candidates
      .map(candidate => `- ${candidate.internal_code ?? `Product ${candidate.product_id}`} | ${candidate.name ?? 'Unnamed product'}`)
      .join('\n');
    return `I found multiple products matching "${result.product_ref}". Which one did you mean?\n${options}`;
  }

  if (result.kind === 'not_found') {
    return `I don't know. I couldn't find a product matching "${result.product_ref}" in Unity.`;
  }

  const productLabel = result.product.name?.trim() || result.product.internal_code?.trim() || `Product ${result.product.product_id}`;
  const codeLabel = result.product.internal_code?.trim();
  const heading = codeLabel && codeLabel !== productLabel ? `${productLabel} (${codeLabel})` : productLabel;

  if (result.missing_material_prices > 0) {
    return `Here is the current unit cost breakdown for ${heading}. ${result.missing_material_prices} material line${result.missing_material_prices === 1 ? '' : 's'} still need supplier pricing.`;
  }

  return `Here is the current unit cost breakdown for ${heading}.`;
}

export function buildProductCostCard(result: Extract<AssistantProductCostSummary, { kind: 'summary' }>): AssistantTableCard {
  const productLabel = result.product.name?.trim() || result.product.internal_code?.trim() || `Product ${result.product.product_id}`;
  const codeLabel = result.product.internal_code?.trim();

  return {
    type: 'table',
    title: codeLabel && codeLabel !== productLabel ? `Costing for ${productLabel} (${codeLabel})` : `Costing for ${productLabel}`,
    description: 'Current unit cost from the same BOM, labor, and overhead inputs used by the product costing screen.',
    metrics: [
      { label: 'Total', value: formatCurrency(result.total_cost) },
      {
        label: 'Materials',
        value: formatCurrency(result.materials_cost),
        detailTitle: 'Material line items',
        details: result.material_details,
      },
      {
        label: 'Labor',
        value: formatCurrency(result.labor_cost),
        detailTitle: 'Labor line items',
        details: result.labor_details,
      },
      {
        label: 'Overhead',
        value: formatCurrency(result.overhead_cost),
        detailTitle: 'Overhead line items',
        details: result.overhead_details,
      },
    ],
    columns: [
      { key: 'driver', label: 'Cost driver' },
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount', align: 'right' },
    ],
    rows: result.top_drivers.map(driver => ({
      driver: driver.name,
      category: driver.category,
      amount: formatCurrency(driver.amount),
    })),
    footer:
      result.missing_material_prices > 0
        ? `${result.missing_material_prices} material line${result.missing_material_prices === 1 ? '' : 's'} still have no supplier price.`
        : `Based on ${result.material_count} material, ${result.labor_count} labor, and ${result.overhead_count} overhead line items.`,
  };
}

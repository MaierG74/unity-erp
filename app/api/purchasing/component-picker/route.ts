import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 75;
const CANDIDATE_LIMIT = 150;
const MAX_IDS = 100;

const COMPONENT_SELECT = `
  component_id, internal_code, description, category_id,
  category:component_categories(categoryname),
  inventory(quantity_on_hand),
  suppliercomponents(
    supplier_component_id, supplier_id, supplier_code, price, lead_time, min_order_quantity,
    supplier:suppliers(name, supplier_id)
  )
`;

type SupplierComponentResult = {
  supplier_component_id: number;
  supplier_id: number;
  supplier_code: string | null;
  price: number | null;
  lead_time: number | null;
  min_order_quantity: number | null;
  supplier: { name: string | null; supplier_id: number } | null;
};

type ComponentResult = {
  component_id: number;
  internal_code: string | null;
  description: string | null;
  category_id: number | null;
  category: { categoryname: string | null } | null;
  inventory: { quantity_on_hand: number | null }[] | { quantity_on_hand: number | null } | null;
  suppliercomponents: SupplierComponentResult[] | null;
};

type ComponentIdQueryResult = {
  data: Array<{ component_id?: number | null }> | null;
  error: unknown;
};

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseIds(value: string | null) {
  if (!value) return [];
  return value
    .split(',')
    .map((id) => Number.parseInt(id.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, MAX_IDS);
}

function normalizeSearch(value: string | null) {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeComponent(row: ComponentResult): ComponentResult {
  const inventory = Array.isArray(row.inventory)
    ? row.inventory
    : row.inventory
      ? [row.inventory]
      : null;

  return {
    ...row,
    inventory,
    suppliercomponents: row.suppliercomponents ?? [],
  };
}

function addIds(target: Set<number>, rows: Array<{ component_id?: number | null }> | null | undefined) {
  for (const row of rows ?? []) {
    if (row.component_id && row.component_id > 0) {
      target.add(row.component_id);
    }
  }
}

function scoreComponent(row: ComponentResult, query: string, selectedSupplierId: number | null) {
  if (!query) return 0;

  const q = query.toLowerCase();
  const code = row.internal_code?.toLowerCase() ?? '';
  const description = row.description?.toLowerCase() ?? '';
  const category = row.category?.categoryname?.toLowerCase() ?? '';
  const supplierText = (row.suppliercomponents ?? [])
    .map((supplierComponent) =>
      [
        supplierComponent.supplier_code,
        supplierComponent.supplier?.name,
        selectedSupplierId && supplierComponent.supplier_id === selectedSupplierId
          ? 'selected supplier'
          : null,
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join(' ')
    .toLowerCase();

  if (code === q) return 1000;
  if ((row.suppliercomponents ?? []).some((sc) => sc.supplier_code?.toLowerCase() === q)) return 950;
  if (code.startsWith(q)) return 850;
  if ((row.suppliercomponents ?? []).some((sc) => sc.supplier_code?.toLowerCase().startsWith(q))) return 800;
  if (code.includes(q)) return 700;
  if (description.includes(q)) return 550;
  if (supplierText.includes(q)) return 500;
  if (category.includes(q)) return 300;
  return 0;
}

export async function GET(req: NextRequest) {
  const access = await requireModuleAccess(req, MODULE_KEYS.PURCHASING_PURCHASE_ORDERS);
  if ('error' in access) return access.error;

  const { searchParams } = req.nextUrl;
  const query = normalizeSearch(searchParams.get('q'));
  const ids = parseIds(searchParams.get('ids'));
  const limit = parsePositiveInt(searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
  const categoryId = parsePositiveInt(searchParams.get('categoryId'), 0, Number.MAX_SAFE_INTEGER);
  const supplierId = parsePositiveInt(searchParams.get('supplierId'), 0, Number.MAX_SAFE_INTEGER);
  const pattern = `%${query}%`;
  const componentIds = new Set<number>();

  try {
    if (ids.length > 0) {
      ids.forEach((id) => componentIds.add(id));
    } else if (!query && supplierId <= 0) {
      let initialQuery = access.ctx.supabase
        .from('components')
        .select(COMPONENT_SELECT)
        .eq('is_active', true)
        .order('internal_code')
        .limit(limit + 1);

      if (access.orgId) initialQuery = initialQuery.eq('org_id', access.orgId);
      if (categoryId > 0) initialQuery = initialQuery.eq('category_id', categoryId);

      const { data, error } = await initialQuery;
      if (error) throw error;

      const rows = ((data ?? []) as unknown as ComponentResult[]).map(normalizeComponent);
      return NextResponse.json({
        components: rows.slice(0, limit),
        has_more: rows.length > limit,
        limit,
        query,
      });
    } else {
      if (query.length >= 2) {
        let exactCodeQuery = access.ctx.supabase
          .from('components')
          .select('component_id')
          .eq('is_active', true)
          .ilike('internal_code', query)
          .limit(CANDIDATE_LIMIT);

        let exactSupplierCodeQuery = access.ctx.supabase
          .from('suppliercomponents')
          .select('component_id')
          .ilike('supplier_code', query)
          .limit(CANDIDATE_LIMIT);

        if (access.orgId) {
          exactCodeQuery = exactCodeQuery.eq('org_id', access.orgId);
          exactSupplierCodeQuery = exactSupplierCodeQuery.eq('org_id', access.orgId);
        }
        if (categoryId > 0) exactCodeQuery = exactCodeQuery.eq('category_id', categoryId);
        if (supplierId > 0) exactSupplierCodeQuery = exactSupplierCodeQuery.eq('supplier_id', supplierId);

        const exactResults = await Promise.all([exactCodeQuery, exactSupplierCodeQuery]);
        for (const result of exactResults) {
          if (result.error) throw result.error;
          addIds(componentIds, result.data as Array<{ component_id?: number | null }> | null);
        }
      }

      if (componentIds.size === 0) {
        const componentQueries: Array<PromiseLike<ComponentIdQueryResult>> = [];

        if (query.length >= 2) {
          let codeQuery = access.ctx.supabase
            .from('components')
            .select('component_id')
            .eq('is_active', true)
            .ilike('internal_code', pattern)
            .limit(CANDIDATE_LIMIT);
          let descriptionQuery = access.ctx.supabase
            .from('components')
            .select('component_id')
            .eq('is_active', true)
            .ilike('description', pattern)
            .limit(CANDIDATE_LIMIT);

          if (access.orgId) {
            codeQuery = codeQuery.eq('org_id', access.orgId);
            descriptionQuery = descriptionQuery.eq('org_id', access.orgId);
          }
          if (categoryId > 0) {
            codeQuery = codeQuery.eq('category_id', categoryId);
            descriptionQuery = descriptionQuery.eq('category_id', categoryId);
          }

          componentQueries.push(codeQuery, descriptionQuery);
        }

        if (supplierId > 0 || query.length >= 2) {
          let supplierComponentQuery = access.ctx.supabase
            .from('suppliercomponents')
            .select('component_id')
            .limit(CANDIDATE_LIMIT);

          if (access.orgId) supplierComponentQuery = supplierComponentQuery.eq('org_id', access.orgId);
          if (supplierId > 0) supplierComponentQuery = supplierComponentQuery.eq('supplier_id', supplierId);
          if (query.length >= 2) supplierComponentQuery = supplierComponentQuery.ilike('supplier_code', pattern);
          componentQueries.push(supplierComponentQuery);
        }

        if (!supplierId && query.length >= 2) {
          let supplierQuery = access.ctx.supabase
            .from('suppliers')
            .select('supplier_id')
            .eq('is_active', true)
            .ilike('name', pattern)
            .limit(25);

          if (access.orgId) supplierQuery = supplierQuery.eq('org_id', access.orgId);
          const { data: matchingSuppliers, error: suppliersError } = await supplierQuery;
          if (suppliersError) throw suppliersError;

          const supplierIds = (matchingSuppliers ?? [])
            .map((supplier) => supplier.supplier_id)
            .filter((id): id is number => Number.isInteger(id) && id > 0);

          if (supplierIds.length > 0) {
            let supplierNameComponentQuery = access.ctx.supabase
              .from('suppliercomponents')
              .select('component_id')
              .in('supplier_id', supplierIds)
              .limit(CANDIDATE_LIMIT);
            if (access.orgId) supplierNameComponentQuery = supplierNameComponentQuery.eq('org_id', access.orgId);
            componentQueries.push(supplierNameComponentQuery);
          }
        }

        const results = await Promise.all(componentQueries);
        for (const result of results) {
          if (result.error) throw result.error;
          addIds(componentIds, result.data as Array<{ component_id?: number | null }> | null);
        }
      }
    }

    if (componentIds.size === 0) {
      return NextResponse.json({ components: [], has_more: false, limit, query });
    }

    let detailsQuery = access.ctx.supabase
      .from('components')
      .select(COMPONENT_SELECT)
      .eq('is_active', true)
      .in('component_id', Array.from(componentIds).slice(0, CANDIDATE_LIMIT));

    if (access.orgId) detailsQuery = detailsQuery.eq('org_id', access.orgId);
    if (categoryId > 0) detailsQuery = detailsQuery.eq('category_id', categoryId);

    const { data: details, error: detailsError } = await detailsQuery;
    if (detailsError) throw detailsError;

    const rows = ((details ?? []) as unknown as ComponentResult[])
      .map(normalizeComponent)
      .filter((row) =>
        supplierId > 0
          ? (row.suppliercomponents ?? []).some((supplierComponent) => supplierComponent.supplier_id === supplierId)
          : true
      )
      .sort((a, b) => {
        const scoreDelta = scoreComponent(b, query, supplierId || null) - scoreComponent(a, query, supplierId || null);
        if (scoreDelta !== 0) return scoreDelta;
        return (a.internal_code ?? '').localeCompare(b.internal_code ?? '');
      });

    return NextResponse.json({
      components: rows.slice(0, limit),
      has_more: rows.length > limit,
      limit,
      query,
    });
  } catch (error) {
    console.error('[purchasing/component-picker] search failed', error);
    return NextResponse.json({ error: 'Failed to search components' }, { status: 500 });
  }
}

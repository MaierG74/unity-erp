import { supabaseAdmin } from '@/lib/supabase-admin';
import { BomSnapshotEntry } from './snapshot-types';

type Substitution = {
  bom_id: number;
  component_id: number;
  supplier_component_id?: number | null;
  note?: string | null;
};

type ComponentRow = {
  component_id: number;
  internal_code: string | null;
  description: string | null;
  category_id: number | null;
  component_categories: { cat_id: number; categoryname: string } | null;
};

type SupplierComponentRow = {
  supplier_component_id: number;
  component_id: number;
  price: number | null;
  suppliers: { supplier_id: number; name: string } | null;
};

export async function buildBomSnapshot(
  productId: number,
  orgId: string,
  substitutions: Substitution[] = [],
  cutlistGroupMap: Map<number, number> = new Map()
): Promise<BomSnapshotEntry[]> {
  // 1. Load full BOM with component + category joins
  const { data: bomRows, error: bomErr } = await supabaseAdmin
    .from('billofmaterials')
    .select(
      `bom_id, component_id, quantity_required, supplier_component_id,
       is_cutlist_item, cutlist_category,
       components (
         component_id, internal_code, description, category_id,
         component_categories ( cat_id, categoryname )
       )`
    )
    .eq('product_id', productId);

  if (bomErr) throw bomErr;
  if (!bomRows || bomRows.length === 0) return [];

  // 2. Build substitution lookup by bom_id
  const subMap = new Map<number, Substitution>();
  for (const s of substitutions) {
    subMap.set(s.bom_id, s);
  }

  // 3. Collect all component_ids we need pricing for (including substituted ones)
  const defaultComponentIds = new Set<number>();
  const substitutedComponentIds = new Set<number>();

  for (const row of bomRows) {
    if (row.component_id != null) defaultComponentIds.add(row.component_id);
    const sub = subMap.get(row.bom_id);
    if (sub) substitutedComponentIds.add(sub.component_id);
  }

  const allComponentIds = new Set([...defaultComponentIds, ...substitutedComponentIds]);

  // 4. Load component details for substituted components not already in BOM
  const bomComponentMap = new Map<number, ComponentRow>();
  for (const row of bomRows) {
    if (row.component_id != null && row.components) {
      bomComponentMap.set(row.component_id, row.components as unknown as ComponentRow);
    }
  }

  const missingIds = [...substitutedComponentIds].filter((id) => !bomComponentMap.has(id));
  if (missingIds.length > 0) {
    const { data: extraComponents, error: compErr } = await supabaseAdmin
      .from('components')
      .select('component_id, internal_code, description, category_id, component_categories ( cat_id, categoryname )')
      .in('component_id', missingIds)
      .eq('org_id', orgId);

    if (compErr) throw compErr;
    for (const c of extraComponents ?? []) {
      bomComponentMap.set(c.component_id, c as unknown as ComponentRow);
    }
  }

  // 5. Load suppliercomponents for all relevant component_ids
  const { data: scRows, error: scErr } = await supabaseAdmin
    .from('suppliercomponents')
    .select('supplier_component_id, component_id, price, suppliers ( supplier_id, name )')
    .in('component_id', [...allComponentIds])
    .eq('org_id', orgId);

  if (scErr) throw scErr;

  // Index suppliercomponents: by supplier_component_id and by component_id -> list
  const scById = new Map<number, SupplierComponentRow>();
  const scByComponent = new Map<number, SupplierComponentRow[]>();

  for (const sc of scRows ?? []) {
    const row = sc as unknown as SupplierComponentRow;
    scById.set(row.supplier_component_id, row);
    const list = scByComponent.get(row.component_id) ?? [];
    list.push(row);
    scByComponent.set(row.component_id, list);
  }

  // 6. Build snapshot entries
  const entries: BomSnapshotEntry[] = [];

  for (const bom of bomRows) {
    const sub = subMap.get(bom.bom_id);

    const defaultComp = bomComponentMap.get(bom.component_id ?? -1);
    const defaultComponentId = bom.component_id ?? 0;
    const defaultComponentCode = defaultComp?.internal_code ?? String(defaultComponentId);

    // Resolve effective component (substituted or default)
    const effectiveComponentId = sub ? sub.component_id : defaultComponentId;
    const effectiveComp = bomComponentMap.get(effectiveComponentId);
    const isSubstituted = !!sub;

    // Resolve supplier component: explicit id from sub > explicit id from bom > cheapest for component
    let resolvedSc: SupplierComponentRow | null = null;

    if (sub?.supplier_component_id) {
      resolvedSc = scById.get(sub.supplier_component_id) ?? null;
    } else if (!sub && bom.supplier_component_id) {
      resolvedSc = scById.get(bom.supplier_component_id) ?? null;
    }

    if (!resolvedSc) {
      const candidates = scByComponent.get(effectiveComponentId) ?? [];
      // Pick cheapest by price (nulls last)
      const sorted = [...candidates].sort((a, b) => {
        if (a.price == null && b.price == null) return 0;
        if (a.price == null) return 1;
        if (b.price == null) return -1;
        return a.price - b.price;
      });
      resolvedSc = sorted[0] ?? null;
    }

    const unitPrice = resolvedSc?.price ?? 0;
    const quantityRequired = Number(bom.quantity_required ?? 0);
    const lineTotal = Math.round(unitPrice * quantityRequired * 100) / 100;

    const category = effectiveComp?.component_categories ?? null;

    entries.push({
      source_bom_id: bom.bom_id,
      component_id: effectiveComponentId,
      component_code: effectiveComp?.internal_code ?? String(effectiveComponentId),
      component_description: effectiveComp?.description ?? null,
      category_id: effectiveComp?.category_id ?? null,
      category_name: category?.categoryname ?? null,
      supplier_component_id: resolvedSc?.supplier_component_id ?? null,
      supplier_name: resolvedSc?.suppliers?.name ?? null,
      unit_price: unitPrice,
      quantity_required: quantityRequired,
      line_total: lineTotal,
      is_substituted: isSubstituted,
      default_component_id: defaultComponentId,
      default_component_code: defaultComponentCode,
      is_cutlist_item: bom.is_cutlist_item ?? false,
      cutlist_category: bom.cutlist_category ?? null,
      cutlist_group_link: cutlistGroupMap.get(effectiveComponentId) ?? null,
      note: sub?.note ?? null,
    });
  }

  return entries;
}

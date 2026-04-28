import { supabaseAdmin } from '@/lib/supabase-admin';
import type { BomSnapshotEntry, BomSnapshotSwapKind } from './snapshot-types';

type Substitution = {
  bom_id: number;
  component_id?: number | null;
  supplier_component_id?: number | null;
  swap_kind?: BomSnapshotSwapKind;
  is_removed?: boolean;
  surcharge_amount?: number | string | null;
  surcharge_label?: string | null;
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

type SnapshotEntryInput = {
  sourceBomId: number;
  defaultComponent: ComponentRow | null;
  effectiveComponent: ComponentRow | null;
  defaultSupplierComponent: SupplierComponentRow | null;
  effectiveSupplierComponent: SupplierComponentRow | null;
  quantityRequired: number;
  swapKind: BomSnapshotSwapKind;
  isCutlistItem: boolean;
  cutlistCategory: string | null;
  cutlistGroupLink: number | null;
  surchargeAmount?: number | string | null;
  surchargeLabel?: string | null;
  note?: string | null;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function numericAmount(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayCode(component: ComponentRow | null, fallbackId: number): string {
  return component?.internal_code ?? String(fallbackId);
}

export function createBomSnapshotEntry(input: SnapshotEntryInput): BomSnapshotEntry {
  const defaultComponentId = input.defaultComponent?.component_id ?? 0;
  const defaultComponentCode = displayCode(input.defaultComponent, defaultComponentId);
  const isRemoved = input.swapKind === 'removed';
  const effectiveComponentId = isRemoved
    ? defaultComponentId
    : input.effectiveComponent?.component_id ?? defaultComponentId;
  const effectiveComponentCode = isRemoved
    ? defaultComponentCode
    : displayCode(input.effectiveComponent, effectiveComponentId);
  const component = isRemoved ? input.defaultComponent : input.effectiveComponent;
  const category = component?.component_categories ?? null;
  const unitPrice = input.effectiveSupplierComponent?.price ?? 0;
  const defaultUnitPrice = input.defaultSupplierComponent?.price ?? unitPrice;
  const effectiveQuantity = isRemoved ? 0 : input.quantityRequired;
  const effectiveUnitPrice = isRemoved ? 0 : unitPrice;

  return {
    source_bom_id: input.sourceBomId,
    component_id: effectiveComponentId,
    component_code: effectiveComponentCode,
    component_description: component?.description ?? null,
    category_id: component?.category_id ?? null,
    category_name: category?.categoryname ?? null,
    supplier_component_id: input.effectiveSupplierComponent?.supplier_component_id ?? null,
    supplier_name: input.effectiveSupplierComponent?.suppliers?.name ?? null,
    unit_price: unitPrice,
    quantity_required: input.quantityRequired,
    line_total: roundMoney(unitPrice * input.quantityRequired),
    swap_kind: input.swapKind,
    is_removed: isRemoved,
    effective_component_id: effectiveComponentId,
    effective_component_code: effectiveComponentCode,
    effective_quantity_required: effectiveQuantity,
    effective_unit_price: effectiveUnitPrice,
    effective_line_total: roundMoney(effectiveUnitPrice * effectiveQuantity),
    default_unit_price: defaultUnitPrice,
    surcharge_amount: numericAmount(input.surchargeAmount),
    surcharge_label: input.surchargeLabel?.trim() ? input.surchargeLabel.trim() : null,
    is_substituted: input.swapKind !== 'default',
    default_component_id: defaultComponentId,
    default_component_code: defaultComponentCode,
    is_cutlist_item: input.isCutlistItem,
    cutlist_category: input.cutlistCategory,
    cutlist_group_link: input.cutlistGroupLink,
    note: input.note ?? null,
  };
}

function cheapestSupplierComponent(rows: SupplierComponentRow[] | undefined): SupplierComponentRow | null {
  const sorted = [...(rows ?? [])].sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });
  return sorted[0] ?? null;
}

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
    if (sub?.component_id != null) substitutedComponentIds.add(sub.component_id);
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
  const { data: scRows, error: scErr } = allComponentIds.size > 0
    ? await supabaseAdmin
        .from('suppliercomponents')
        .select('supplier_component_id, component_id, price, suppliers ( supplier_id, name )')
        .in('component_id', [...allComponentIds])
        .eq('org_id', orgId)
    : { data: [], error: null };

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

    const swapKind: BomSnapshotSwapKind = sub?.swap_kind === 'removed' || sub?.is_removed
      ? 'removed'
      : sub?.component_id != null && sub.component_id !== defaultComponentId
        ? 'alternative'
        : 'default';

    const effectiveComponentId = swapKind === 'alternative' && sub?.component_id != null
      ? sub.component_id
      : defaultComponentId;
    const effectiveComp = bomComponentMap.get(effectiveComponentId);

    let defaultSc: SupplierComponentRow | null = null;
    if (bom.supplier_component_id) {
      defaultSc = scById.get(bom.supplier_component_id) ?? null;
    }
    if (!defaultSc) {
      defaultSc = cheapestSupplierComponent(scByComponent.get(defaultComponentId));
    }

    let resolvedSc: SupplierComponentRow | null = null;
    if (swapKind === 'alternative' && sub?.supplier_component_id) {
      resolvedSc = scById.get(sub.supplier_component_id) ?? null;
    } else if (swapKind !== 'alternative') {
      resolvedSc = defaultSc;
    }

    if (!resolvedSc) {
      resolvedSc = cheapestSupplierComponent(scByComponent.get(effectiveComponentId));
    }

    const quantityRequired = Number(bom.quantity_required ?? 0);

    entries.push(createBomSnapshotEntry({
      sourceBomId: bom.bom_id,
      defaultComponent: defaultComp ?? null,
      effectiveComponent: effectiveComp ?? defaultComp ?? null,
      defaultSupplierComponent: defaultSc,
      effectiveSupplierComponent: resolvedSc,
      quantityRequired,
      swapKind,
      isCutlistItem: bom.is_cutlist_item ?? false,
      cutlistCategory: bom.cutlist_category ?? null,
      cutlistGroupLink: cutlistGroupMap.get(defaultComponentId) ?? null,
      surchargeAmount: sub?.surcharge_amount,
      surchargeLabel: sub?.surcharge_label,
      note: sub?.note ?? null,
    }));
  }

  return entries;
}

import { supabase } from '@/lib/supabase';
import type {
  PurchaseOrderAllocation,
  PurchaseOrderDraft,
  PurchaseOrderDraftLine,
  PurchaseOrderFormData,
} from '@/types/purchasing';

type PurchaseOrderDraftRow = {
  draft_id: number;
  org_id: string | null;
  title: string | null;
  order_date: string | null;
  notes: string | null;
  status: PurchaseOrderDraft['status'];
  version: number;
  created_by: string;
  updated_by: string;
  locked_by: string | null;
  locked_at: string | null;
  converted_at: string | null;
  converted_purchase_order_ids: number[] | null;
  created_at: string;
  updated_at: string;
  purchase_order_draft_lines?: Array<{
    draft_line_id: number;
    sort_order: number;
    component_id: number | null;
    supplier_component_id: number | null;
    quantity: number | null;
    customer_order_id: number | null;
    allocations: PurchaseOrderAllocation[] | null;
    notes: string | null;
  }> | null;
};

type SavePurchaseOrderDraftArgs = {
  draftId: number | null;
  expectedVersion: number | null;
  title: string;
  formData: PurchaseOrderFormData;
};

type SavePurchaseOrderDraftResult = {
  draft_id: number;
  version: number;
  updated_at: string;
  updated_by: string;
  locked_by: string | null;
  locked_at: string | null;
  status: PurchaseOrderDraft['status'];
};

export type PurchaseOrderDraftSaveMeta = {
  draftId: number;
  version: number;
  updatedAt: string;
  updatedBy: string;
  lockedBy: string | null;
  lockedAt: string | null;
  status: PurchaseOrderDraft['status'];
};

const EMPTY_ITEM: PurchaseOrderFormData['items'][number] = {
  component_id: 0,
  supplier_component_id: 0,
  quantity: undefined as unknown as number,
  customer_order_id: null,
  allocations: [],
  notes: '',
};

export function createEmptyPurchaseOrderFormData(): PurchaseOrderFormData {
  return {
    order_date: new Date().toISOString().split('T')[0],
    notes: '',
    items: [{ ...EMPTY_ITEM }],
  };
}

function normalizeAllocations(
  allocations: PurchaseOrderAllocation[] | null | undefined
): PurchaseOrderAllocation[] {
  if (!Array.isArray(allocations)) return [];
  return allocations
    .filter(
      (allocation) =>
        Number.isFinite(allocation?.customer_order_id) &&
        Number.isFinite(allocation?.quantity) &&
        Number(allocation.quantity) > 0
    )
    .map((allocation) => ({
      customer_order_id: Number(allocation.customer_order_id),
      quantity: Number(allocation.quantity),
    }));
}

function normalizeDraftLine(line: PurchaseOrderDraftLine): PurchaseOrderDraftLine {
  return {
    draft_line_id: line.draft_line_id,
    sort_order: Number.isFinite(line.sort_order) ? line.sort_order : 0,
    component_id:
      Number.isFinite(line.component_id) && Number(line.component_id) > 0
        ? Number(line.component_id)
        : null,
    supplier_component_id:
      Number.isFinite(line.supplier_component_id) &&
      Number(line.supplier_component_id) > 0
        ? Number(line.supplier_component_id)
        : null,
    quantity:
      Number.isFinite(line.quantity) && Number(line.quantity) > 0
        ? Number(line.quantity)
        : null,
    customer_order_id:
      Number.isFinite(line.customer_order_id) &&
      Number(line.customer_order_id) > 0
        ? Number(line.customer_order_id)
        : null,
    allocations: normalizeAllocations(line.allocations),
    notes: line.notes ?? '',
  };
}

export function serializeDraftLines(
  formData: PurchaseOrderFormData
): PurchaseOrderDraftLine[] {
  return formData.items
    .map((item, index) =>
      normalizeDraftLine({
        sort_order: index,
        component_id: Number(item.component_id) || null,
        supplier_component_id: Number(item.supplier_component_id) || null,
        quantity:
          typeof item.quantity === 'number' && Number.isFinite(item.quantity)
            ? Number(item.quantity)
            : null,
        customer_order_id:
          typeof item.customer_order_id === 'number' &&
          Number.isFinite(item.customer_order_id)
            ? Number(item.customer_order_id)
            : null,
        allocations: normalizeAllocations(item.allocations),
        notes: item.notes ?? '',
      })
    )
    .filter((line) => {
      const hasAllocations = line.allocations.length > 0;
      return Boolean(
        line.component_id ||
          line.supplier_component_id ||
          line.quantity ||
          line.customer_order_id ||
          hasAllocations ||
          line.notes.trim()
      );
    });
}

export function hasMeaningfulPurchaseOrderDraftContent(
  title: string,
  formData: PurchaseOrderFormData
): boolean {
  if (title.trim().length > 0) return true;
  if ((formData.notes ?? '').trim().length > 0) return true;
  return serializeDraftLines(formData).length > 0;
}

export function buildPurchaseOrderDraftSignature(
  title: string,
  formData: PurchaseOrderFormData
): string {
  return JSON.stringify({
    title: title.trim(),
    order_date: formData.order_date ?? '',
    notes: formData.notes ?? '',
    items: serializeDraftLines(formData),
  });
}

function mapDraftRowToDraft(row: PurchaseOrderDraftRow): PurchaseOrderDraft {
  const lines = (row.purchase_order_draft_lines ?? [])
    .map((line) =>
      normalizeDraftLine({
        draft_line_id: line.draft_line_id,
        sort_order: line.sort_order,
        component_id: line.component_id,
        supplier_component_id: line.supplier_component_id,
        quantity: line.quantity,
        customer_order_id: line.customer_order_id,
        allocations: normalizeAllocations(line.allocations),
        notes: line.notes ?? '',
      })
    )
    .sort((left, right) => left.sort_order - right.sort_order);

  return {
    draft_id: row.draft_id,
    org_id: row.org_id ?? null,
    title: row.title,
    order_date: row.order_date,
    notes: row.notes ?? '',
    status: row.status,
    version: row.version,
    created_by: row.created_by,
    updated_by: row.updated_by,
    locked_by: row.locked_by,
    locked_at: row.locked_at,
    converted_at: row.converted_at,
    converted_purchase_order_ids: row.converted_purchase_order_ids,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lines,
  };
}

const DRAFT_SELECT_COLUMNS = `
  draft_id,
  org_id,
  title,
  order_date,
  notes,
  status,
  version,
  created_by,
  updated_by,
  locked_by,
  locked_at,
  converted_at,
  converted_purchase_order_ids,
  created_at,
  updated_at,
  purchase_order_draft_lines (
    draft_line_id,
    sort_order,
    component_id,
    supplier_component_id,
    quantity,
    customer_order_id,
    allocations,
    notes
  )
`;

export async function fetchPurchaseOrderDrafts(): Promise<PurchaseOrderDraft[]> {
  const { data, error } = await supabase
    .from('purchase_order_drafts')
    .select(DRAFT_SELECT_COLUMNS)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as PurchaseOrderDraftRow[]).map(mapDraftRowToDraft);
}

export async function fetchPurchaseOrderDraftById(
  draftId: number
): Promise<PurchaseOrderDraft | null> {
  const { data, error } = await supabase
    .from('purchase_order_drafts')
    .select(DRAFT_SELECT_COLUMNS)
    .eq('draft_id', draftId)
    .eq('status', 'draft')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;

  return mapDraftRowToDraft(data as PurchaseOrderDraftRow);
}

export function mapPurchaseOrderDraftToFormData(
  draft: PurchaseOrderDraft
): PurchaseOrderFormData {
  const items =
    draft.lines.length > 0
      ? draft.lines.map((line) => ({
          component_id: line.component_id ?? 0,
          supplier_component_id: line.supplier_component_id ?? 0,
          quantity:
            line.quantity === null
              ? (undefined as unknown as number)
              : Number(line.quantity),
          customer_order_id: line.customer_order_id ?? null,
          allocations: normalizeAllocations(line.allocations),
          notes: line.notes ?? '',
        }))
      : [{ ...EMPTY_ITEM }];

  return {
    order_date:
      draft.order_date ?? new Date().toISOString().split('T')[0],
    notes: draft.notes ?? '',
    items,
  };
}

export async function savePurchaseOrderDraft(
  args: SavePurchaseOrderDraftArgs
): Promise<PurchaseOrderDraftSaveMeta> {
  const payload = {
    p_draft_id: args.draftId,
    p_expected_version: args.expectedVersion,
    p_title: args.title,
    p_order_date: args.formData.order_date || null,
    p_notes: args.formData.notes ?? '',
    p_lines: serializeDraftLines(args.formData),
  };

  const { data, error } = await supabase.rpc('save_purchase_order_draft', payload);

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? (data[0] as SavePurchaseOrderDraftResult) : (data as SavePurchaseOrderDraftResult);

  if (!row?.draft_id) {
    throw new Error('Draft save did not return an id');
  }

  return {
    draftId: row.draft_id,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    status: row.status,
  };
}

export async function updatePurchaseOrderDraftStatus(args: {
  draftId: number;
  status: 'archived' | 'converted';
  purchaseOrderIds?: number[];
}): Promise<void> {
  const { error } = await supabase.rpc('set_purchase_order_draft_status', {
    p_draft_id: args.draftId,
    p_status: args.status,
    p_purchase_order_ids: args.purchaseOrderIds ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }
}

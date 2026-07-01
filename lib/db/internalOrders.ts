import { supabase } from '@/lib/supabase';

// =============================================================================
// Types — Internal Orders & Order Completion
// =============================================================================
export type OrderType = 'customer' | 'internal';
export type OrderDetailStatus = 'pending' | 'in_production' | 'ready' | 'delivered' | 'received' | 'cancelled';
export type StockReceiptStatus = 'draft' | 'confirmed' | 'cancelled';
export type DeliveryNoteSource = 'unity' | 'pastel';
export type DeliveryNoteStatus = 'draft' | 'printed' | 'signed' | 'cancelled';
export type SectionRouteSource = 'product_sections' | 'bol_derived' | 'default_route' | 'fallback';

export interface FactorySection {
  section_id: number;
  name: string;
  display_order: number | null;
  color: string | null;
}

export interface StockReceiptItem {
  stock_receipt_item_id: number;
  stock_receipt_id: number;
  order_detail_id: number;
  product_id: number;
  quantity: number;
}

export interface StockReceipt {
  stock_receipt_id: number;
  org_id: string;
  order_id: number;
  receipt_number: string;
  status: StockReceiptStatus;
  received_at: string | null;
  received_by: string | null;
  notes: string | null;
  created_at: string;
  items?: StockReceiptItem[];
}

export interface DeliveryNoteItem {
  order_delivery_note_item_id: number;
  order_delivery_note_id: number;
  order_detail_id: number;
  quantity: number;
}

export interface OrderDeliveryNote {
  order_delivery_note_id: number;
  org_id: string;
  order_id: number;
  note_number: string | null;
  source: DeliveryNoteSource;
  external_reference: string | null;
  delivery_date: string;
  status: DeliveryNoteStatus;
  signed_by: string | null;
  signed_at: string | null;
  notes: string | null;
  created_at: string;
  items?: DeliveryNoteItem[];
}

export interface ReceiptItemInput { order_detail_id: number; quantity: number; }
export interface DeliveryItemInput { order_detail_id: number; quantity: number; }

// =============================================================================
// Internal order creation
// =============================================================================
async function resolveStatusId(name: string, fallback: number): Promise<number> {
  const { data } = await supabase.from('order_statuses').select('status_id').eq('status_name', name).limit(1).maybeSingle();
  return (data?.status_id as number) ?? fallback;
}

export async function createInternalOrder(params: {
  org_id: string;
  internal_reason: string;
  items: Array<{ product_id: number; quantity: number; unit_price?: number | null }>;
  delivery_date?: string | null;
}): Promise<{ order_id: number }> {
  const statusId = await resolveStatusId('New', 27);
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert([{ org_id: params.org_id, order_type: 'internal', internal_reason: params.internal_reason, status_id: statusId, delivery_date: params.delivery_date ?? null }])
    .select('order_id')
    .single();
  if (orderErr) throw orderErr;
  const orderId = (order as any).order_id as number;

  if (params.items.length) {
    const rows = params.items.map((it) => ({
      order_id: orderId,
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price: it.unit_price ?? 0,
      org_id: params.org_id,
    }));
    const { error: detErr } = await supabase.from('order_details').insert(rows);
    if (detErr) throw detErr;
  }
  return { order_id: orderId };
}

// =============================================================================
// Stock check-in (Phase 4)
// =============================================================================
export async function fetchDraftStockReceipt(orderId: number): Promise<StockReceipt | null> {
  const { data, error } = await supabase
    .from('stock_receipts')
    .select('*, items:stock_receipt_items(*)')
    .eq('order_id', orderId)
    .eq('status', 'draft')
    .maybeSingle();
  if (error) throw error;
  return (data as StockReceipt) ?? null;
}

export async function fetchStockReceipts(orderId: number): Promise<StockReceipt[]> {
  const { data, error } = await supabase
    .from('stock_receipts')
    .select('*, items:stock_receipt_items(*)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as StockReceipt[]) ?? [];
}

export async function confirmStockReceipt(receiptId: number, itemQuantities?: ReceiptItemInput[]): Promise<any> {
  const { data, error } = await supabase.rpc('confirm_stock_receipt', {
    p_stock_receipt_id: receiptId,
    p_actor: null,
    p_item_quantities: itemQuantities ?? null,
  });
  if (error) throw error;
  return data;
}

export async function createManualStockReceipt(orderId: number, items: ReceiptItemInput[], notes: string): Promise<number> {
  const { data, error } = await supabase.rpc('create_manual_stock_receipt', {
    p_order_id: orderId,
    p_items: items,
    p_notes: notes,
    p_actor: null,
  });
  if (error) throw error;
  return data as number;
}

export async function applyStockAdjustment(productId: number, delta: number, reason: string): Promise<number> {
  const { data, error } = await supabase.rpc('apply_stock_adjustment', {
    p_product_id: productId,
    p_delta: delta,
    p_reason: reason,
    p_actor: null,
  });
  if (error) throw error;
  return data as number;
}

export async function reverseStockAdjustment(adjustmentId: number): Promise<number> {
  const { data, error } = await supabase.rpc('reverse_stock_adjustment', { p_adjustment_id: adjustmentId, p_actor: null });
  if (error) throw error;
  return data as number;
}

// =============================================================================
// Delivery notes (Phase 5)
// =============================================================================
export async function fetchDeliveryNotes(orderId: number): Promise<OrderDeliveryNote[]> {
  const { data, error } = await supabase
    .from('order_delivery_notes')
    .select('*, items:order_delivery_note_items(*)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as OrderDeliveryNote[]) ?? [];
}

export async function fetchDeliveryNote(noteId: number): Promise<OrderDeliveryNote | null> {
  const { data, error } = await supabase
    .from('order_delivery_notes')
    .select('*, items:order_delivery_note_items(*)')
    .eq('order_delivery_note_id', noteId)
    .maybeSingle();
  if (error) throw error;
  return (data as OrderDeliveryNote) ?? null;
}

export async function createUnityDeliveryNote(orderId: number, items: DeliveryItemInput[], deliveryDate?: string | null, notes?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('create_unity_delivery_note', {
    p_order_id: orderId,
    p_items: items,
    p_delivery_date: deliveryDate ?? null,
    p_notes: notes ?? null,
    p_actor: null,
  });
  if (error) throw error;
  return data as number;
}

export async function markDeliveryNotePrinted(noteId: number): Promise<void> {
  const { error } = await supabase.rpc('mark_delivery_note_printed', { p_note_id: noteId, p_actor: null });
  if (error) throw error;
}

export async function markDeliveryNoteSigned(noteId: number, signedBy: string, signedAt?: string | null): Promise<void> {
  const { error } = await supabase.rpc('mark_delivery_note_signed', {
    p_note_id: noteId,
    p_signed_by: signedBy,
    p_signed_at: signedAt ?? null,
    p_actor: null,
  });
  if (error) throw error;
}

export async function recordExternalDeliveryNote(orderId: number, externalRef: string, items: DeliveryItemInput[], deliveryDate?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('record_external_delivery_note', {
    p_order_id: orderId,
    p_external_ref: externalRef,
    p_items: items,
    p_delivery_date: deliveryDate ?? null,
    p_actor: null,
  });
  if (error) throw error;
  return data as number;
}

export async function cancelDeliveryNote(noteId: number, reason?: string | null): Promise<void> {
  const { error } = await supabase.rpc('cancel_delivery_note', { p_note_id: noteId, p_reason: reason ?? null, p_actor: null });
  if (error) throw error;
}

export async function reopenOrder(orderId: number, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_order', { p_order_id: orderId, p_reason: reason, p_actor: null });
  if (error) throw error;
}

// =============================================================================
// Section routing (Phase 3)
// =============================================================================
export async function fetchFactorySections(): Promise<FactorySection[]> {
  const { data, error } = await supabase
    .from('factory_sections')
    .select('section_id, name, display_order, color')
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data as FactorySection[]) ?? [];
}

export interface ProductSectionRow { product_section_id: number; section_id: number; sequence_order: number; }
export async function fetchProductSections(orgId: string, productId: number): Promise<ProductSectionRow[]> {
  const { data, error } = await supabase
    .from('product_sections')
    .select('product_section_id, section_id, sequence_order')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .order('sequence_order', { ascending: true });
  if (error) throw error;
  return (data as ProductSectionRow[]) ?? [];
}

/** Replace a product's section route with the given ordered section ids. */
export async function saveProductSections(orgId: string, productId: number, sectionIds: number[]): Promise<void> {
  const { error: delErr } = await supabase.from('product_sections').delete().eq('org_id', orgId).eq('product_id', productId);
  if (delErr) throw delErr;
  if (sectionIds.length === 0) return;
  const rows = sectionIds.map((sid, i) => ({ org_id: orgId, product_id: productId, section_id: sid, sequence_order: i + 1 }));
  const { error: insErr } = await supabase.from('product_sections').insert(rows);
  if (insErr) throw insErr;
}

export interface RequiredSectionRow { section_id: number; sequence_order: number; source: SectionRouteSource; }
export async function fetchOrderDetailRequiredSections(orderDetailId: number): Promise<RequiredSectionRow[]> {
  const { data, error } = await supabase
    .from('order_detail_required_sections')
    .select('section_id, sequence_order, source')
    .eq('order_detail_id', orderDetailId)
    .order('sequence_order', { ascending: true });
  if (error) throw error;
  return (data as RequiredSectionRow[]) ?? [];
}

// =============================================================================
// Replenishment suggestions (internal orders list panel)
// =============================================================================
export interface ReplenishmentSuggestion {
  product_id: number;
  internal_code: string | null;
  name: string;
  quantity_on_hand: number;
  reorder_level: number;
  suggested_qty: number;
}
export async function fetchReplenishmentSuggestions(orgId: string, limit = 10): Promise<ReplenishmentSuggestion[]> {
  const { data, error } = await supabase
    .from('product_inventory')
    .select('product_id, quantity_on_hand, reorder_level, products!inner(internal_code, name, org_id, is_stocked)')
    .eq('org_id', orgId);
  if (error) throw error;
  const rows = (data as any[]) ?? [];
  return rows
    .filter((r) => r.reorder_level != null && Number(r.quantity_on_hand) < Number(r.reorder_level))
    .map((r) => {
      const need = Number(r.reorder_level) - Number(r.quantity_on_hand);
      const suggested = Math.max(10, Math.ceil(need / 10) * 10); // round up to next 10 (heuristic — confirm with ops)
      return {
        product_id: r.product_id,
        internal_code: r.products?.internal_code ?? null,
        name: r.products?.name ?? `Product ${r.product_id}`,
        quantity_on_hand: Number(r.quantity_on_hand),
        reorder_level: Number(r.reorder_level),
        suggested_qty: suggested,
      } as ReplenishmentSuggestion;
    })
    .sort((a, b) => a.quantity_on_hand - b.quantity_on_hand)
    .slice(0, limit);
}

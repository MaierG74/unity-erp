import { resolveProductConfiguration, type ProductOptionSelection } from '@/lib/db/products';
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';

export interface Quote {
  id: string;
  quote_number: string;
  customer_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  grand_total: number;
}

export type QuoteItemType = 'priced' | 'heading' | 'note';
export type QuoteItemTextAlign = 'left' | 'center' | 'right';

export interface QuoteItem {
  id: string;
  quote_id: string;
  description: string;
  qty: number;
  unit_price: number;
  total: number;
  item_type: QuoteItemType;
  text_align: QuoteItemTextAlign;
  position: number;
  bullet_points?: string | null;
  internal_notes?: string | null;
  selected_options?: Record<string, string> | null;
  quote_item_clusters?: QuoteItemCluster[];
  cutlist_snapshot?: QuoteItemCutlist | null;
}

export interface QuoteItemCutlist {
  id: string;
  quote_item_id: string;
  options_hash?: string | null;
  layout_json: unknown;
  billing_overrides?: unknown;
  line_refs?: Record<string, string | null> | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteItemCluster {
  id: string; // uuid
  quote_item_id: string; // uuid
  name: string;
  notes?: string | null;
  position: number;
  markup_percent: number;
  created_at: string;
  updated_at: string;
  quote_cluster_lines?: QuoteClusterLine[];
}

export interface QuoteClusterLine {
  id: string; // uuid
  cluster_id: string; // uuid
  line_type: 'component' | 'manual' | 'labor' | 'overhead';
  component_id?: number | null;
  supplier_component_id?: number | null; // References the specific supplier offer used
  description?: string | null;
  qty: number;
  unit_cost?: number | null;
  unit_price?: number | null;
  include_in_markup: boolean;
  labor_type?: string | null;
  hours?: number | null;
  rate?: number | null;
  sort_order: number;
  cutlist_slot?: 'primary' | 'backer' | 'band16' | 'band32' | null;
  overhead_element_id?: number | null;
  overhead_cost_type?: 'fixed' | 'percentage' | null;
  overhead_percentage_basis?: 'materials' | 'labor' | 'total' | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteAttachment {
  id: string;
  quote_id: string;
  quote_item_id?: string | null;
  scope?: 'quote' | 'item';
  file_url: string;
  mime_type: string;
  uploaded_at: string;
  original_name?: string | null;
  display_in_quote?: boolean; // whether to show this attachment in the generated PDF
  crop_params?: import('@/types/image-editor').CropParams | null;
  annotations?: import('@/types/image-editor').ArrowAnnotation[] | null;
  display_size?: import('@/types/image-editor').ImageDisplaySize | null;
}

export async function fetchQuotes(filters?: {
  status?: string;
  search?: string;
  customerId?: string;
}): Promise<Quote[]> {
  let query = supabase
    .from('quotes')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  if (filters?.search) {
    const term = `%${filters.search}%`;
    query = query.ilike('quote_number', term);
  }
  if (filters?.customerId) {
    query = query.eq('customer_id', filters.customerId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchQuote(
  id: string
): Promise<
  Quote & {
    items: QuoteItem[];
    attachments: QuoteAttachment[];
    customer?: { id: number; name: string; email?: string | null; telephone?: string | null };
    contact?: { id: number; name: string; email: string | null; phone: string | null; mobile: string | null; job_title: string | null; is_primary: boolean } | null;
  }
> {
  const client = supabaseAdmin;

  const { data: quote, error: quoteError } = await client
    .from('quotes')
    .select('*, customer:customers(id, name, email, telephone), contact:customer_contacts(id, name, email, phone, mobile, job_title, is_primary)')
    .eq('id', id)
    .single();

  if (quoteError) throw quoteError;

  const { data: items, error: itemsError } = await client
    .from('quote_items')
    .select('*, quote_item_clusters(*, quote_cluster_lines(*)), quote_item_cutlists(*)')
    .eq('quote_id', id)
    .order('position', { ascending: true });

  const { data: attachments, error: attachmentsError } = await client
    .from('quote_attachments')
    .select('*')
    .eq('quote_id', id);

  if (itemsError) console.warn('Failed to fetch quote items:', itemsError);
  if (attachmentsError) console.warn('Failed to fetch quote attachments:', attachmentsError);

  const typedItems = Array.isArray(items)
    ? items.map((item: any) => {
        const cutlists = Array.isArray(item?.quote_item_cutlists) ? item.quote_item_cutlists : [];
        const [latestCutlist] = cutlists;
        const { quote_item_cutlists, ...rest } = item;
        return {
          ...(rest as QuoteItem),
          cutlist_snapshot: latestCutlist ?? null,
        };
      })
    : [];

  return {
    ...quote,
    items: typedItems,
    attachments: attachments || [],
  } as any;
}

export async function fetchQuoteItemCutlistSnapshot(quoteItemId: string): Promise<QuoteItemCutlist | null> {
  if (!quoteItemId) return null;
  try {
    const res = await fetch(`/api/quote-items/${quoteItemId}/cutlist`, {
      method: 'GET',
      cache: 'no-store',
    });

    if (res.status === 204) return null;
    if (!res.ok) {
      console.warn('fetchQuoteItemCutlistSnapshot failed', res.status, await res.text());
      return null;
    }

    const json = await res.json();
    return (json?.cutlist ?? null) as QuoteItemCutlist | null;
  } catch (error) {
    console.warn('fetchQuoteItemCutlistSnapshot error:', error);
    return null;
  }
}

export async function saveQuoteItemCutlistSnapshot(
  quoteItemId: string,
  payload: {
    optionsHash?: string;
    layout: unknown;
    billingOverrides?: unknown;
  }
): Promise<QuoteItemCutlist | null> {
  if (!quoteItemId) throw new Error('quoteItemId is required');

  try {
    const res = await fetch(`/api/quote-items/${quoteItemId}/cutlist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        optionsHash: payload.optionsHash,
        layout: payload.layout,
        billingOverrides: payload.billingOverrides,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Save failed (${res.status}): ${text}`);
    }

    const json = await res.json();
    return (json?.cutlist ?? null) as QuoteItemCutlist | null;
  } catch (error) {
    console.error('saveQuoteItemCutlistSnapshot error:', error);
    throw (error instanceof Error ? error : new Error('Failed to save cutlist snapshot'));
  }
}

export async function createQuote(quote: Partial<Quote>): Promise<Quote> {
  const { data, error } = await supabase
    .from('quotes')
    .insert([quote])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateQuote(id: string, updates: Partial<Quote>): Promise<Quote> {
  const { data, error } = await supabase
    .from('quotes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase
    .from('quotes')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/**
 * Creates a new quote item.
 *
 * @param options.skipDefaultCluster - Set to true when duplicating items to avoid
 *   creating duplicate clusters. The duplicate flow copies clusters separately.
 *   DB constraint: unique(quote_item_id, position) prevents duplicates.
 */
export async function createQuoteItem(
  item: Partial<QuoteItem>,
  options?: { skipDefaultCluster?: boolean }
): Promise<QuoteItem> {
  // Get the max position for this quote to place new item at the end
  let nextPosition = 0;
  if (item.quote_id) {
    const { data: maxPosResult } = await supabase
      .from('quote_items')
      .select('position')
      .eq('quote_id', item.quote_id)
      .order('position', { ascending: false })
      .limit(1)
      .single();
    if (maxPosResult) {
      nextPosition = (maxPosResult.position || 0) + 1;
    }
  }

  // Create the quote item with the calculated position
  const { data: newItem, error: itemError } = await supabase
    .from('quote_items')
    .insert([{ ...item, position: item.position ?? nextPosition }])
    .select('*')
    .single();
  if (itemError) throw itemError;

  // Automatically create a default cluster for priced items (unless skipped)
  // Non-priced items (heading, note) don't need clusters
  const isPriced = !item.item_type || item.item_type === 'priced';
  if (newItem && !options?.skipDefaultCluster && isPriced) {
    await createQuoteItemCluster({
      quote_item_id: newItem.id,
      name: 'Costing Cluster',
      position: 0,
    });
  }

  // Return item with clusters populated so client state is complete
  if (newItem && !options?.skipDefaultCluster && isPriced) {
    const clusters = await fetchQuoteItemClusters(newItem.id);
    return { ...newItem, quote_item_clusters: clusters } as QuoteItem;
  }

  return newItem!;
}

export async function updateQuoteItem(
  id: string,
  updates: Partial<QuoteItem>
): Promise<QuoteItem> {
  // In development, use dev API to bypass auth/RLS and missing env vars
  if (process.env.NODE_ENV === 'development') {
    const res = await fetch('/api/dev/update-quote-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, updates }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dev update failed: ${res.status} ${text}`);
    }
    return (await res.json()) as QuoteItem;
  }

  const { data, error } = await supabase
    .from('quote_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data!;
}

export async function deleteQuoteItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('quote_items')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/**
 * Reorders quote items by updating their position values.
 * @param itemIds - Array of item IDs in the desired order
 */
export async function reorderQuoteItems(itemIds: string[]): Promise<void> {
  // Update each item's position based on its index in the array
  const updates = itemIds.map((id, index) =>
    supabase
      .from('quote_items')
      .update({ position: index })
      .eq('id', id)
  );

  const results = await Promise.all(updates);
  const errors = results.filter(r => r.error);
  if (errors.length > 0) {
    throw errors[0].error;
  }
}

/**
 * Deletes a quote attachment record from the database.
 */
// Fetch all attachments for a specific quote item
export async function fetchQuoteItemAttachments(
  quoteId: string,
  quoteItemId: string
): Promise<QuoteAttachment[]> {
  const { data, error } = await supabase
    .from('quote_attachments')
    .select('*')
    .eq('quote_id', quoteId)
    .eq('quote_item_id', quoteItemId);
  if (error) throw error;
  return data || [];
}

export async function deleteQuoteAttachment(id: string): Promise<void> {
  const { error } = await supabase
    .from('quote_attachments')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function updateQuoteAttachmentDisplayInQuote(
  id: string,
  displayInQuote: boolean
): Promise<void> {
  const { error } = await supabase
    .from('quote_attachments')
    .update({ display_in_quote: displayInQuote })
    .eq('id', id);
  if (error) throw error;
}

export async function updateQuoteAttachmentEditorParams(
  id: string,
  cropParams: import('@/types/image-editor').CropParams | null,
  annotations: import('@/types/image-editor').ArrowAnnotation[] | null,
  displaySize?: import('@/types/image-editor').ImageDisplaySize | null
): Promise<void> {
  const { error } = await supabase
    .from('quote_attachments')
    .update({ crop_params: cropParams, annotations: annotations, display_size: displaySize ?? null })
    .eq('id', id);
  if (error) throw error;
}

export async function createQuoteAttachmentFromUrl(params: {
  quoteId: string;
  quoteItemId?: string | null;
  url: string;
  mimeType?: string;
  originalName?: string | null;
  displayInQuote?: boolean;
}): Promise<QuoteAttachment> {
  const { quoteId, quoteItemId, url, mimeType, originalName, displayInQuote } = params;
  const record: Partial<QuoteAttachment> = {
    quote_id: quoteId,
    quote_item_id: quoteItemId ?? null,
    scope: quoteItemId ? 'item' : 'quote',
    file_url: url,
    mime_type: mimeType || (url.toLowerCase().match(/\.(png|jpg|jpeg|gif|webp)$/) ? 'image/*' : 'application/octet-stream'),
    original_name: originalName || null,
    display_in_quote: displayInQuote !== false,
  } as any;
  const { data, error } = await supabase
    .from('quote_attachments')
    .insert([record])
    .select('*')
    .single();
  if (error) throw error;
  return data!;
}

export async function fetchAllQuoteAttachments(quoteId: string): Promise<QuoteAttachment[]> {
  const { data, error } = await supabase
    .from('quote_attachments')
    .select('*')
    .eq('quote_id', quoteId)
    .order('uploaded_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Uploads a file to Supabase storage (with timestamp prefix to avoid duplicates), and creates a DB record.
 */
export async function uploadQuoteAttachment(
file: File,
quoteId: string,
 quoteItemId: string | null = null
): Promise<QuoteAttachment> {
  const timestamp = Date.now();
  const unique = crypto.randomUUID();
  const filePath = `quote-attachments/${quoteId}/${timestamp}_${unique}_${file.name}`;
  const { data: uploadData, error: uploadError } = await supabase
    .storage
    .from('QButton')
    .upload(filePath, file);
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase
    .storage
    .from('QButton')
    .getPublicUrl(uploadData.path);
  const publicUrl = urlData.publicUrl;

  const attachmentRecord: Partial<QuoteAttachment> = {
    quote_item_id: quoteItemId,
    scope: quoteItemId ? 'item' : 'quote',
    quote_id: quoteId,
    file_url: publicUrl,
    mime_type: file.type,
    original_name: file.name,
  };
  const { data, error } = await supabase
    .from('quote_attachments')
    .insert([attachmentRecord])
    .select()
    .single();
  if (error) throw error;

  return data;
}

// --- Quote Item Cluster Functions ---

export async function createQuoteItemCluster(
  cluster: Partial<QuoteItemCluster>
): Promise<QuoteItemCluster> {
  const { data, error } = await supabase
    .from('quote_item_clusters')
    .insert([cluster])
    .select('*')
    .single();
  if (error) throw error;
  return data!;
}

export async function updateQuoteItemCluster(
  id: string,
  updates: Partial<QuoteItemCluster>
): Promise<QuoteItemCluster> {
  const { data, error } = await supabase
    .from('quote_item_clusters')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data!;
}

export async function deleteQuoteItemCluster(id: string): Promise<void> {
  const { error } = await supabase
    .from('quote_item_clusters')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function fetchQuoteItemClusters(quoteItemId: string): Promise<QuoteItemCluster[]> {
  const { data, error } = await supabase
    .from('quote_item_clusters')
    .select('*, quote_cluster_lines(*)')
    .eq('quote_item_id', quoteItemId)
    .order('position');
  if (error) throw error;
  return (data as QuoteItemCluster[]) || [];
}

// --- Quote Cluster Line Functions ---

export async function createQuoteClusterLine(
  line: Partial<QuoteClusterLine>
): Promise<QuoteClusterLine> {
  const { data, error } = await supabase
    .from('quote_cluster_lines')
    .insert([{ ...line, cutlist_slot: line.cutlist_slot ?? null }])
    .select('*')
    .single();
  if (error) throw error;
  return data!;
}

export async function updateQuoteClusterLine(
  id: string,
  updates: Partial<QuoteClusterLine>
): Promise<QuoteClusterLine> {
  const { data, error } = await supabase
    .from('quote_cluster_lines')
    .update({ ...updates, cutlist_slot: updates.cutlist_slot ?? null })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data!;
}

export async function deleteQuoteClusterLine(id: string): Promise<void> {
  const { error } = await supabase
    .from('quote_cluster_lines')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// Component-related functions for hybrid component selection
export interface Component {
  component_id: number;
  internal_code?: string;
  description?: string;
  unit_id?: number;
  category_id?: number;
  image_url?: string;
}

export interface SupplierComponent {
  supplier_component_id: number;
  component_id?: number;
  supplier_id?: number;
  supplier_code: string;
  price?: number;
  lead_time?: number;
  min_order_quantity?: number;
  description?: string;
  supplier?: {
    supplier_id: number;
    name: string;
    contact_info?: string;
  };
}

// --- Product helpers (for adding products to quotes) ---
export interface Product {
  product_id: number
  name: string
  internal_code?: string | null
}

export interface ProductComponent {
  component_id: number
  quantity: number
  unit_cost?: number | null
  description?: string | null
}

// Labor items associated with a product (effective BOL)
export interface ProductLaborItem {
  job_id: number
  job_name?: string | null
  category_name?: string | null
  pay_type: 'hourly' | 'piece'
  time_required?: number | null
  time_unit?: 'hours' | 'minutes' | 'seconds'
  quantity?: number | null
  hourly_rate?: number | null
  piece_rate?: number | null
}

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.access_token) {
      headers.set('Authorization', `Bearer ${data.session.access_token}`);
    }
  } catch {
    // Keep request best-effort for contexts without an interactive auth session.
  }
  return fetch(input, { ...init, headers });
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('product_id, name, internal_code')
    .order('name');
  if (error) {
    console.error('Error fetching products:', error);
    return [];
  }
  return (data as Product[]) || [];
}

export async function fetchProductComponents(
  productId: number,
  selectedOptions: ProductOptionSelection = {}
): Promise<ProductComponent[]> {
  const resolved = await resolveProductConfiguration(productId, selectedOptions);

  if (resolved.length > 0) {
    return resolved.map((row) => ({
      component_id: row.component_id,
      quantity: row.quantity,
      unit_cost: row.supplier_price ?? null,
      description: row.component_description ?? null,
    }));
  }

  try {
    const { data, error } = await supabase
      .from('product_components')
      .select('component_id, quantity, unit_cost, description')
      .eq('product_id', productId);

    if (error) {
      console.warn('Fallback table product_components failed:', error.message);
      return [];
    }

    return Array.isArray(data) ? (data as ProductComponent[]) : [];
  } catch (tableError) {
    console.warn('Fallback table query failed:', tableError);
    return [];
  }
}

// Fetch Effective BOL (labor) for a product via API route
export async function fetchProductLabor(productId: number): Promise<ProductLaborItem[]> {
  try {
    const res = await routeFetch(`/api/products/${productId}/effective-bol`, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('fetchProductLabor failed:', res.status, await res.text());
      return [];
    }
    const json = await res.json();
    const items = Array.isArray(json?.items) ? json.items : [];
    return items as ProductLaborItem[];
  } catch (e) {
    console.warn('fetchProductLabor error:', e);
    return [];
  }
}

// Product overhead items for quote explosion
export interface ProductOverheadItem {
  id: number;
  element_id: number;
  quantity: number;
  override_value: number | null;
  element: {
    element_id: number;
    code: string;
    name: string;
    cost_type: 'fixed' | 'percentage';
    default_value: number;
    percentage_basis: 'materials' | 'labor' | 'total' | null;
  };
}

export async function fetchProductOverhead(productId: number): Promise<ProductOverheadItem[]> {
  try {
    const res = await routeFetch(`/api/products/${productId}/overhead`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    const items = json?.items ?? json;
    return Array.isArray(items) ? items : [];
  } catch (e) {
    console.warn('fetchProductOverhead error:', e);
    return [];
  }
}

// Effective BOM (direct + linked) for quotes
export interface EffectiveBOMItem {
  component_id: number;
  quantity_required: number;
  supplier_component_id?: number | null;
  suppliercomponents?: { price?: number } | null;
  configuration_scope?: string | null;
  option_group_code?: string | null;
  option_value_code?: string | null;
  quantity_source?: string | null;
  notes?: string | null;
  is_cutlist_item?: boolean | null;
  cutlist_category?: string | null;
  cutlist_dimensions?: Record<string, unknown> | null;
  attributes?: Record<string, unknown> | null;
  component_description?: string | null;
}

export async function fetchEffectiveBOM(
  productId: number,
  selectedOptions: ProductOptionSelection = {}
): Promise<EffectiveBOMItem[]> {
  try {
    const params = new URLSearchParams();
    const normalizedEntries = Object.entries(selectedOptions).filter(
      ([, value]) => typeof value === 'string' && value.length > 0
    );

    if (normalizedEntries.length > 0) {
      params.set('selected_options', JSON.stringify(Object.fromEntries(normalizedEntries)));
    }

    const query = params.toString();
    const url = query
      ? `/api/products/${productId}/effective-bom?${query}`
      : `/api/products/${productId}/effective-bom`;

    const res = await routeFetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: any[] };
    const items = Array.isArray(json?.items) ? json!.items! : [];
    return items as EffectiveBOMItem[];
  } catch (e) {
    console.warn('fetchEffectiveBOM error:', e);
    return [];
  }
}

export async function fetchPrimaryProductImage(productId: number): Promise<{ url: string; original_name?: string | null } | null> {
  const { data, error } = await supabase
    .from('product_images')
    .select('image_url, alt_text, is_primary, display_order')
    .eq('product_id', productId)
    .order('is_primary', { ascending: false })
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('fetchPrimaryProductImage error:', error.message);
    return null;
  }
  if (!data) return null;
  return { url: (data as any).image_url as string, original_name: (data as any).alt_text ?? null };
}

export async function fetchComponents(): Promise<Component[]> {
  const { data, error } = await supabase
    .from('components')
    .select('*')
    .order('description');
  
  if (error) {
    console.error('Error fetching components:', error);
    return [];
  }
  
  return data || [];
}

export async function fetchComponentsByIds(ids: number[]): Promise<Component[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { data, error } = await supabase
    .from('components')
    .select('component_id, internal_code, description')
    .in('component_id', ids);
  if (error) {
    console.error('Error fetching components by ids:', error);
    return [];
  }
  return (data as Component[]) || [];
}

export async function fetchSupplierComponentsForComponent(componentId: number): Promise<SupplierComponent[]> {
  const { data, error } = await supabase
    .from('suppliercomponents')
    .select(`
      supplier_component_id,
      component_id,
      supplier_id,
      supplier_code,
      price,
      lead_time,
      min_order_quantity,
      description,
      supplier:suppliers(
        supplier_id,
        name,
        contact_info
      )
    `)
    .eq('component_id', componentId)
    .order('price');

  if (error) {
    console.error('Error fetching supplier components:', error);
    return [];
  }

  if (!data) return [];

  return data.map((item) => {
    const record = item as unknown as {
      supplier_component_id: number;
      component_id: number;
      supplier_id: number | null;
      supplier_code: string;
      price?: number | null;
      lead_time?: number | null;
      min_order_quantity?: number | null;
      description?: string | null;
      supplier?: {
        supplier_id: number;
        name: string;
        contact_info?: string | null;
      } | null;
    };

    return {
      supplier_component_id: record.supplier_component_id,
      component_id: record.component_id,
      supplier_id: record.supplier_id ?? record.supplier?.supplier_id ?? undefined,
      supplier_code: record.supplier_code,
      price: typeof record.price === 'number' ? record.price : undefined,
      lead_time: record.lead_time ?? undefined,
      min_order_quantity: record.min_order_quantity ?? undefined,
      description: record.description ?? undefined,
      supplier: record.supplier
        ? {
            supplier_id: record.supplier.supplier_id,
            name: record.supplier.name,
            contact_info: record.supplier.contact_info ?? undefined,
          }
        : undefined,
    } as SupplierComponent;
  });
}

// ---- Supplier browse helpers for quotes ----
export interface SupplierLite { supplier_id: number; name: string }

export interface SupplierComponentWithMaster extends SupplierComponent {
  component?: { internal_code?: string | null; description?: string | null } | null;
}

export async function fetchSuppliersSimple(): Promise<SupplierLite[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('supplier_id, name')
    .order('name');
  if (error) {
    console.error('Error fetching suppliers:', error);
    return [];
  }
  return (data as SupplierLite[]) || [];
}

export async function fetchSupplierComponentsBySupplier(
  supplierId: number
): Promise<SupplierComponentWithMaster[]> {
  const { data, error } = await supabase
    .from('suppliercomponents')
    .select(`
      supplier_component_id,
      component_id,
      supplier_id,
      supplier_code,
      price,
      lead_time,
      min_order_quantity,
      description,
      supplier:suppliers(supplier_id, name),
      component:components(internal_code, description)
    `)
    .eq('supplier_id', supplierId)
    .order('price', { ascending: true });

  if (error) {
    console.error('Error fetching supplier components for supplier:', error);
    return [];
  }

  return (data as unknown as SupplierComponentWithMaster[]) || [];
}

// Re-export formatCurrency utility
export { formatCurrency } from '@/lib/quotes';

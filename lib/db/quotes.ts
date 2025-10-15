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

export interface QuoteItem {
  id: string;
  quote_id: string;
  description: string;
  qty: number;
  unit_price: number;
  total: number;
  bullet_points?: string | null;
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
  line_type: 'component' | 'manual' | 'labor';
  component_id?: number | null;
  description?: string | null;
  qty: number;
  unit_cost?: number | null;
  unit_price?: number | null;
  include_in_markup: boolean;
  labor_type?: string | null;
  hours?: number | null;
  rate?: number | null;
  sort_order: number;
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
  }
> {
  const client = supabaseAdmin;

  const { data: quote, error: quoteError } = await client
    .from('quotes')
    .select('*, customer:customers(id, name, email, telephone)')
    .eq('id', id)
    .single();

  if (quoteError) throw quoteError;

  const { data: items, error: itemsError } = await client
    .from('quote_items')
    .select('*, quote_item_clusters(*, quote_cluster_lines(*)), quote_item_cutlists(*)')
    .eq('quote_id', id)
    .order('created_at', { ascending: true });

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

export async function createQuoteItem(item: Partial<QuoteItem>): Promise<QuoteItem> {
  // Create the quote item first
  const { data: newItem, error: itemError } = await supabase
    .from('quote_items')
    .insert([item])
    .select('*')
    .single();
  if (itemError) throw itemError;

  // Automatically create a default cluster for the new item
  if (newItem) {
    await createQuoteItemCluster({
      quote_item_id: newItem.id,
      name: 'Costing Cluster',
      position: 0,
    });
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
    .insert([line])
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
    .update(updates)
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
    const res = await fetch(`/api/products/${productId}/effective-bol`, { cache: 'no-store' });
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

    const res = await fetch(url, { cache: 'no-store' });
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
      *,
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
  
  return data || [];
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

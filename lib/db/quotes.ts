import { supabase } from '@/lib/supabase';

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
}

export interface QuoteAttachment {
  id: string;
  quote_id: string;
  file_url: string;
  mime_type: string;
  uploaded_at: string;
}

export async function fetchQuotes(filters?: {
  status?: string;
  search?: string;
  customerId?: string;
}): Promise<Quote[]> {
  let query = supabase
    .from('quote_with_total')
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

export async function fetchQuote(id: string): Promise<Quote & { items: QuoteItem[]; attachments: QuoteAttachment[] }> {
  const { data, error } = await supabase
    .from('quotes')
    .select(
      `*,
       quote_items(*),
       quote_attachments(*)`
    )
    .eq('id', id)
    .single();
  if (error) throw error;
  return {
    ...data,
    items: data.quote_items,
    attachments: data.quote_attachments,
  };
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
  const { data, error } = await supabase
    .from('quote_items')
    .insert([item])
    .select()
    .single();
  if (error) throw error;
  return data!;
}

export async function updateQuoteItem(
  id: string,
  updates: Partial<QuoteItem>
): Promise<QuoteItem> {
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
export async function deleteQuoteAttachment(id: string): Promise<void> {
  const { error } = await supabase
    .from('quote_attachments')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/**
 * Uploads a file to Supabase storage (with timestamp prefix to avoid duplicates), and creates a DB record.
 */
export async function uploadQuoteAttachment(
  file: File,
  quoteId: string
): Promise<QuoteAttachment> {
  const timestamp = Date.now();
  const filePath = `quote-attachments/${quoteId}/${timestamp}_${file.name}`;
  const { data: uploadData, error: uploadError } = await supabase
    .storage
    .from('QButton')
    .upload(filePath, file);
  if (uploadError) throw uploadError;

  const { data: urlData, error: urlError } = supabase
    .storage
    .from('QButton')
    .getPublicUrl(uploadData.path);
  const publicUrl = urlData.publicUrl;

  const attachmentRecord: Partial<QuoteAttachment> = {
    quote_id: quoteId,
    file_url: publicUrl,
    mime_type: file.type,
  };
  const { data, error } = await supabase
    .from('quote_attachments')
    .insert([attachmentRecord])
    .select()
    .single();
  if (error) throw error;

  return data;
}

// Quotes System Utilities
import { supabase } from './supabase';
import type {
  Quote,
  QuoteLineItem,
  QuoteLineAttachment,
  QuoteReferenceImage,
  QuoteCompanySettings,
  CreateQuoteData,
  CreateQuoteLineItemData,
  UpdateQuoteLineItemData,
  QuoteFilters,
  FileUploadResult
} from '../types/quotes';

// Quotes CRUD operations
export async function createQuote(data: CreateQuoteData) {
  const { data: quote, error } = await supabase
    .from('quotes')
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return quote as Quote;
}

export async function getQuotes(filters: QuoteFilters = {}) {
  let query = supabase
    .from('quotes')
    .select(`
      *,
      customer:customers(id, name, email, telephone),
      line_items:quote_line_items(
        *,
        attachments:quote_line_attachments(*)
      ),
      reference_images:quote_reference_images(*)
    `)
    .order('created_at', { ascending: false });

  // Apply filters
  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.customer_id) {
    query = query.eq('customer_id', filters.customer_id);
  }
  if (filters.date_from) {
    query = query.gte('created_at', filters.date_from);
  }
  if (filters.date_to) {
    query = query.lte('created_at', filters.date_to);
  }
  if (filters.search) {
    query = query.or(`quote_number.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Quote[];
}

export async function getQuote(quoteId: number) {
  const { data, error } = await supabase
    .from('quotes')
    .select(`
      *,
      customer:customers(id, name, email, telephone),
      line_items:quote_line_items(
        *,
        attachments:quote_line_attachments(*)
      ),
      reference_images:quote_reference_images(*)
    `)
    .eq('quote_id', quoteId)
    .single();

  if (error) throw error;
  return data as Quote;
}

export async function updateQuote(quoteId: number, updates: Partial<Quote>) {
  const { data, error } = await supabase
    .from('quotes')
    .update(updates)
    .eq('quote_id', quoteId)
    .select()
    .single();

  if (error) throw error;
  return data as Quote;
}

export async function deleteQuote(quoteId: number) {
  const { error } = await supabase
    .from('quotes')
    .delete()
    .eq('quote_id', quoteId);

  if (error) throw error;
}

// Quote Line Items CRUD
export async function addQuoteLineItem(quoteId: number, data: CreateQuoteLineItemData) {
  // Get the next line number
  const { data: maxLineNumber } = await supabase
    .from('quote_line_items')
    .select('line_number')
    .eq('quote_id', quoteId)
    .order('line_number', { ascending: false })
    .limit(1)
    .single();

  const nextLineNumber = (maxLineNumber?.line_number || 0) + 1;

  const { data: lineItem, error } = await supabase
    .from('quote_line_items')
    .insert({
      quote_id: quoteId,
      line_number: nextLineNumber,
      ...data
    })
    .select()
    .single();

  if (error) throw error;
  return lineItem as QuoteLineItem;
}

export async function updateQuoteLineItem(data: UpdateQuoteLineItemData) {
  const { line_item_id, ...updates } = data;
  const { data: lineItem, error } = await supabase
    .from('quote_line_items')
    .update(updates)
    .eq('line_item_id', line_item_id)
    .select()
    .single();

  if (error) throw error;
  return lineItem as QuoteLineItem;
}

export async function deleteQuoteLineItem(lineItemId: number) {
  const { error } = await supabase
    .from('quote_line_items')
    .delete()
    .eq('line_item_id', lineItemId);

  if (error) throw error;
}

// File upload utilities
export async function uploadQuoteFile(file: File, folder: string = 'quotes'): Promise<FileUploadResult> {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
  const filePath = `${folder}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('quote-files')
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  return {
    file_path: filePath,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type
  };
}

export async function addLineItemAttachment(lineItemId: number, fileResult: FileUploadResult, displayInQuote: boolean = true) {
  const { data, error } = await supabase
    .from('quote_line_attachments')
    .insert({
      line_item_id: lineItemId,
      file_name: fileResult.file_name,
      file_path: fileResult.file_path,
      file_type: fileResult.mime_type.startsWith('image/') ? 'image' : 'document',
      mime_type: fileResult.mime_type,
      file_size: fileResult.file_size,
      display_in_quote: displayInQuote
    })
    .select()
    .single();

  if (error) throw error;
  return data as QuoteLineAttachment;
}

export async function updateAttachmentDisplaySettings(attachmentId: number, displayInQuote: boolean, displayOrder: number) {
  const { data, error } = await supabase
    .from('quote_line_attachments')
    .update({
      display_in_quote: displayInQuote,
      display_order: displayOrder
    })
    .eq('attachment_id', attachmentId)
    .select()
    .single();

  if (error) throw error;
  return data as QuoteLineAttachment;
}

export async function deleteAttachment(attachmentId: number) {
  // First get the file path to delete from storage
  const { data: attachment } = await supabase
    .from('quote_line_attachments')
    .select('file_path')
    .eq('attachment_id', attachmentId)
    .single();

  if (attachment) {
    // Delete from storage
    await supabase.storage
      .from('quote-files')
      .remove([attachment.file_path]);
  }

  // Delete from database
  const { error } = await supabase
    .from('quote_line_attachments')
    .delete()
    .eq('attachment_id', attachmentId);

  if (error) throw error;
}

// Reference images
export async function addReferenceImage(quoteId: number, fileResult: FileUploadResult, title: string, description?: string) {
  const { data, error } = await supabase
    .from('quote_reference_images')
    .insert({
      quote_id: quoteId,
      title,
      description,
      file_name: fileResult.file_name,
      file_path: fileResult.file_path,
      mime_type: fileResult.mime_type,
      file_size: fileResult.file_size
    })
    .select()
    .single();

  if (error) throw error;
  return data as QuoteReferenceImage;
}

export async function deleteReferenceImage(referenceId: number) {
  // First get the file path to delete from storage
  const { data: reference } = await supabase
    .from('quote_reference_images')
    .select('file_path')
    .eq('reference_id', referenceId)
    .single();

  if (reference) {
    // Delete from storage
    await supabase.storage
      .from('quote-files')
      .remove([reference.file_path]);
  }

  // Delete from database
  const { error } = await supabase
    .from('quote_reference_images')
    .delete()
    .eq('reference_id', referenceId);

  if (error) throw error;
}

// Company settings
export async function getCompanySettings(): Promise<QuoteCompanySettings> {
  const { data, error } = await supabase
    .from('quote_company_settings')
    .select('*')
    .limit(1)
    .single();

  if (error) throw error;
  return data as QuoteCompanySettings;
}

export async function updateCompanySettings(updates: Partial<QuoteCompanySettings>) {
  const { data, error } = await supabase
    .from('quote_company_settings')
    .update(updates)
    .eq('setting_id', 1) // Assuming single company settings record
    .select()
    .single();

  if (error) throw error;
  return data as QuoteCompanySettings;
}

// Utility functions
export function getFileUrl(filePath: string): string {
  const { data } = supabase.storage
    .from('quote-files')
    .getPublicUrl(filePath);
  
  return data.publicUrl;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR'
  }).format(amount);
}

export function calculateVAT(amount: number, vatRate: number = 15): number {
  return amount * (vatRate / 100);
}

export function calculateTotal(subtotal: number, vatRate: number = 15): number {
  return subtotal + calculateVAT(subtotal, vatRate);
}

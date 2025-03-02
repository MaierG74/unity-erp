import { supabase } from '@/lib/supabase';
import type { Supplier, SupplierEmail, SupplierComponent, SupplierWithDetails, SupplierPricelist } from '@/types/suppliers';

export async function getSuppliers() {
  const { data, error } = await supabase
    .from('suppliers')
    .select(`
      *,
      emails:supplier_emails(*),
      components:suppliercomponents(
        *,
        component:components(internal_code, description)
      ),
      pricelists:supplier_pricelists(*)
    `)
    .order('name');

  if (error) throw error;
  return data as SupplierWithDetails[];
}

export async function getSupplier(id: number) {
  const { data, error } = await supabase
    .from('suppliers')
    .select(`
      *,
      emails:supplier_emails(*),
      components:suppliercomponents(
        *,
        component:components(internal_code, description)
      ),
      pricelists:supplier_pricelists(*)
    `)
    .eq('supplier_id', id)
    .single();

  if (error) throw error;
  return data as SupplierWithDetails;
}

export async function createSupplier(supplier: Omit<Supplier, 'supplier_id'>) {
  const { data, error } = await supabase
    .from('suppliers')
    .insert(supplier)
    .select()
    .single();

  if (error) throw error;
  return data as Supplier;
}

export async function updateSupplier(id: number, supplier: Partial<Supplier>) {
  const { data, error } = await supabase
    .from('suppliers')
    .update(supplier)
    .eq('supplier_id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Supplier;
}

export async function deleteSupplier(id: number) {
  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('supplier_id', id);

  if (error) throw error;
}

// Email management
export async function addSupplierEmail(email: Omit<SupplierEmail, 'email_id'>) {
  const { data, error } = await supabase
    .from('supplier_emails')
    .insert(email)
    .select()
    .single();

  if (error) throw error;
  return data as SupplierEmail;
}

export async function updateSupplierEmail(id: number, email: Partial<SupplierEmail>) {
  const { data, error } = await supabase
    .from('supplier_emails')
    .update(email)
    .eq('email_id', id)
    .select()
    .single();

  if (error) throw error;
  return data as SupplierEmail;
}

export async function deleteSupplierEmail(id: number) {
  const { error } = await supabase
    .from('supplier_emails')
    .delete()
    .eq('email_id', id);

  if (error) throw error;
}

// Component management
export async function addSupplierComponent(component: Omit<SupplierComponent, 'supplier_component_id'>) {
  const { data, error } = await supabase
    .from('suppliercomponents')
    .insert(component)
    .select()
    .single();

  if (error) throw error;
  return data as SupplierComponent;
}

export async function updateSupplierComponent(id: number, component: Partial<SupplierComponent>) {
  const { data, error } = await supabase
    .from('suppliercomponents')
    .update(component)
    .eq('supplier_component_id', id)
    .select()
    .single();

  if (error) throw error;
  return data as SupplierComponent;
}

export async function deleteSupplierComponent(id: number) {
  const { error } = await supabase
    .from('suppliercomponents')
    .delete()
    .eq('supplier_component_id', id);

  if (error) throw error;
}

// Pricelist management
export async function uploadPricelist(
  supplierId: number,
  file: File,
  displayName: string
): Promise<SupplierPricelist> {
  const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
  const filePath = `Price List/${fileName}`;

  // Upload file to Supabase Storage
  const { error: uploadError, data: uploadData } = await supabase.storage
    .from('QButton')
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  // Get the public URL
  const { data: { publicUrl } } = supabase.storage
    .from('QButton')
    .getPublicUrl(filePath);

  // Create database record
  const { data, error } = await supabase
    .from('supplier_pricelists')
    .insert({
      supplier_id: supplierId,
      file_name: fileName,
      display_name: displayName,
      file_url: publicUrl,
      file_type: fileExt
    })
    .select()
    .single();

  if (error) {
    // If database insert fails, delete the uploaded file
    await supabase.storage
      .from('QButton')
      .remove([filePath]);
    throw error;
  }

  return data as SupplierPricelist;
}

export async function deletePricelist(pricelist: SupplierPricelist) {
  // Delete file from storage
  const filePath = `Price List/${pricelist.file_name}`;
  const { error: storageError } = await supabase.storage
    .from('QButton')
    .remove([filePath]);

  if (storageError) throw storageError;

  // Delete database record
  const { error: dbError } = await supabase
    .from('supplier_pricelists')
    .delete()
    .eq('pricelist_id', pricelist.pricelist_id);

  if (dbError) throw dbError;
} 
import { supabase } from '@/lib/supabase';
import type { Supplier, SupplierEmail, SupplierComponent, SupplierWithDetails, SupplierPricelist, SupplierPurchaseOrder } from '@/types/suppliers';

// Extended SupplierComponent type that includes component details
export type SupplierComponentWithDetails = SupplierComponent & {
  component: {
    internal_code: string;
    description: string | null;
    category: {
      cat_id: number;
      categoryname: string;
    } | null;
  };
};

export async function getSuppliers() {
  const { data, error } = await supabase
    .from('suppliers')
    .select(`
      *,
      emails:supplier_emails(*),
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
      pricelists:supplier_pricelists(*)
    `)
    .eq('supplier_id', id)
    .single();

  if (error) throw error;
  return data as SupplierWithDetails;
}

// Fetch supplier components separately (optimized - only loads when Components tab is opened)
export async function getSupplierComponents(supplierId: number) {
  const { data, error } = await supabase
    .from('suppliercomponents')
    .select(`
      *,
      component:components(
        internal_code, 
        description,
        category:component_categories(cat_id, categoryname)
      )
    `)
    .eq('supplier_id', supplierId)
    .order('supplier_component_id');

  if (error) throw error;
  return data as SupplierComponentWithDetails[];
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
  // Check for purchase orders referencing this supplier
  const { count, error: checkError } = await supabase
    .from('purchase_orders')
    .select('*', { count: 'exact', head: true })
    .eq('supplier_id', id);

  if (checkError) throw checkError;

  if (count && count > 0) {
    throw new Error(
      `Cannot delete this supplier because it has ${count} purchase order${count === 1 ? '' : 's'}. Remove the purchase orders first.`
    );
  }

  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('supplier_id', id);

  if (error) throw error;
}

// Lightweight function to get just supplier names and IDs for dropdowns (active only)
export async function getSuppliersList() {
  const { data, error } = await supabase
    .from('suppliers')
    .select('supplier_id, name')
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return data as Array<{ supplier_id: number; name: string }>;
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

export async function togglePricelistActive(pricelistId: number, isActive: boolean) {
  const { data, error } = await supabase
    .from('supplier_pricelists')
    .update({ is_active: isActive })
    .eq('pricelist_id', pricelistId)
    .select()
    .single();

  if (error) throw error;
  return data as SupplierPricelist;
}

// Open order counts per supplier (for list page indicator)
export async function getOpenOrderCounts(): Promise<Record<number, number>> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('purchase_order_id, supplier_id, status_id')
    .in('status_id', [1, 2, 7, 8]); // Open, In Progress, Approved, Partially Received

  if (error) throw error;

  const counts: Record<number, number> = {};
  (data || []).forEach((po) => {
    if (po.supplier_id) {
      counts[po.supplier_id] = (counts[po.supplier_id] || 0) + 1;
    }
  });
  return counts;
}

// Detailed open orders for a specific supplier (for modal)
export async function getSupplierOpenOrders(supplierId: number) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(`
      purchase_order_id,
      q_number,
      order_date,
      created_at,
      notes,
      status:supplier_order_statuses!purchase_orders_status_id_fkey(status_name),
      supplier_orders(
        order_id,
        order_quantity,
        total_received,
        supplier_component:suppliercomponents(
          supplier_component_id,
          supplier_code,
          price,
          component:components(
            component_id,
            internal_code,
            description
          )
        ),
        supplier_order_customer_orders(
          order:orders(
            order_id,
            order_number,
            customer:customers(name)
          )
        )
      )
    `)
    .eq('supplier_id', supplierId)
    .in('status_id', [1, 2, 7, 8])
    .order('order_date', { ascending: false });

  if (error) throw error;
  return (data || []) as SupplierPurchaseOrder[];
} 
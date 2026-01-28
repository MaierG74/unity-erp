import { supabase } from '@/lib/supabase';
import type {
  CustomerContact,
  CreateCustomerContactData,
  UpdateCustomerContactData,
} from '@/types/customers';

export async function fetchContactsByCustomerId(
  customerId: number
): Promise<CustomerContact[]> {
  const { data, error } = await supabase
    .from('customer_contacts')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_primary', { ascending: false })
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function fetchContactById(
  contactId: number
): Promise<CustomerContact | null> {
  const { data, error } = await supabase
    .from('customer_contacts')
    .select('*')
    .eq('id', contactId)
    .single();

  if (error) {
    console.error('Error fetching contact:', error);
    return null;
  }
  return data;
}

export async function createContact(
  input: CreateCustomerContactData
): Promise<CustomerContact> {
  // If this is the first contact for the customer, force is_primary
  const { count } = await supabase
    .from('customer_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', input.customer_id);

  const isPrimary = count === 0 ? true : input.is_primary ?? false;

  // If setting as primary, unset existing primary first
  if (isPrimary) {
    await supabase
      .from('customer_contacts')
      .update({ is_primary: false })
      .eq('customer_id', input.customer_id)
      .eq('is_primary', true);
  }

  const { data, error } = await supabase
    .from('customer_contacts')
    .insert({ ...input, is_primary: isPrimary })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateContact(
  contactId: number,
  customerId: number,
  input: UpdateCustomerContactData
): Promise<CustomerContact> {
  // If setting as primary, unset existing primary first
  if (input.is_primary) {
    await supabase
      .from('customer_contacts')
      .update({ is_primary: false })
      .eq('customer_id', customerId)
      .eq('is_primary', true);
  }

  const { data, error } = await supabase
    .from('customer_contacts')
    .update(input)
    .eq('id', contactId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteContact(contactId: number): Promise<void> {
  // Get the contact to check if it was primary
  const { data: contact } = await supabase
    .from('customer_contacts')
    .select('customer_id, is_primary')
    .eq('id', contactId)
    .single();

  const { error } = await supabase
    .from('customer_contacts')
    .delete()
    .eq('id', contactId);

  if (error) throw error;

  // If deleted contact was primary, promote the next one
  if (contact?.is_primary) {
    const { data: next } = await supabase
      .from('customer_contacts')
      .select('id')
      .eq('customer_id', contact.customer_id)
      .order('created_at')
      .limit(1)
      .single();

    if (next) {
      await supabase
        .from('customer_contacts')
        .update({ is_primary: true })
        .eq('id', next.id);
    }
  }
}

export async function setPrimaryContact(
  contactId: number,
  customerId: number
): Promise<void> {
  // Unset current primary
  await supabase
    .from('customer_contacts')
    .update({ is_primary: false })
    .eq('customer_id', customerId)
    .eq('is_primary', true);

  // Set new primary
  const { error } = await supabase
    .from('customer_contacts')
    .update({ is_primary: true })
    .eq('id', contactId);

  if (error) throw error;
}

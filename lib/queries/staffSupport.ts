import { supabase } from '@/lib/supabase';

export interface SupportLink {
  link_id: number;
  primary_staff_id: number;
  primary_staff_name: string;
  support_staff_id: number;
  support_staff_name: string;
  cost_share_pct: number;
  effective_from: string;
  effective_until: string | null;
}

export async function fetchSupportLinks(): Promise<SupportLink[]> {
  const { data, error } = await supabase
    .from('staff_support_links')
    .select(`
      link_id,
      primary_staff_id,
      primary_staff:staff!staff_support_links_primary_staff_id_fkey(first_name, last_name),
      support_staff_id,
      support_staff:staff!staff_support_links_support_staff_id_fkey(first_name, last_name),
      cost_share_pct,
      effective_from,
      effective_until
    `)
    .is('effective_until', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    link_id: row.link_id,
    primary_staff_id: row.primary_staff_id,
    primary_staff_name: row.primary_staff
      ? `${row.primary_staff.first_name} ${row.primary_staff.last_name}`
      : 'Unknown',
    support_staff_id: row.support_staff_id,
    support_staff_name: row.support_staff
      ? `${row.support_staff.first_name} ${row.support_staff.last_name}`
      : 'Unknown',
    cost_share_pct: row.cost_share_pct,
    effective_from: row.effective_from,
    effective_until: row.effective_until,
  }));
}

export async function createSupportLink(params: {
  primaryStaffId: number;
  supportStaffId: number;
  costSharePct: number;
  orgId: string;
}): Promise<void> {
  const { error } = await supabase
    .from('staff_support_links')
    .insert({
      primary_staff_id: params.primaryStaffId,
      support_staff_id: params.supportStaffId,
      cost_share_pct: params.costSharePct,
      org_id: params.orgId,
    });
  if (error) throw error;
}

export async function updateSupportLink(linkId: number, costSharePct: number): Promise<void> {
  const { error } = await supabase
    .from('staff_support_links')
    .update({ cost_share_pct: costSharePct, updated_at: new Date().toISOString() })
    .eq('link_id', linkId);
  if (error) throw error;
}

export async function deactivateSupportLink(linkId: number): Promise<void> {
  const { error } = await supabase
    .from('staff_support_links')
    .update({ effective_until: new Date().toISOString().split('T')[0], updated_at: new Date().toISOString() })
    .eq('link_id', linkId);
  if (error) throw error;
}

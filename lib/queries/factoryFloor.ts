import { supabase } from '@/lib/supabase';
import type { FactorySection, FloorStaffJob, SectionWithStaff } from '@/components/factory-floor/types';

// --------------- Floor status (active sections + jobs) ---------------

export async function fetchFactoryFloorData(): Promise<SectionWithStaff[]> {
  // Run both queries in parallel — they are independent
  const [jobsResult, sectionsResult] = await Promise.all([
    supabase.from('factory_floor_status').select('*'),
    supabase
      .from('factory_sections')
      .select('section_id, name, display_order, category_id, color, grid_span, is_active')
      .eq('is_active', true)
      .order('display_order'),
  ]);

  if (jobsResult.error) throw jobsResult.error;
  if (sectionsResult.error) throw sectionsResult.error;

  const jobs: FloorStaffJob[] = jobsResult.data ?? [];
  const sectionRows = sectionsResult.data ?? [];

  // Seed the map with all active sections (so empty ones show)
  const map = new Map<number, SectionWithStaff>();
  for (const s of sectionRows ?? []) {
    map.set(s.section_id, {
      section: s,
      staffJobs: [],
    });
  }

  // Group jobs into their sections
  for (const job of jobs) {
    if (job.section_id === null) continue;
    const entry = map.get(job.section_id);
    if (entry) {
      entry.staffJobs.push(job);
    }
  }

  return [...map.values()].sort((a, b) => a.section.display_order - b.section.display_order);
}

export async function updateProgressOverride(
  assignmentId: number,
  progress: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('labor_plan_assignments')
    .update({ progress_override: progress })
    .eq('assignment_id', assignmentId);

  if (error) throw error;
}

// --------------- Section CRUD (settings dialog) ---------------

export interface JobCategory {
  category_id: number;
  name: string;
}

export async function fetchAllSections(): Promise<FactorySection[]> {
  const { data, error } = await supabase
    .from('factory_sections')
    .select('*')
    .order('display_order');

  if (error) throw error;
  return data ?? [];
}

export async function fetchJobCategories(): Promise<JobCategory[]> {
  const { data, error } = await supabase
    .from('job_categories')
    .select('category_id, name')
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export type SectionInsert = Omit<FactorySection, 'section_id'>;
export type SectionUpdate = Partial<Omit<FactorySection, 'section_id'>>;

export async function createSection(section: SectionInsert): Promise<FactorySection> {
  const { data, error } = await supabase
    .from('factory_sections')
    .insert(section)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSection(
  sectionId: number,
  updates: SectionUpdate,
): Promise<void> {
  const { error } = await supabase
    .from('factory_sections')
    .update(updates)
    .eq('section_id', sectionId);

  if (error) throw error;
}

export async function deleteSection(sectionId: number): Promise<void> {
  const { error } = await supabase
    .from('factory_sections')
    .delete()
    .eq('section_id', sectionId);

  if (error) throw error;
}

// --------------- Job card items (for completion dialog) ---------------

export interface JobCardItemForCompletion {
  item_id: number;
  job_id: number | null;
  job_name: string | null;
  product_id: number | null;
  product_name: string | null;
  quantity: number;
  completed_quantity: number;
  piece_rate: number | null;
  status: string;
}

export async function fetchJobCardItems(jobCardId: number): Promise<JobCardItemForCompletion[]> {
  const { data, error } = await supabase
    .from('job_card_items')
    .select(`
      item_id,
      job_id,
      jobs:job_id (name),
      product_id,
      products:product_id (name),
      quantity,
      completed_quantity,
      piece_rate,
      status
    `)
    .eq('job_card_id', jobCardId)
    .order('item_id');

  if (error) throw error;

  return (data ?? []).map((item: any) => ({
    item_id: item.item_id,
    job_id: item.job_id,
    job_name: item.jobs?.name ?? null,
    product_id: item.product_id,
    product_name: item.products?.name ?? null,
    quantity: item.quantity,
    completed_quantity: item.completed_quantity,
    piece_rate: item.piece_rate,
    status: item.status,
  }));
}

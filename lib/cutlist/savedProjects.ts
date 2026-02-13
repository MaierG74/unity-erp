'use client';

import { supabase } from '@/lib/supabase';
import type {
  BoardMaterial,
  EdgingMaterial,
  CompactPart,
} from '@/components/features/cutlist/primitives';

// =============================================================================
// Types
// =============================================================================

export interface SavedCutlistData {
  parts: CompactPart[];
  primaryBoards: BoardMaterial[];
  backerBoards: BoardMaterial[];
  edging: EdgingMaterial[];
  kerf: number;
  optimizationPriority: 'fast' | 'offcut' | 'deep';
}

export interface CutlistFolder {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SavedCutlistProject {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  data: SavedCutlistData;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Helpers
// =============================================================================

async function getUserId(): Promise<string | null> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.user) return null;
  return session.user.id;
}

// =============================================================================
// Folder CRUD
// =============================================================================

export async function loadFolders(): Promise<CutlistFolder[]> {
  const userId = await getUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('cutlist_folders')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Error loading cutlist folders:', error);
    return [];
  }

  return (data ?? []) as CutlistFolder[];
}

export async function createFolder(
  name: string,
  parentId?: string | null
): Promise<CutlistFolder | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('cutlist_folders')
    .insert({
      user_id: userId,
      name,
      parent_id: parentId ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating cutlist folder:', error);
    return null;
  }

  return data as CutlistFolder;
}

export async function renameFolder(
  id: string,
  name: string
): Promise<boolean> {
  const { error } = await supabase
    .from('cutlist_folders')
    .update({ name })
    .eq('id', id);

  if (error) {
    console.error('Error renaming cutlist folder:', error);
    return false;
  }
  return true;
}

export async function deleteFolder(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('cutlist_folders')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting cutlist folder:', error);
    return false;
  }
  return true;
}

// =============================================================================
// Project CRUD
// =============================================================================

export async function loadProjects(): Promise<SavedCutlistProject[]> {
  const userId = await getUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from('cutlist_saved_projects')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error loading cutlist projects:', error);
    return [];
  }

  return (data ?? []) as SavedCutlistProject[];
}

export async function saveProject(
  name: string,
  data: SavedCutlistData,
  folderId?: string | null
): Promise<SavedCutlistProject | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const { data: row, error } = await supabase
    .from('cutlist_saved_projects')
    .insert({
      user_id: userId,
      name,
      data: data as unknown as Record<string, unknown>,
      folder_id: folderId ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error saving cutlist project:', error);
    return null;
  }

  return row as SavedCutlistProject;
}

export async function updateProject(
  id: string,
  updates: {
    name?: string;
    folderId?: string | null;
    data?: SavedCutlistData;
  }
): Promise<boolean> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.folderId !== undefined) payload.folder_id = updates.folderId;
  if (updates.data !== undefined) payload.data = updates.data;

  const { error } = await supabase
    .from('cutlist_saved_projects')
    .update(payload)
    .eq('id', id);

  if (error) {
    console.error('Error updating cutlist project:', error);
    return false;
  }
  return true;
}

export async function deleteProject(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('cutlist_saved_projects')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting cutlist project:', error);
    return false;
  }
  return true;
}

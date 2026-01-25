'use client';

/**
 * Cutlist Material Defaults Persistence
 *
 * Functions for saving and loading user-specific cutlist material defaults
 * from the database. Falls back to localStorage if user is not authenticated.
 *
 * Usage in the cutlist page:
 *
 *   // On mount, load saved defaults:
 *   useEffect(() => {
 *     loadMaterialDefaults().then(defaults => {
 *       if (defaults) {
 *         setPrimaryBoards(defaults.primaryBoards);
 *         setBackerBoards(defaults.backerBoards);
 *         setEdging(defaults.edging);
 *         setKerf(defaults.kerf);
 *       }
 *     });
 *   }, []);
 *
 *   // Save button handler:
 *   const handleSaveDefaults = async () => {
 *     const success = await saveMaterialDefaults({
 *       primaryBoards,
 *       backerBoards,
 *       edging,
 *       kerf,
 *     });
 *     if (success) toast.success('Defaults saved');
 *   };
 */

import { supabase } from '@/lib/supabase';
import type {
  BoardMaterial,
  EdgingMaterial,
} from '@/components/features/cutlist/primitives';

// =============================================================================
// Types
// =============================================================================

/**
 * The material defaults configuration to save/load.
 */
export interface MaterialDefaults {
  primaryBoards: BoardMaterial[];
  backerBoards: BoardMaterial[];
  edging: EdgingMaterial[];
  kerf: number;
}

/**
 * Row shape from the cutlist_material_defaults table.
 */
interface MaterialDefaultsRow {
  id: string;
  user_id: string;
  primary_boards: BoardMaterial[];
  backer_boards: BoardMaterial[];
  edging: EdgingMaterial[];
  kerf_mm: number;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Constants
// =============================================================================

const LOCAL_STORAGE_KEY = 'cutlist_material_defaults';

const DEFAULT_KERF = 3;

// =============================================================================
// Local Storage Fallback
// =============================================================================

function loadFromLocalStorage(): MaterialDefaults | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return {
      primaryBoards: Array.isArray(parsed.primaryBoards)
        ? parsed.primaryBoards
        : [],
      backerBoards: Array.isArray(parsed.backerBoards)
        ? parsed.backerBoards
        : [],
      edging: Array.isArray(parsed.edging) ? parsed.edging : [],
      kerf:
        typeof parsed.kerf === 'number' ? parsed.kerf : DEFAULT_KERF,
    };
  } catch {
    return null;
  }
}

function saveToLocalStorage(defaults: MaterialDefaults): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(defaults));
    return true;
  } catch {
    return false;
  }
}

function clearLocalStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

// =============================================================================
// Database Functions
// =============================================================================

/**
 * Load material defaults for the current user.
 *
 * Attempts to load from the database first. If the user is not authenticated
 * or an error occurs, falls back to localStorage.
 *
 * @returns The saved defaults, or null if none exist
 */
export async function loadMaterialDefaults(): Promise<MaterialDefaults | null> {
  try {
    // Get current session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      // User not logged in - use localStorage fallback
      return loadFromLocalStorage();
    }

    // Query the database (RLS ensures we only get our own row)
    const { data, error } = await supabase
      .from('cutlist_material_defaults')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (error) {
      // PGRST116 = no rows found (not an error, just no defaults saved yet)
      if (error.code === 'PGRST116') {
        // Check localStorage for migrating existing local defaults
        return loadFromLocalStorage();
      }
      console.error('Error loading material defaults:', error);
      return loadFromLocalStorage();
    }

    const row = data as MaterialDefaultsRow;

    return {
      primaryBoards: Array.isArray(row.primary_boards)
        ? row.primary_boards
        : [],
      backerBoards: Array.isArray(row.backer_boards)
        ? row.backer_boards
        : [],
      edging: Array.isArray(row.edging) ? row.edging : [],
      kerf: typeof row.kerf_mm === 'number' ? row.kerf_mm : DEFAULT_KERF,
    };
  } catch (err) {
    console.error('Error loading material defaults:', err);
    return loadFromLocalStorage();
  }
}

/**
 * Save material defaults for the current user.
 *
 * Uses upsert to create or update the user's defaults row.
 * Falls back to localStorage if the user is not authenticated.
 *
 * @param defaults - The material defaults to save
 * @returns true if saved successfully, false otherwise
 */
export async function saveMaterialDefaults(
  defaults: MaterialDefaults
): Promise<boolean> {
  try {
    // Get current session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      // User not logged in - use localStorage fallback
      return saveToLocalStorage(defaults);
    }

    // Upsert to database (creates if not exists, updates if exists)
    const { error } = await supabase.from('cutlist_material_defaults').upsert(
      {
        user_id: session.user.id,
        primary_boards: defaults.primaryBoards,
        backer_boards: defaults.backerBoards,
        edging: defaults.edging,
        kerf_mm: defaults.kerf,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id',
      }
    );

    if (error) {
      console.error('Error saving material defaults:', error);
      // Fall back to localStorage
      return saveToLocalStorage(defaults);
    }

    // Clear localStorage since we've saved to database
    clearLocalStorage();

    return true;
  } catch (err) {
    console.error('Error saving material defaults:', err);
    return saveToLocalStorage(defaults);
  }
}

/**
 * Delete the current user's material defaults.
 *
 * @returns true if deleted successfully, false otherwise
 */
export async function deleteMaterialDefaults(): Promise<boolean> {
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      clearLocalStorage();
      return true;
    }

    const { error } = await supabase
      .from('cutlist_material_defaults')
      .delete()
      .eq('user_id', session.user.id);

    if (error) {
      console.error('Error deleting material defaults:', error);
      return false;
    }

    clearLocalStorage();
    return true;
  } catch (err) {
    console.error('Error deleting material defaults:', err);
    return false;
  }
}

/**
 * Migrate defaults from localStorage to the database.
 *
 * Call this after a user logs in to persist any locally-stored defaults
 * to the database.
 *
 * @returns true if migrated successfully or nothing to migrate, false on error
 */
export async function migrateMaterialDefaults(): Promise<boolean> {
  const localDefaults = loadFromLocalStorage();
  if (!localDefaults) {
    // Nothing to migrate
    return true;
  }

  // Check if user already has database defaults
  const dbDefaults = await loadMaterialDefaults();

  // Only migrate if no database defaults exist and we have local data
  if (!dbDefaults) {
    const success = await saveMaterialDefaults(localDefaults);
    if (success) {
      clearLocalStorage();
    }
    return success;
  }

  // Database already has defaults - optionally could merge here
  // For now, just clear localStorage since DB takes precedence
  clearLocalStorage();
  return true;
}

// =============================================================================
// Default Values Factory
// =============================================================================

/**
 * Create an empty MaterialDefaults object with sensible defaults.
 */
export function createEmptyMaterialDefaults(): MaterialDefaults {
  return {
    primaryBoards: [],
    backerBoards: [],
    edging: [],
    kerf: DEFAULT_KERF,
  };
}

'use client';

import { useCallback, useMemo } from 'react';
import type { CutlistPersistenceAdapter, CutlistSnapshot } from '../CutlistWorkspace';

/**
 * Options for the localStorage persistence adapter.
 */
export interface UseLocalStorageAdapterOptions {
  /** The localStorage key to use for persistence */
  storageKey?: string;
  /** Whether to log errors to console (default: true) */
  logErrors?: boolean;
}

const DEFAULT_STORAGE_KEY = 'cutlist-workspace-snapshot';

/**
 * Hook that returns a CutlistPersistenceAdapter for localStorage.
 *
 * Uses localStorage for persistence with JSON serialization.
 * Suitable for the standalone /cutlist page where no backend is needed.
 *
 * @example
 * ```tsx
 * const adapter = useLocalStorageAdapter({ storageKey: 'my-cutlist' });
 * <CutlistWorkspace persistenceAdapter={adapter} />
 * ```
 */
export function useLocalStorageAdapter(
  options: UseLocalStorageAdapterOptions = {}
): CutlistPersistenceAdapter {
  const { storageKey = DEFAULT_STORAGE_KEY, logErrors = true } = options;

  const load = useCallback(async (): Promise<CutlistSnapshot | null> => {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) {
        return null;
      }

      const parsed = JSON.parse(stored) as CutlistSnapshot | null;

      // Basic validation that we have expected structure
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      return parsed;
    } catch (err) {
      if (logErrors) {
        console.warn(`[useLocalStorageAdapter] Failed to load from "${storageKey}"`, err);
      }
      return null;
    }
  }, [storageKey, logErrors]);

  const save = useCallback(async (snapshot: CutlistSnapshot): Promise<void> => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const serialized = JSON.stringify(snapshot);
      window.localStorage.setItem(storageKey, serialized);
    } catch (err) {
      if (logErrors) {
        console.warn(`[useLocalStorageAdapter] Failed to save to "${storageKey}"`, err);
      }
      // Don't throw - localStorage errors shouldn't break the UI
    }
  }, [storageKey, logErrors]);

  const adapter = useMemo(
    (): CutlistPersistenceAdapter => ({
      load,
      save,
    }),
    [load, save]
  );

  return adapter;
}

export default useLocalStorageAdapter;

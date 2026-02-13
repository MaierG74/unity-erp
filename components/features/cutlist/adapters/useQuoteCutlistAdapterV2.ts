'use client';

import { useCallback, useRef } from 'react';
import type { CutlistCalculatorData } from '@/components/features/cutlist/CutlistCalculator';
import type { CompactPart, BoardMaterial, EdgingMaterial } from '@/components/features/cutlist/primitives';
import type { SheetBillingOverride, CutlistLineRefs } from '@/lib/cutlist/types';

// =============================================================================
// Types
// =============================================================================

/**
 * V2 layout format stored in quote_item_cutlists.layout_json.
 * Uses the new CompactPart + BoardMaterial + EdgingMaterial format
 * from the refactored CutlistCalculator component.
 */
export interface QuoteCutlistLayoutV2 {
  version: 2;
  parts: CompactPart[];
  primaryBoards: BoardMaterial[];
  backerBoards: BoardMaterial[];
  edging: EdgingMaterial[];
  kerf: number;
  optimizationPriority: 'fast' | 'offcut' | 'deep';
  sheetOverrides?: Record<string, SheetBillingOverride>;
  globalFullBoard?: boolean;
  backerSheetOverrides?: Record<string, SheetBillingOverride>;
  backerGlobalFullBoard?: boolean;
  lineRefs?: CutlistLineRefs;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Adapter for loading/saving cutlist data in the V2 format to the
 * quote_item_cutlists table via the existing API.
 *
 * Uses GET/PUT /api/quote-items/[id]/cutlist which stores layout_json
 * as flexible JSON (z.unknown() in the API schema).
 *
 * Old format data (no version field) returns null, meaning the calculator
 * starts fresh with pinned material defaults.
 */
export function useQuoteCutlistAdapterV2(quoteItemId: string | null | undefined) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const load = useCallback(async (): Promise<QuoteCutlistLayoutV2 | null> => {
    if (!quoteItemId) return null;

    try {
      const res = await fetch(`/api/quote-items/${quoteItemId}/cutlist`);
      if (res.status === 204) return null; // No saved cutlist
      if (!res.ok) {
        console.warn('Failed to load quote cutlist', res.status);
        return null;
      }

      const json = await res.json();
      const layout = json?.cutlist?.layout_json;
      if (!layout || layout.version !== 2) {
        // Old format or missing — start fresh
        return null;
      }

      return layout as QuoteCutlistLayoutV2;
    } catch (err) {
      console.warn('Failed to load quote cutlist', err);
      return null;
    }
  }, [quoteItemId]);

  const save = useCallback(async (data: CutlistCalculatorData, lineRefs?: CutlistLineRefs): Promise<void> => {
    if (!quoteItemId) return;

    const layout: QuoteCutlistLayoutV2 = {
      version: 2,
      parts: data.parts,
      primaryBoards: data.primaryBoards,
      backerBoards: data.backerBoards,
      edging: data.edging,
      kerf: data.kerf,
      optimizationPriority: data.optimizationPriority,
      sheetOverrides: data.sheetOverrides,
      globalFullBoard: data.globalFullBoard,
      backerSheetOverrides: data.backerSheetOverrides,
      backerGlobalFullBoard: data.backerGlobalFullBoard,
      lineRefs,
    };

    try {
      const res = await fetch(`/api/quote-items/${quoteItemId}/cutlist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout }),
      });

      if (!res.ok) {
        console.warn('Failed to save quote cutlist', res.status);
      }
    } catch (err) {
      console.warn('Failed to save quote cutlist', err);
    }
  }, [quoteItemId]);

  /** Debounced save — call on every data change */
  const debouncedSave = useCallback((data: CutlistCalculatorData, lineRefs?: CutlistLineRefs) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      save(data, lineRefs);
    }, 500);
  }, [save]);

  return { load, save, debouncedSave };
}

'use client';

import { useCallback, useMemo } from 'react';
import type { CutlistPersistenceAdapter, CutlistSnapshot } from '../CutlistWorkspace';
import type {
  LayoutResult,
  PartSpec,
  StockSheetSpec,
  SelectedComponent,
  CutlistMaterialDefinition,
  CutlistGroup,
  CutlistPart,
} from '@/lib/cutlist/types';

/**
 * Options for the quote cutlist persistence adapter.
 */
export interface UseQuoteCutlistAdapterOptions {
  /** Whether to log errors to console (default: true) */
  logErrors?: boolean;
}

/**
 * Layout snapshot format used by the quote API.
 * This matches the format in CutlistTool.tsx's SnapshotLayout type.
 */
interface SnapshotLayout {
  result: LayoutResult;
  backerResult: LayoutResult | null;
  parts: Array<PartSpec & { label?: string }>;
  stock: StockSheetSpec[];
  kerf: number;
  allowRotation: boolean;
  singleSheetOnly: boolean;
  costing: {
    primarySheetDescription: string;
    primaryPricePerSheet: number | null;
    backerSheetDescription: string;
    backerPricePerSheet: number | null;
    bandingDesc16: string;
    bandingPrice16: number | null;
    bandingDesc32: string;
    bandingPrice32: number | null;
    primaryComponent: SelectedComponent | null;
    backerComponent: SelectedComponent | null;
    band16Component: SelectedComponent | null;
    band32Component: SelectedComponent | null;
    materials: Array<{
      id: string;
      name: string;
      sheetDescription: string;
      pricePerSheet: number | null;
      band16Description: string;
      band16Price: number | null;
      band32Description: string;
      band32Price: number | null;
      component_id?: number;
      supplier_component_id?: number;
      unit_cost?: number | null;
    }>;
  };
}

interface SnapshotBilling {
  globalFullBoard: boolean;
  sheetOverrides: Record<string, { mode: 'auto' | 'full' | 'manual'; manualPct: number }>;
}

interface QuoteCutlistResponse {
  cutlist?: {
    layout_json?: SnapshotLayout;
    billing_overrides?: SnapshotBilling;
    updated_at?: string;
  };
}

/**
 * Helper to convert number | '' | null | undefined to number | '' for input fields.
 */
function hydrateNumberInput(value: number | null | undefined): number | '' {
  return value == null || Number.isNaN(value) ? '' : value;
}

/**
 * Helper to convert number | '' to number | null for API.
 */
function normalizeNullableNumber(value: number | '' | null | undefined): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/**
 * Convert API layout format to CutlistSnapshot format.
 */
function layoutToSnapshot(layout: SnapshotLayout): Partial<CutlistSnapshot> {
  const snapshot: Partial<CutlistSnapshot> = {};

  // Convert parts from API format to PartWithLabel format
  if (layout.parts?.length > 0) {
    snapshot.parts = layout.parts.map((p) => ({
      ...p,
      id: p.id || `P${Math.random().toString(36).slice(2, 8)}`,
      grain: p.grain ?? 'length',
      band_edges: p.band_edges ?? { top: true, right: true, bottom: true, left: true },
    }));
  }

  if (layout.stock?.length > 0) {
    snapshot.stock = layout.stock;
  }

  if (layout.costing) {
    const c = layout.costing;
    snapshot.costing = {
      primarySheetDescription: c.primarySheetDescription ?? 'MELAMINE SHEET',
      primaryPricePerSheet: hydrateNumberInput(c.primaryPricePerSheet),
      backerSheetDescription: c.backerSheetDescription ?? 'BACKER BOARD',
      backerPricePerSheet: hydrateNumberInput(c.backerPricePerSheet),
      bandingDesc16: c.bandingDesc16 ?? 'EDGE BANDING 16mm (m)',
      bandingPrice16: hydrateNumberInput(c.bandingPrice16),
      bandingDesc32: c.bandingDesc32 ?? 'EDGE BANDING 32mm (m)',
      bandingPrice32: hydrateNumberInput(c.bandingPrice32),
    };

    snapshot.components = {
      primary: c.primaryComponent ?? null,
      backer: c.backerComponent ?? null,
      band16: c.band16Component ?? null,
      band32: c.band32Component ?? null,
    };

    // Convert materials from API format
    if (Array.isArray(c.materials) && c.materials.length > 0) {
      snapshot.materials = c.materials.map((mat, idx): CutlistMaterialDefinition => ({
        id: mat.id || `material-${idx + 1}`,
        name: mat.name || `Material ${idx + 1}`,
        sheetDescription: mat.sheetDescription || 'MELAMINE SHEET',
        pricePerSheet: hydrateNumberInput(mat.pricePerSheet ?? null),
        band16Description: mat.band16Description || 'EDGE BANDING 16mm',
        band16Price: hydrateNumberInput(mat.band16Price ?? null),
        band32Description: mat.band32Description || 'EDGE BANDING 32mm',
        band32Price: hydrateNumberInput(mat.band32Price ?? null),
        component_id: mat.component_id,
        supplier_component_id: mat.supplier_component_id,
        unit_cost: typeof mat.unit_cost === 'number' ? mat.unit_cost : null,
      }));
    }
  }

  snapshot.options = {
    kerf: typeof layout.kerf === 'number' ? layout.kerf : 3,
    allowRotation: typeof layout.allowRotation === 'boolean' ? layout.allowRotation : true,
    singleSheetOnly: typeof layout.singleSheetOnly === 'boolean' ? layout.singleSheetOnly : false,
  };

  return snapshot;
}

/**
 * Convert CutlistSnapshot to API layout format.
 */
function snapshotToLayout(snapshot: CutlistSnapshot): SnapshotLayout {
  return {
    result: null as unknown as LayoutResult, // Not storing result in snapshot
    backerResult: null,
    parts: snapshot.parts.map((p) => ({
      id: p.id,
      length_mm: p.length_mm,
      width_mm: p.width_mm,
      qty: p.qty,
      grain: p.grain,
      band_edges: p.band_edges,
      laminate: p.laminate,
      material_id: p.material_id,
      label: p.label,
    })),
    stock: snapshot.stock,
    kerf: snapshot.options.kerf,
    allowRotation: snapshot.options.allowRotation,
    singleSheetOnly: snapshot.options.singleSheetOnly,
    costing: {
      primarySheetDescription: snapshot.costing.primarySheetDescription,
      primaryPricePerSheet: normalizeNullableNumber(snapshot.costing.primaryPricePerSheet),
      backerSheetDescription: snapshot.costing.backerSheetDescription,
      backerPricePerSheet: normalizeNullableNumber(snapshot.costing.backerPricePerSheet),
      bandingDesc16: snapshot.costing.bandingDesc16,
      bandingPrice16: normalizeNullableNumber(snapshot.costing.bandingPrice16),
      bandingDesc32: snapshot.costing.bandingDesc32,
      bandingPrice32: normalizeNullableNumber(snapshot.costing.bandingPrice32),
      primaryComponent: snapshot.components.primary,
      backerComponent: snapshot.components.backer,
      band16Component: snapshot.components.band16,
      band32Component: snapshot.components.band32,
      materials: snapshot.materials.map((mat) => ({
        id: mat.id,
        name: mat.name,
        sheetDescription: mat.sheetDescription,
        pricePerSheet: normalizeNullableNumber(mat.pricePerSheet),
        band16Description: mat.band16Description,
        band16Price: normalizeNullableNumber(mat.band16Price),
        band32Description: mat.band32Description,
        band32Price: normalizeNullableNumber(mat.band32Price),
        component_id: mat.component_id,
        supplier_component_id: mat.supplier_component_id,
        unit_cost: mat.unit_cost,
      })),
    },
  };
}

/**
 * Hook that returns a CutlistPersistenceAdapter for quote item cutlists.
 *
 * Uses the /api/quote-items/[id]/cutlist endpoint for persistence.
 * Suitable for the quote modal context where cutlist data is stored per quote item.
 *
 * @param quoteItemId - The UUID of the quote item to persist cutlist data for
 * @param options - Optional configuration
 *
 * @example
 * ```tsx
 * const adapter = useQuoteCutlistAdapter('uuid-here');
 * <CutlistWorkspace persistenceAdapter={adapter} />
 * ```
 */
export function useQuoteCutlistAdapter(
  quoteItemId: string | null | undefined,
  options: UseQuoteCutlistAdapterOptions = {}
): CutlistPersistenceAdapter {
  const { logErrors = true } = options;

  const load = useCallback(async (): Promise<CutlistSnapshot | null> => {
    if (!quoteItemId) {
      return null;
    }

    try {
      const res = await fetch(`/api/quote-items/${quoteItemId}/cutlist`, {
        cache: 'no-store',
      });

      // 204 = no content, no cutlist exists yet
      if (res.status === 204) {
        return null;
      }

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `Failed to load cutlist (${res.status})`);
      }

      const json = (await res.json()) as QuoteCutlistResponse;
      const cutlist = json?.cutlist;

      if (!cutlist) {
        return null;
      }

      const layout = cutlist.layout_json;
      if (!layout) {
        return null;
      }

      // Convert API layout format to CutlistSnapshot
      const partialSnapshot = layoutToSnapshot(layout);

      // Restore billing overrides if present
      const billing = cutlist.billing_overrides as SnapshotBilling | null | undefined;

      // Build full snapshot with defaults
      const snapshot: CutlistSnapshot = {
        parts: partialSnapshot.parts ?? [],
        groups: [], // Quote cutlist doesn't use grouped mode
        ungroupedParts: [],
        stock: partialSnapshot.stock ?? [
          { id: 'S1', length_mm: 2750, width_mm: 1830, qty: 10, kerf_mm: 3 },
        ],
        materials: partialSnapshot.materials ?? [],
        costing: partialSnapshot.costing ?? {
          primarySheetDescription: 'MELAMINE SHEET',
          primaryPricePerSheet: '',
          backerSheetDescription: 'BACKER BOARD',
          backerPricePerSheet: '',
          bandingDesc16: 'EDGE BANDING 16mm (m)',
          bandingPrice16: '',
          bandingDesc32: 'EDGE BANDING 32mm (m)',
          bandingPrice32: '',
        },
        components: partialSnapshot.components ?? {
          primary: null,
          backer: null,
          band16: null,
          band32: null,
        },
        options: partialSnapshot.options ?? {
          kerf: 3,
          allowRotation: true,
          singleSheetOnly: false,
        },
        inputMode: 'manual', // Quote cutlist uses manual mode
        billingOverrides: billing
          ? {
              globalFullBoard: billing.globalFullBoard ?? false,
              sheetOverrides: billing.sheetOverrides ?? {},
            }
          : undefined,
      };

      return snapshot;
    } catch (err) {
      if (logErrors) {
        console.warn(`[useQuoteCutlistAdapter] Failed to load cutlist for item "${quoteItemId}"`, err);
      }
      return null;
    }
  }, [quoteItemId, logErrors]);

  const save = useCallback(async (snapshot: CutlistSnapshot): Promise<void> => {
    if (!quoteItemId) {
      return;
    }

    try {
      const layout = snapshotToLayout(snapshot);

      const optionsHash = JSON.stringify({
        parts: snapshot.parts,
        stock: snapshot.stock,
        kerf: snapshot.options.kerf,
        allowRotation: snapshot.options.allowRotation,
        singleSheetOnly: snapshot.options.singleSheetOnly,
      });

      const billingOverrides: SnapshotBilling | null = snapshot.billingOverrides
        ? {
            globalFullBoard: snapshot.billingOverrides.globalFullBoard,
            sheetOverrides: snapshot.billingOverrides.sheetOverrides,
          }
        : null;

      const res = await fetch(`/api/quote-items/${quoteItemId}/cutlist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout,
          optionsHash,
          billingOverrides,
        }),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `Failed to save cutlist (${res.status})`);
      }
    } catch (err) {
      if (logErrors) {
        console.warn(`[useQuoteCutlistAdapter] Failed to save cutlist for item "${quoteItemId}"`, err);
      }
      // Don't throw - save errors shouldn't break the UI
    }
  }, [quoteItemId, logErrors]);

  const adapter = useMemo(
    (): CutlistPersistenceAdapter => ({
      load,
      save,
    }),
    [load, save]
  );

  return adapter;
}

export default useQuoteCutlistAdapter;

'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { packPartsIntoSheets, type PartSpec, type StockSheetSpec, type LayoutResult } from './packing';
import { ChevronDown, Trash2 } from 'lucide-react';
import { SheetPreview } from './preview';
import { exportCutlistToQuote, type CutlistLineRefs, type CutlistLineInput } from '@/components/features/cutlist/export';
import ComponentSelectionDialog from '@/components/features/quotes/ComponentSelectionDialog';
import { cn } from '@/lib/utils';

export interface CutlistToolProps {
  onExport?: (result: LayoutResult) => void;
  onResultsChange?: (result: LayoutResult | null) => void;
  onSummaryChange?: (summary: CutlistSummary | null) => void;
  quoteItemId?: string | null;
  onExportSuccess?: () => void;
  showCostingTab?: boolean;
  persistCostingDefaultsKey?: string;
  enableMaterialPalette?: boolean;
}

export interface CutlistSummary {
  result: LayoutResult;
  backerResult: LayoutResult | null;
  primarySheetsUsed: number;
  primarySheetsBillable: number;
  backerSheetsUsed: number;
  backerSheetsBillable: number;
  edgebanding16mm: number;
  edgebanding32mm: number;
  edgebandingTotal: number;
  laminationOn: boolean;
  materials?: CutlistMaterialSummary[];
}

export interface CutlistMaterialSummary {
  materialId: string;
  materialName: string;
  sheetsUsed: number;
  sheetsBillable: number;
  edgebanding16mm: number;
  edgebanding32mm: number;
  totalBanding: number;
  sheetCost: number;
  band16Cost: number;
  band32Cost: number;
  backerSheets: number;
  backerCost: number;
  totalCost: number;
}

type MaterialDefinition = {
  id: string;
  name: string;
  sheetDescription: string;
  pricePerSheet: number | '';
  band16Description: string;
  band16Price: number | '';
  band32Description: string;
  band32Price: number | '';
  component_id?: number;
  supplier_component_id?: number;
  unit_cost?: number | null;
};

export default function CutlistTool({
  onExport,
  onResultsChange,
  onSummaryChange,
  quoteItemId,
  onExportSuccess,
  showCostingTab = true,
  persistCostingDefaultsKey,
  enableMaterialPalette = false,
}: CutlistToolProps) {
  const generateId = React.useCallback(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `mat-${Math.random().toString(36).slice(2, 10)}`;
  }, []);
  const NONE_MATERIAL_VALUE = 'none';

  const [materials, setMaterials] = React.useState<MaterialDefinition[]>([]);

  const firstMaterialId = materials[0]?.id ?? null;

  const [parts, setParts] = React.useState<Array<PartSpec & { label?: string }>>([
    { id: 'P1', length_mm: 500, width_mm: 300, qty: 2, grain: 'length', band_edges: { top: true, right: true, bottom: true, left: true }, material_id: firstMaterialId },
  ]);
  const [stock, setStock] = React.useState<StockSheetSpec[]>([
    { id: 'S1', length_mm: 2750, width_mm: 1830, qty: 10, kerf_mm: 3 },
  ]);
  const [allowRotation, setAllowRotation] = React.useState(true);
  const [singleSheetOnly, setSingleSheetOnly] = React.useState(false);
  const [kerf, setKerf] = React.useState(3);
  const [result, setResult] = React.useState<LayoutResult | null>(null);
  const [activeTab, setActiveTab] = React.useState<'inputs' | 'stock' | 'results'>('inputs');
  const [backerResult, setBackerResult] = React.useState<LayoutResult | null>(null);
  const [sheetOverrides, setSheetOverrides] = React.useState<Record<string, { mode: 'auto' | 'full' | 'manual'; manualPct: number }>>({});
  const [globalFullBoard, setGlobalFullBoard] = React.useState(false);
  const [zoomSheetId, setZoomSheetId] = React.useState<string | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = React.useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [snapshotError, setSnapshotError] = React.useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  const [lineRefs, setLineRefs] = React.useState<CutlistLineRefs>({});
  const restoringSnapshotRef = React.useRef(false);
  const autoSaveTimeoutRef = React.useRef<number | null>(null);

  type CostingSectionKey = 'backer' | 'primary' | 'palette' | 'edgebanding';
  const [costingSections, setCostingSections] = React.useState<Record<CostingSectionKey, boolean>>({
    backer: false,
    primary: false,
    palette: false,
    edgebanding: false,
  });
  const toggleCostingSection = React.useCallback((section: CostingSectionKey) => {
    setCostingSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Costing state
  const [primarySheetDescription, setPrimarySheetDescription] = React.useState<string>('MELAMINE SHEET');
  const [primaryPricePerSheet, setPrimaryPricePerSheet] = React.useState<number | ''>('');
  const [backerSheetDescription, setBackerSheetDescription] = React.useState<string>('BACKER BOARD');
  const [backerPricePerSheet, setBackerPricePerSheet] = React.useState<number | ''>('');
  const [bandingDesc16, setBandingDesc16] = React.useState<string>('EDGE BANDING 16mm (m)');
  const [bandingPrice16, setBandingPrice16] = React.useState<number | ''>('');
  const [bandingDesc32, setBandingDesc32] = React.useState<string>('EDGE BANDING 32mm (m)');
  const [bandingPrice32, setBandingPrice32] = React.useState<number | ''>('');

  // Selected components (optional)
  type SelectedComponent = { description: string; component_id?: number; supplier_component_id?: number; unit_cost?: number | null } | null;
  const [primaryComponent, setPrimaryComponent] = React.useState<SelectedComponent>(null);
  const [backerComponent, setBackerComponent] = React.useState<SelectedComponent>(null);
  const [band16Component, setBand16Component] = React.useState<SelectedComponent>(null);
  const [band32Component, setBand32Component] = React.useState<SelectedComponent>(null);
  const [pickerFor, setPickerFor] = React.useState<null | 'primary' | 'backer' | 'band16' | 'band32'>(null);
  type MaterialPickerState =
    | { mode: 'part'; partIndex: number }
    | { mode: 'material'; materialId: string }
    | { mode: 'new' };
  const [materialPicker, setMaterialPicker] = React.useState<MaterialPickerState | null>(null);

  const sheet = stock[0];
  const laminationOn = React.useMemo(() => parts.some((p) => p.laminate), [parts]);

  const normalizeNullableNumber = (value: number | '' | null | undefined) =>
    typeof value === 'number' && !Number.isNaN(value) ? value : null;

  const hydrateNumberInput = (value: number | null | undefined): number | '' =>
    value == null || Number.isNaN(value) ? '' : value;

  const MATERIALS_STORAGE_KEY = 'cutlist-materials';
  const BACKER_COMPONENT_STORAGE_KEY = 'cutlist-default-backer-component';
  const materialsLoadedRef = React.useRef(false);

  React.useEffect(() => {
    if (!enableMaterialPalette) {
      setMaterialPicker(null);
    }
  }, [enableMaterialPalette]);

  React.useEffect(() => {
    if (!persistCostingDefaultsKey) return;
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(persistCostingDefaultsKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        primarySheetDescription?: string;
        primaryPricePerSheet?: number | null;
        backerSheetDescription?: string;
        backerPricePerSheet?: number | null;
        bandingDesc16?: string;
        bandingPrice16?: number | null;
        bandingDesc32?: string;
        bandingPrice32?: number | null;
      } | null;
      if (!parsed) return;
      if (typeof parsed.primarySheetDescription === 'string') setPrimarySheetDescription(parsed.primarySheetDescription);
      if (typeof parsed.backerSheetDescription === 'string') setBackerSheetDescription(parsed.backerSheetDescription);
      if (typeof parsed.bandingDesc16 === 'string') setBandingDesc16(parsed.bandingDesc16);
      if (typeof parsed.bandingDesc32 === 'string') setBandingDesc32(parsed.bandingDesc32);
      if (parsed.primaryPricePerSheet !== undefined) setPrimaryPricePerSheet(hydrateNumberInput(parsed.primaryPricePerSheet));
      if (parsed.backerPricePerSheet !== undefined) setBackerPricePerSheet(hydrateNumberInput(parsed.backerPricePerSheet));
      if (parsed.bandingPrice16 !== undefined) setBandingPrice16(hydrateNumberInput(parsed.bandingPrice16));
      if (parsed.bandingPrice32 !== undefined) setBandingPrice32(hydrateNumberInput(parsed.bandingPrice32));
    } catch (err) {
      console.warn('Failed to load cutlist costing defaults', err);
    }
  }, [persistCostingDefaultsKey]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(BACKER_COMPONENT_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as SelectedComponent | null;
      if (parsed && typeof parsed === 'object') {
        setBackerComponent(parsed);
        if (parsed.unit_cost != null && backerPricePerSheet === '') {
          setBackerPricePerSheet(parsed.unit_cost);
        }
        if (parsed.description && backerSheetDescription === 'BACKER BOARD') {
          setBackerSheetDescription(parsed.description);
        }
      }
    } catch (err) {
      console.warn('Failed to load default backer component', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!enableMaterialPalette) {
      materialsLoadedRef.current = true;
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(MATERIALS_STORAGE_KEY);
      if (!stored) {
        materialsLoadedRef.current = true;
        return;
      }
      const parsed = JSON.parse(stored) as MaterialDefinition[] | null;
      if (parsed && Array.isArray(parsed) && parsed.length > 0) {
        setMaterials(parsed);
      }
    } catch (err) {
      console.warn('Failed to load cutlist materials', err);
    } finally {
      materialsLoadedRef.current = true;
    }
  }, [enableMaterialPalette]);

  React.useEffect(() => {
    if (!enableMaterialPalette) return;
    if (!materialsLoadedRef.current) return;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MATERIALS_STORAGE_KEY, JSON.stringify(materials));
    } catch (err) {
      console.warn('Failed to persist cutlist materials', err);
    }
  }, [enableMaterialPalette, materials]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (restoringSnapshotRef.current) return;
    try {
      if (backerComponent) {
        window.localStorage.setItem(BACKER_COMPONENT_STORAGE_KEY, JSON.stringify(backerComponent));
      } else {
        window.localStorage.removeItem(BACKER_COMPONENT_STORAGE_KEY);
      }
    } catch (err) {
      console.warn('Failed to persist default backer component', err);
    }
  }, [backerComponent]);

  React.useEffect(() => {
    const defaultId = materials[0]?.id ?? null;
    setParts((prev) => {
      let changed = false;
      const next = prev.map((part) => {
        const hasMaterial = part.material_id && materials.some((mat) => mat.id === part.material_id);
        if (hasMaterial) return part;
        changed = true;
        return { ...part, material_id: defaultId } as any;
      });
      return changed ? next : prev;
    });
  }, [materials]);

  React.useEffect(() => {
    const first = materials[0];
    if (!first) return;
    const derivedPrice = typeof first.pricePerSheet === 'number'
      ? first.pricePerSheet
      : typeof first.unit_cost === 'number'
        ? first.unit_cost
        : '';
    setPrimarySheetDescription((prev) => (prev === first.sheetDescription ? prev : first.sheetDescription));
    setPrimaryPricePerSheet((prev) => (prev === derivedPrice ? prev : derivedPrice));
    setBandingDesc16((prev) => (prev === first.band16Description ? prev : first.band16Description));
    setBandingPrice16((prev) => (prev === first.band16Price ? prev : first.band16Price));
    setBandingDesc32((prev) => (prev === first.band32Description ? prev : first.band32Description));
    setBandingPrice32((prev) => (prev === first.band32Price ? prev : first.band32Price));
  }, [materials]);

  type SnapshotLayout = {
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
      primaryComponent: SelectedComponent;
      backerComponent: SelectedComponent;
      band16Component: SelectedComponent;
      band32Component: SelectedComponent;
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
  };

  type SnapshotBilling = {
    globalFullBoard: boolean;
    sheetOverrides: Record<string, { mode: 'auto' | 'full' | 'manual'; manualPct: number }>;
    lineRefs?: CutlistLineRefs; // legacy; preserved for backwards compatibility
  };

  const buildSnapshotPayload = React.useCallback(
    (overrides?: {
      result?: LayoutResult | null;
      backerResult?: LayoutResult | null;
      sheetOverrides?: Record<string, { mode: 'auto' | 'full' | 'manual'; manualPct: number }>;
      globalFullBoard?: boolean;
      parts?: Array<PartSpec & { label?: string }>;
      stock?: StockSheetSpec[];
      lineRefs?: CutlistLineRefs;
    }) => {
      const snapshotResult = overrides?.result ?? result;
      if (!quoteItemId || !snapshotResult) return null;
      const snapshotBacker = overrides?.backerResult ?? backerResult ?? null;
      const snapshotParts = overrides?.parts ?? parts;
      const snapshotStock = overrides?.stock ?? stock;
      const snapshotSheetOverrides = overrides?.sheetOverrides ?? sheetOverrides;
      const snapshotGlobalFullBoard = overrides?.globalFullBoard ?? globalFullBoard;
      const snapshotLineRefs = overrides?.lineRefs ?? lineRefs;

      const layout: SnapshotLayout = {
        result: snapshotResult,
        backerResult: snapshotBacker,
        parts: snapshotParts,
        stock: snapshotStock,
        kerf,
        allowRotation,
        singleSheetOnly,
        costing: {
          primarySheetDescription,
          primaryPricePerSheet: normalizeNullableNumber(primaryPricePerSheet),
          backerSheetDescription,
          backerPricePerSheet: normalizeNullableNumber(backerPricePerSheet),
          bandingDesc16,
          bandingPrice16: normalizeNullableNumber(bandingPrice16),
          bandingDesc32,
          bandingPrice32: normalizeNullableNumber(bandingPrice32),
          primaryComponent,
          backerComponent,
          band16Component,
          band32Component,
          materials: materials.map((mat) => ({
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
            unit_cost: typeof mat.unit_cost === 'number' ? mat.unit_cost : normalizeNullableNumber(mat.pricePerSheet),
          })),
        },
      };

      const billing: SnapshotBilling = {
        globalFullBoard: snapshotGlobalFullBoard,
        sheetOverrides: snapshotSheetOverrides,
      };

      const optionsHash = JSON.stringify({
        parts: snapshotParts,
        stock: snapshotStock,
        kerf,
        allowRotation,
        singleSheetOnly,
      });

      return { layout, billing, optionsHash, lineRefs: snapshotLineRefs } as const;
    },
    [
      allowRotation,
      backerResult,
      band16Component,
      band32Component,
      bandingDesc16,
      bandingDesc32,
      bandingPrice16,
      bandingPrice32,
      globalFullBoard,
      kerf,
      lineRefs,
      materials,
      parts,
      primaryComponent,
      primaryPricePerSheet,
      primarySheetDescription,
      quoteItemId,
      result,
      sheetOverrides,
      singleSheetOnly,
      stock,
      backerComponent,
      backerPricePerSheet,
      backerSheetDescription,
    ]
  );

  const persistSnapshot = React.useCallback(
    async (
      payload: ReturnType<typeof buildSnapshotPayload>,
      _reason: 'manual' | 'auto' | 'export' = 'manual'
    ) => {
      if (!quoteItemId || !payload) return;
      setIsSavingSnapshot(true);
      setSnapshotError(null);
      try {
        const res = await fetch(`/api/quote-items/${quoteItemId}/cutlist`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            layout: payload.layout,
            billingOverrides: payload.billing,
            optionsHash: payload.optionsHash,
            lineRefs: payload.lineRefs ?? null,
          }),
        });
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || `Failed to save snapshot (${res.status})`);
        }
        const json = await res.json();
        const updatedAt: string | undefined = json?.cutlist?.updated_at;
        if (updatedAt) {
          setLastSavedAt(updatedAt);
        } else {
          setLastSavedAt(new Date().toISOString());
        }
      } catch (err) {
        console.error('persistSnapshot error', err);
        setSnapshotError(err instanceof Error ? err.message : 'Unknown error saving snapshot');
      } finally {
        setIsSavingSnapshot(false);
      }
  },
    [buildSnapshotPayload, quoteItemId]
  );

  React.useEffect(() => {
    if (!quoteItemId) {
      setLastSavedAt(null);
      setSnapshotError(null);
      return;
    }

    let cancelled = false;
    async function loadSnapshot() {
      setIsLoadingSnapshot(true);
      setSnapshotError(null);
      restoringSnapshotRef.current = true;
      try {
        const res = await fetch(`/api/quote-items/${quoteItemId}/cutlist`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 204) {
          setLastSavedAt(null);
          return;
        }
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || `Failed to load snapshot (${res.status})`);
        }
        const json = await res.json();
        const cutlist = json?.cutlist;
        if (!cutlist) return;

        const layout = cutlist.layout_json as SnapshotLayout | undefined;
        const billing = (cutlist.billing_overrides as SnapshotBilling | undefined) ?? null;

        if (layout?.parts?.length) {
          setParts(layout.parts as any);
        }
        if (layout?.stock?.length) {
          setStock(layout.stock as any);
        }
        if (typeof layout?.kerf === 'number') {
          setKerf(layout.kerf);
        }
        if (typeof layout?.allowRotation === 'boolean') {
          setAllowRotation(layout.allowRotation);
        }
        if (typeof layout?.singleSheetOnly === 'boolean') {
          setSingleSheetOnly(layout.singleSheetOnly);
        }
        if (layout?.costing) {
          setPrimarySheetDescription(layout.costing.primarySheetDescription ?? 'MELAMINE SHEET');
          setPrimaryPricePerSheet(hydrateNumberInput(layout.costing.primaryPricePerSheet));
          setBackerSheetDescription(layout.costing.backerSheetDescription ?? 'BACKER BOARD');
          setBackerPricePerSheet(hydrateNumberInput(layout.costing.backerPricePerSheet));
          setBandingDesc16(layout.costing.bandingDesc16 ?? 'EDGE BANDING 16mm (m)');
          setBandingPrice16(hydrateNumberInput(layout.costing.bandingPrice16));
          setBandingDesc32(layout.costing.bandingDesc32 ?? 'EDGE BANDING 32mm (m)');
          setBandingPrice32(hydrateNumberInput(layout.costing.bandingPrice32));
          setPrimaryComponent(layout.costing.primaryComponent ?? null);
          setBackerComponent(layout.costing.backerComponent ?? null);
          setBand16Component(layout.costing.band16Component ?? null);
          setBand32Component(layout.costing.band32Component ?? null);
          if (Array.isArray(layout.costing.materials) && layout.costing.materials.length > 0) {
            setMaterials(layout.costing.materials.map((mat, idx) => ({
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
              unit_cost: typeof mat.unit_cost === 'number' ? mat.unit_cost : (typeof mat.pricePerSheet === 'number' ? mat.pricePerSheet : null),
            })));
          }
        }
        if (layout?.result) {
          setResult(layout.result);
          onResultsChange?.(layout.result);
        }
        if (layout?.backerResult) {
          setBackerResult(layout.backerResult);
        } else {
          setBackerResult(null);
        }

        if (billing) {
          setGlobalFullBoard(Boolean(billing.globalFullBoard));
          setSheetOverrides(billing.sheetOverrides ?? {});
          setLineRefs(billing.lineRefs ?? {});
        } else {
          setGlobalFullBoard(false);
          setSheetOverrides({});
          setLineRefs({});
        }

        if (cutlist.updated_at) {
          setLastSavedAt(cutlist.updated_at as string);
        }
      } catch (err) {
        console.error('loadSnapshot error', err);
        if (!cancelled) {
          setSnapshotError(err instanceof Error ? err.message : 'Failed to load cutlist snapshot');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSnapshot(false);
          window.setTimeout(() => {
            restoringSnapshotRef.current = false;
          }, 0);
        }
      }
    }

    loadSnapshot();

    return () => {
      cancelled = true;
      if (autoSaveTimeoutRef.current) {
        window.clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [onResultsChange, quoteItemId]);

  React.useEffect(() => {
    if (!quoteItemId || !result) return;
    if (restoringSnapshotRef.current) return;
    if (autoSaveTimeoutRef.current) {
      window.clearTimeout(autoSaveTimeoutRef.current);
    }
    const payload = buildSnapshotPayload();
    if (!payload) return;
    autoSaveTimeoutRef.current = window.setTimeout(() => {
      persistSnapshot(payload, 'auto');
      autoSaveTimeoutRef.current = null;
    }, 800);

    return () => {
      if (autoSaveTimeoutRef.current) {
        window.clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [buildSnapshotPayload, persistSnapshot, quoteItemId, result, sheetOverrides, globalFullBoard, lineRefs]);

  const addPartRow = () => {
    const nextIndex = parts.length + 1;
    const defaultMaterialId = materials[0]?.id ?? null;
    setParts([
      ...parts,
      {
        id: `P${nextIndex}`,
        length_mm: 400,
        width_mm: 300,
        qty: 1,
        grain: 'length',
        band_edges: { top: true, right: true, bottom: true, left: true },
        material_id: defaultMaterialId,
      },
    ]);
  };

  const removePartRow = (idx: number) => {
    setParts(parts.filter((_, i) => i !== idx));
  };

  const updatePart = (idx: number, updates: Partial<PartSpec & { label?: string }>) => {
    const next = [...parts];
    next[idx] = { ...next[idx], ...updates } as any;
    setParts(next);
  };

  const addMaterial = () => {
    if (!enableMaterialPalette) return;
    setMaterialPicker({ mode: 'new' });
  };

  const updateMaterial = (id: string, updates: Partial<MaterialDefinition>) => {
    setMaterials((prev) => prev.map((mat) => {
      if (mat.id !== id) return mat;
      const next: MaterialDefinition = { ...mat, ...updates };
      if (updates.pricePerSheet !== undefined) {
        if (typeof updates.pricePerSheet === 'number') {
          next.unit_cost = updates.pricePerSheet;
        } else if (updates.pricePerSheet === '') {
          next.unit_cost = null;
        }
      }
      return next;
    }));
  };

  const removeMaterial = (id: string) => {
    setMaterials((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((mat) => mat.id !== id);
      const fallbackId = next[0]?.id ?? null;
      setParts((prevParts) =>
        prevParts.map((part) =>
          part.material_id === id ? ({ ...part, material_id: fallbackId } as any) : part
        )
      );
      return next;
    });
  };

  const updateStock = (updates: Partial<StockSheetSpec>) => {
    const next = [{ ...stock[0], ...updates } as StockSheetSpec];
    setStock(next);
  };

  const applyMaterialSelection = React.useCallback((picker: MaterialPickerState, selection: {
    description: string;
    unit_cost: number;
    component_id?: number;
    supplier_component_id?: number;
  }) => {
    if (!enableMaterialPalette) return;
    const description = selection.description?.trim() || 'Material';
    const price = Number.isFinite(selection.unit_cost) ? Number(selection.unit_cost) : null;

    const findByComponent = selection.component_id
      ? materials.find(
          (mat) =>
            mat.component_id === selection.component_id &&
            mat.supplier_component_id === selection.supplier_component_id
        )
      : undefined;

    let targetId: string;
    if (picker.mode === 'material') {
      targetId = picker.materialId;
    } else if (findByComponent) {
      targetId = findByComponent.id;
    } else {
      targetId = generateId();
    }

    const existing = picker.mode === 'material'
      ? materials.find((mat) => mat.id === picker.materialId)
      : findByComponent;

    const nextDefinition: MaterialDefinition = {
      id: targetId,
      name: existing?.name || description,
      sheetDescription: description,
      pricePerSheet: price ?? existing?.pricePerSheet ?? '',
      band16Description: existing?.band16Description || bandingDesc16 || 'EDGE BANDING 16mm (m)',
      band16Price: existing?.band16Price ?? bandingPrice16,
      band32Description: existing?.band32Description || bandingDesc32 || 'EDGE BANDING 32mm (m)',
      band32Price: existing?.band32Price ?? bandingPrice32,
      component_id: selection.component_id ?? existing?.component_id,
      supplier_component_id: selection.supplier_component_id ?? existing?.supplier_component_id,
      unit_cost: price ?? existing?.unit_cost ?? null,
    };

    setMaterials((prev) => {
      const has = prev.some((mat) => mat.id === targetId);
      if (has) {
        return prev.map((mat) => (mat.id === targetId ? { ...mat, ...nextDefinition } : mat));
      }
      return [...prev, nextDefinition];
    });

    if (picker.mode === 'part') {
      const partIndex = picker.partIndex;
      setParts((prev) => prev.map((part, idx) => (idx === partIndex ? { ...part, material_id: targetId } : part)));
    }

    const willBePrimary = materials.length === 0 || materials[0]?.id === targetId;
    if (willBePrimary) {
      const primarySel: SelectedComponent = {
        description,
        component_id: selection.component_id,
        supplier_component_id: selection.supplier_component_id,
        unit_cost: price,
      } as SelectedComponent;
      setPrimaryComponent(primarySel);
      setPrimarySheetDescription(description);
      if (price != null) {
        setPrimaryPricePerSheet(price);
      }
    }
  }, [bandingDesc16, bandingPrice16, bandingDesc32, bandingPrice32, enableMaterialPalette, generateId, materials]);

  const CostingSectionCard = ({
    section,
    title,
    description,
    accent,
    children,
  }: {
    section: CostingSectionKey;
    title: string;
    description?: string;
    accent?: string;
    children: React.ReactNode;
  }) => {
    const isOpen = costingSections[section];
    return (
      <section className={cn('rounded-xl border shadow-sm backdrop-blur-sm transition-colors', accent)}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => toggleCostingSection(section)}
        >
          <div>
            <div className="font-semibold text-foreground">{title}</div>
            {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', isOpen ? 'rotate-180' : 'rotate-0')} />
        </button>
        <Separator />
        <div className={cn('px-4 py-4 space-y-4', !isOpen && 'hidden')}>
          {children}
        </div>
      </section>
    );
  };

  type CurrencyInputProps = React.ComponentProps<typeof Input>;
  const CurrencyInput = ({ className, onFocus, ...rest }: CurrencyInputProps) => (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R</span>
      <Input
        {...rest}
        className={cn('w-full pl-7', className)}
        onFocus={(event) => {
          onFocus?.(event);
          event.currentTarget.select();
        }}
      />
    </div>
  );

  const handleCalculate = () => {
    // Ensure kerf from options applied to stock sheet
    const normalized: StockSheetSpec[] = [{ ...stock[0], kerf_mm: Math.max(0, kerf) }];
    const res = packPartsIntoSheets(parts, normalized, { allowRotation, singleSheetOnly });
    setResult(res);
    setSheetOverrides({});
    setGlobalFullBoard(false);
    // Optional backer calculation (laminate=true parts, grain-any)
    if (parts.some(p => p.laminate)) {
      const backerParts: PartSpec[] = parts
        .filter(p => p.laminate)
        .map(p => ({ ...p, grain: 'any', require_grain: undefined, band_edges: undefined } as PartSpec));
      const resBacker = packPartsIntoSheets(backerParts, normalized, { allowRotation: true, singleSheetOnly });
      setBackerResult(resBacker);
      const payload = buildSnapshotPayload({
        result: res,
        backerResult: resBacker,
        sheetOverrides: {},
        globalFullBoard: false,
      });
      if (payload) persistSnapshot(payload, 'manual');
    } else {
      setBackerResult(null);
      const payload = buildSnapshotPayload({ result: res, sheetOverrides: {}, globalFullBoard: false });
      if (payload) persistSnapshot(payload, 'manual');
    }
    setActiveTab('results');
    onResultsChange?.(res);
  };

  const handleExport = async () => {
    if (!result) return;
    // If a quote item id is provided, export directly with costing
    if (quoteItemId) {
      setIsExporting(true);
      const pricePerSheetVal = primaryPricePerSheet === '' ? (primaryComponent?.unit_cost ?? null) : Number(primaryPricePerSheet);
      const backerPriceVal = backerPricePerSheet === '' ? (backerComponent?.unit_cost ?? null) : Number(backerPricePerSheet);
      const chargePrimarySheets = primaryChargeSheets;
      const chargeBackerSheets = backerChargeSheets;

      const primaryLine: CutlistLineInput | null = chargePrimarySheets > 0.0001
        ? {
            description: primaryComponent?.description || primarySheetDescription,
            qty: chargePrimarySheets,
            unit_cost: pricePerSheetVal ?? undefined,
            component_id: primaryComponent?.component_id,
          }
        : null;

      const backerLine: CutlistLineInput | null = backerResult && chargeBackerSheets > 0.0001 && laminationOn
        ? {
            description: backerComponent?.description || backerSheetDescription,
            qty: chargeBackerSheets,
            unit_cost: backerPriceVal ?? undefined,
            component_id: backerComponent?.component_id,
          }
        : null;

      const band16Line: CutlistLineInput | null = bandLen16 > 0.0001
        ? {
            description: band16Component?.description || bandingDesc16,
            qty: bandLen16 / 1000,
            unit_cost: band16Component?.unit_cost ?? (bandingPrice16 === '' ? null : Number(bandingPrice16)) ?? undefined,
            component_id: band16Component?.component_id,
          }
        : null;

      const band32Line: CutlistLineInput | null = bandLen32 > 0.0001
        ? {
            description: band32Component?.description || bandingDesc32,
            qty: bandLen32 / 1000,
            unit_cost: band32Component?.unit_cost ?? (bandingPrice32 === '' ? null : Number(bandingPrice32)) ?? undefined,
            component_id: band32Component?.component_id,
          }
        : null;

      try {
        const updatedRefs = await exportCutlistToQuote({
          quoteItemId,
          existingLineRefs: lineRefs,
          primaryLine,
          backerLine,
          band16Line,
          band32Line,
        });
        setLineRefs(updatedRefs);
        const payload = buildSnapshotPayload({ lineRefs: updatedRefs });
        if (payload) {
          persistSnapshot(payload, 'export');
        }
        onExportSuccess?.();
      } catch (e) {
        console.error('Cutlist export failed:', e);
      } finally {
        setIsExporting(false);
      }
    } else {
      onExport?.(result);
    }
  };

  const usedSheets = result?.sheets.length || 0;
  const usedArea = result?.stats.used_area_mm2 || 0;
  const wasteArea = result?.stats.waste_area_mm2 || 0;
  const totalArea = usedArea + wasteArea;
  const usedPct = totalArea > 0 ? (usedArea / totalArea) * 100 : 0;
  const bandLen = result?.stats.edgebanding_length_mm || 0;
  const bandLen16 = result?.stats.edgebanding_16mm_mm || 0;
  const bandLen32 = result?.stats.edgebanding_32mm_mm || 0;
  const sheetArea = sheet.length_mm * sheet.width_mm;
  const primarySheetsFractional = sheetArea > 0 ? usedArea / sheetArea : 0;
  const backerUsedArea = backerResult?.stats.used_area_mm2 || 0;
  const backerSheetsFractional = sheetArea > 0 ? backerUsedArea / sheetArea : 0;
  const computeSheetCharge = React.useCallback((layout: LayoutResult | null): number => {
    if (!layout) return 0;
    const area = sheetArea > 0 ? sheetArea : 0;
    if (area <= 0) return 0;
    return layout.sheets.reduce((sum, s) => {
      const used = s.used_area_mm2 ?? 0;
      const autoPct = Math.min(100, Math.max(0, (used / area) * 100));
      const override = sheetOverrides[s.sheet_id];
      let pct = autoPct;
      if (globalFullBoard) {
        pct = 100;
      } else if (override) {
        if (override.mode === 'full') pct = 100;
        if (override.mode === 'manual') pct = Math.min(100, Math.max(0, override.manualPct));
      }
      return sum + pct / 100;
    }, 0);
  }, [globalFullBoard, sheetArea, sheetOverrides]);

  const primaryChargeSheets = computeSheetCharge(result);
  const backerChargeSheets = computeSheetCharge(backerResult);

  const [activePage, setActivePage] = React.useState(0); // 0-based, 3 sheets per page
  React.useEffect(() => { setActivePage(0); }, [result?.sheets.length]);

  React.useEffect(() => {
    if (!onSummaryChange) return;
    if (!result) {
      onSummaryChange(null);
      return;
    }

    const sheetAreaSafe = sheetArea > 0 ? sheetArea : 1;
    const totalPartsArea = parts.reduce((sum, part) => {
      const qty = Math.max(0, Number(part.qty) || 0);
      return sum + (part.length_mm || 0) * (part.width_mm || 0) * qty;
    }, 0);

    const backerPriceNumeric = typeof backerPricePerSheet === 'number' ? backerPricePerSheet : 0;

    const materialStats = new Map<string, { name: string; area: number; band16: number; band32: number; laminateArea: number }>();

    const getMaterial = (id: string | null | undefined) => materials.find((m) => m.id === id) ?? materials[0];

    for (const part of parts) {
      const qty = Math.max(0, Number(part.qty) || 0);
      if (qty <= 0) continue;
      const area = (part.length_mm || 0) * (part.width_mm || 0) * qty;
      const band = part.band_edges || {};
      const perBandLen =
        ((band.top ? part.width_mm : 0) ?? 0) +
        ((band.bottom ? part.width_mm : 0) ?? 0) +
        ((band.left ? part.length_mm : 0) ?? 0) +
        ((band.right ? part.length_mm : 0) ?? 0);
      const totalBandLen = perBandLen * qty;
      const mat = getMaterial(part.material_id);
      const key = mat?.id || materials[0]?.id || 'default';
      if (!materialStats.has(key)) {
        materialStats.set(key, { name: mat?.name || 'Material', area: 0, band16: 0, band32: 0, laminateArea: 0 });
      }
      const bucket = materialStats.get(key)!;
      bucket.area += area;
      if (part.laminate) {
        bucket.band32 += totalBandLen;
        bucket.laminateArea += area;
      } else {
        bucket.band16 += totalBandLen;
      }
    }

    const materialSummaries: CutlistMaterialSummary[] = materials.map((mat) => {
      const stats = materialStats.get(mat.id) || { name: mat.name, area: 0, band16: 0, band32: 0, laminateArea: 0 };
      const sheetsUsed = stats.area / sheetAreaSafe;
      const usageRatio = totalPartsArea > 0 ? stats.area / totalPartsArea : 0;
      const sheetsBillable = primaryChargeSheets * usageRatio;
      const sheetPrice = typeof mat.pricePerSheet === 'number'
        ? mat.pricePerSheet
        : typeof mat.unit_cost === 'number'
          ? mat.unit_cost
          : 0;
      const band16Price = typeof mat.band16Price === 'number' ? mat.band16Price : 0;
      const band32Price = typeof mat.band32Price === 'number' ? mat.band32Price : 0;
      const sheetCost = sheetsBillable * sheetPrice;
      const band16Cost = (stats.band16 / 1000) * band16Price;
      const band32Cost = (stats.band32 / 1000) * band32Price;
      const backerSheets = stats.laminateArea / sheetAreaSafe;
      const backerCost = backerSheets * backerPriceNumeric;
      const totalCost = sheetCost + band16Cost + band32Cost + backerCost;
      return {
        materialId: mat.id,
        materialName: mat.name,
        sheetsUsed,
        sheetsBillable,
        edgebanding16mm: stats.band16,
        edgebanding32mm: stats.band32,
        totalBanding: stats.band16 + stats.band32,
        sheetCost,
        band16Cost,
        band32Cost,
        backerSheets,
        backerCost,
        totalCost,
      };
    });

    onSummaryChange({
      result,
      backerResult: backerResult ?? null,
      primarySheetsUsed: primarySheetsFractional,
      primarySheetsBillable: primaryChargeSheets,
      backerSheetsUsed: backerSheetsFractional,
      backerSheetsBillable: backerChargeSheets,
      edgebanding16mm: bandLen16,
      edgebanding32mm: bandLen32,
      edgebandingTotal: bandLen,
      laminationOn,
      materials: materialSummaries,
    });
  }, [
    onSummaryChange,
    result,
    backerResult,
    primarySheetsFractional,
    primaryChargeSheets,
    backerSheetsFractional,
    backerChargeSheets,
    bandLen16,
    bandLen32,
    bandLen,
    laminationOn,
    materials,
    parts,
    sheetArea,
    backerPricePerSheet,
  ]);

  React.useEffect(() => {
    if (!persistCostingDefaultsKey) return;
    if (typeof window === 'undefined') return;
    if (restoringSnapshotRef.current) return;
    try {
      const toNullable = (value: number | '' | null | undefined) =>
        typeof value === 'number' && !Number.isNaN(value) ? value : null;
      const payload = {
        primarySheetDescription,
        primaryPricePerSheet: toNullable(primaryPricePerSheet),
        backerSheetDescription,
        backerPricePerSheet: toNullable(backerPricePerSheet),
        bandingDesc16,
        bandingPrice16: toNullable(bandingPrice16),
        bandingDesc32,
        bandingPrice32: toNullable(bandingPrice32),
      } as const;
      window.localStorage.setItem(persistCostingDefaultsKey, JSON.stringify(payload));
    } catch (err) {
      console.warn('Failed to persist cutlist costing defaults', err);
    }
  }, [
    persistCostingDefaultsKey,
    primarySheetDescription,
    primaryPricePerSheet,
    backerSheetDescription,
    backerPricePerSheet,
    bandingDesc16,
    bandingPrice16,
    bandingDesc32,
    bandingPrice32,
  ]);

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className={`grid ${showCostingTab ? 'grid-cols-4' : 'grid-cols-3'} w-full`}>
          <TabsTrigger value="inputs">Inputs</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          {showCostingTab && <TabsTrigger value="costing">Costing</TabsTrigger>}
        </TabsList>
        <TabsContent value="inputs" className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-3">
              <div className="font-medium">Parts</div>
              <div className="space-y-2">
                <div className="space-y-4">
                  {parts.map((p, idx) => {
                    const material = p.material_id ? materials.find((m) => m.id === p.material_id) : null;
                    return (
                      <div key={idx} className="rounded-xl border bg-card/40 shadow-sm">
                        <div className="flex flex-col gap-4 border-b px-4 py-4 md:flex-row md:items-start md:justify-between">
                          <div
                            className={`grid w-full gap-4 md:w-auto ${
                              enableMaterialPalette ? 'md:grid-cols-[96px minmax(0,1fr)] md:items-start' : 'md:grid-cols-[96px]'
                            }`}
                          >
                            <div className="space-y-1">
                              <Label htmlFor={`pid-${idx}`} className="text-xs font-medium uppercase text-muted-foreground">ID</Label>
                              <Input id={`pid-${idx}`} className="w-full md:w-[96px]" value={p.id} onChange={(e) => updatePart(idx, { id: e.target.value })} />
                            </div>
                            {enableMaterialPalette && (
                              <div className="space-y-1">
                                <Label htmlFor={`mat-${idx}`} className="text-xs font-medium uppercase text-muted-foreground">Material</Label>
                                <div className="flex flex-wrap items-start gap-2">
                                  <Select
                                    value={p.material_id ?? NONE_MATERIAL_VALUE}
                                    onValueChange={(v) => updatePart(idx, { material_id: v === NONE_MATERIAL_VALUE ? null : v })}
                                  >
                                    <SelectTrigger id={`mat-${idx}`} className="w-full md:w-[220px]">
                                      <SelectValue placeholder="Select material" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={NONE_MATERIAL_VALUE}>No material</SelectItem>
                                      {materials.map((mat) => (
                                        <SelectItem key={mat.id} value={mat.id}>
                                          {mat.name || mat.sheetDescription}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="shrink-0"
                                    onClick={() => setMaterialPicker({ mode: 'part', partIndex: idx })}
                                  >
                                    Choose…
                                  </Button>
                                </div>
                                {material && (
                                  <div className="text-[11px] text-muted-foreground">
                                    {material.sheetDescription}
                                    {material.unit_cost != null ? ` • ${material.unit_cost.toFixed(2)}` : ''}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <Button variant="destructiveSoft" size="icon" className="h-8 w-8 self-start" type="button" onClick={() => removePartRow(idx)} aria-label="Delete row">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
                          <div className="space-y-2">
                            <Label htmlFor={`len-${idx}`}>Length (mm)</Label>
                            <Input id={`len-${idx}`} type="number" value={p.length_mm} onChange={(e) => updatePart(idx, { length_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`wid-${idx}`}>Width (mm)</Label>
                            <Input id={`wid-${idx}`} type="number" value={p.width_mm} onChange={(e) => updatePart(idx, { width_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`qty-${idx}`}>Quantity</Label>
                            <Input id={`qty-${idx}`} type="number" value={p.qty} onChange={(e) => updatePart(idx, { qty: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`grain-${idx}`}>Grain</Label>
                            <Select value={p.grain ?? (p.require_grain ? 'length' : 'any')} onValueChange={(v) => updatePart(idx, { grain: v as any, require_grain: undefined })}>
                              <SelectTrigger id={`grain-${idx}`}>
                                <SelectValue placeholder="Grain" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="any">Any</SelectItem>
                                <SelectItem value="length">Length</SelectItem>
                                <SelectItem value="width">Width</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Edge length</Label>
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <div className="flex items-center gap-1">
                                <Checkbox id={`len-left-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.left)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, left: Boolean(v) } })} />
                                <Label htmlFor={`len-left-${idx}`} className="leading-none">Left ({p.length_mm})</Label>
                              </div>
                              <div className="flex items-center gap-1">
                                <Checkbox id={`len-right-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.right)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, right: Boolean(v) } })} />
                                <Label htmlFor={`len-right-${idx}`} className="leading-none">Right ({p.length_mm})</Label>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Edge width</Label>
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <div className="flex items-center gap-1">
                                <Checkbox id={`wid-top-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.top)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, top: Boolean(v) } })} />
                                <Label htmlFor={`wid-top-${idx}`} className="leading-none">Top ({p.width_mm})</Label>
                              </div>
                              <div className="flex items-center gap-1">
                                <Checkbox id={`wid-bot-${idx}`} className="h-4 w-4" checked={Boolean(p.band_edges?.bottom)} onCheckedChange={(v) => updatePart(idx, { band_edges: { ...p.band_edges, bottom: Boolean(v) } })} />
                                <Label htmlFor={`wid-bot-${idx}`} className="leading-none">Bottom ({p.width_mm})</Label>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`lam-${idx}`}>Lamination</Label>
                            <div className="flex items-center gap-2">
                              <Checkbox id={`lam-${idx}`} checked={Boolean(p.laminate)} onCheckedChange={(v) => updatePart(idx, { laminate: Boolean(v) })} />
                              <Label htmlFor={`lam-${idx}`} className="text-sm text-muted-foreground">Apply backer</Label>
                            </div>
                          </div>
                          {enableMaterialPalette && material && (
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <div className="font-medium text-foreground">{material.sheetDescription}</div>
                              {material.unit_cost != null && (
                                <div>Unit price: {material.unit_cost.toFixed(2)}</div>
                              )}
                              {material.component_id && (
                                <div>Component #{material.component_id}</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="secondary" onClick={addPartRow}>+ Add Part</Button>
                  <Button onClick={handleCalculate}>Calculate</Button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {showCostingTab && (
        <TabsContent value="costing" className="space-y-4">
          <CostingSectionCard
            section="backer"
            title="Backer defaults"
            description="Set the laminate backer and rate that applies whenever lamination is on."
            accent="bg-muted/15"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Backer description</Label>
                <Input value={backerSheetDescription} onChange={(e) => setBackerSheetDescription(e.target.value)} className="w-full" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cost-backer-price">Price per sheet</Label>
                <CurrencyInput
                  id="cost-backer-price"
                  type="number"
                  value={backerPricePerSheet}
                  onChange={(e) => setBackerPricePerSheet(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={backerComponent?.unit_cost != null ? String(backerComponent.unit_cost) : undefined}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setPickerFor('backer')}>
                {backerComponent ? 'Change backer component' : 'Select backer component'}
              </Button>
              {backerComponent && <span className="text-sm text-muted-foreground">{backerComponent.description}</span>}
            </div>
            {backerComponent?.unit_cost != null && (
              <div className="text-xs text-muted-foreground">
                Current rate: <span className="font-medium text-foreground">{backerComponent.unit_cost.toFixed(2)}</span>
              </div>
            )}
          </CostingSectionCard>

          {enableMaterialPalette ? (
            <>
              <CostingSectionCard
                section="palette"
                title="Material palette"
                description="Define sheet and edging pricing for every finish. Assign materials in the Inputs tab; the first entry exports by default."
                accent="bg-card/50"
              >
                <div className="space-y-5">
                  {materials.map((mat, idx) => (
                    <div
                      key={mat.id}
                      className={cn(
                        'rounded-lg border p-5 space-y-5 transition-colors',
                        idx % 2 === 0 ? 'bg-white/60 dark:bg-muted/30' : 'bg-muted/25'
                      )}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="w-full lg:max-w-xs space-y-2">
                          <Label htmlFor={`material-name-${mat.id}`}>Material name</Label>
                          <Input
                            id={`material-name-${mat.id}`}
                            value={mat.name}
                            onChange={(e) => updateMaterial(mat.id, { name: e.target.value })}
                            placeholder={`Material ${idx + 1}`}
                            className="w-full"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{idx === 0 ? 'Primary / export default' : `Material ${idx + 1}`}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeMaterial(mat.id)}
                            disabled={materials.length <= 1}
                            aria-label="Remove material"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <div className="space-y-2">
                          <Label htmlFor={`material-sheet-${mat.id}`}>Sheet description</Label>
                          <Input
                            id={`material-sheet-${mat.id}`}
                            value={mat.sheetDescription}
                            onChange={(e) => updateMaterial(mat.id, { sheetDescription: e.target.value })}
                            placeholder="e.g. White Melamine"
                            className="w-full"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`material-price-${mat.id}`}>Price per sheet</Label>
                          <CurrencyInput
                            id={`material-price-${mat.id}`}
                            type="number"
                            value={mat.pricePerSheet}
                            onChange={(e) => updateMaterial(mat.id, { pricePerSheet: e.target.value === '' ? '' : Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`material-band16-desc-${mat.id}`}>Edgebanding 16mm description</Label>
                          <Input
                            id={`material-band16-desc-${mat.id}`}
                            value={mat.band16Description}
                            onChange={(e) => updateMaterial(mat.id, { band16Description: e.target.value })}
                            placeholder="e.g. White PVC 16mm"
                            className="w-full"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`material-band16-price-${mat.id}`}>Edgebanding 16mm price / meter</Label>
                          <CurrencyInput
                            id={`material-band16-price-${mat.id}`}
                            type="number"
                            value={mat.band16Price}
                            onChange={(e) => updateMaterial(mat.id, { band16Price: e.target.value === '' ? '' : Number(e.target.value) })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`material-band32-desc-${mat.id}`}>Edgebanding 32mm description</Label>
                          <Input
                            id={`material-band32-desc-${mat.id}`}
                            value={mat.band32Description}
                            onChange={(e) => updateMaterial(mat.id, { band32Description: e.target.value })}
                            placeholder="e.g. White PVC 32mm"
                            className="w-full"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`material-band32-price-${mat.id}`}>Edgebanding 32mm price / meter</Label>
                          <CurrencyInput
                            id={`material-band32-price-${mat.id}`}
                            type="number"
                            value={mat.band32Price}
                            onChange={(e) => updateMaterial(mat.id, { band32Price: e.target.value === '' ? '' : Number(e.target.value) })}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <Button type="button" variant="outline" size="sm" onClick={() => setMaterialPicker({ mode: 'material', materialId: mat.id })}>
                          Choose sheet…
                        </Button>
                        {mat.component_id && <span>Component #{mat.component_id}</span>}
                      </div>

                      {idx === 0 && (
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <span className="uppercase tracking-wide text-xs text-muted-foreground">Export components</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => setPickerFor('primary')}>
                            {primaryComponent ? 'Change sheet component' : 'Select sheet component'}
                          </Button>
                          {primaryComponent && <span>{primaryComponent.description}</span>}
                          <Button type="button" variant="outline" size="sm" onClick={() => setPickerFor('band16')}>
                            {band16Component ? 'Change 16mm component' : 'Select 16mm component'}
                          </Button>
                          {band16Component && <span>{band16Component.description}</span>}
                          <Button type="button" variant="outline" size="sm" onClick={() => setPickerFor('band32')}>
                            {band32Component ? 'Change 32mm component' : 'Select 32mm component'}
                          </Button>
                          {band32Component && <span>{band32Component.description}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Button type="button" variant="secondary" onClick={addMaterial}>
                  + Add material
                </Button>
              </CostingSectionCard>
            </>
          ) : (
            <>
              <CostingSectionCard
                section="primary"
                title="Primary material"
                description="Set the sheet that exports to the costing cluster by default."
                accent="bg-card/50"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="primary-sheet-desc">Sheet description</Label>
                    <Input
                      id="primary-sheet-desc"
                      value={primarySheetDescription}
                      onChange={(e) => setPrimarySheetDescription(e.target.value)}
                      placeholder="e.g. White Melamine"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="primary-sheet-price">Price per sheet</Label>
                    <CurrencyInput
                      id="primary-sheet-price"
                      type="number"
                      value={primaryPricePerSheet}
                      onChange={(e) => setPrimaryPricePerSheet(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder={primaryComponent?.unit_cost != null ? String(primaryComponent.unit_cost) : undefined}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => setPickerFor('primary')}>
                    {primaryComponent ? 'Change sheet component' : 'Select sheet component'}
                  </Button>
                  {primaryComponent && <span className="text-sm text-muted-foreground">{primaryComponent.description}</span>}
                </div>
              </CostingSectionCard>

              <CostingSectionCard
                section="edgebanding"
                title="Edgebanding"
                description="Configure the banding descriptions and supplier selections that export with the cutlist."
                accent="bg-muted/20"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="band16-desc">Edgebanding 16mm description</Label>
                      <Input
                        id="band16-desc"
                        value={bandingDesc16}
                        onChange={(e) => setBandingDesc16(e.target.value)}
                        placeholder="e.g. White PVC 16mm"
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="band16-price">Edgebanding 16mm price / meter</Label>
                      <CurrencyInput
                        id="band16-price"
                        type="number"
                        value={bandingPrice16}
                        onChange={(e) => setBandingPrice16(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder={band16Component?.unit_cost != null ? String(band16Component.unit_cost) : undefined}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" onClick={() => setPickerFor('band16')}>
                        {band16Component ? 'Change 16mm component' : 'Select 16mm component'}
                      </Button>
                      {band16Component && <span className="text-sm text-muted-foreground">{band16Component.description}</span>}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="band32-desc">Edgebanding 32mm description</Label>
                      <Input
                        id="band32-desc"
                        value={bandingDesc32}
                        onChange={(e) => setBandingDesc32(e.target.value)}
                        placeholder="e.g. White PVC 32mm"
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="band32-price">Edgebanding 32mm price / meter</Label>
                      <CurrencyInput
                        id="band32-price"
                        type="number"
                        value={bandingPrice32}
                        onChange={(e) => setBandingPrice32(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder={band32Component?.unit_cost != null ? String(band32Component.unit_cost) : undefined}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" onClick={() => setPickerFor('band32')}>
                        {band32Component ? 'Change 32mm component' : 'Select 32mm component'}
                      </Button>
                      {band32Component && <span className="text-sm text-muted-foreground">{band32Component.description}</span>}
                    </div>
                  </div>
                </div>
              </CostingSectionCard>
            </>
          )}

          {showCostingTab && (onExport || quoteItemId) && (
            <div className="flex flex-col items-end gap-2 pt-2">
              {!result && (
                <p className="text-sm text-muted-foreground">
                  Calculate the cutlist first (Inputs tab) before exporting
                </p>
              )}
              <Button onClick={handleExport} disabled={isExporting || !result}>
                {isExporting ? 'Exporting…' : 'Export to Quote'}
              </Button>
            </div>
          )}
        </TabsContent>
        )}
        <TabsContent value="stock" className="space-y-4">
          <div className="space-y-3">
            <div className="font-medium">Stock Sheet</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="s-l">Length (mm)</Label>
                <Input id="s-l" type="number" value={sheet.length_mm} onChange={(e) => updateStock({ length_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <Label htmlFor="s-w">Width (mm)</Label>
                <Input id="s-w" type="number" value={sheet.width_mm} onChange={(e) => updateStock({ width_mm: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <Label htmlFor="s-q">Qty Available</Label>
                <Input id="s-q" type="number" value={sheet.qty} onChange={(e) => updateStock({ qty: Number(e.target.value || 0) })} onFocus={(e) => e.target.select()} />
              </div>
              <div>
                <Label htmlFor="kerf">Kerf (mm)</Label>
                <Input id="kerf" type="number" value={kerf} onChange={(e) => setKerf(Number(e.target.value || 0))} onFocus={(e) => e.target.select()} />
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <Checkbox id="rot" checked={allowRotation} onCheckedChange={(v) => setAllowRotation(Boolean(v))} />
                <Label htmlFor="rot" className="text-sm text-muted-foreground">Allow 90° rotation</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="single" checked={singleSheetOnly} onCheckedChange={(v) => setSingleSheetOnly(Boolean(v))} />
                <Label htmlFor="single" className="text-sm text-muted-foreground">Single sheet only</Label>
              </div>
            </div>
            
          </div>
          <Separator />
          <section className="space-y-2">
            <header className="space-y-1">
              <div className="font-medium">Backer board</div>
              <p className="text-sm text-muted-foreground">Select the laminate backer used for most runs. This feeds the Costing tab automatically.</p>
            </header>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setPickerFor('backer')}>
                {backerComponent ? 'Change backer component' : 'Select backer component'}
              </Button>
              {backerComponent && <span className="text-sm text-muted-foreground">{backerComponent.description}</span>}
            </div>
            {backerComponent?.unit_cost != null && (
              <div className="text-xs text-muted-foreground">
                Price per sheet: <span className="text-foreground font-medium">{backerComponent.unit_cost.toFixed(2)}</span>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="results" className="space-y-4">
          {!result ? (
            <div className="text-muted-foreground">No results yet. Enter inputs and click Calculate.</div>
          ) : (
            <div className="space-y-4">
              <div className={`grid grid-cols-2 ${backerResult ? 'md:grid-cols-6' : 'md:grid-cols-5'} gap-3`}>
                <Stat label="Sheets used" value={`${primarySheetsFractional.toFixed(3)}`} />
                <Stat label="Billable sheets" value={`${primaryChargeSheets.toFixed(3)}`} />
                <Stat label="Board used %" value={`${usedPct.toFixed(1)}%`} />
                <Stat label="Edge 16mm" value={`${(bandLen16 / 1000).toFixed(2)}m`} />
                <Stat label="Edge 32mm" value={`${(bandLen32 / 1000).toFixed(2)}m`} />
                <Stat label="Lamination" value={laminationOn ? 'On' : 'Off'} />
                {backerResult && <Stat label="Backer sheets" value={`${backerSheetsFractional.toFixed(3)}`} />}
                {backerResult && <Stat label="Billable backer" value={`${backerChargeSheets.toFixed(3)}`} />}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div>
                  {isLoadingSnapshot ? 'Loading saved snapshot…' : lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : 'No saved snapshot yet'}
                  {snapshotError ? ` — Save issue: ${snapshotError}` : ''}
                </div>
                <div>{isSavingSnapshot ? 'Saving…' : null}</div>
              </div>
              <div className="flex items-center gap-3 bg-muted/40 border rounded px-3 py-2">
                <Switch id="full-board-switch" checked={globalFullBoard} onCheckedChange={(v) => setGlobalFullBoard(Boolean(v))} />
                <Label htmlFor="full-board-switch" className="text-sm">Charge full sheet for every used board</Label>
              </div>
              {result.unplaced && result.unplaced.length > 0 && (
                <Alert className="border-amber-400/70 bg-amber-50">
                  <AlertTitle>Unplaced parts</AlertTitle>
                  <AlertDescription>
                    <div className="text-sm leading-relaxed space-y-1">
                      {result.unplaced.map((item, idx) => (
                        <div key={idx}>
                          <span className="font-medium">{item.part.id}</span>
                          {` × ${item.count} — `}
                          {item.reason === 'too_large_for_sheet'
                            ? 'Part exceeds stock sheet dimensions (check grain/rotation and sizing).'
                            : 'No sheet capacity remaining. Increase available sheets or adjust layout.'}
                          {` (${item.part.length_mm} × ${item.part.width_mm} mm)`}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="text-sm text-muted-foreground mr-1">Pages:</div>
                  {Array.from({ length: Math.ceil(result.sheets.length / 3) }).map((_, idx) => (
                    <Button key={idx} size="sm" variant={idx === activePage ? 'default' : 'outline'} onClick={() => setActivePage(idx)}>
                      {idx + 1}
                    </Button>
                  ))}
                  <div className="ml-auto text-xs text-muted-foreground">
                    Showing {activePage * 3 + 1}-{Math.min((activePage + 1) * 3, result.sheets.length)} of {result.sheets.length}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {result.sheets.slice(activePage * 3, activePage * 3 + 3).map((sheetLayout, idx) => {
                    const autoPct = sheetArea > 0 ? (sheetLayout.used_area_mm2 || 0) / sheetArea * 100 : 0;
                    const override = sheetOverrides[sheetLayout.sheet_id];
                    const mode = globalFullBoard ? 'full' : override?.mode ?? 'auto';
                    const manualPct = override?.manualPct ?? autoPct;
                    const chargePct = mode === 'full' ? 100 : mode === 'manual' ? manualPct : autoPct;
                    return (
                      <div key={sheetLayout.sheet_id} className="border rounded p-2 space-y-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Sheet {activePage * 3 + idx + 1}</span>
                          <Button variant="link" size="sm" className="h-auto px-1" onClick={() => setZoomSheetId(sheetLayout.sheet_id)}>
                            Zoom
                          </Button>
                        </div>
                        <SheetPreview sheetWidth={sheet.width_mm} sheetLength={sheet.length_mm} layout={sheetLayout} maxWidth={260} maxHeight={200} />
                        <div className="text-xs text-muted-foreground">
                          Used {(autoPct).toFixed(1)}% ({((sheetLayout.used_area_mm2 || 0) / 1_000_000).toFixed(2)} m² of {(sheetArea / 1_000_000).toFixed(2)} m²)
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs">
                            <Switch
                              id={`full-${sheetLayout.sheet_id}`}
                              checked={mode === 'full'}
                              disabled={globalFullBoard}
                              onCheckedChange={(v) => {
                                setSheetOverrides(prev => {
                                  const next = { ...prev };
                                  const existing = next[sheetLayout.sheet_id];
                                  if (v) {
                                    next[sheetLayout.sheet_id] = { mode: 'full', manualPct: existing?.manualPct ?? manualPct };
                                  } else {
                                    if (existing?.mode === 'manual') {
                                      next[sheetLayout.sheet_id] = { mode: 'manual', manualPct: existing.manualPct };
                                    } else {
                                      delete next[sheetLayout.sheet_id];
                                    }
                                  }
                                  return next;
                                });
                              }}
                            />
                            <Label htmlFor={`full-${sheetLayout.sheet_id}`} className="text-xs">Charge full sheet</Label>
                          </div>
                          <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs">
                            <Label htmlFor={`manual-${sheetLayout.sheet_id}`}>Manual %</Label>
                            <Input
                              id={`manual-${sheetLayout.sheet_id}`}
                              type="number"
                              value={mode === 'manual' ? Number.isFinite(manualPct) ? manualPct : autoPct : Number(chargePct.toFixed(1))}
                              min={0}
                              max={100}
                              step={0.1}
                              disabled={globalFullBoard || mode === 'full'}
                              onChange={(e) => {
                                const next = Math.max(0, Math.min(100, Number(e.target.value || 0)));
                                setSheetOverrides(prev => ({
                                  ...prev,
                                  [sheetLayout.sheet_id]: { mode: 'manual', manualPct: next },
                                }));
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>Billing {chargePct.toFixed(1)}%</span>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              className="h-auto px-1"
                              onClick={() => {
                                setSheetOverrides(prev => {
                                  const next = { ...prev };
                                  delete next[sheetLayout.sheet_id];
                                  return next;
                                });
                              }}
                            >
                              Reset to auto
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {(onExport || quoteItemId) && (
                <div className="pt-2">
                  <Button onClick={handleExport} disabled={isExporting}>
                    {isExporting ? 'Exporting…' : 'Export to Quote'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
      {enableMaterialPalette && (
        <ComponentSelectionDialog
          open={materialPicker != null}
          onClose={() => setMaterialPicker(null)}
          defaultEntryType="database"
          onAddComponent={(comp) => {
            if (!materialPicker) return;
            if (comp.type !== 'manual' && comp.type !== 'database') {
              setMaterialPicker(null);
              return;
            }
            applyMaterialSelection(materialPicker, {
              description: comp.description,
              unit_cost: Number.isFinite(comp.unit_cost) ? Number(comp.unit_cost) : 0,
              component_id: comp.component_id,
              supplier_component_id: comp.supplier_component_id,
            });
            setMaterialPicker(null);
          }}
        />
      )}
      <ComponentSelectionDialog
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onAddComponent={(comp) => {
          const sel = {
            description: comp.description,
            component_id: comp.component_id,
            supplier_component_id: comp.supplier_component_id,
            unit_cost: comp.unit_cost,
          } as SelectedComponent;
          if (pickerFor === 'primary') { setPrimaryComponent(sel); if (primaryPricePerSheet === '') setPrimaryPricePerSheet(comp.unit_cost || ''); }
          if (pickerFor === 'backer') { setBackerComponent(sel); if (backerPricePerSheet === '') setBackerPricePerSheet(comp.unit_cost || ''); if (sel.description) setBackerSheetDescription((prev) => (prev === 'BACKER BOARD' ? sel.description : prev)); }
          if (pickerFor === 'band16') { setBand16Component(sel); if (bandingPrice16 === '') setBandingPrice16(comp.unit_cost || ''); }
          if (pickerFor === 'band32') { setBand32Component(sel); if (bandingPrice32 === '') setBandingPrice32(comp.unit_cost || ''); }
          setPickerFor(null);
        }}
      />
      <Dialog open={zoomSheetId != null} onOpenChange={(open) => { if (!open) setZoomSheetId(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sheet preview</DialogTitle>
          </DialogHeader>
          {zoomSheetId && result && result.sheets.find(s => s.sheet_id === zoomSheetId) && (
            <div className="flex justify-center">
              <SheetPreview
                sheetWidth={sheet.width_mm}
                sheetLength={sheet.length_mm}
                layout={result.sheets.find(s => s.sheet_id === zoomSheetId)!}
                maxWidth={800}
                maxHeight={600}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">
        {value} {unit ? <span className="font-normal text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}

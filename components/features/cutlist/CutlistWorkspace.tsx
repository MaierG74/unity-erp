'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Import primitives
import {
  PartsInputTable,
  CostingPanel,
  ResultsSummary,
  SheetLayoutGrid,
  CSVDropzone,
  GroupedPartsPanel,
  type PartWithLabel,
  type MaterialOption,
  type CostingPickerTarget,
  type GroupedPartsMaterialOption,
} from './primitives';

// Import types
import type {
  PartSpec,
  StockSheetSpec,
  LayoutResult,
  CutlistSummary,
  CutlistMaterialSummary,
  CutlistMaterialDefinition,
  SelectedComponent,
  SheetBillingOverride,
  CutlistPart,
  CutlistGroup,
  CutlistLineInput,
} from '@/lib/cutlist/types';

// Import board calculator for grouped mode
import { expandGroupsToPartSpecs } from '@/lib/cutlist/boardCalculator';

// Import packing
import { packPartsIntoSheets } from './packing';

// =============================================================================
// Types
// =============================================================================

/**
 * Mode configuration for the workspace input UI.
 * - 'manual': Direct part entry only
 * - 'grouped': Drag-and-drop grouping only
 * - 'hybrid': Toggle between manual and grouped
 */
export type CutlistWorkspaceMode = 'manual' | 'grouped' | 'hybrid';

/**
 * Snapshot of all cutlist state for persistence.
 */
export interface CutlistSnapshot {
  parts: PartWithLabel[];
  groups: CutlistGroup[];
  ungroupedParts: CutlistPart[];
  stock: StockSheetSpec[];
  materials: CutlistMaterialDefinition[];
  costing: {
    primarySheetDescription: string;
    primaryPricePerSheet: number | '';
    backerSheetDescription: string;
    backerPricePerSheet: number | '';
    bandingDesc16: string;
    bandingPrice16: number | '';
    bandingDesc32: string;
    bandingPrice32: number | '';
  };
  components: {
    primary: SelectedComponent | null;
    backer: SelectedComponent | null;
    band16: SelectedComponent | null;
    band32: SelectedComponent | null;
  };
  options: {
    kerf: number;
    allowRotation: boolean;
    singleSheetOnly: boolean;
  };
  inputMode: 'manual' | 'grouped';
}

/**
 * Persistence adapter interface for loading/saving cutlist state.
 */
export interface CutlistPersistenceAdapter {
  load: () => Promise<CutlistSnapshot | null>;
  save: (snapshot: CutlistSnapshot) => Promise<void>;
}

/**
 * Export adapter interface for sending cutlist results to quotes.
 */
export interface CutlistExportAdapter {
  exportToQuote: (lines: CutlistLineInput[]) => Promise<void>;
}

/**
 * Props for the CutlistWorkspace component.
 */
export interface CutlistWorkspaceProps {
  // Mode configuration
  mode?: CutlistWorkspaceMode;
  defaultInputMode?: 'manual' | 'grouped';

  // Feature toggles
  showCSVImport?: boolean;
  showCosting?: boolean;
  showResults?: boolean;
  showMaterialPalette?: boolean;
  showStockTab?: boolean;

  // Initial data (optional)
  initialParts?: PartSpec[];
  initialGroups?: CutlistGroup[];
  initialStock?: StockSheetSpec;

  // Callbacks
  onResultsChange?: (result: LayoutResult | null) => void;
  onSummaryChange?: (summary: CutlistSummary | null) => void;
  onPartsChange?: (parts: PartSpec[]) => void;
  onGroupsChange?: (groups: CutlistGroup[]) => void;

  // Adapters (optional)
  persistenceAdapter?: CutlistPersistenceAdapter;
  exportAdapter?: CutlistExportAdapter;

  // Component picker (provided by parent for integration)
  onOpenComponentPicker?: (target: CostingPickerTarget) => void;

  // External component selections (controlled by parent)
  primaryComponent?: SelectedComponent | null;
  backerComponent?: SelectedComponent | null;
  band16Component?: SelectedComponent | null;
  band32Component?: SelectedComponent | null;

  // Styling
  className?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mat-${Math.random().toString(36).slice(2, 10)}`;
};

// =============================================================================
// Main Component
// =============================================================================

/**
 * CutlistWorkspace - Composable wrapper for cutlist primitives.
 *
 * Manages all state and orchestration for the cutlist tool, including:
 * - Parts input (manual or grouped mode)
 * - Stock sheet configuration
 * - Packing algorithm execution
 * - Results display
 * - Costing configuration
 *
 * @example Standalone page usage:
 * ```tsx
 * <CutlistWorkspace
 *   mode="hybrid"
 *   showCSVImport
 *   showCosting
 *   showMaterialPalette
 *   persistenceAdapter={localStorageAdapter}
 * />
 * ```
 *
 * @example Quote modal usage:
 * ```tsx
 * <CutlistWorkspace
 *   mode="manual"
 *   showCosting={false}
 *   showMaterialPalette={false}
 *   initialParts={quoteLineParts}
 *   onResultsChange={handleResultsChange}
 *   onSummaryChange={handleSummaryChange}
 *   exportAdapter={quoteExportAdapter}
 * />
 * ```
 */
export function CutlistWorkspace({
  // Mode configuration
  mode = 'hybrid',
  defaultInputMode = 'manual',

  // Feature toggles
  showCSVImport = true,
  showCosting = true,
  showResults = true,
  showMaterialPalette = true,
  showStockTab = true,

  // Initial data
  initialParts,
  initialGroups,
  initialStock,

  // Callbacks
  onResultsChange,
  onSummaryChange,
  onPartsChange,
  onGroupsChange,

  // Adapters
  persistenceAdapter,
  exportAdapter,

  // Component picker
  onOpenComponentPicker,

  // External component selections
  primaryComponent: externalPrimaryComponent,
  backerComponent: externalBackerComponent,
  band16Component: externalBand16Component,
  band32Component: externalBand32Component,

  // Styling
  className,
}: CutlistWorkspaceProps) {
  // ============== State ==============

  // Materials palette
  const [materials, setMaterials] = React.useState<CutlistMaterialDefinition[]>([]);
  const materialsLoadedRef = React.useRef(false);

  // Parts
  const firstMaterialId = materials[0]?.id ?? null;
  const [parts, setParts] = React.useState<PartWithLabel[]>(() => {
    if (initialParts && initialParts.length > 0) {
      return initialParts.map((p, idx) => ({
        ...p,
        id: p.id || `P${idx + 1}`,
        grain: p.grain ?? 'length',
        band_edges: p.band_edges ?? { top: true, right: true, bottom: true, left: true },
      }));
    }
    return [
      {
        id: 'P1',
        length_mm: 500,
        width_mm: 300,
        qty: 2,
        grain: 'length',
        band_edges: { top: true, right: true, bottom: true, left: true },
        material_id: null,
      },
    ];
  });

  // Stock sheet
  const [stock, setStock] = React.useState<StockSheetSpec[]>(() => {
    if (initialStock) {
      return [initialStock];
    }
    return [{ id: 'S1', length_mm: 2750, width_mm: 1830, qty: 10, kerf_mm: 3 }];
  });
  const sheet = stock[0];

  // Packing options
  const [allowRotation, setAllowRotation] = React.useState(true);
  const [singleSheetOnly, setSingleSheetOnly] = React.useState(false);
  const [kerf, setKerf] = React.useState(3);

  // Results
  const [result, setResult] = React.useState<LayoutResult | null>(null);
  const [backerResult, setBackerResult] = React.useState<LayoutResult | null>(null);

  // Billing overrides
  const [sheetOverrides, setSheetOverrides] = React.useState<Record<string, SheetBillingOverride>>({});
  const [globalFullBoard, setGlobalFullBoard] = React.useState(false);

  // Costing
  const [primarySheetDescription, setPrimarySheetDescription] = React.useState<string>('MELAMINE SHEET');
  const [primaryPricePerSheet, setPrimaryPricePerSheet] = React.useState<number | ''>('');
  const [backerSheetDescription, setBackerSheetDescription] = React.useState<string>('BACKER BOARD');
  const [backerPricePerSheet, setBackerPricePerSheet] = React.useState<number | ''>('');
  const [bandingDesc16, setBandingDesc16] = React.useState<string>('EDGE BANDING 16mm (m)');
  const [bandingPrice16, setBandingPrice16] = React.useState<number | ''>('');
  const [bandingDesc32, setBandingDesc32] = React.useState<string>('EDGE BANDING 32mm (m)');
  const [bandingPrice32, setBandingPrice32] = React.useState<number | ''>('');

  // Internal component selections (used when not controlled externally)
  const [internalPrimaryComponent, setInternalPrimaryComponent] = React.useState<SelectedComponent | null>(null);
  const [internalBackerComponent, setInternalBackerComponent] = React.useState<SelectedComponent | null>(null);
  const [internalBand16Component, setInternalBand16Component] = React.useState<SelectedComponent | null>(null);
  const [internalBand32Component, setInternalBand32Component] = React.useState<SelectedComponent | null>(null);

  // Use external components if provided, otherwise internal
  const primaryComponent = externalPrimaryComponent ?? internalPrimaryComponent;
  const backerComponent = externalBackerComponent ?? internalBackerComponent;
  const band16Component = externalBand16Component ?? internalBand16Component;
  const band32Component = externalBand32Component ?? internalBand32Component;

  // Tabs and dialogs
  const [activeTab, setActiveTab] = React.useState<'inputs' | 'stock' | 'results' | 'costing'>('inputs');

  // Summary (computed from results)
  const [summary, setSummary] = React.useState<CutlistSummary | null>(null);

  // Input mode: 'manual' for direct part entry, 'grouped' for drag-and-drop grouping
  const [inputMode, setInputMode] = React.useState<'manual' | 'grouped'>(
    mode === 'grouped' ? 'grouped' : mode === 'manual' ? 'manual' : defaultInputMode
  );

  // Grouped mode state
  const [groups, setGroups] = React.useState<CutlistGroup[]>(initialGroups ?? []);
  const [ungroupedParts, setUngroupedParts] = React.useState<CutlistPart[]>([]);

  // ============== Derived Values ==============

  const laminationOn = React.useMemo(() => parts.some((p) => p.laminate), [parts]);
  const sheetArea = sheet.length_mm * sheet.width_mm;

  const usedArea = result?.stats.used_area_mm2 || 0;
  const wasteArea = result?.stats.waste_area_mm2 || 0;
  const totalArea = usedArea + wasteArea;
  const usedPct = totalArea > 0 ? (usedArea / totalArea) * 100 : 0;
  const bandLen16 = result?.stats.edgebanding_16mm_mm || 0;
  const bandLen32 = result?.stats.edgebanding_32mm_mm || 0;
  const primarySheetsFractional = sheetArea > 0 ? usedArea / sheetArea : 0;
  const backerUsedArea = backerResult?.stats.used_area_mm2 || 0;
  const backerSheetsFractional = sheetArea > 0 ? backerUsedArea / sheetArea : 0;

  const computeSheetCharge = React.useCallback(
    (layout: LayoutResult | null): number => {
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
    },
    [globalFullBoard, sheetArea, sheetOverrides]
  );

  const primaryChargeSheets = computeSheetCharge(result);
  const backerChargeSheets = computeSheetCharge(backerResult);

  // ============== Effects ==============

  // Load from persistence adapter on mount
  React.useEffect(() => {
    if (!persistenceAdapter) return;

    persistenceAdapter.load().then((snapshot) => {
      if (!snapshot) {
        materialsLoadedRef.current = true;
        return;
      }

      // Restore state from snapshot
      if (snapshot.parts?.length > 0) setParts(snapshot.parts);
      if (snapshot.groups?.length > 0) setGroups(snapshot.groups);
      if (snapshot.ungroupedParts?.length > 0) setUngroupedParts(snapshot.ungroupedParts);
      if (snapshot.stock?.length > 0) setStock(snapshot.stock);
      if (snapshot.materials?.length > 0) setMaterials(snapshot.materials);

      if (snapshot.costing) {
        const c = snapshot.costing;
        if (c.primarySheetDescription) setPrimarySheetDescription(c.primarySheetDescription);
        if (c.primaryPricePerSheet !== undefined) setPrimaryPricePerSheet(c.primaryPricePerSheet);
        if (c.backerSheetDescription) setBackerSheetDescription(c.backerSheetDescription);
        if (c.backerPricePerSheet !== undefined) setBackerPricePerSheet(c.backerPricePerSheet);
        if (c.bandingDesc16) setBandingDesc16(c.bandingDesc16);
        if (c.bandingPrice16 !== undefined) setBandingPrice16(c.bandingPrice16);
        if (c.bandingDesc32) setBandingDesc32(c.bandingDesc32);
        if (c.bandingPrice32 !== undefined) setBandingPrice32(c.bandingPrice32);
      }

      if (snapshot.components) {
        const comp = snapshot.components;
        if (comp.primary) setInternalPrimaryComponent(comp.primary);
        if (comp.backer) setInternalBackerComponent(comp.backer);
        if (comp.band16) setInternalBand16Component(comp.band16);
        if (comp.band32) setInternalBand32Component(comp.band32);
      }

      if (snapshot.options) {
        const opts = snapshot.options;
        if (typeof opts.kerf === 'number') setKerf(opts.kerf);
        if (typeof opts.allowRotation === 'boolean') setAllowRotation(opts.allowRotation);
        if (typeof opts.singleSheetOnly === 'boolean') setSingleSheetOnly(opts.singleSheetOnly);
      }

      if (snapshot.inputMode && mode === 'hybrid') {
        setInputMode(snapshot.inputMode);
      }

      materialsLoadedRef.current = true;
    }).catch((err) => {
      console.warn('Failed to load cutlist snapshot', err);
      materialsLoadedRef.current = true;
    });
  }, [persistenceAdapter, mode]);

  // Save to persistence adapter when state changes
  React.useEffect(() => {
    if (!persistenceAdapter || !materialsLoadedRef.current) return;

    const snapshot: CutlistSnapshot = {
      parts,
      groups,
      ungroupedParts,
      stock,
      materials,
      costing: {
        primarySheetDescription,
        primaryPricePerSheet,
        backerSheetDescription,
        backerPricePerSheet,
        bandingDesc16,
        bandingPrice16,
        bandingDesc32,
        bandingPrice32,
      },
      components: {
        primary: internalPrimaryComponent,
        backer: internalBackerComponent,
        band16: internalBand16Component,
        band32: internalBand32Component,
      },
      options: {
        kerf,
        allowRotation,
        singleSheetOnly,
      },
      inputMode,
    };

    persistenceAdapter.save(snapshot).catch((err) => {
      console.warn('Failed to save cutlist snapshot', err);
    });
  }, [
    persistenceAdapter,
    parts,
    groups,
    ungroupedParts,
    stock,
    materials,
    primarySheetDescription,
    primaryPricePerSheet,
    backerSheetDescription,
    backerPricePerSheet,
    bandingDesc16,
    bandingPrice16,
    bandingDesc32,
    bandingPrice32,
    internalPrimaryComponent,
    internalBackerComponent,
    internalBand16Component,
    internalBand32Component,
    kerf,
    allowRotation,
    singleSheetOnly,
    inputMode,
  ]);

  // Update parts with default material when materials change
  React.useEffect(() => {
    const defaultId = materials[0]?.id ?? null;
    setParts((prev) => {
      let changed = false;
      const next = prev.map((part) => {
        const hasMaterial = part.material_id && materials.some((mat) => mat.id === part.material_id);
        if (hasMaterial) return part;
        changed = true;
        return { ...part, material_id: defaultId };
      });
      return changed ? next : prev;
    });
  }, [materials]);

  // Sync primary costing from first material
  React.useEffect(() => {
    const first = materials[0];
    if (!first) return;
    const derivedPrice =
      typeof first.pricePerSheet === 'number'
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

  // Update summary when results change
  React.useEffect(() => {
    if (!result) {
      setSummary(null);
      onSummaryChange?.(null);
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
      const sheetPrice =
        typeof mat.pricePerSheet === 'number'
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

    const newSummary: CutlistSummary = {
      result,
      backerResult: backerResult ?? null,
      primarySheetsUsed: primarySheetsFractional,
      primarySheetsBillable: primaryChargeSheets,
      backerSheetsUsed: backerSheetsFractional,
      backerSheetsBillable: backerChargeSheets,
      edgebanding16mm: bandLen16,
      edgebanding32mm: bandLen32,
      edgebandingTotal: bandLen16 + bandLen32,
      laminationOn,
      materials: materialSummaries,
    };

    setSummary(newSummary);
    onSummaryChange?.(newSummary);
  }, [
    result,
    backerResult,
    primarySheetsFractional,
    primaryChargeSheets,
    backerSheetsFractional,
    backerChargeSheets,
    bandLen16,
    bandLen32,
    laminationOn,
    materials,
    parts,
    sheetArea,
    backerPricePerSheet,
    onSummaryChange,
  ]);

  // Notify parent when results change
  React.useEffect(() => {
    onResultsChange?.(result);
  }, [result, onResultsChange]);

  // Notify parent when parts change
  React.useEffect(() => {
    onPartsChange?.(parts);
  }, [parts, onPartsChange]);

  // Notify parent when groups change
  React.useEffect(() => {
    onGroupsChange?.(groups);
  }, [groups, onGroupsChange]);

  // ============== Callbacks ==============

  const updateStock = (updates: Partial<StockSheetSpec>) => {
    const next = [{ ...stock[0], ...updates }];
    setStock(next);
  };

  const updateMaterial = (id: string, updates: Partial<CutlistMaterialDefinition>) => {
    setMaterials((prev) =>
      prev.map((mat) => {
        if (mat.id !== id) return mat;
        const next: CutlistMaterialDefinition = { ...mat, ...updates };
        if (updates.pricePerSheet !== undefined) {
          if (typeof updates.pricePerSheet === 'number') {
            next.unit_cost = updates.pricePerSheet;
          } else if (updates.pricePerSheet === '') {
            next.unit_cost = null;
          }
        }
        return next;
      })
    );
  };

  const removeMaterial = (id: string) => {
    setMaterials((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((mat) => mat.id !== id);
      const fallbackId = next[0]?.id ?? null;
      setParts((prevParts) =>
        prevParts.map((part) => (part.material_id === id ? { ...part, material_id: fallbackId } : part))
      );
      return next;
    });
  };

  const addMaterial = () => {
    const newMat: CutlistMaterialDefinition = {
      id: generateId(),
      name: `Material ${materials.length + 1}`,
      sheetDescription: '',
      pricePerSheet: '',
      band16Description: bandingDesc16 || 'EDGE BANDING 16mm (m)',
      band16Price: bandingPrice16,
      band32Description: bandingDesc32 || 'EDGE BANDING 32mm (m)',
      band32Price: bandingPrice32,
    };
    setMaterials((prev) => [...prev, newMat]);
  };

  const handleCalculate = () => {
    // Ensure kerf from options applied to stock sheet
    const normalized: StockSheetSpec[] = [{ ...stock[0], kerf_mm: Math.max(0, kerf) }];

    if (inputMode === 'grouped') {
      // Grouped mode: expand groups to part specs using boardCalculator
      const boardCalc = expandGroupsToPartSpecs(groups);

      // Combine all primary parts for packing
      const allPrimaryParts: PartSpec[] = boardCalc.primarySets.flatMap((set) => set.parts);
      const allBackerParts: PartSpec[] = boardCalc.backerSets.flatMap((set) => set.parts);

      if (allPrimaryParts.length === 0) {
        // No parts to pack - show empty result
        setResult(null);
        setBackerResult(null);
        setActiveTab('results');
        return;
      }

      // Pack primary parts
      const res = packPartsIntoSheets(allPrimaryParts, normalized, { allowRotation, singleSheetOnly });
      setResult(res);
      setSheetOverrides({});
      setGlobalFullBoard(false);

      // Pack backer parts if any
      if (allBackerParts.length > 0) {
        const backerRes = packPartsIntoSheets(allBackerParts, normalized, { allowRotation: true, singleSheetOnly });
        setBackerResult(backerRes);
      } else {
        setBackerResult(null);
      }
    } else {
      // Manual mode: use parts directly
      const res = packPartsIntoSheets(parts as PartSpec[], normalized, { allowRotation, singleSheetOnly });
      setResult(res);
      setSheetOverrides({});
      setGlobalFullBoard(false);

      // Optional backer calculation (laminate=true parts, grain-any)
      if (parts.some((p) => p.laminate)) {
        const backerParts: PartSpec[] = parts
          .filter((p) => p.laminate)
          .map((p) => ({ ...p, grain: 'any', require_grain: undefined, band_edges: undefined } as PartSpec));
        const resBacker = packPartsIntoSheets(backerParts, normalized, { allowRotation: true, singleSheetOnly });
        setBackerResult(resBacker);
      } else {
        setBackerResult(null);
      }
    }

    setActiveTab('results');
  };

  const handleCSVImport = (importedParts: CutlistPart[]) => {
    if (inputMode === 'grouped') {
      // In grouped mode, add to ungrouped parts area
      setUngroupedParts((prev) => [...prev, ...importedParts]);
    } else {
      // In manual mode, convert CutlistPart to PartWithLabel format
      const defaultMaterialId = materials[0]?.id ?? null;
      const newParts: PartWithLabel[] = importedParts.map((p) => ({
        id: p.id,
        length_mm: p.length_mm,
        width_mm: p.width_mm,
        qty: p.quantity,
        grain: p.grain,
        band_edges: p.band_edges,
        material_id: defaultMaterialId,
        label: p.name,
      }));
      setParts((prev) => [...prev, ...newParts]);
    }
  };

  const handleOpenComponentPicker = (target: CostingPickerTarget) => {
    // If external handler provided, use it
    if (onOpenComponentPicker) {
      onOpenComponentPicker(target);
    }
  };

  // Convert materials to MaterialOption for PartsInputTable
  const materialOptions: MaterialOption[] = materials.map((mat) => ({
    id: mat.id,
    name: mat.name,
    description: mat.sheetDescription,
    unit_cost: mat.unit_cost,
  }));

  // Convert materials to GroupedPartsMaterialOption for GroupedPartsPanel
  const groupedMaterialOptions: GroupedPartsMaterialOption[] = materials.map((mat) => ({
    id: mat.id,
    code: mat.name,
    description: mat.sheetDescription,
  }));

  // Build tabs list based on feature toggles
  const tabsList = React.useMemo(() => {
    const tabs: { value: string; label: string }[] = [{ value: 'inputs', label: 'Inputs' }];
    if (showStockTab) tabs.push({ value: 'stock', label: 'Stock' });
    if (showResults) tabs.push({ value: 'results', label: 'Results' });
    if (showCosting) tabs.push({ value: 'costing', label: 'Costing' });
    return tabs;
  }, [showStockTab, showResults, showCosting]);

  // ============== Render ==============

  return (
    <div className={cn('space-y-4', className)}>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className={cn('grid w-full', `grid-cols-${tabsList.length}`)}>
          {tabsList.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Inputs Tab */}
        <TabsContent value="inputs" className="space-y-4">
          {/* Mode Toggle (only in hybrid mode) */}
          {mode === 'hybrid' && (
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-muted-foreground">Input Mode:</span>
              <div className="inline-flex items-center rounded-lg border bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setInputMode('manual')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                    inputMode === 'manual'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('grouped')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                    inputMode === 'grouped'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Grouped
                </button>
              </div>
              <span className="text-xs text-muted-foreground">
                {inputMode === 'manual'
                  ? 'Enter parts directly with dimensions and quantities'
                  : 'Drag and drop parts into groups with board types'}
              </span>
            </div>
          )}

          {/* CSV Import Dropzone */}
          {showCSVImport && <CSVDropzone onPartsImported={handleCSVImport} className="mb-4" />}

          {/* Manual Mode: Parts Input Table */}
          {inputMode === 'manual' && (
            <PartsInputTable
              parts={parts}
              onPartsChange={setParts}
              materials={materialOptions}
              showMaterialSelector={showMaterialPalette}
              onCalculate={handleCalculate}
            />
          )}

          {/* Grouped Mode: Drag-and-Drop Panel */}
          {inputMode === 'grouped' && (
            <div className="space-y-4">
              <GroupedPartsPanel
                groups={groups}
                ungroupedParts={ungroupedParts}
                onGroupsChange={setGroups}
                onUngroupedPartsChange={setUngroupedParts}
                materials={groupedMaterialOptions}
                ungroupedTitle="Imported Parts"
                ungroupedDescription="Import parts via CSV above, then drag them to groups"
                groupsTitle="Part Groups"
                groupsDescription="Create groups and assign board types (16mm, 32mm-both, 32mm-backer)"
                emptyUngroupedText="Import a CSV or all parts have been grouped"
                emptyGroupsText="Click 'New Group' to create a group"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleCalculate}
                  disabled={groups.length === 0 || groups.every((g) => g.parts.length === 0)}
                >
                  Calculate Layout
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Stock Tab */}
        {showStockTab && (
          <TabsContent value="stock" className="space-y-4">
            <div className="space-y-3">
              <div className="font-medium">Stock Sheet</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="s-l">Length (mm)</Label>
                  <Input
                    id="s-l"
                    type="number"
                    value={sheet.length_mm}
                    onChange={(e) => updateStock({ length_mm: Number(e.target.value || 0) })}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div>
                  <Label htmlFor="s-w">Width (mm)</Label>
                  <Input
                    id="s-w"
                    type="number"
                    value={sheet.width_mm}
                    onChange={(e) => updateStock({ width_mm: Number(e.target.value || 0) })}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div>
                  <Label htmlFor="s-q">Qty Available</Label>
                  <Input
                    id="s-q"
                    type="number"
                    value={sheet.qty}
                    onChange={(e) => updateStock({ qty: Number(e.target.value || 0) })}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div>
                  <Label htmlFor="kerf">Kerf (mm)</Label>
                  <Input
                    id="kerf"
                    type="number"
                    value={kerf}
                    onChange={(e) => setKerf(Number(e.target.value || 0))}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="rot" checked={allowRotation} onCheckedChange={(v) => setAllowRotation(Boolean(v))} />
                  <Label htmlFor="rot" className="text-sm text-muted-foreground">
                    Allow 90 degree rotation
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="single" checked={singleSheetOnly} onCheckedChange={(v) => setSingleSheetOnly(Boolean(v))} />
                  <Label htmlFor="single" className="text-sm text-muted-foreground">
                    Single sheet only
                  </Label>
                </div>
              </div>
            </div>
          </TabsContent>
        )}

        {/* Results Tab */}
        {showResults && (
          <TabsContent value="results" className="space-y-4">
            {!result ? (
              <div className="text-muted-foreground">No results yet. Enter inputs and click Calculate.</div>
            ) : (
              <div className="space-y-4">
                {/* Results Summary */}
                <ResultsSummary
                  primarySheetsUsed={primarySheetsFractional}
                  primarySheetsBillable={primaryChargeSheets}
                  usedPercent={usedPct}
                  edgebanding16mm={bandLen16}
                  edgebanding32mm={bandLen32}
                  laminationOn={laminationOn}
                  backerSheetsUsed={backerResult ? backerSheetsFractional : undefined}
                  backerSheetsBillable={backerResult ? backerChargeSheets : undefined}
                />

                {/* Unplaced parts alert */}
                {result.unplaced && result.unplaced.length > 0 && (
                  <Alert className="border-amber-400/70 bg-amber-50">
                    <AlertTitle>Unplaced parts</AlertTitle>
                    <AlertDescription>
                      <div className="text-sm leading-relaxed space-y-1">
                        {result.unplaced.map((item, idx) => (
                          <div key={idx}>
                            <span className="font-medium">{item.part.id}</span>
                            {` x ${item.count} - `}
                            {item.reason === 'too_large_for_sheet'
                              ? 'Part exceeds stock sheet dimensions (check grain/rotation and sizing).'
                              : 'No sheet capacity remaining. Increase available sheets or adjust layout.'}
                            {` (${item.part.length_mm} x ${item.part.width_mm} mm)`}
                          </div>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Sheet Layout Grid */}
                <SheetLayoutGrid
                  result={result}
                  stockSheet={sheet}
                  globalFullBoard={globalFullBoard}
                  onGlobalFullBoardChange={setGlobalFullBoard}
                  sheetOverrides={sheetOverrides}
                  onSheetOverridesChange={setSheetOverrides}
                />
              </div>
            )}
          </TabsContent>
        )}

        {/* Costing Tab */}
        {showCosting && (
          <TabsContent value="costing" className="space-y-4">
            <CostingPanel
              // Backer
              backerDescription={backerSheetDescription}
              onBackerDescriptionChange={setBackerSheetDescription}
              backerPrice={backerPricePerSheet}
              onBackerPriceChange={setBackerPricePerSheet}
              backerComponent={backerComponent}
              onBackerComponentChange={setInternalBackerComponent}
              // Primary
              primaryDescription={primarySheetDescription}
              onPrimaryDescriptionChange={setPrimarySheetDescription}
              primaryPrice={primaryPricePerSheet}
              onPrimaryPriceChange={setPrimaryPricePerSheet}
              primaryComponent={primaryComponent}
              onPrimaryComponentChange={setInternalPrimaryComponent}
              // Edgebanding 16mm
              band16Description={bandingDesc16}
              onBand16DescriptionChange={setBandingDesc16}
              band16Price={bandingPrice16}
              onBand16PriceChange={setBandingPrice16}
              band16Component={band16Component}
              onBand16ComponentChange={setInternalBand16Component}
              // Edgebanding 32mm
              band32Description={bandingDesc32}
              onBand32DescriptionChange={setBandingDesc32}
              band32Price={bandingPrice32}
              onBand32PriceChange={setBandingPrice32}
              band32Component={band32Component}
              onBand32ComponentChange={setInternalBand32Component}
              // Material palette
              enableMaterialPalette={showMaterialPalette}
              materials={materials}
              onMaterialsChange={setMaterials}
              onAddMaterial={addMaterial}
              onRemoveMaterial={removeMaterial}
              onUpdateMaterial={updateMaterial}
              // Component picker
              onOpenComponentPicker={handleOpenComponentPicker}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default CutlistWorkspace;

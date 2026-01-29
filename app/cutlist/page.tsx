'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ArrowLeft, BarChart3, Info, Calculator, Trash2, Save, HelpCircle, FolderOpen, FilePlus, SaveAll } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Import primitives
import {
  MaterialsPanel,
  type BoardMaterial,
  type EdgingMaterial,
  CompactPartsTable,
  type CompactPartsTableRef,
  type CompactPart,
  CustomLaminationModal,
  type LaminationConfig,
  type BoardOption,
  CSVDropzone,
  ResultsSummary,
  SheetLayoutGrid,
} from '@/components/features/cutlist/primitives';

// Import component picker
import {
  ComponentPickerDialog,
  type SelectedComponent,
  CATEGORY_IDS,
} from '@/components/features/cutlist/ComponentPickerDialog';

// Import material defaults persistence
import {
  loadMaterialDefaults,
  saveMaterialDefaults,
} from '@/lib/cutlist/materialsDefaults';

// Import save/load
import { useSavedCutlists } from '@/hooks/useSavedCutlists';
import type { SavedCutlistData, SavedCutlistProject } from '@/lib/cutlist/savedProjects';
import { SaveCutlistDialog } from '@/components/features/cutlist/SaveCutlistDialog';
import { LoadCutlistDialog } from '@/components/features/cutlist/LoadCutlistDialog';
import { toast } from 'sonner';

// Import types
import type {
  PartSpec,
  StockSheetSpec,
  LayoutResult,
  CutlistSummary,
  CutlistMaterialSummary,
  SheetBillingOverride,
  CutlistPart,
} from '@/lib/cutlist/types';

// Import packing - smart packer (strip-based default)
import { packPartsSmartOptimized } from '@/components/features/cutlist/packing';

// =============================================================================
// Formatters
// =============================================================================

const sheetFormatter = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const meterFormatter = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatSheets = (value: number) => sheetFormatter.format(Number.isFinite(value) ? value : 0);
const formatMeters = (value: number) => `${meterFormatter.format(Number.isFinite(value) ? value : 0)} m`;
const formatCurrency = (value: number) => currencyFormatter.format(Number.isFinite(value) ? value : 0);

// =============================================================================
// Helper Components
// =============================================================================

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

// =============================================================================
// Local Storage Keys (for session-only data like parts)
// =============================================================================

const PARTS_STORAGE_KEY = 'cutlist-parts';
const OPTIMIZATION_PRIORITY_KEY = 'cutlist-optimization-priority';

type OptimizationPriority = 'fast' | 'offcut';

// =============================================================================
// Helper Functions
// =============================================================================

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}`;
};

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_KERF = 3;

// =============================================================================
// Main Component
// =============================================================================

export default function CutlistPage() {
  // ============== Materials Panel State ==============
  const [primaryBoards, setPrimaryBoards] = React.useState<BoardMaterial[]>([]);
  const [backerBoards, setBackerBoards] = React.useState<BoardMaterial[]>([]);
  const [edging, setEdging] = React.useState<EdgingMaterial[]>([]);
  const [kerf, setKerf] = React.useState(DEFAULT_KERF);
  const materialsLoadedRef = React.useRef(false);

  // ============== Parts State ==============
  const [parts, setParts] = React.useState<CompactPart[]>([]);
  const partsLoadedRef = React.useRef(false);
  const partsTableRef = React.useRef<CompactPartsTableRef>(null);
  const [hasQuickAddPending, setHasQuickAddPending] = React.useState(false);

  // ============== Stock sheet (derived from default primary board) ==============
  const defaultPrimaryBoard = React.useMemo(
    () => primaryBoards.find((b) => b.isDefault) || primaryBoards[0],
    [primaryBoards]
  );
  const stock = React.useMemo<StockSheetSpec[]>(() => {
    if (!defaultPrimaryBoard) {
      return [{ id: 'S1', length_mm: 2750, width_mm: 1830, qty: 10, kerf_mm: kerf }];
    }
    return [
      {
        id: 'S1',
        length_mm: defaultPrimaryBoard.length_mm,
        width_mm: defaultPrimaryBoard.width_mm,
        qty: 10,
        kerf_mm: kerf,
      },
    ];
  }, [defaultPrimaryBoard, kerf]);
  const sheet = stock[0];

  // ============== Packing Options ==============
  const [allowRotation] = React.useState(true);
  const [singleSheetOnly] = React.useState(false);
  const [optimizationPriority, setOptimizationPriority] = React.useState<OptimizationPriority>('fast');
  const optimizationLoadedRef = React.useRef(false);

  // ============== Results ==============
  const [result, setResult] = React.useState<LayoutResult | null>(null);
  const [backerResult, setBackerResult] = React.useState<LayoutResult | null>(null);

  // ============== Billing overrides ==============
  const [sheetOverrides, setSheetOverrides] = React.useState<Record<string, SheetBillingOverride>>({});
  const [globalFullBoard, setGlobalFullBoard] = React.useState(false);

  // ============== Custom Lamination Modal ==============
  const [customLamPartId, setCustomLamPartId] = React.useState<string | null>(null);
  const [customLamConfig, setCustomLamConfig] = React.useState<LaminationConfig | undefined>();
  const [showCustomLamModal, setShowCustomLamModal] = React.useState(false);

  // ============== Component Picker Dialog ==============
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerType, setPickerType] = React.useState<'primary' | 'backer' | 'edging'>('primary');

  // ============== Tabs and dialogs ==============
  const [activeTab, setActiveTab] = React.useState<'materials' | 'parts' | 'preview'>('parts');
  const [snapshotOpen, setSnapshotOpen] = React.useState(false);
  const [tipsOpen, setTipsOpen] = React.useState(false);

  // ============== Save/Load Project State ==============
  const [currentProjectId, setCurrentProjectId] = React.useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = React.useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const {
    folders,
    projects,
    saveProject,
    updateProject,
    deleteProject,
    createFolder,
    renameFolder,
    deleteFolder,
  } = useSavedCutlists();

  // ============== Summary (passed to dialog) ==============
  const [summary, setSummary] = React.useState<CutlistSummary | null>(null);

  // ============== Derived Values ==============

  const laminationOn = React.useMemo(
    () => parts.some((p) => p.lamination_type && p.lamination_type !== 'none'),
    [parts]
  );
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

  // ============== Material Options for CompactPartsTable ==============

  const materialOptions = React.useMemo(() => {
    return primaryBoards.map((b) => ({
      id: b.id,
      label: b.name,
      thickness: 16, // All primary boards are 16mm
    }));
  }, [primaryBoards]);

  // ============== Board Options for CustomLaminationModal ==============

  const primaryBoardOptions = React.useMemo<BoardOption[]>(
    () => primaryBoards.map((b) => ({ id: b.id, name: b.name })),
    [primaryBoards]
  );

  const backerBoardOptions = React.useMemo<BoardOption[]>(
    () => backerBoards.map((b) => ({ id: b.id, name: b.name })),
    [backerBoards]
  );

  // ============== Load pinned materials from database ==============

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadPinnedMaterials = async () => {
      try {
        const defaults = await loadMaterialDefaults();
        if (defaults) {
          // Load only pinned materials (or all if no isPinned flag, for backwards compat)
          const pinnedPrimary = defaults.primaryBoards.filter((b) => b.isPinned !== false);
          const pinnedBacker = defaults.backerBoards.filter((b) => b.isPinned !== false);
          const pinnedEdging = defaults.edging.filter((e) => e.isPinned !== false);

          // Mark them all as pinned
          setPrimaryBoards(pinnedPrimary.map((b) => ({ ...b, isPinned: true })));
          setBackerBoards(pinnedBacker.map((b) => ({ ...b, isPinned: true })));
          setEdging(pinnedEdging.map((e) => ({ ...e, isPinned: true })));
          setKerf(defaults.kerf);
        }
        // If no defaults, start with empty arrays (user adds from inventory)
      } catch (err) {
        console.warn('Failed to load pinned materials', err);
      } finally {
        materialsLoadedRef.current = true;
      }
    };

    loadPinnedMaterials();
  }, []);

  // Load parts from localStorage
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedParts = window.localStorage.getItem(PARTS_STORAGE_KEY);
      if (storedParts) {
        const parsed = JSON.parse(storedParts) as CompactPart[];
        if (Array.isArray(parsed)) {
          setParts(parsed);
        }
      }
    } catch (err) {
      console.warn('Failed to load cutlist parts from localStorage', err);
    } finally {
      partsLoadedRef.current = true;
    }
  }, []);

  // ============== Persist pinned materials to database ==============

  // Debounce save to avoid too many database calls
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (!materialsLoadedRef.current || typeof window === 'undefined') return;

    // Only save pinned materials
    const pinnedPrimary = primaryBoards.filter((b) => b.isPinned);
    const pinnedBacker = backerBoards.filter((b) => b.isPinned);
    const pinnedEdging = edging.filter((e) => e.isPinned);

    // Debounce the save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveMaterialDefaults({
        primaryBoards: pinnedPrimary,
        backerBoards: pinnedBacker,
        edging: pinnedEdging,
        kerf,
      }).catch((err) => {
        console.warn('Failed to save pinned materials', err);
      });
    }, 500); // 500ms debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [primaryBoards, backerBoards, edging, kerf]);

  React.useEffect(() => {
    if (!partsLoadedRef.current || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PARTS_STORAGE_KEY, JSON.stringify(parts));
    } catch (err) {
      console.warn('Failed to persist parts', err);
    }
  }, [parts]);

  // ============== Load optimization priority from localStorage ==============
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(OPTIMIZATION_PRIORITY_KEY);
      if (stored === 'fast' || stored === 'offcut') {
        setOptimizationPriority(stored);
      }
    } catch (err) {
      console.warn('Failed to load optimization priority', err);
    } finally {
      optimizationLoadedRef.current = true;
    }
  }, []);

  // ============== Persist optimization priority ==============
  React.useEffect(() => {
    if (!optimizationLoadedRef.current || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(OPTIMIZATION_PRIORITY_KEY, optimizationPriority);
    } catch (err) {
      console.warn('Failed to persist optimization priority', err);
    }
  }, [optimizationPriority]);

  // ============== Update summary when results change ==============

  React.useEffect(() => {
    if (!result) {
      setSummary(null);
      return;
    }

    const sheetAreaSafe = sheetArea > 0 ? sheetArea : 1;
    const totalPartsArea = parts.reduce((sum, part) => {
      const qty = Math.max(0, Number(part.quantity) || 0);
      return sum + (part.length_mm || 0) * (part.width_mm || 0) * qty;
    }, 0);

    // Get default backer board cost
    const defaultBacker = backerBoards.find((b) => b.isDefault) || backerBoards[0];
    const backerPriceNumeric = defaultBacker?.cost || 0;

    // Get default primary board cost
    const defaultPrimary = primaryBoards.find((b) => b.isDefault) || primaryBoards[0];

    // Get default edging costs
    const edging16 = edging.find((e) => e.thickness_mm === 16 && e.isDefaultForThickness);
    const edging32 = edging.find((e) => e.thickness_mm === 32 && e.isDefaultForThickness);

    const materialStats = new Map<
      string,
      { name: string; area: number; band16: number; band32: number; laminateArea: number }
    >();

    const getMaterial = (id: string | null | undefined) =>
      primaryBoards.find((m) => m.id === id) ?? primaryBoards[0];

    for (const part of parts) {
      const qty = Math.max(0, Number(part.quantity) || 0);
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
      const key = mat?.id || primaryBoards[0]?.id || 'default';
      if (!materialStats.has(key)) {
        materialStats.set(key, { name: mat?.name || 'Material', area: 0, band16: 0, band32: 0, laminateArea: 0 });
      }
      const bucket = materialStats.get(key)!;
      bucket.area += area;
      // Check if part uses 32mm edging (any lamination type)
      const has32mmEdging = part.lamination_type && part.lamination_type !== 'none';
      // Check if part needs a SEPARATE backer board (only with-backer, NOT same-board)
      const needsBackerBoard = part.lamination_type === 'with-backer';

      if (has32mmEdging) {
        bucket.band32 += totalBandLen;
      } else {
        bucket.band16 += totalBandLen;
      }
      // Only count backer area for parts that actually need a separate backer
      if (needsBackerBoard) {
        bucket.laminateArea += area;
      }
    }

    const materialSummaries: CutlistMaterialSummary[] = primaryBoards.map((mat) => {
      const stats = materialStats.get(mat.id) || { name: mat.name, area: 0, band16: 0, band32: 0, laminateArea: 0 };
      const sheetsUsed = stats.area / sheetAreaSafe;
      const usageRatio = totalPartsArea > 0 ? stats.area / totalPartsArea : 0;
      const sheetsBillable = primaryChargeSheets * usageRatio;
      const sheetPrice = mat.cost || 0;
      const band16Price = edging16?.cost_per_meter || 0;
      const band32Price = edging32?.cost_per_meter || 0;
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

    setSummary({
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
    });
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
    primaryBoards,
    backerBoards,
    edging,
    parts,
    sheetArea,
  ]);

  // ============== Callbacks ==============

  const handleAddPrimaryBoard = () => {
    setPickerType('primary');
    setPickerOpen(true);
  };

  const handleAddBackerBoard = () => {
    setPickerType('backer');
    setPickerOpen(true);
  };

  const handleAddEdging = () => {
    setPickerType('edging');
    setPickerOpen(true);
  };

  const handleComponentSelected = (component: SelectedComponent) => {
    if (pickerType === 'primary') {
      const newBoard: BoardMaterial = {
        id: generateId(),
        name: component.description || component.internal_code,
        length_mm: component.length_mm || 2750,
        width_mm: component.width_mm || 1830,
        cost: component.price,
        isDefault: primaryBoards.length === 0,
        isPinned: false, // New materials start unpinned (session only)
        component_id: component.component_id,
      };
      setPrimaryBoards((prev) => [...prev, newBoard]);
    } else if (pickerType === 'backer') {
      const newBoard: BoardMaterial = {
        id: generateId(),
        name: component.description || component.internal_code,
        length_mm: component.length_mm || 2750,
        width_mm: component.width_mm || 1830,
        cost: component.price,
        isDefault: backerBoards.length === 0,
        isPinned: false, // New materials start unpinned (session only)
        component_id: component.component_id,
      };
      setBackerBoards((prev) => [...prev, newBoard]);
    } else if (pickerType === 'edging') {
      const thickness = component.thickness_mm || 16;
      const newEdging: EdgingMaterial = {
        id: generateId(),
        name: component.description || component.internal_code,
        thickness_mm: thickness,
        width_mm: component.width_mm || 22,
        cost_per_meter: component.price,
        isDefaultForThickness: !edging.some((e) => e.thickness_mm === thickness && e.isDefaultForThickness),
        isPinned: false, // New materials start unpinned (session only)
        component_id: component.component_id,
      };
      setEdging((prev) => [...prev, newEdging]);
    }
  };

  // Get category IDs based on picker type
  const getPickerCategoryIds = () => {
    switch (pickerType) {
      case 'primary':
        return [CATEGORY_IDS.MELAMINE];
      case 'backer':
        return [CATEGORY_IDS.MELAMINE, CATEGORY_IDS.MDF, CATEGORY_IDS.PLYWOOD];
      case 'edging':
        return [CATEGORY_IDS.EDGING];
      default:
        return undefined;
    }
  };

  const getPickerTitle = () => {
    switch (pickerType) {
      case 'primary':
        return 'Select Primary Board';
      case 'backer':
        return 'Select Backer Board';
      case 'edging':
        return 'Select Edging';
      default:
        return 'Select Component';
    }
  };

  const getPickerDescription = () => {
    switch (pickerType) {
      case 'primary':
        return 'Search and select a melamine board from inventory.';
      case 'backer':
        return 'Search and select a backer board (Melamine/MDF/Plywood) from inventory.';
      case 'edging':
        return 'Search and select an edging material from inventory.';
      default:
        return 'Search and select a component from inventory.';
    }
  };

  const handleOpenCustomLamination = (partId: string, config?: LaminationConfig) => {
    setCustomLamPartId(partId);
    setCustomLamConfig(config);
    setShowCustomLamModal(true);
  };

  const handleCustomLaminationConfirm = (config: LaminationConfig) => {
    if (!customLamPartId) return;
    setParts((prev) =>
      prev.map((p) =>
        p.id === customLamPartId
          ? { ...p, lamination_type: 'custom' as const, lamination_config: config }
          : p
      )
    );
  };

  // Flag to trigger calculation after quick-add activation
  const pendingCalculateRef = React.useRef(false);

  const runCalculation = React.useCallback((partsToUse: CompactPart[]) => {
    // Convert CompactPart to PartSpec for packing
    const partSpecs: PartSpec[] = partsToUse
      .filter((p) => p.length_mm > 0 && p.width_mm > 0 && p.quantity > 0)
      .map((p) => ({
        id: p.id,
        length_mm: p.length_mm,
        width_mm: p.width_mm,
        qty: p.quantity,
        grain: p.grain,
        band_edges: p.band_edges,
        laminate: p.lamination_type !== 'none' && p.lamination_type !== undefined,
        lamination_type: p.lamination_type, // Include lamination_type for backer filtering
        material_id: p.material_id,
        label: p.name,
      }));

    if (partSpecs.length === 0) {
      setResult(null);
      setBackerResult(null);
      return;
    }

    const normalized: StockSheetSpec[] = [{ ...stock[0], kerf_mm: Math.max(0, kerf) }];

    // Map optimization priority to algorithm
    const algorithm = optimizationPriority === 'fast' ? 'strip' : 'guillotine';

    // Pack primary parts using selected algorithm
    const res = packPartsSmartOptimized(partSpecs, normalized, { allowRotation, singleSheetOnly, algorithm });

    // Calculate edging correctly based on lamination type AND lamination groups
    // The packing algorithm doesn't know about same-board vs with-backer or groups,
    // so we calculate edging separately here
    let edging16mm = 0;
    let edging32mm = 0;
    const customEdging = new Map<number, number>();

    // Group parts by lamination_group
    const laminationGroups = new Map<string, typeof partsToUse>();
    const ungroupedParts: typeof partsToUse = [];

    for (const part of partsToUse) {
      if (part.lamination_group) {
        if (!laminationGroups.has(part.lamination_group)) {
          laminationGroups.set(part.lamination_group, []);
        }
        laminationGroups.get(part.lamination_group)!.push(part);
      } else {
        ungroupedParts.push(part);
      }
    }

    // Process ungrouped parts (existing logic)
    for (const part of ungroupedParts) {
      if (part.length_mm <= 0 || part.width_mm <= 0 || part.quantity <= 0) continue;

      const laminationType = part.lamination_type || 'none';

      // Calculate edge length for one part
      // Convention: top/bottom edges = length, left/right edges = width
      const be = part.band_edges;
      const singlePartEdge =
        (be.top ? part.length_mm : 0) +
        (be.bottom ? part.length_mm : 0) +
        (be.left ? part.width_mm : 0) +
        (be.right ? part.width_mm : 0);

      // Determine finished part count based on lamination type
      // Edge banding goes on FINISHED parts, not individual pieces
      let finishedPartCount: number;
      switch (laminationType) {
        case 'same-board':
          // 2 pieces become 1 finished part
          finishedPartCount = Math.floor(part.quantity / 2);
          break;
        case 'with-backer':
        case 'none':
        case 'custom':
        default:
          // Each piece/entry is a finished part
          finishedPartCount = part.quantity;
          break;
      }

      const totalEdge = singlePartEdge * finishedPartCount;

      // Assign to correct thickness based on lamination
      if (laminationType === 'none') {
        edging16mm += totalEdge;
      } else {
        edging32mm += totalEdge;
      }
    }

    // Process grouped parts - parts with same lamination_group are laminated together
    for (const [, groupParts] of laminationGroups) {
      if (groupParts.length === 0) continue;

      const memberCount = groupParts.length;
      const edgeThickness = 16 * memberCount; // 32mm for 2 parts, 48mm for 3, etc.

      // Use dimensions from first part (all parts in group should have same dimensions)
      const refPart = groupParts[0];
      if (refPart.length_mm <= 0 || refPart.width_mm <= 0) continue;

      // Merge band_edges from all parts in group (union of edges)
      const mergedEdges = { top: false, right: false, bottom: false, left: false };
      for (const p of groupParts) {
        if (p.band_edges.top) mergedEdges.top = true;
        if (p.band_edges.right) mergedEdges.right = true;
        if (p.band_edges.bottom) mergedEdges.bottom = true;
        if (p.band_edges.left) mergedEdges.left = true;
      }

      // Calculate edge length for one assembly
      const singleAssemblyEdge =
        (mergedEdges.top ? refPart.length_mm : 0) +
        (mergedEdges.bottom ? refPart.length_mm : 0) +
        (mergedEdges.left ? refPart.width_mm : 0) +
        (mergedEdges.right ? refPart.width_mm : 0);

      // Number of finished assemblies = minimum quantity across group parts
      const assemblies = Math.min(...groupParts.map((p) => p.quantity));
      const totalEdge = singleAssemblyEdge * assemblies;

      // Assign to correct thickness bucket
      if (memberCount === 1) {
        // Single part in group = treat as ungrouped (16mm)
        edging16mm += totalEdge;
      } else if (edgeThickness === 32) {
        edging32mm += totalEdge;
      } else {
        // Custom thickness (48mm, 64mm, etc.)
        customEdging.set(edgeThickness, (customEdging.get(edgeThickness) || 0) + totalEdge);
      }
    }

    // Override the packing result's edging values with our corrected calculation
    if (res.stats) {
      res.stats.edgebanding_16mm_mm = edging16mm;
      res.stats.edgebanding_32mm_mm = edging32mm;
    }

    setResult(res);
    setSheetOverrides({});
    setGlobalFullBoard(false);

    // Pack backer parts - ONLY for 'with-backer' lamination (NOT same-board)
    // Same-board uses the SAME primary material, with-backer uses a separate backer material
    const backerParts: PartSpec[] = partSpecs
      .filter((p) => p.lamination_type === 'with-backer')
      .map((p) => ({ ...p, grain: 'any', require_grain: undefined, band_edges: undefined } as PartSpec));

    if (backerParts.length > 0) {
      const resBacker = packPartsSmartOptimized(backerParts, normalized, { allowRotation: true, singleSheetOnly, algorithm });
      setBackerResult(resBacker);
    } else {
      setBackerResult(null);
    }

    setActiveTab('preview');
  }, [stock, kerf, allowRotation, singleSheetOnly, optimizationPriority]);

  // Handle pending calculation after quick-add activation
  React.useEffect(() => {
    if (pendingCalculateRef.current && parts.length > 0) {
      pendingCalculateRef.current = false;
      runCalculation(parts);
    }
  }, [parts, runCalculation]);

  const handleCalculate = () => {
    // If there's pending quick-add data, activate it first
    if (hasQuickAddPending) {
      pendingCalculateRef.current = true;
      partsTableRef.current?.activateQuickAdd();
      return;
    }

    // Otherwise calculate directly
    runCalculation(parts);
  };

  const handleCSVImport = (importedParts: CutlistPart[]) => {
    const defaultMaterialId = primaryBoards[0]?.id;
    const newParts: CompactPart[] = importedParts.map((p) => ({
      ...p,
      material_id: defaultMaterialId,
      lamination_type: 'none' as const,
    }));
    setParts((prev) => [...prev, ...newParts]);
  };

  const handleClearAll = () => {
    setParts([]);
    setResult(null);
    setBackerResult(null);
    setSheetOverrides({});
    setGlobalFullBoard(false);
    setSummary(null);
  };

  // ============== Save/Load Handlers ==============

  const gatherProjectData = React.useCallback((): SavedCutlistData => ({
    parts,
    primaryBoards,
    backerBoards,
    edging,
    kerf,
    optimizationPriority,
  }), [parts, primaryBoards, backerBoards, edging, kerf, optimizationPriority]);

  const handleSaveProject = React.useCallback(
    async (name: string, folderId: string | null) => {
      setIsSaving(true);
      try {
        const data = gatherProjectData();
        if (currentProjectId) {
          const success = await updateProject(currentProjectId, { name, folderId, data });
          if (success) {
            setCurrentProjectName(name);
            setCurrentFolderId(folderId);
            toast.success(`Saved "${name}"`);
          } else {
            toast.error('Failed to save cutlist');
          }
        } else {
          const project = await saveProject(name, data, folderId);
          if (project) {
            setCurrentProjectId(project.id);
            setCurrentProjectName(name);
            setCurrentFolderId(folderId);
            toast.success(`Saved "${name}"`);
          } else {
            toast.error('Failed to save cutlist');
          }
        }
      } finally {
        setIsSaving(false);
      }
    },
    [currentProjectId, gatherProjectData, saveProject, updateProject]
  );

  const handleQuickSave = React.useCallback(async () => {
    if (!currentProjectId || !currentProjectName) {
      setSaveDialogOpen(true);
      return;
    }
    setIsSaving(true);
    try {
      const data = gatherProjectData();
      const success = await updateProject(currentProjectId, { data });
      if (success) {
        toast.success(`Saved "${currentProjectName}"`);
      } else {
        toast.error('Failed to save cutlist');
      }
    } finally {
      setIsSaving(false);
    }
  }, [currentProjectId, currentProjectName, gatherProjectData, updateProject]);

  const handleLoadProject = React.useCallback((project: SavedCutlistProject) => {
    const d = project.data;
    if (d.parts) setParts(d.parts);
    if (d.primaryBoards) setPrimaryBoards(d.primaryBoards);
    if (d.backerBoards) setBackerBoards(d.backerBoards);
    if (d.edging) setEdging(d.edging);
    if (d.kerf !== undefined) setKerf(d.kerf);
    if (d.optimizationPriority) setOptimizationPriority(d.optimizationPriority);
    setResult(null);
    setBackerResult(null);
    setSheetOverrides({});
    setGlobalFullBoard(false);
    setSummary(null);
    setCurrentProjectId(project.id);
    setCurrentProjectName(project.name);
    setCurrentFolderId(project.folder_id);
    setLoadDialogOpen(false);
    toast.success(`Loaded "${project.name}"`);
  }, []);

  const handleNewProject = React.useCallback(() => {
    handleClearAll();
    setCurrentProjectId(null);
    setCurrentProjectName(null);
    setCurrentFolderId(null);
  }, [handleClearAll]);

  // ============== Render ==============

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-foreground">Cutlist Calculator</h1>
              {currentProjectName && (
                <Badge variant="secondary" className="text-sm font-normal">
                  {currentProjectName}
                </Badge>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
              Run quick board calculations. Enter parts in the compact table, configure materials, and preview optimized
              sheet layouts.
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNewProject}
              className="gap-1.5"
              title="New cutlist"
            >
              <FilePlus className="h-4 w-4" />
              New
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLoadDialogOpen(true)}
              className="gap-1.5"
              title="Open saved cutlist"
            >
              <FolderOpen className="h-4 w-4" />
              Open
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleQuickSave}
              disabled={isSaving || parts.length === 0}
              className="gap-1.5"
              title={currentProjectId ? `Save "${currentProjectName}"` : 'Save cutlist'}
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSaveDialogOpen(true)}
              disabled={parts.length === 0}
              className="gap-1.5"
              title="Save as new cutlist"
            >
              <SaveAll className="h-4 w-4" />
              Save As
            </Button>
          </div>
        </div>
      </div>

      <Card className="relative">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Layout & Inputs</CardTitle>
              <CardDescription>
                Configure materials, add parts, and preview optimized sheet layouts. Material settings are saved
                automatically.
              </CardDescription>
            </div>
            <div className="flex gap-2 self-end lg:self-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                Clear All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => setSnapshotOpen(true)}
                title="Show usage snapshot"
              >
                <BarChart3 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => setTipsOpen(true)}
                title="Show material tips"
              >
                <Info className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="grid grid-cols-3 w-full max-w-md">
              <TabsTrigger value="materials">Materials</TabsTrigger>
              <TabsTrigger value="parts">Parts</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>

            {/* Materials Tab */}
            <TabsContent value="materials" className="space-y-4">
              <MaterialsPanel
                primaryBoards={primaryBoards}
                backerBoards={backerBoards}
                edging={edging}
                kerf={kerf}
                onPrimaryBoardsChange={setPrimaryBoards}
                onBackerBoardsChange={setBackerBoards}
                onEdgingChange={setEdging}
                onKerfChange={setKerf}
                onAddPrimaryBoard={handleAddPrimaryBoard}
                onAddBackerBoard={handleAddBackerBoard}
                onAddEdging={handleAddEdging}
              />
            </TabsContent>

            {/* Parts Tab */}
            <TabsContent value="parts" className="space-y-4">
              {/* CSV Import & Calculate Row */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CSVDropzone onPartsImported={handleCSVImport} collapsible buttonLabel="Import CSV" />
                <div className="flex items-center gap-3">
                  {/* Optimization Priority Selector */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Optimization:</span>
                    <Select
                      value={optimizationPriority}
                      onValueChange={(v) => setOptimizationPriority(v as OptimizationPriority)}
                    >
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fast">Fast / fewer cuts</SelectItem>
                        <SelectItem value="offcut">Best offcut</SelectItem>
                      </SelectContent>
                    </Select>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                          <p className="font-medium">Fast / fewer cuts:</p>
                          <p className="text-muted-foreground mb-2">Runs quickly and minimizes the number of saw cuts (strip-based).</p>
                          <p className="font-medium">Best offcut:</p>
                          <p className="text-muted-foreground">Trades extra computation for a larger contiguous offcut (guillotine packer).</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Button
                    type="button"
                    onClick={handleCalculate}
                    disabled={parts.length === 0 && !hasQuickAddPending}
                    className="gap-1.5"
                  >
                    <Calculator className="h-4 w-4" />
                    Calculate Layout
                  </Button>
                </div>
              </div>

              {/* No materials warning */}
              {primaryBoards.length === 0 && (
                <Alert>
                  <AlertTitle>No materials configured</AlertTitle>
                  <AlertDescription>
                    Go to the Materials tab to add primary boards before adding parts.
                  </AlertDescription>
                </Alert>
              )}

              {/* Compact Parts Table */}
              {primaryBoards.length > 0 && (
                <CompactPartsTable
                  ref={partsTableRef}
                  parts={parts}
                  onPartsChange={setParts}
                  materialOptions={materialOptions}
                  onOpenCustomLamination={handleOpenCustomLamination}
                  onQuickAddPending={setHasQuickAddPending}
                />
              )}

              {/* Parts count summary */}
              {parts.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  {parts.length} part{parts.length !== 1 ? 's' : ''},{' '}
                  {parts.reduce((sum, p) => sum + (p.quantity || 0), 0)} total pieces
                </div>
              )}
            </TabsContent>

            {/* Preview Tab */}
            <TabsContent value="preview" className="space-y-4">
              {!result ? (
                <div className="text-muted-foreground py-8 text-center">
                  No results yet. Add parts and click Calculate Layout.
                </div>
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

                  {/* Optimization selector with recalculate */}
                  <div className="flex items-center gap-3 py-2">
                    <span className="text-sm text-muted-foreground">Optimization:</span>
                    <Select
                      value={optimizationPriority}
                      onValueChange={(v) => setOptimizationPriority(v as OptimizationPriority)}
                    >
                      <SelectTrigger className="w-[180px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fast">Fast / fewer cuts</SelectItem>
                        <SelectItem value="offcut">Best offcut</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCalculate}
                      className="h-8"
                    >
                      <Calculator className="h-4 w-4 mr-1" />
                      Recalculate
                    </Button>
                  </div>

                  {/* Unplaced parts alert */}
                  {result.unplaced && result.unplaced.length > 0 && (
                    <Alert className="border-amber-400/70 bg-amber-50 dark:bg-amber-950/30">
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
          </Tabs>
        </CardContent>
      </Card>

      {/* Custom Lamination Modal */}
      <CustomLaminationModal
        open={showCustomLamModal}
        onOpenChange={setShowCustomLamModal}
        primaryBoards={primaryBoardOptions}
        backerBoards={backerBoardOptions}
        initialConfig={customLamConfig}
        onConfirm={handleCustomLaminationConfirm}
      />

      {/* Component Picker Dialog */}
      <ComponentPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        categoryIds={getPickerCategoryIds()}
        title={getPickerTitle()}
        description={getPickerDescription()}
        onSelect={handleComponentSelected}
      />

      {/* Snapshot Dialog */}
      <Dialog open={snapshotOpen} onOpenChange={setSnapshotOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Usage Snapshot</DialogTitle>
            <DialogDescription>Latest layout totals at a glance.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {summary ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={summary.laminationOn ? 'default' : 'outline'}>
                    {summary.laminationOn ? 'Lamination On' : 'No Lamination'}
                  </Badge>
                  <Badge variant="secondary">{formatSheets(summary.primarySheetsBillable)} billable sheets</Badge>
                  {summary.materials && summary.materials.length > 0 && (
                    <Badge variant="outline">
                      {formatCurrency(summary.materials.reduce((sum, mat) => sum + mat.totalCost, 0))} total
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SummaryStat label="Primary sheets (used)" value={`${formatSheets(summary.primarySheetsUsed)} sheets`} />
                  <SummaryStat
                    label="Primary sheets (billable)"
                    value={`${formatSheets(summary.primarySheetsBillable)} sheets`}
                  />
                  {summary.laminationOn && (
                    <SummaryStat
                      label="Backer sheets (billable)"
                      value={`${formatSheets(summary.backerSheetsBillable)} sheets`}
                    />
                  )}
                  <SummaryStat label="Edgebanding 16mm" value={formatMeters(summary.edgebanding16mm / 1000)} />
                  <SummaryStat label="Edgebanding 32mm" value={formatMeters(summary.edgebanding32mm / 1000)} />
                </div>
                {summary.materials && summary.materials.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Materials</div>
                    <div className="space-y-2">
                      {summary.materials.map((mat) => (
                        <div key={mat.materialId} className="rounded-md border p-3 space-y-2">
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <div className="font-medium text-foreground">{mat.materialName}</div>
                            <div className="text-sm font-semibold text-foreground">{formatCurrency(mat.totalCost)}</div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>
                              Sheets billable:{' '}
                              <span className="text-foreground font-medium">{formatSheets(mat.sheetsBillable)}</span>
                            </div>
                            <div>
                              Sheet cost: <span className="text-foreground font-medium">{formatCurrency(mat.sheetCost)}</span>
                            </div>
                            <div>
                              Backer cost:{' '}
                              <span className="text-foreground font-medium">{formatCurrency(mat.backerCost)}</span>
                            </div>
                            <div>
                              Banding 16mm:{' '}
                              <span className="text-foreground font-medium">{formatMeters(mat.edgebanding16mm / 1000)}</span>
                            </div>
                            <div>
                              16mm cost:{' '}
                              <span className="text-foreground font-medium">{formatCurrency(mat.band16Cost)}</span>
                            </div>
                            <div>
                              Banding 32mm:{' '}
                              <span className="text-foreground font-medium">{formatMeters(mat.edgebanding32mm / 1000)}</span>
                            </div>
                            <div>
                              32mm cost:{' '}
                              <span className="text-foreground font-medium">{formatCurrency(mat.band32Cost)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Calculate a layout to see board usage, lamination requirements, and total banding lengths here.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Tips Dialog */}
      <Dialog open={tipsOpen} onOpenChange={setTipsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Material tips</DialogTitle>
            <DialogDescription>
              Material settings are saved automatically, so your boards and edging are ready next time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>
              <strong>Materials tab:</strong> Configure your primary boards, backer boards, and edging materials. The
              default board for each section is used for new parts and calculations.
            </p>
            <p>
              <strong>Parts tab:</strong> Use the compact table to enter parts quickly. Each row shows ID, material,
              dimensions, quantity, lamination type, and edge banding. Click the edge indicator to configure which edges
              get banding.
            </p>
            <p>
              <strong>Lamination:</strong> Select &quot;With Backer&quot; for standard 32mm lamination (primary + backer), or
              &quot;Same Board&quot; for 2x primary. For thicker panels (48mm+), select &quot;Custom...&quot; to configure multiple layers.
            </p>
            <p>
              <strong>CSV Import:</strong> Import parts from SketchUp or other tools using the CSV import button. Parts
              will be assigned the default material automatically.
            </p>

            {/* Keyboard Shortcuts */}
            <div className="pt-3 border-t">
              <p className="font-semibold text-foreground mb-3">Keyboard shortcuts</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span>Next field</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Tab</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Next row / Add part</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Enter</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Cycle grain direction</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Space</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Open dropdown</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Space / ↓</kbd>
                </div>
                <div className="col-span-2 mt-2 pt-2 border-t border-dashed">
                  <span className="font-medium text-foreground">Edge banding (when focused):</span>
                </div>
                <div className="flex justify-between">
                  <span>Toggle top edge</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">↑</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Toggle bottom edge</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">↓</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Toggle left edge</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">←</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Toggle right edge</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">→</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Toggle all edges</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">A</kbd>
                </div>
                <div className="flex justify-between">
                  <span>Open edge popover</span>
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">Space</kbd>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save/Load Dialogs */}
      <SaveCutlistDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        currentName={currentProjectName ?? undefined}
        currentFolderId={currentFolderId}
        folders={folders}
        onSave={handleSaveProject}
        onCreateFolder={createFolder}
        saving={isSaving}
      />
      <LoadCutlistDialog
        open={loadDialogOpen}
        onOpenChange={setLoadDialogOpen}
        folders={folders}
        projects={projects}
        onLoad={handleLoadProject}
        onDeleteProject={deleteProject}
        onRenameProject={async (id, name) => {
          const success = await updateProject(id, { name });
          return success;
        }}
        onMoveProject={async (id, folderId) => {
          const success = await updateProject(id, { folderId });
          return success;
        }}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
      />
    </div>
  );
}

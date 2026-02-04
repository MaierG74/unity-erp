'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

// Import the reusable calculator component
import { CutlistCalculator, type CutlistCalculatorHandle } from '@/components/features/cutlist/CutlistCalculator';
import type { CutlistCalculatorData, CutlistSummary } from '@/components/features/cutlist/CutlistCalculator';

// Import the V2 adapter for quote persistence
import { useQuoteCutlistAdapterV2 } from '@/components/features/cutlist/adapters';
import type { QuoteCutlistLayoutV2 } from '@/components/features/cutlist/adapters';

// Import export function
import { exportCutlistToQuote } from '@/components/features/cutlist/export';
import type { CutlistLineRefs, CutlistLineInput } from '@/lib/cutlist/types';

// Import supabase for fetching quote item details
import { supabase } from '@/lib/supabase';

// =============================================================================
// Main Page Component
// =============================================================================

export default function QuoteCutlistPage() {
  const params = useParams();
  const router = useRouter();
  const quoteId = params.id as string;
  const itemId = params.itemId as string;

  // ============== State ==============
  const [itemDescription, setItemDescription] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isExporting, setIsExporting] = React.useState(false);
  const [lineRefs, setLineRefs] = React.useState<CutlistLineRefs>({});
  const [summary, setSummary] = React.useState<CutlistSummary | null>(null);
  const [initialData, setInitialData] = React.useState<Partial<CutlistCalculatorData> | undefined>(undefined);
  const [calculatorKey, setCalculatorKey] = React.useState(0);
  const [isDirty, setIsDirty] = React.useState(false);
  const [showExportDialog, setShowExportDialog] = React.useState(false);
  const [pendingExport, setPendingExport] = React.useState<null | { mode: 'replace' | 'append' }>(null);

  const adapter = useQuoteCutlistAdapterV2(itemId);
  const adapterRef = React.useRef(adapter);
  const calculatorDataRef = React.useRef<CutlistCalculatorData | null>(null);
  const calculatorRef = React.useRef<CutlistCalculatorHandle | null>(null);
  const suppressNextDirtyRef = React.useRef(true);
  const latestSummaryRef = React.useRef<CutlistSummary | null>(null);
  const lineRefsRef = React.useRef<CutlistLineRefs>({});
  const pendingExportRef = React.useRef<null | { mode: 'replace' | 'append' }>(null);
  const runExportRef = React.useRef<(mode: 'replace' | 'append', summaryOverride?: CutlistSummary | null) => void>(() => {});

  React.useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  React.useEffect(() => {
    lineRefsRef.current = lineRefs;
  }, [lineRefs]);

  // ============== Load saved cutlist + quote item description ==============

  React.useEffect(() => {
    if (!itemId || !quoteId) return;

    const loadData = async () => {
      setIsLoading(true);
      try {
        // Load quote item description
        const { data: itemData } = await supabase
          .from('quote_items')
          .select('description')
          .eq('id', itemId)
          .single();
        if (itemData?.description) {
          setItemDescription(itemData.description);
        }

        // Load saved cutlist data
        const savedLayout = await adapter.load();
        if (savedLayout) {
          setInitialData({
            parts: savedLayout.parts,
            primaryBoards: savedLayout.primaryBoards,
            backerBoards: savedLayout.backerBoards,
            edging: savedLayout.edging,
            kerf: savedLayout.kerf,
            optimizationPriority: savedLayout.optimizationPriority,
            sheetOverrides: savedLayout.sheetOverrides,
            globalFullBoard: savedLayout.globalFullBoard,
            backerSheetOverrides: savedLayout.backerSheetOverrides,
            backerGlobalFullBoard: savedLayout.backerGlobalFullBoard,
          });
          if (savedLayout.lineRefs) {
            setLineRefs(savedLayout.lineRefs);
          }
        }
        // If no saved data, initialData stays undefined and CutlistCalculator
        // will load pinned material defaults
      } catch (err) {
        console.warn('Failed to load quote cutlist data', err);
      } finally {
        setIsLoading(false);
        setCalculatorKey((k) => k + 1);
        suppressNextDirtyRef.current = true;
      }
    };

    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, quoteId]);

  // ============== Auto-save on data changes ==============

  const handleDataChange = React.useCallback((data: CutlistCalculatorData) => {
    calculatorDataRef.current = data;
    adapterRef.current.debouncedSave(data, lineRefsRef.current);
    if (suppressNextDirtyRef.current) {
      suppressNextDirtyRef.current = false;
      return;
    }
    setIsDirty(true);
  }, []);

  // ============== Export to Quote ==============

  const runExport = React.useCallback(async (mode: 'replace' | 'append', summaryOverride?: CutlistSummary | null) => {
    const summaryToUse = summaryOverride ?? latestSummaryRef.current;
    if (!summaryToUse || !itemId) return;

    const data = calculatorDataRef.current;
    if (!data) return;

    setIsExporting(true);
    try {
      // Get default materials for export
      const defaultPrimary = data.primaryBoards.find((b) => b.isDefault) || data.primaryBoards[0];
      const defaultBacker = data.backerBoards.find((b) => b.isDefault) || data.backerBoards[0];

      // Build export lines
      const primaryLines: Record<string, CutlistLineInput> = {};
      if (summaryToUse.materials && summaryToUse.materials.length > 0) {
        for (const mat of summaryToUse.materials) {
          if (mat.sheetsBillable <= 0.0001) continue;
          const board = data.primaryBoards.find((b) => b.id === mat.materialId);
          if (!board) continue;
          const slot = `primary_${mat.materialId}`;
          primaryLines[slot] = {
            description: board.name,
            qty: mat.sheetsBillable,
            unit_cost: board.cost,
            component_id: board.component_id,
          };
        }
      }

      const hasPerMaterialPrimary = Object.keys(primaryLines).length > 0;
      const primaryLine: CutlistLineInput | null = !hasPerMaterialPrimary && summaryToUse.primarySheetsBillable > 0.0001 && defaultPrimary
        ? {
            description: defaultPrimary.name,
            qty: summaryToUse.primarySheetsBillable,
            unit_cost: defaultPrimary.cost,
            component_id: defaultPrimary.component_id,
          }
        : null;

      const backerLine: CutlistLineInput | null =
        summaryToUse.backerResult && summaryToUse.backerSheetsBillable > 0.0001 && summaryToUse.laminationOn && defaultBacker
          ? {
              description: defaultBacker.name,
              qty: summaryToUse.backerSheetsBillable,
              unit_cost: defaultBacker.cost,
              component_id: defaultBacker.component_id,
            }
          : null;

      // Build per-material edging lines (replaces fixed band16/band32)
      const edgingLines: Record<string, CutlistLineInput> = {};
      if (summaryToUse.edgingByMaterial) {
        for (const entry of summaryToUse.edgingByMaterial) {
          const slot = `edging_${entry.materialId}`;
          edgingLines[slot] = {
            description: `${entry.name} (${entry.thickness_mm}mm edging)`,
            qty: entry.length_mm / 1000, // mm to meters
            unit_cost: entry.cost_per_meter,
            component_id: entry.component_id,
          };
        }
      }

      // Fallback: if no per-material breakdown, use legacy band16/band32
      const edging16 = data.edging.find((e) => e.thickness_mm === 16 && e.isDefaultForThickness);
      const edging32 = data.edging.find((e) => e.thickness_mm === 32 && e.isDefaultForThickness);
      const hasPerMaterialEdging = Object.keys(edgingLines).length > 0;
      const band16Line: CutlistLineInput | null =
        !hasPerMaterialEdging && summaryToUse.edgebanding16mm > 0.0001
          ? {
              description: edging16?.name ?? '16mm Edge Banding',
              qty: summaryToUse.edgebanding16mm / 1000,
              unit_cost: edging16?.cost_per_meter ?? 0,
              component_id: edging16?.component_id,
            }
          : null;
      const band32Line: CutlistLineInput | null =
        !hasPerMaterialEdging && summaryToUse.edgebanding32mm > 0.0001
          ? {
              description: edging32?.name ?? '32mm Edge Banding',
              qty: summaryToUse.edgebanding32mm / 1000,
              unit_cost: edging32?.cost_per_meter ?? 0,
              component_id: edging32?.component_id,
            }
          : null;

      const updatedRefs = await exportCutlistToQuote({
        quoteItemId: itemId,
        existingLineRefs: lineRefsRef.current,
        mode,
        primaryLine,
        backerLine,
        band16Line,
        band32Line,
        edgingLines: Object.keys(edgingLines).length > 0 ? edgingLines : undefined,
        extraLines: hasPerMaterialPrimary ? primaryLines : undefined,
      });

      lineRefsRef.current = updatedRefs;
      setLineRefs(updatedRefs);

      // Save updated line refs alongside the cutlist data
      if (data) {
        adapterRef.current.save(data, updatedRefs);
      }

      toast.success('Exported to quote', {
        action: {
          label: 'Return to Quote',
          onClick: () => router.push(`/quotes/${quoteId}?tab=items&item=${itemId}&expand=1`),
        },
      });
    } catch (err) {
      console.error('Cutlist export failed:', err);
      toast.error('Failed to export cutlist to quote');
    } finally {
      setIsExporting(false);
    }
  }, [itemId, quoteId, router]);

  React.useEffect(() => {
    runExportRef.current = runExport;
  }, [runExport]);

  const handleSummaryChange = React.useCallback((newSummary: CutlistSummary | null) => {
    latestSummaryRef.current = newSummary;
    setSummary(newSummary);
    if (newSummary) {
      setIsDirty(false);
      if (pendingExportRef.current) {
        const { mode } = pendingExportRef.current;
        pendingExportRef.current = null;
        setPendingExport(null);
        runExportRef.current(mode, newSummary);
      }
    } else if (pendingExportRef.current) {
      pendingExportRef.current = null;
      setPendingExport(null);
    }
  }, []);

  const handleExportClick = () => {
    if (!summary || !itemId) return;
    const hasExisting = Object.values(lineRefs).some(Boolean);
    if (isDirty || hasExisting) {
      setShowExportDialog(true);
      return;
    }
    runExport('replace');
  };

  const handleConfirmExport = (mode: 'replace' | 'append', recalcFirst: boolean) => {
    setShowExportDialog(false);
    if (recalcFirst) {
      pendingExportRef.current = { mode };
      setPendingExport({ mode });
      calculatorRef.current?.calculate();
      return;
    }
    runExportRef.current(mode);
  };

  const canExport = !!summary && !!itemId;
  const hasExistingCutlist = Object.values(lineRefs).some(Boolean);

  // ============== Render ==============

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link
          href={`/quotes/${quoteId}?tab=items&item=${itemId}&expand=1`}
          className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Quote
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-foreground">Cutlist Calculator</h1>
            {itemDescription && (
              <p className="mt-1 text-sm text-muted-foreground">
                Line item: <span className="font-medium text-foreground">{itemDescription}</span>
              </p>
            )}
          </div>
          <Button
            onClick={handleExportClick}
            disabled={!canExport || isExporting}
            className="gap-1.5 shrink-0"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {isExporting ? 'Exporting...' : 'Export to Quote'}
          </Button>
        </div>
      </div>

      {/* Calculator */}
      <CutlistCalculator
        ref={calculatorRef}
        key={calculatorKey}
        initialData={initialData}
        onDataChange={handleDataChange}
        onSummaryChange={handleSummaryChange}
        loadMaterialDefaults={true}
        saveMaterialDefaults={false}
        partsStorageKey={null}
        optimizationStorageKey={null}
      />

      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Export cutlist to quote?</DialogTitle>
            <DialogDescription>
              {isDirty
                ? 'You have changes since the last calculation. Recalculate before exporting so totals match.'
                : 'This will update the costing lines created by the cutlist.'}
              {hasExistingCutlist && (
                <>
                  {' '}
                  Choosing replace will remove prior cutlist lines for this item. Manual costing lines added outside the cutlist are not changed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            {isDirty ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleConfirmExport('append', true)}
                >
                  Recalculate & Keep Existing
                </Button>
                <Button onClick={() => handleConfirmExport('replace', true)}>
                  Recalculate & Replace
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleConfirmExport('append', false)}
                >
                  Keep Existing
                </Button>
                <Button onClick={() => handleConfirmExport('replace', false)}>
                  Replace Existing
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

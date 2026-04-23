'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';
import type { CutlistCalculatorData } from '@/components/features/cutlist/CutlistCalculator';
import { useProductCutlistBuilderAdapter } from '@/components/features/cutlist/adapters';
import type { CutlistSummary } from '@/lib/cutlist/types';
import {
  buildSnapshotFromCalculator,
  computePartsHash,
  type CutlistCostingSnapshot,
  type RestoredCutlistCostingSnapshot,
} from '@/lib/cutlist/costingSnapshot';
import { decideSnapshotSave } from '@/lib/cutlist/snapshot-freshness';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { MODULE_KEYS } from '@/lib/modules/keys';

// Dynamic import to avoid SSR issues
const CutlistCalculator = dynamic(
  () =>
    import('@/components/features/cutlist/CutlistCalculator').then((mod) => ({
      default: mod.CutlistCalculator,
    })),
  { ssr: false }
);

interface CutlistBuilderPageProps {
  params: Promise<{
    productId: string;
  }>;
}

interface ProductCutlistSnapshotResponse {
  snapshot: {
    snapshot_data: CutlistCostingSnapshot;
    parts_hash: string | null;
  } | null;
}

async function loadProductCostingSnapshot(
  productId: number
): Promise<RestoredCutlistCostingSnapshot | null> {
  const res = await authorizedFetch(
    `/api/products/${productId}/cutlist-costing-snapshot?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
  );
  if (!res.ok) return null;

  const json = (await res.json()) as ProductCutlistSnapshotResponse;
  if (!json.snapshot?.snapshot_data) return null;

  return {
    ...json.snapshot.snapshot_data,
    parts_hash: json.snapshot.parts_hash ?? undefined,
  };
}

export default function CutlistBuilderPage({ params }: CutlistBuilderPageProps) {
  const { productId: productIdParam } = use(params);
  const productId = parseInt(productIdParam, 10);
  const router = useRouter();

  const [initialData, setInitialData] = useState<
    Partial<CutlistCalculatorData> | undefined
  >(undefined);
  const [savedSnapshot, setSavedSnapshot] = useState<RestoredCutlistCostingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calculatorKey, setCalculatorKey] = useState(0);
  const dataRef = useRef<CutlistCalculatorData | null>(null);
  const summaryRef = useRef<CutlistSummary | null>(null);
  const adapter = useProductCutlistBuilderAdapter(productId);

  // Load product cutlist groups on mount
  useEffect(() => {
    if (isNaN(productId)) return;

    let cancelled = false;

    async function loadGroups() {
      try {
        const loaded = await adapter.load();
        if (!cancelled && loaded) {
          setInitialData(loaded);
          setCalculatorKey((k) => k + 1);
        }

        // After loading parts, also load saved snapshot
        const snapshot = await loadProductCostingSnapshot(productId);
        if (!cancelled && snapshot) {
          setSavedSnapshot(snapshot);
        }
      } catch (err) {
        console.warn('[CutlistBuilder] Failed to load product groups:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadGroups();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const handleSummaryChange = useCallback((summary: CutlistSummary | null) => {
    summaryRef.current = summary;
  }, []);

  // Auto-save with 2s debounce on data change
  const handleDataChange = useCallback(
    (data: CutlistCalculatorData) => {
      dataRef.current = data;
      if (!data.parts.length) return;
      adapter.debouncedSave(data);
    },
    [adapter]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      adapter.cancelPendingSave();
    };
  }, [adapter]);

  const persistSnapshot = useCallback(async () => {
    const data = dataRef.current;
    const summary = summaryRef.current;
    if (!data || !summary?.result) return;

    // Gate: the snapshot must be saved with the hash of the parts that
    // produced the current layout, and those parts must still match what
    // the user sees. Otherwise we'd persist a stale layout under a fresh
    // hash, silently misleading the product costing tab.
    const currentPartsHash = computePartsHash(data.parts);
    const decision = decideSnapshotSave({
      resultPartsHash: summary.resultPartsHash,
      currentPartsHash,
    });
    if (!decision.canSave) {
      throw new Error(decision.reason);
    }

    const snapshot = buildSnapshotFromCalculator({
      result: summary.result,
      backerResult: summary.backerResult,
      parts: data.parts,
      primaryBoards: data.primaryBoards,
      backerBoards: data.backerBoards,
      edgingMaterials: data.edging,
      kerf: data.kerf,
      optimizationPriority: data.optimizationPriority,
      sheetOverrides: data.sheetOverrides,
      globalFullBoard: data.globalFullBoard,
      backerSheetOverrides: data.backerSheetOverrides,
      backerGlobalFullBoard: data.backerGlobalFullBoard,
      edgingByMaterial: summary.edgingByMaterial ?? [],
      edgingOverrides: data.edgingOverrides,
    });
    await adapter.saveSnapshot(snapshot, decision.partsHash, data.parts);
  }, [adapter]);

  const handleSave = useCallback(async () => {
    const data = dataRef.current;
    if (!data || !data.parts.length) return;

    setSaving(true);
    try {
      await adapter.save(data);
      // Snapshot save is best-effort here — the main intent of Save is to
      // persist parts. If the layout is stale (parts edited after calc),
      // skip the snapshot silently; the user can explicitly recalculate
      // and use Save to Costing to commit a fresh snapshot.
      const summary = summaryRef.current;
      if (summary?.result) {
        const decision = decideSnapshotSave({
          resultPartsHash: summary.resultPartsHash,
          currentPartsHash: computePartsHash(data.parts),
        });
        if (decision.canSave) {
          await persistSnapshot();
        }
      }
      toast.success('Cutlist saved to product');
    } catch {
      toast.error('Failed to save cutlist');
    } finally {
      setSaving(false);
    }
  }, [adapter, persistSnapshot]);

  const [savingToCosting, setSavingToCosting] = useState(false);

  const handleSaveToCosting = useCallback(async () => {
    const data = dataRef.current;
    if (!data || !summaryRef.current?.result) return;

    setSavingToCosting(true);
    try {
      // Flush any pending debouncedSave and force the groups write to
      // complete before the snapshot PUT. Without this the snapshot can
      // describe parts that differ from what product_cutlist_groups
      // currently holds, and the product-costing tab would read back
      // inconsistent data.
      adapter.cancelPendingSave();
      await adapter.save(data);
      await persistSnapshot();
      toast.success('Costing snapshot saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save costing snapshot';
      toast.error(message);
    } finally {
      setSavingToCosting(false);
    }
  }, [adapter, persistSnapshot]);

  if (isNaN(productId)) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Invalid product ID.</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col p-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b mb-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Cutlist Builder</h1>
            <p className="text-sm text-muted-foreground">
              Configure materials, optimize sheet layouts, and export cutting diagrams
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading cutlist...</p>
        ) : (
          <CutlistCalculator
            key={calculatorKey}
            initialData={initialData}
            savedSnapshot={savedSnapshot}
            onDataChange={handleDataChange}
            onSummaryChange={handleSummaryChange}
            onSaveToCosting={handleSaveToCosting}
            savingToCosting={savingToCosting}
            loadMaterialDefaults={true}
            saveMaterialDefaults={true}
          />
        )}
      </div>
    </div>
  );
}

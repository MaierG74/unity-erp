'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { MODULE_KEYS } from '@/lib/modules/keys';
import type { CutlistCalculatorData } from '@/components/features/cutlist/CutlistCalculator';
import {
  flattenGroupsToCompactParts,
  regroupPartsToApiGroups,
} from '@/lib/configurator/cutlistGroupConversion';

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

export default function CutlistBuilderPage({ params }: CutlistBuilderPageProps) {
  const { productId: productIdParam } = use(params);
  const productId = parseInt(productIdParam, 10);
  const router = useRouter();

  const [initialData, setInitialData] = useState<
    Partial<CutlistCalculatorData> | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calculatorKey, setCalculatorKey] = useState(0);
  const dataRef = useRef<CutlistCalculatorData | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load product cutlist groups on mount
  useEffect(() => {
    if (isNaN(productId)) return;

    let cancelled = false;

    async function loadGroups() {
      try {
        const res = await authorizedFetch(
          `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
        );
        if (!res.ok) throw new Error('Failed to load');
        const json = await res.json();
        const groups = json?.groups;

        if (!cancelled && groups && groups.length > 0) {
          const parts = flattenGroupsToCompactParts(groups);
          setInitialData({ parts });
          setCalculatorKey((k) => k + 1);
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

  // Auto-save with 2s debounce on data change
  const handleDataChange = useCallback(
    (data: CutlistCalculatorData) => {
      dataRef.current = data;

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        if (!data.parts.length) return;
        try {
          const groups = regroupPartsToApiGroups(data.parts);
          await authorizedFetch(
            `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ groups }),
            }
          );
        } catch {
          // Silent fail for auto-save — user can manually save
        }
      }, 2000);
    },
    [productId]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Manual save
  const handleSave = useCallback(async () => {
    const data = dataRef.current;
    if (!data || !data.parts.length) return;

    setSaving(true);
    try {
      const groups = regroupPartsToApiGroups(data.parts);
      const res = await authorizedFetch(
        `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groups }),
        }
      );
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Cutlist saved to product');
    } catch {
      toast.error('Failed to save cutlist');
    } finally {
      setSaving(false);
    }
  }, [productId]);

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
            onDataChange={handleDataChange}
            loadMaterialDefaults={true}
            saveMaterialDefaults={true}
          />
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { useOrderCuttingPlan } from '@/hooks/useOrderCuttingPlan';
import { useMaterialAssignments } from '@/hooks/useMaterialAssignments';
import { useBoardComponents, useBackerComponents } from '@/hooks/useBoardComponents';
import { regroupByAssignedMaterial } from '@/lib/orders/material-regroup';
import { packPartsSmartOptimized } from '@/components/features/cutlist/packing';
import type { StockSheetSpec, PartSpec, GrainOrientation } from '@/lib/cutlist/types';
import type {
  AggregateResponse,
  AggregatedPartGroup,
  CuttingPlan,
  CuttingPlanMaterialGroup,
  CuttingPlanOverride,
} from '@/lib/orders/cutting-plan-types';
import type { PartRole } from '@/lib/orders/material-assignment-types';

// TODO: resolve per-component stock in future
const DEFAULT_STOCK: StockSheetSpec = {
  id: 'S1',
  length_mm: 2750,
  width_mm: 1830,
  qty: 99,
  kerf_mm: 4,
};

function toGrain(grain: string): GrainOrientation {
  if (grain === 'length' || grain === 'along_length') return 'length';
  if (grain === 'width' || grain === 'along_width') return 'width';
  return 'any';
}

function toPartSpecs(group: AggregatedPartGroup): PartSpec[] {
  return group.parts.map((p) => ({
    id: p.id,
    length_mm: p.length_mm,
    width_mm: p.width_mm,
    qty: p.quantity,
    grain: toGrain(p.grain),
    band_edges: {
      top: p.band_edges?.top ?? false,
      bottom: p.band_edges?.bottom ?? false,
      left: p.band_edges?.left ?? false,
      right: p.band_edges?.right ?? false,
    },
    lamination_type: (p.lamination_type as PartSpec['lamination_type']) || 'none',
    lamination_config: p.lamination_config as PartSpec['lamination_config'],
    material_thickness: p.material_thickness,
    label: p.material_label,
  }));
}

export function useCuttingPlanBuilder(orderId: number) {
  const cuttingPlan = useOrderCuttingPlan(orderId);
  const materialAssignments = useMaterialAssignments(orderId);
  const boardComponents = useBoardComponents();
  const backerComponents = useBackerComponents();

  const [aggData, setAggData] = useState<AggregateResponse | null>(null);
  const [pendingPlan, setPendingPlan] = useState<CuttingPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [quality, setQuality] = useState<'fast' | 'balanced' | 'quality'>('fast');

  // Derive part roles from current aggregate + assignments
  const partRoles = useMemo<PartRole[]>(() => {
    if (!aggData) return [];
    return materialAssignments.buildPartRoles(aggData);
  }, [aggData, materialAssignments]);

  // canGenerate: all roles assigned AND backer resolved (if any -backer group exists)
  const canGenerate = useMemo<boolean>(() => {
    if (!aggData || partRoles.length === 0) return false;
    const allAssigned = materialAssignments.isComplete(partRoles);
    if (!allAssigned) return false;
    const needsBacker = aggData.material_groups.some((g) =>
      g.board_type.includes('-backer'),
    );
    if (needsBacker) {
      const hasBacker =
        materialAssignments.assignments.backer_default != null ||
        aggData.material_groups.some((g) => g.backer_material_id != null);
      if (!hasBacker) return false;
    }
    return true;
  }, [aggData, partRoles, materialAssignments]);

  // Load (or re-load) the aggregate from the API
  const loadAggregate = useCallback(async () => {
    try {
      const agg = await cuttingPlan.aggregate();
      setAggData(agg);
      return agg;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load aggregate';
      toast.error(message);
      return null;
    }
  }, [cuttingPlan]);

  // Generate: flush saves → re-fetch aggregate → regroup → pack → build plan
  const generate = useCallback(async () => {
    setIsGenerating(true);
    setPendingPlan(null);
    try {
      // 1. Flush any pending assignment saves
      await materialAssignments.flush();

      // 2. Re-fetch aggregate to get the latest snapshot
      const agg = await cuttingPlan.aggregate();
      setAggData(agg);

      if (!agg.has_cutlist_items) {
        toast.error('No cutlist items found on this order');
        return;
      }

      // 3. Re-group by assigned material
      const regrouped = regroupByAssignedMaterial(
        agg,
        materialAssignments.assignments,
      );
      if (!regrouped) {
        toast.error(
          'Some parts are missing material assignments. Assign all materials before generating.',
        );
        return;
      }

      const sheetArea = DEFAULT_STOCK.length_mm * DEFAULT_STOCK.width_mm;

      // 4. Pack all re-grouped material groups in parallel
      const packResults = await Promise.all(
        regrouped.map(async (group) => {
          const parts = toPartSpecs(group);
          const result = await packPartsSmartOptimized(parts, [DEFAULT_STOCK]);
          return { group, parts, result };
        }),
      );

      const materialGroups: CuttingPlanMaterialGroup[] = [];
      const overrides: CuttingPlanOverride[] = [];

      for (const { group, parts, result } of packResults) {
        const sheetsUsed = result.sheets.length;
        const totalArea = sheetArea * sheetsUsed;
        const usedArea = result.stats.used_area_mm2;
        const wastePercent =
          totalArea > 0 ? ((totalArea - usedArea) / totalArea) * 100 : 0;

        const bomEstimateArea = parts.reduce(
          (s, p) => s + p.length_mm * p.width_mm * p.qty,
          0,
        );
        const bomEstimateSheets = Math.ceil(bomEstimateArea / sheetArea);

        const hasBacker = group.board_type.includes('-backer');
        const backerSheetsRequired = hasBacker ? sheetsUsed : 0;
        const bomEstimateBackerSheets = hasBacker ? bomEstimateSheets : 0;

        materialGroups.push({
          board_type: group.board_type,
          primary_material_id: group.primary_material_id,
          primary_material_name: group.primary_material_name,
          backer_material_id: group.backer_material_id,
          backer_material_name: group.backer_material_name,
          sheets_required: sheetsUsed,
          backer_sheets_required: backerSheetsRequired,
          edging_by_material: [],
          total_parts: parts.reduce((s, p) => s + p.qty, 0),
          waste_percent: Math.round(wastePercent * 10) / 10,
          bom_estimate_sheets: bomEstimateSheets,
          bom_estimate_backer_sheets: bomEstimateBackerSheets,
          layouts: result.sheets,
          stock_sheet_spec: {
            length_mm: DEFAULT_STOCK.length_mm,
            width_mm: DEFAULT_STOCK.width_mm,
          },
        });

        // Build real overrides — primary (non-zero) and backer (non-zero only)
        if (group.primary_material_id != null && sheetsUsed > 0) {
          overrides.push({
            component_id: group.primary_material_id,
            quantity: sheetsUsed,
            unit: 'sheets',
            source: 'cutlist_primary',
          });
        }
        if (group.backer_material_id != null && backerSheetsRequired > 0) {
          overrides.push({
            component_id: group.backer_material_id,
            quantity: backerSheetsRequired,
            unit: 'sheets',
            source: 'cutlist_backer',
          });
        }
      }

      const newPlan: CuttingPlan = {
        version: 1,
        generated_at: new Date().toISOString(),
        optimization_quality: quality,
        stale: false,
        source_revision: agg.source_revision,
        material_groups: materialGroups,
        component_overrides: overrides,
      };

      setPendingPlan(newPlan);
      toast.success(
        `Cutting plan generated: ${materialGroups.reduce((s, g) => s + g.sheets_required, 0)} sheets across ${materialGroups.length} material group(s)`,
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate cutting plan';
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }, [cuttingPlan, materialAssignments, quality]);

  const confirmPlan = useCallback(async () => {
    if (!pendingPlan) return;
    try {
      await cuttingPlan.confirm(pendingPlan);
      setPendingPlan(null);
      toast.success('Cutting plan confirmed and saved');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to confirm cutting plan';
      toast.error(message);
    }
  }, [pendingPlan, cuttingPlan]);

  const clearPlan = useCallback(async () => {
    try {
      await cuttingPlan.clear();
      setPendingPlan(null);
      toast.success('Cutting plan cleared');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to clear cutting plan';
      toast.error(message);
    }
  }, [cuttingPlan]);

  const discardPending = useCallback(() => {
    setPendingPlan(null);
  }, []);

  return {
    // Saved plan from DB
    plan: cuttingPlan.plan,
    isPlanLoading: cuttingPlan.isLoading,
    isSaving: cuttingPlan.isSaving,

    // Pending (generated but not yet confirmed) plan
    pendingPlan,

    // Generate state
    isGenerating,
    quality,
    setQuality,

    // Aggregate data + loading state
    aggData,
    isAggLoading: materialAssignments.isLoading,

    // Material assignments
    materialAssignments,

    // Board component options (for assignment grid)
    boardComponents,
    backerComponents,

    // Derived
    partRoles,
    canGenerate,

    // Actions
    loadAggregate,
    generate,
    confirmPlan,
    clearPlan,
    discardPending,
  };
}

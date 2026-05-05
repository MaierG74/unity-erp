'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useOrderCuttingPlan } from '@/hooks/useOrderCuttingPlan';
import { useMaterialAssignments } from '@/hooks/useMaterialAssignments';
import { useBoardComponents, useBackerComponents, useEdgingComponents } from '@/hooks/useBoardComponents';
import { computeEdging } from '@/lib/orders/edging-computation';
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
import { buildPartRoles } from '@/lib/orders/material-assignment-types';
import { buildPartLabelMap } from '@/lib/cutlist/cutter-cut-list-helpers';
import type { PartRole } from '@/lib/orders/material-assignment-types';
import type { BackerLookupEntry } from '@/lib/orders/cutting-plan-aggregate';

// TODO: resolve per-component stock in future
const DEFAULT_STOCK: StockSheetSpec = {
  id: 'S1',
  length_mm: 2750,
  width_mm: 1830,
  qty: 99,
  kerf_mm: 4,
};
const BACKER_CATEGORY_IDS = [75, 3];
const BACKER_CATEGORY_SET = new Set(BACKER_CATEGORY_IDS);

function toastError(err: unknown, fallback: string) {
  toast.error(err instanceof Error ? err.message : fallback);
}

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

function buildBackerLookup(
  backers: Array<{ component_id: number; description: string; category_id: number; parsed_thickness_mm: number | null }> | undefined,
): Map<number, BackerLookupEntry> | null {
  if (!backers) return null;
  const lookup = new Map<number, BackerLookupEntry>();
  for (const backer of backers) {
    const parsed = backer.parsed_thickness_mm;
    if (!BACKER_CATEGORY_SET.has(backer.category_id) || parsed == null || parsed < 0.5 || parsed > 50) {
      continue;
    }
    lookup.set(backer.component_id, {
      thickness_mm: parsed,
      category_id: backer.category_id,
      component_name: backer.description,
    });
  }
  return lookup;
}

export function useCuttingPlanBuilder(orderId: number) {
  const cuttingPlan = useOrderCuttingPlan(orderId);
  const {
    assignments: matAssignments,
    flush: flushAssignments,
    assign,
    assignBulk,
    setBackerDefault,
    setEdgingDefault,
    setEdgingOverride,
    isLoading: isAssignmentsLoading,
  } = useMaterialAssignments(orderId);
  const boardComponents = useBoardComponents();
  const backerComponents = useBackerComponents();
  const edgingComponents = useEdgingComponents();

  const [aggData, setAggData] = useState<AggregateResponse | null>(null);
  const [pendingPlan, setPendingPlan] = useState<CuttingPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [quality, setQuality] = useState<'fast' | 'balanced' | 'quality'>('fast');

  // Keep a ref to the latest assignments so generate() can read post-flush
  // state instead of the closed-over value from the render that created the callback.
  const latestAssignmentsRef = useRef(matAssignments);
  latestAssignmentsRef.current = matAssignments;

  // Discard any pending (unconfirmed) plan when assignments change —
  // prevents confirming a plan built from stale assignment set A after
  // the user switches to set B.
  const prevAssignmentsRef = useRef(matAssignments);
  useEffect(() => {
    if (prevAssignmentsRef.current !== matAssignments) {
      prevAssignmentsRef.current = matAssignments;
      setPendingPlan(null);
    }
  }, [matAssignments]);

  // Derive part roles from current aggregate + assignments
  const partRoles = useMemo<PartRole[]>(
    () => buildPartRoles(aggData, matAssignments),
    [aggData, matAssignments],
  );
  const partLabelMap = useMemo(() => buildPartLabelMap(aggData), [aggData]);
  const isLabelMapReady = partLabelMap.size > 0;
  const allAssigned = partRoles.every((r) => r.assigned_component_id != null);

  // canGenerate: all roles assigned AND backer resolved (if any -backer group exists)
  const canGenerate = useMemo<boolean>(() => {
    if (!aggData || partRoles.length === 0) return false;
    if (boardComponents.data === undefined || backerComponents.data === undefined) return false;
    if (isAssignmentsLoading || backerComponents.isFetching || boardComponents.isFetching) return false;
    if (!allAssigned) return false;
    const needsBacker = aggData.material_groups.some((g) =>
      g.kind === 'primary' && g.parts.some((part) => part.source_board_type.endsWith('-backer')),
    );
    if (needsBacker) {
      const hasBacker =
        matAssignments.backer_default != null ||
        aggData.material_groups.some((g) => g.parts.some((part) => part.effective_backer_id != null));
      if (!hasBacker) return false;
    }
    // Check edging: every assigned board with edged parts needs an edging default
    // (unless all its edged parts have individual overrides)
    const boardIdsWithEdges = new Set<number>();
    for (const role of partRoles) {
      if (role.has_edges && role.assigned_component_id != null) {
        boardIdsWithEdges.add(role.assigned_component_id);
      }
    }
    for (const boardId of boardIdsWithEdges) {
      const hasEdgingDefault = (matAssignments.edging_defaults ?? []).some(
        (ed) => ed.board_component_id === boardId,
      );
      if (!hasEdgingDefault) {
        const allOverridden = partRoles
          .filter((r) => r.assigned_component_id === boardId && r.has_edges)
          .every((r) =>
            (matAssignments.edging_overrides ?? []).some(
              (eo) =>
                eo.board_type === r.board_type &&
                eo.part_name === r.part_name &&
                eo.length_mm === r.length_mm &&
                eo.width_mm === r.width_mm,
            ),
          );
        if (!allOverridden) return false;
      }
    }

    return true;
  }, [aggData, partRoles, allAssigned, matAssignments, boardComponents.data, boardComponents.isFetching, backerComponents.data, backerComponents.isFetching, isAssignmentsLoading]);

  // Load (or re-load) the aggregate from the API
  const loadAggregate = useCallback(async () => {
    try {
      const agg = await cuttingPlan.aggregate();
      setAggData(agg);
      return agg;
    } catch (err: unknown) {
      toastError(err, 'Failed to load aggregate');
      return null;
    }
  }, [cuttingPlan]);

  // Generate: flush saves → re-fetch aggregate → regroup → pack → build plan
  const generate = useCallback(async () => {
    setIsGenerating(true);
    setPendingPlan(null);
    try {
      // 1. Flush any pending assignment saves
      await flushAssignments();

      // 2. Re-fetch aggregate to get the latest snapshot
      const agg = await cuttingPlan.aggregate();
      setAggData(agg);

      if (!agg.has_cutlist_items) {
        toast.error('No cutlist items found on this order');
        return;
      }

      // 3. Re-group by assigned material (read from ref for post-flush freshness)
      const currentAssignments = latestAssignmentsRef.current;
      const currentBackerLookup = buildBackerLookup(backerComponents.data);
      if (!currentBackerLookup) {
        toast.error('Backer components are still loading. Try again in a moment.');
        return;
      }

      const referencedBackerIds = new Set<number>();
      for (const group of agg.material_groups) {
        for (const part of group.parts) {
          if (!part.source_board_type.endsWith('-backer')) continue;
          const id = currentAssignments.backer_default?.component_id ?? part.effective_backer_id ?? null;
          if (id != null) referencedBackerIds.add(id);
        }
      }
      for (const id of referencedBackerIds) {
        const row = backerComponents.data?.find((component) => component.component_id === id);
        if (!row) {
          toast.error('Backer component not found — reload the page or pick a different backer');
          return;
        }
        if (!currentBackerLookup.has(id)) {
          toast.error(`Backer description '${row.description}' is invalid — fix the description or pick a different backer`);
          return;
        }
      }

      const regrouped = regroupByAssignedMaterial(
        agg,
        currentAssignments,
        currentBackerLookup,
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

        materialGroups.push({
          kind: group.kind,
          sheet_thickness_mm: group.sheet_thickness_mm,
          material_id: group.material_id,
          material_name: group.material_name,
          sheets_required: sheetsUsed,
          edging_by_material: [],
          total_parts: parts.reduce((s, p) => s + p.qty, 0),
          waste_percent: Math.round(wastePercent * 10) / 10,
          bom_estimate_sheets: bomEstimateSheets,
          layouts: result.sheets,
          stock_sheet_spec: {
            length_mm: DEFAULT_STOCK.length_mm,
            width_mm: DEFAULT_STOCK.width_mm,
          },
        });

        // Build real overrides — primary (non-zero) and backer (non-zero only)
        if (sheetsUsed > 0) {
          overrides.push({
            component_id: group.material_id,
            quantity: sheetsUsed,
            unit: 'sheets',
            source: group.kind === 'backer' ? 'cutlist_backer' : 'cutlist_primary',
          });
        }
      }

      // 5. Compute edging from parts + edging assignments
      const edgingResult = computeEdging(regrouped, currentAssignments);
      if (!edgingResult) {
        toast.error('Some parts with edges are missing edging assignments');
        return;
      }

      // Apply per-group edging entries
      for (const mg of materialGroups) {
        const groupKey = `${mg.kind}|${mg.sheet_thickness_mm}|${mg.material_id}`;
        mg.edging_by_material = edgingResult.groupEdging.get(groupKey) ?? [];
      }

      // Add edging overrides to component_overrides
      overrides.push(...edgingResult.edgingOverrides);

      const newPlan: CuttingPlan = {
        version: 2,
        generated_at: new Date().toISOString(),
        optimization_quality: quality,
        stale: false,
        stale_reason: null,
        source_revision: agg.source_revision,
        material_groups: materialGroups,
        component_overrides: overrides,
        total_nested_cost: 0,
        line_allocations: [],
      };

      setPendingPlan(newPlan);
      toast.success(
        `Cutting plan generated: ${materialGroups.reduce((s, g) => s + g.sheets_required, 0)} sheets across ${materialGroups.length} material group(s)`,
      );
    } catch (err: unknown) {
      toastError(err, 'Failed to generate cutting plan');
    } finally {
      setIsGenerating(false);
    }
  }, [backerComponents.data, cuttingPlan, flushAssignments, quality]);

  const confirmPlan = useCallback(async () => {
    if (!pendingPlan) return;
    try {
      await cuttingPlan.confirm(pendingPlan);
      setPendingPlan(null);
      toast.success('Cutting plan confirmed and saved');
    } catch (err: unknown) {
      toastError(err, 'Failed to confirm cutting plan');
    }
  }, [pendingPlan, cuttingPlan]);

  const clearPlan = useCallback(async () => {
    try {
      await cuttingPlan.clear();
      setPendingPlan(null);
      toast.success('Cutting plan cleared');
    } catch (err: unknown) {
      toastError(err, 'Failed to clear cutting plan');
    }
  }, [cuttingPlan]);

  const discardPending = useCallback(() => {
    setPendingPlan(null);
  }, []);

  const displayPlan = pendingPlan || (cuttingPlan.planState.kind === 'current' ? cuttingPlan.planState.plan : null);
  const isPending = pendingPlan != null;

  return {
    // Plan state
    planState: cuttingPlan.planState,
    plan: cuttingPlan.plan,
    pendingPlan,
    displayPlan,
    isPending,
    isLoading: cuttingPlan.isLoading || isAssignmentsLoading,
    isSaving: cuttingPlan.isSaving,
    isGenerating,

    // Material assignments (flattened for easy access)
    assignments: matAssignments,
    assign,
    assignBulk,
    setBackerDefault,
    partRoles,
    canGenerate,

    // Board data
    boards: boardComponents.data ?? [],
    backerBoards: backerComponents.data ?? [],
    edgingComponents: edgingComponents.data ?? [],
    setEdgingDefault,
    setEdgingOverride,

    // Actions
    loadAggregate,
    generate,
    confirmPlan,
    clearPlan,
    discardPending,

    // Quality
    quality,
    setQuality,
    partLabelMap,
    isLabelMapReady,
  };
}

'use client';

import { useState } from 'react';
import { useOrderCuttingPlan } from '@/hooks/useOrderCuttingPlan';
import { packPartsSmartOptimized } from '@/components/features/cutlist/packing';
import type { StockSheetSpec, PartSpec, GrainOrientation } from '@/lib/cutlist/types';
import type {
  CuttingPlan,
  CuttingPlanMaterialGroup,
  CuttingPlanOverride,
  AggregatedPartGroup,
} from '@/lib/orders/cutting-plan-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Loader2,
  Scissors,
  Package,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

interface CuttingPlanTabProps {
  orderId: number;
}

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

export default function CuttingPlanTab({ orderId }: CuttingPlanTabProps) {
  const { plan, isLoading, isSaving, aggregate, confirm, clear } =
    useOrderCuttingPlan(orderId);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<CuttingPlan | null>(null);
  const [quality, setQuality] = useState<'fast' | 'balanced' | 'quality'>(
    'fast'
  );

  /** Convert AggregatedPart[] → PartSpec[] for the packing engine */
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

  async function handleGenerate() {
    setIsGenerating(true);
    setPendingPlan(null);
    try {
      const agg = await aggregate();
      if (!agg.has_cutlist_items) {
        toast.error('No cutlist items found on this order');
        return;
      }

      const materialGroups: CuttingPlanMaterialGroup[] = [];
      const overrides: CuttingPlanOverride[] = [];

      for (const group of agg.material_groups) {
        const parts = toPartSpecs(group);
        const result = await packPartsSmartOptimized(parts, [DEFAULT_STOCK]);

        const sheetsUsed = result.sheets.length;
        const totalArea =
          DEFAULT_STOCK.length_mm * DEFAULT_STOCK.width_mm * sheetsUsed;
        const usedArea = result.stats.used_area_mm2;
        const wastePercent =
          totalArea > 0 ? ((totalArea - usedArea) / totalArea) * 100 : 0;

        // BOM estimate: naive total-area / sheet-area, rounded up
        const sheetArea = DEFAULT_STOCK.length_mm * DEFAULT_STOCK.width_mm;
        let bomEstimateArea = 0;
        for (const part of parts) {
          bomEstimateArea += part.length_mm * part.width_mm * part.qty;
        }
        const bomEstimateSheets = Math.ceil(bomEstimateArea / sheetArea);

        materialGroups.push({
          board_type: group.board_type,
          primary_material_id: group.primary_material_id,
          primary_material_name: group.primary_material_name,
          backer_material_id: group.backer_material_id,
          backer_material_name: group.backer_material_name,
          sheets_required: sheetsUsed,
          backer_sheets_required: 0,
          edging_by_material: [],
          total_parts: parts.reduce((s, p) => s + p.qty, 0),
          waste_percent: Math.round(wastePercent * 10) / 10,
          bom_estimate_sheets: bomEstimateSheets,
          bom_estimate_backer_sheets: 0,
          layouts: result.sheets,
          stock_sheet_spec: {
            length_mm: DEFAULT_STOCK.length_mm,
            width_mm: DEFAULT_STOCK.width_mm,
          },
        });

        // Component overrides for purchasing
        if (group.primary_material_id != null) {
          overrides.push({
            component_id: group.primary_material_id,
            quantity: sheetsUsed,
            unit: 'sheets',
            source: 'cutlist_primary',
          });
        }
        if (group.backer_material_id != null) {
          overrides.push({
            component_id: group.backer_material_id,
            quantity: 0, // No backer packing in v1
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
        `Cutting plan generated: ${materialGroups.reduce((s, g) => s + g.sheets_required, 0)} sheets across ${materialGroups.length} material group(s)`
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate cutting plan';
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleConfirm() {
    if (!pendingPlan) return;
    try {
      await confirm(pendingPlan);
      setPendingPlan(null);
      toast.success('Cutting plan confirmed and saved');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to confirm cutting plan';
      toast.error(message);
    }
  }

  async function handleClear() {
    try {
      await clear();
      setPendingPlan(null);
      toast.success('Cutting plan cleared');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to clear cutting plan';
      toast.error(message);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Pending plan takes precedence over saved plan
  const displayPlan = pendingPlan || plan;
  const isPending = pendingPlan != null;

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!displayPlan) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8 space-y-4">
            <Scissors className="h-10 w-10 text-muted-foreground" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">No cutting plan generated</p>
              <p className="text-xs text-muted-foreground">
                Generate a plan to optimize sheet usage across all products
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={quality}
                onChange={(e) =>
                  setQuality(e.target.value as 'fast' | 'balanced' | 'quality')
                }
                className="h-9 rounded-sm border bg-background px-3 text-sm"
              >
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="quality">Quality</option>
              </select>
              <Button onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />{' '}
                    Generating...
                  </>
                ) : (
                  <>
                    <Scissors className="mr-2 h-4 w-4" /> Generate Cutting Plan
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Plan display (stale / fresh / pending) ───────────────────────────────
  const totalSheets = displayPlan.material_groups.reduce(
    (s, g) => s + g.sheets_required,
    0
  );
  const totalParts = displayPlan.material_groups.reduce(
    (s, g) => s + g.total_parts,
    0
  );
  const avgWaste =
    displayPlan.material_groups.length > 0
      ? displayPlan.material_groups.reduce((s, g) => s + g.waste_percent, 0) /
        displayPlan.material_groups.length
      : 0;
  const totalBomEstimate = displayPlan.material_groups.reduce(
    (s, g) => s + g.bom_estimate_sheets,
    0
  );
  const sheetsSaved = totalBomEstimate - totalSheets;

  return (
    <div className="space-y-4">
      {/* Stale warning */}
      {displayPlan.stale && (
        <div className="flex items-center gap-2 rounded-sm border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Order has changed since this plan was generated. Re-generate for
            accurate results.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Re-generate'
            )}
          </Button>
        </div>
      )}

      {/* Pending confirmation banner */}
      {isPending && (
        <div className="flex items-center gap-2 rounded-sm border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-sm text-blue-400">
          <Package className="h-4 w-4 shrink-0" />
          <span>
            Plan generated but not saved. Confirm to update purchasing
            requirements.
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPendingPlan(null)}
            >
              Discard
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              )}
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Sheets</p>
            <p className="text-2xl font-bold">{totalSheets}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Parts</p>
            <p className="text-2xl font-bold">{totalParts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Avg Waste</p>
            <p className="text-2xl font-bold">{avgWaste.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Sheets Saved</p>
            <p className="text-2xl font-bold text-green-500">
              {sheetsSaved > 0 ? `${sheetsSaved}` : '\u2014'}
            </p>
            {sheetsSaved > 0 && (
              <p className="text-xs text-muted-foreground">
                vs BOM estimate ({totalBomEstimate})
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Material breakdown table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium uppercase text-muted-foreground">
            Material Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-sm border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Material</th>
                  <th className="px-3 py-2 text-right font-medium">Parts</th>
                  <th className="px-3 py-2 text-right font-medium">Sheets</th>
                  <th className="px-3 py-2 text-right font-medium">
                    BOM Est.
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Saved</th>
                  <th className="px-3 py-2 text-right font-medium">Waste</th>
                </tr>
              </thead>
              <tbody>
                {displayPlan.material_groups.map((group, i) => {
                  const saved =
                    group.bom_estimate_sheets - group.sheets_required;
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span>
                            {group.primary_material_name ?? group.board_type}
                          </span>
                          {group.backer_material_name && (
                            <Badge variant="outline" className="text-xs">
                              + {group.backer_material_name}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {group.total_parts}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {group.sheets_required}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {group.bom_estimate_sheets}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {saved > 0 ? (
                          <span className="text-green-500">-{saved}</span>
                        ) : (
                          <span className="text-muted-foreground">
                            {'\u2014'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {group.waste_percent}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Actions footer */}
      {!isPending && !displayPlan.stale && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Generated {new Date(displayPlan.generated_at).toLocaleString()} ·
            Quality: {displayPlan.optimization_quality}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Scissors className="mr-1 h-3 w-3" />
              )}
              Re-generate
            </Button>
            <Button size="sm" variant="outline" onClick={handleClear}>
              <Trash2 className="mr-1 h-3 w-3" /> Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

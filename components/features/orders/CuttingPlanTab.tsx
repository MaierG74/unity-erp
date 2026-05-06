'use client';

import { useEffect, useRef, useState } from 'react';
import { useCuttingPlanBuilder } from '@/hooks/useCuttingPlanBuilder';
import MaterialAssignmentGrid from './MaterialAssignmentGrid';
import { CutterCutListButton } from '@/components/features/cutlist/CutterCutListButton';
import { CutterCutListViewerButton } from '@/components/features/cutlist/CutterCutListViewerButton';
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
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';

interface CuttingPlanTabProps {
  orderId: number;
  orderNumber: string;
  customerName: string;
}

export default function CuttingPlanTab({ orderId, orderNumber, customerName }: CuttingPlanTabProps) {
  const b = useCuttingPlanBuilder(orderId);
  const [gridCollapsed, setGridCollapsed] = useState(false);
  const hasAutoCollapsedAssignments = useRef(false);

  // Auto-load aggregate on mount
  useEffect(() => {
    b.loadAggregate().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayPlan = b.displayPlan;
  const isLegacyPlan = b.planState.kind === 'legacy' && !b.pendingPlan;
  const assignedPartRoles = b.partRoles.filter((role) => role.assigned_component_id != null).length;

  useEffect(() => {
    if (hasAutoCollapsedAssignments.current || !displayPlan || b.partRoles.length === 0) return;
    setGridCollapsed(true);
    hasAutoCollapsedAssignments.current = true;
  }, [displayPlan, b.partRoles.length]);

  if (b.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Summary stats (when plan exists)
  const totalSheets = displayPlan?.material_groups.reduce((s, g) => s + g.sheets_required, 0) ?? 0;
  const totalParts = displayPlan?.material_groups.reduce((s, g) => s + g.total_parts, 0) ?? 0;
  const avgWaste = displayPlan && displayPlan.material_groups.length > 0
    ? displayPlan.material_groups.reduce((s, g) => s + g.waste_percent, 0) / displayPlan.material_groups.length
    : 0;
  const totalBomEstimate = displayPlan?.material_groups.reduce((s, g) => s + g.bom_estimate_sheets, 0) ?? 0;
  const sheetsSaved = totalBomEstimate - totalSheets;
  const printDisabled = !!displayPlan?.stale;
  const draft = b.isPending && !displayPlan?.stale;
  const preparingLabels = !!displayPlan && !displayPlan.stale && !b.isLabelMapReady;

  return (
    <div className="space-y-4">
      {/* Stale warning */}
      {isLegacyPlan && (
        <div className="flex items-center gap-2 rounded-sm border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>This cutting plan uses an older format. Re-generate to update it.</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={b.generate} disabled={b.isGenerating || !b.canGenerate}>
            {b.isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Re-generate'}
          </Button>
        </div>
      )}

      {/* Stale warning */}
      {displayPlan?.stale && (
        <div className="flex items-center gap-2 rounded-sm border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-500">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {displayPlan.stale_reason === 'source_changed'
              ? 'Order has changed since this plan was generated. Re-generate for accurate results.'
              : 'Order has changed since this plan was generated. Re-generate for accurate results.'}
          </span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={b.generate} disabled={b.isGenerating}>
            {b.isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Re-generate'}
          </Button>
        </div>
      )}

      {/* Pending confirmation banner */}
      {b.isPending && (
        <div className="flex items-center gap-2 rounded-sm border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-sm text-blue-400">
          <Package className="h-4 w-4 shrink-0" />
          <span>Plan generated but not saved. Confirm to update purchasing requirements.</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={b.discardPending}>Discard</Button>
            <Button size="sm" onClick={b.confirmPlan} disabled={b.isSaving}>
              {b.isSaving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* Generate controls — visible whenever the user has parts to plan and
          isn't in the middle of confirming a pending plan. Rendered above
          the Material Assignments grid so the Quality dropdown is always
          directly visible alongside the action button, including for
          already-saved current plans (re-generate to a different mode
          without first having to Clear). */}
      {b.partRoles.length > 0 && !b.isPending && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={b.quality}
              onChange={(e) => b.setQuality(e.target.value as 'fast' | 'balanced' | 'quality')}
              className="h-9 rounded-sm border bg-background px-3 text-sm"
              disabled={b.isGenerating}
            >
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="quality">Quality</option>
            </select>
            <Button onClick={b.generate} disabled={b.isGenerating || !b.canGenerate}>
              {b.isGenerating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
              ) : (
                <><Scissors className="mr-2 h-4 w-4" /> Generate Cutting Plan</>
              )}
            </Button>
            {/* Cancel only meaningful for the deep / SA path — fast and balanced
                runs complete in ≤2s, faster than the user can react. The
                AbortController is a no-op outside the deep path. */}
            {b.isGenerating && b.quality === 'quality' && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={b.cancelGeneration}
                className="gap-1.5"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
            {!b.canGenerate && b.partRoles.length > 0 && (
              <span className="text-xs text-muted-foreground">
                Assign all materials to enable generation
              </span>
            )}
          </div>
          {/* SA progress — only fires on deep runs. Surfaces the most
              recently-reporting group's progress; sufficient feedback that
              "something is making progress" without per-group multiplexing. */}
          {b.isGenerating && b.saProgress && (
            <div className="text-xs text-muted-foreground tabular-nums">
              Iter {b.saProgress.iteration}
              {' · '}
              {(b.saProgress.elapsed / 1000).toFixed(1)}s
              {' · '}
              best score {b.saProgress.bestScore.toFixed(0)}
              {b.saProgress.improvementCount > 0 && ` · ${b.saProgress.improvementCount} improvements`}
            </div>
          )}
        </div>
      )}

      {/* Material Assignment Grid — always visible, collapsible.
          Sits below the Generate controls so the Quality+Generate row stays
          directly under any banner; the assignments grid is a fine-tuning
          surface that the user opens after deciding to (re-)generate. */}
      {b.partRoles.length > 0 && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setGridCollapsed((v) => !v)}
            className="mb-2 h-8 gap-2 px-3 text-xs"
          >
            {gridCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span>Material Assignments</span>
            <Badge variant={assignedPartRoles === b.partRoles.length ? 'default' : 'secondary'} className="ml-1 h-5 px-2 text-[11px]">
              {assignedPartRoles}/{b.partRoles.length}
            </Badge>
          </Button>
          {!gridCollapsed && (
            <MaterialAssignmentGrid
              partRoles={b.partRoles}
              boards={b.boards}
              backerBoards={b.backerBoards}
              backerDefault={b.assignments.backer_default}
              onAssign={b.assign}
              onAssignBulk={b.assignBulk}
              onBackerDefaultChange={b.setBackerDefault}
              edgingComponents={b.edgingComponents}
              edgingDefaults={b.assignments.edging_defaults ?? []}
              edgingOverrides={b.assignments.edging_overrides ?? []}
              onEdgingDefault={b.setEdgingDefault}
              onEdgingOverride={b.setEdgingOverride}
            />
          )}
        </div>
      )}

      {/* Empty state (no parts loaded yet) */}
      {b.partRoles.length === 0 && !displayPlan && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-6 space-y-3">
            <Scissors className="h-8 w-8 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No cutlist parts found. Add products with cutlist data to this order.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Summary cards (when plan exists) */}
      {displayPlan && (
        <>
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
                  <p className="text-xs text-muted-foreground">vs BOM estimate ({totalBomEstimate})</p>
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
                      <th className="px-3 py-2 text-right font-medium">BOM Est.</th>
                      <th className="px-3 py-2 text-right font-medium">Saved</th>
                      <th className="px-3 py-2 text-right font-medium">Waste</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayPlan.material_groups.map((group, i) => {
                      const saved = group.bom_estimate_sheets - group.sheets_required;
                      return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {/* `material_name` already encodes thickness in production
                                  inventory (e.g. "16mm African Wenge", "3mm Super White
                                  Melamine"); prepending sheet_thickness_mm produced
                                  "16mm 16mm African Wenge". Strip a leading "<n>mm "
                                  prefix from material_name if present to avoid the
                                  duplicate while preserving the explicit thickness for
                                  components whose description omits it. */}
                              <span>
                                {group.sheet_thickness_mm}mm{' '}
                                {group.material_name.replace(/^\d+(?:\.\d+)?\s*mm\s+/i, '')}
                              </span>
                              {group.kind === 'backer' && (
                                <Badge variant="outline" className="text-xs">
                                  Backer
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{group.total_parts}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{group.sheets_required}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{group.bom_estimate_sheets}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {saved > 0 ? (
                              <span className="text-green-500">-{saved}</span>
                            ) : (
                              <span className="text-muted-foreground">{'\u2014'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{group.waste_percent}%</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              <CutterCutListViewerButton
                                orderNumber={orderNumber}
                                customerName={customerName}
                                generatedAt={displayPlan.generated_at}
                                group={group}
                                partLabelMap={b.partLabelMap}
                                disabled={printDisabled}
                                preparingLabels={preparingLabels}
                                draft={draft}
                              />
                              <CutterCutListButton
                                orderNumber={orderNumber}
                                customerName={customerName}
                                generatedAt={displayPlan.generated_at}
                                group={group}
                                partLabelMap={b.partLabelMap}
                                disabled={printDisabled}
                                preparingLabels={preparingLabels}
                                draft={draft}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Actions footer — Re-generate moved to the unified Generate
              controls above (so the Quality dropdown is always reachable);
              this footer keeps the metadata + Clear affordance only. */}
          {!b.isPending && !displayPlan.stale && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Generated {new Date(displayPlan.generated_at).toLocaleString()} · Quality: {displayPlan.optimization_quality}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={b.clearPlan}>
                  <Trash2 className="mr-1 h-3 w-3" /> Clear
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

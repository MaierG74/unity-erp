'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SheetPreview } from '../preview';
import { CuttingDiagramButton } from './CuttingDiagramButton';
import { InteractiveSheetViewer } from './InteractiveSheetViewer';
import { getPartColorMap } from '@/lib/cutlist/colorAssignment';
import type {
  LayoutResult,
  StockSheetSpec,
  SheetBillingOverride,
} from '@/lib/cutlist/types';

export interface SheetLayoutGridProps {
  result: LayoutResult;
  stockSheet: StockSheetSpec;

  // Billing overrides
  globalFullBoard: boolean;
  onGlobalFullBoardChange: (value: boolean) => void;
  sheetOverrides: Record<string, SheetBillingOverride>;
  onSheetOverridesChange: (overrides: Record<string, SheetBillingOverride>) => void;

  // Pagination (optional, defaults to 3 per page)
  sheetsPerPage?: number;
}

export function SheetLayoutGrid({
  result,
  stockSheet,
  globalFullBoard,
  onGlobalFullBoardChange,
  sheetOverrides,
  onSheetOverridesChange,
  sheetsPerPage = 3,
}: SheetLayoutGridProps) {
  const [activePage, setActivePage] = React.useState(0);
  const [zoomSheetId, setZoomSheetId] = React.useState<string | null>(null);

  // Build a single color map from all placements across all sheets for consistent coloring
  const allColorMap = React.useMemo(() => {
    const allPlacements = result.sheets.flatMap((s) => s.placements);
    return getPartColorMap(allPlacements);
  }, [result.sheets]);

  const totalPages = Math.ceil(result.sheets.length / sheetsPerPage);

  // Reset to first page if current page becomes invalid
  React.useEffect(() => {
    if (activePage >= totalPages && totalPages > 0) {
      setActivePage(0);
    }
  }, [activePage, totalPages]);

  return (
    <div className="space-y-3">
      {/* Global full board toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="full-board-switch"
          checked={globalFullBoard}
          onCheckedChange={(v) => onGlobalFullBoardChange(Boolean(v))}
        />
        <Label htmlFor="full-board-switch" className="text-sm">
          Charge full sheet for every used board
        </Label>
      </div>

      {/* Pagination controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="text-sm text-muted-foreground mr-1">Pages:</div>
        {Array.from({ length: totalPages }).map((_, idx) => (
          <Button
            key={idx}
            size="sm"
            variant={idx === activePage ? 'default' : 'outline'}
            onClick={() => setActivePage(idx)}
          >
            {idx + 1}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <CuttingDiagramButton
            sheets={result.sheets}
            stockWidth={stockSheet.width_mm}
            stockLength={stockSheet.length_mm}
            materialLabel={result.sheets[0]?.material_label}
          />
          <span className="text-xs text-muted-foreground">
            Showing {activePage * sheetsPerPage + 1}-
            {Math.min((activePage + 1) * sheetsPerPage, result.sheets.length)} of{' '}
            {result.sheets.length}
          </span>
        </div>
      </div>

      {/* Sheet grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <AnimatePresence mode="wait">
        {result.sheets
          .slice(activePage * sheetsPerPage, activePage * sheetsPerPage + sheetsPerPage)
          .map((sheetLayout, idx) => {
            // Use per-sheet stock dimensions if available (multi-material support)
            const sheetW = sheetLayout.stock_width_mm || stockSheet.width_mm;
            const sheetL = sheetLayout.stock_length_mm || stockSheet.length_mm;
            const sheetArea = sheetW * sheetL;
            const autoPct =
              sheetArea > 0 ? ((sheetLayout.used_area_mm2 || 0) / sheetArea) * 100 : 0;
            const override = sheetOverrides[sheetLayout.sheet_id];
            const mode = globalFullBoard ? 'full' : (override?.mode ?? 'auto');
            const manualPct = override?.manualPct ?? autoPct;
            const chargePct = mode === 'full' ? 100 : mode === 'manual' ? manualPct : autoPct;

            return (
              <motion.div
                key={sheetLayout.sheet_id}
                className="border rounded p-2 space-y-2 hover:border-primary/50 transition-colors"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, delay: idx * 0.08 }}
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Sheet {activePage * sheetsPerPage + idx + 1}
                    {sheetLayout.material_label && (
                      <span className="ml-1 text-foreground font-medium">— {sheetLayout.material_label}</span>
                    )}
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-1"
                    onClick={() => setZoomSheetId(sheetLayout.sheet_id)}
                  >
                    Zoom
                  </Button>
                </div>

                <div
                  className="cursor-pointer"
                  onClick={() => setZoomSheetId(sheetLayout.sheet_id)}
                >
                  <SheetPreview
                    sheetWidth={sheetW}
                    sheetLength={sheetL}
                    layout={sheetLayout}
                    maxWidth={260}
                    maxHeight={200}
                    colorMap={allColorMap}
                    showEdgeBanding
                  />
                </div>

                <div className="text-xs text-muted-foreground">
                  Used {autoPct.toFixed(1)}% (
                  {((sheetLayout.used_area_mm2 || 0) / 1_000_000).toFixed(2)} m² of{' '}
                  {(sheetArea / 1_000_000).toFixed(2)} m²)
                </div>

                <div className="space-y-2">
                  {/* Charge full sheet toggle */}
                  <div className="flex items-center gap-2 text-xs">
                    <Switch
                      id={`full-${sheetLayout.sheet_id}`}
                      checked={mode === 'full'}
                      disabled={globalFullBoard}
                      onCheckedChange={(v) => {
                        const next = { ...sheetOverrides };
                        const existing = next[sheetLayout.sheet_id];
                        if (v) {
                          next[sheetLayout.sheet_id] = {
                            mode: 'full',
                            manualPct: existing?.manualPct ?? manualPct,
                          };
                        } else {
                          if (existing?.mode === 'manual') {
                            next[sheetLayout.sheet_id] = {
                              mode: 'manual',
                              manualPct: existing.manualPct,
                            };
                          } else {
                            delete next[sheetLayout.sheet_id];
                          }
                        }
                        onSheetOverridesChange(next);
                      }}
                    />
                    <Label htmlFor={`full-${sheetLayout.sheet_id}`} className="text-xs">
                      Charge full sheet
                    </Label>
                  </div>

                  {/* Manual percentage input */}
                  <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs">
                    <Label htmlFor={`manual-${sheetLayout.sheet_id}`}>Manual %</Label>
                    <Input
                      id={`manual-${sheetLayout.sheet_id}`}
                      type="number"
                      value={
                        mode === 'manual'
                          ? Number.isFinite(manualPct)
                            ? manualPct
                            : autoPct
                          : Number(chargePct.toFixed(1))
                      }
                      min={0}
                      max={100}
                      step={0.1}
                      disabled={globalFullBoard || mode === 'full'}
                      onChange={(e) => {
                        const nextPct = Math.max(
                          0,
                          Math.min(100, Number(e.target.value || 0))
                        );
                        onSheetOverridesChange({
                          ...sheetOverrides,
                          [sheetLayout.sheet_id]: { mode: 'manual', manualPct: nextPct },
                        });
                      }}
                    />
                  </div>

                  {/* Billing display and reset */}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Billing {chargePct.toFixed(1)}%</span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-1"
                      onClick={() => {
                        const next = { ...sheetOverrides };
                        delete next[sheetLayout.sheet_id];
                        onSheetOverridesChange(next);
                      }}
                    >
                      Reset to auto
                    </Button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Interactive zoom dialog */}
      {zoomSheetId && (() => {
        const zoomSheet = result.sheets.find((s) => s.sheet_id === zoomSheetId);
        if (!zoomSheet) return null;
        const zoomIdx = result.sheets.indexOf(zoomSheet);
        return (
          <InteractiveSheetViewer
            open
            onOpenChange={(open) => { if (!open) setZoomSheetId(null); }}
            sheetLayout={zoomSheet}
            sheetWidth={zoomSheet.stock_width_mm || stockSheet.width_mm}
            sheetLength={zoomSheet.stock_length_mm || stockSheet.length_mm}
            sheetIndex={zoomIdx >= 0 ? zoomIdx : undefined}
          />
        );
      })()}
    </div>
  );
}

export default SheetLayoutGrid;

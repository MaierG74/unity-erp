'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SheetPreview } from '../preview';
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

  const sheetArea = stockSheet.width_mm * stockSheet.length_mm;
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
        <div className="ml-auto text-xs text-muted-foreground">
          Showing {activePage * sheetsPerPage + 1}-
          {Math.min((activePage + 1) * sheetsPerPage, result.sheets.length)} of{' '}
          {result.sheets.length}
        </div>
      </div>

      {/* Sheet grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {result.sheets
          .slice(activePage * sheetsPerPage, activePage * sheetsPerPage + sheetsPerPage)
          .map((sheetLayout, idx) => {
            const autoPct =
              sheetArea > 0 ? ((sheetLayout.used_area_mm2 || 0) / sheetArea) * 100 : 0;
            const override = sheetOverrides[sheetLayout.sheet_id];
            const mode = globalFullBoard ? 'full' : (override?.mode ?? 'auto');
            const manualPct = override?.manualPct ?? autoPct;
            const chargePct = mode === 'full' ? 100 : mode === 'manual' ? manualPct : autoPct;

            return (
              <div key={sheetLayout.sheet_id} className="border rounded p-2 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Sheet {activePage * sheetsPerPage + idx + 1}</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-1"
                    onClick={() => setZoomSheetId(sheetLayout.sheet_id)}
                  >
                    Zoom
                  </Button>
                </div>

                <SheetPreview
                  sheetWidth={stockSheet.width_mm}
                  sheetLength={stockSheet.length_mm}
                  layout={sheetLayout}
                  maxWidth={260}
                  maxHeight={200}
                />

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
              </div>
            );
          })}
      </div>

      {/* Zoom dialog */}
      <Dialog
        open={zoomSheetId != null}
        onOpenChange={(open) => {
          if (!open) setZoomSheetId(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sheet preview</DialogTitle>
          </DialogHeader>
          {zoomSheetId && result.sheets.find((s) => s.sheet_id === zoomSheetId) && (
            <div className="flex justify-center">
              <SheetPreview
                sheetWidth={stockSheet.width_mm}
                sheetLength={stockSheet.length_mm}
                layout={result.sheets.find((s) => s.sheet_id === zoomSheetId)!}
                maxWidth={800}
                maxHeight={600}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SheetLayoutGrid;

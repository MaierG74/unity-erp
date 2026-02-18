'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Panzoom, { PanzoomObject } from '@panzoom/panzoom';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SheetPreview } from '../preview';
import type { SheetLayout, Placement } from '@/lib/cutlist/types';
import type { ColorEntry } from '@/lib/cutlist/colorAssignment';
import {
  getPartColorMap,
  getPartColor,
  getBasePartName,
} from '@/lib/cutlist/colorAssignment';

// ---------------------------------------------------------------------------
// Legend helpers
// ---------------------------------------------------------------------------

interface LegendRow {
  letter: string;
  /** User-visible display name (from label, not internal part_id) */
  baseName: string;
  /** Internal base part_id for color lookup and highlight matching */
  basePartId: string;
  color: ColorEntry;
  qty: number;
  /** Representative placement for dimensions */
  w: number;
  h: number;
  grain?: string;
  bandEdges?: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function buildLegend(
  placements: Placement[],
  colorMap: Map<string, ColorEntry>,
): LegendRow[] {
  const grouped = new Map<
    string,
    { count: number; sample: Placement; displayName: string }
  >();

  for (const pl of placements) {
    const base = getBasePartName(pl.part_id);
    // Use label for display, falling back to part_id.
    // Only strip instance suffixes from part_id (internal), not from labels
    // which may legitimately contain "#" (e.g. "Door #2").
    const rawLabel = pl.label || pl.part_id;
    const displayName = rawLabel === pl.part_id ? getBasePartName(rawLabel) : rawLabel;
    const existing = grouped.get(base);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(base, { count: 1, sample: pl, displayName });
    }
  }

  const sorted = Array.from(grouped.entries()).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

  return sorted.map(([baseId, { count, sample, displayName }], i) => ({
    letter: i < LETTERS.length ? LETTERS[i] : `#${i + 1}`,
    baseName: displayName,
    basePartId: baseId,
    color: getPartColor(colorMap, sample.part_id),
    qty: count,
    w: sample.w,
    h: sample.h,
    grain: sample.grain,
    bandEdges: sample.band_edges,
  }));
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

interface TooltipInfo {
  partId: string;
  label: string;
  w: number;
  h: number;
  grain?: string;
  bandEdges?: { top: boolean; right: boolean; bottom: boolean; left: boolean };
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// InteractiveSheetViewer
// ---------------------------------------------------------------------------

export interface InteractiveSheetViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheetLayout: SheetLayout;
  sheetWidth: number;
  sheetLength: number;
  sheetIndex?: number;
}

export function InteractiveSheetViewer({
  open,
  onOpenChange,
  sheetLayout,
  sheetWidth,
  sheetLength,
  sheetIndex,
}: InteractiveSheetViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panzoomTargetRef = useRef<HTMLDivElement>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null);

  const [highlightedPartId, setHighlightedPartId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [panzoomReady, setPanzoomReady] = useState(false);

  // Build color map from placements
  const colorMap = useMemo(
    () => getPartColorMap(sheetLayout.placements),
    [sheetLayout.placements],
  );

  // Legend data
  const legend = useMemo(
    () => buildLegend(sheetLayout.placements, colorMap),
    [sheetLayout.placements, colorMap],
  );

  // -----------------------------------------------------------------------
  // Panzoom lifecycle
  // -----------------------------------------------------------------------

  const cleanupPanzoom = useCallback(() => {
    if (wheelHandlerRef.current && containerRef.current) {
      containerRef.current.removeEventListener('wheel', wheelHandlerRef.current);
      wheelHandlerRef.current = null;
    }
    panzoomRef.current?.destroy();
    panzoomRef.current = null;
  }, []);

  const initPanzoom = useCallback(() => {
    if (!panzoomTargetRef.current || !containerRef.current) {
      console.warn('InteractiveSheetViewer: panzoom refs not ready');
      return;
    }
    cleanupPanzoom();

    try {
      panzoomRef.current = Panzoom(panzoomTargetRef.current, {
        maxScale: 8,
        minScale: 1,
        contain: 'inside',
        cursor: 'grab',
        startScale: 1,
      });
      wheelHandlerRef.current = panzoomRef.current.zoomWithWheel;
      containerRef.current.addEventListener(
        'wheel',
        wheelHandlerRef.current,
        { passive: false },
      );
      setPanzoomReady(true);
    } catch (e) {
      console.error('InteractiveSheetViewer: failed to init panzoom', e);
    }
  }, [cleanupPanzoom]);

  // Setup / teardown when dialog opens/closes
  useEffect(() => {
    if (open) {
      setPanzoomReady(false);
      // Delay so the dialog content has rendered and has real dimensions
      const timer = setTimeout(initPanzoom, 150);
      return () => clearTimeout(timer);
    } else {
      cleanupPanzoom();
      setPanzoomReady(false);
      setHighlightedPartId(null);
      setTooltip(null);
    }
  }, [open, initPanzoom, cleanupPanzoom]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { cleanupPanzoom(); };
  }, [cleanupPanzoom]);

  const handleZoomIn = () => {
    if (!panzoomRef.current) return;
    panzoomRef.current.zoomIn();
  };
  const handleZoomOut = () => {
    if (!panzoomRef.current) return;
    panzoomRef.current.zoomOut();
  };
  const handleReset = () => {
    if (!panzoomRef.current) return;
    panzoomRef.current.reset();
  };

  // -----------------------------------------------------------------------
  // Part hover & click
  // -----------------------------------------------------------------------

  const handlePartHover = useCallback(
    (partId: string | null) => {
      setHighlightedPartId(partId);
      if (!partId) {
        setTooltip(null);
        return;
      }
      const pl = sheetLayout.placements.find((p) => p.part_id === partId);
      if (!pl) {
        setTooltip(null);
        return;
      }
      setTooltip({
        partId: pl.part_id,
        label: pl.label || pl.part_id,
        w: pl.w,
        h: pl.h,
        grain: pl.grain,
        bandEdges: pl.band_edges,
        x: pl.x + pl.w / 2,
        y: pl.y,
      });
    },
    [sheetLayout.placements],
  );

  const handlePartClick = useCallback((partId: string) => {
    setHighlightedPartId((prev) => (prev === partId ? null : partId));
  }, []);

  const handleLegendHover = useCallback((basePartId: string | null) => {
    if (!basePartId) {
      setHighlightedPartId(null);
      return;
    }
    setHighlightedPartId(basePartId);
  }, []);

  const edgeLabel = (be?: { top: boolean; right: boolean; bottom: boolean; left: boolean }) => {
    if (!be) return 'None';
    const edges: string[] = [];
    if (be.top) edges.push('T');
    if (be.right) edges.push('R');
    if (be.bottom) edges.push('B');
    if (be.left) edges.push('L');
    return edges.length > 0 ? edges.join('+') : 'None';
  };

  const usagePct = sheetLayout.used_area_mm2 != null
    ? ((sheetLayout.used_area_mm2 / (sheetWidth * sheetLength)) * 100).toFixed(1)
    : null;

  const title = sheetIndex != null
    ? `Sheet ${sheetIndex + 1}${sheetLayout.material_label ? ` — ${sheetLayout.material_label}` : ''}`
    : `Sheet preview${sheetLayout.material_label ? ` — ${sheetLayout.material_label}` : ''}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Override the shadcn inner scroll wrapper: make it a flex column that
          fills the dialog height and never scrolls. This is critical — without
          it, the SVG's natural height dictates the container height, causing
          the board to overflow below the visible dialog area. */}
      <DialogContent
        className={[
          'max-w-6xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden',
          // Target the inner <div> that shadcn wraps around {children}
          '[&>div:first-child]:!overflow-hidden',
          '[&>div:first-child]:!max-h-none',
          '[&>div:first-child]:flex',
          '[&>div:first-child]:flex-col',
          '[&>div:first-child]:flex-1',
          '[&>div:first-child]:min-h-0',
          '[&>div:first-child]:h-full',
        ].join(' ')}
      >
        <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
          <DialogTitle className="flex items-baseline gap-3">
            <span>{title}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {Math.round(sheetWidth)} x {Math.round(sheetLength)} mm
              {usagePct && ` | ${usagePct}% used`}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Body: flex-1 min-h-0 ensures it takes remaining space without
            growing beyond the dialog's fixed height. */}
        <div className="flex flex-1 min-h-0">
          {/* Left: diagram with pan/zoom (70%) */}
          <div className="relative flex-[7] min-w-0 min-h-0 border-r">
            {/* Zoom controls — semi-transparent bg so they don't clash with dimension labels */}
            <div className="absolute top-2 right-2 z-10 flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-0.5">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={handleZoomIn}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={handleZoomOut}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={handleReset}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Panzoom container — absolute inset-0 so its size is dictated
                by the flex parent, NOT by the SVG's intrinsic height.
                This is the core fix for the overflow issue. */}
            <div
              ref={containerRef}
              className="absolute inset-0 overflow-hidden bg-muted/30"
            >
              <div
                ref={panzoomTargetRef}
                className="touch-none w-full h-full flex items-center justify-center"
              >
                {/* fillContainer makes the SVG use width="100%" height="100%"
                    with preserveAspectRatio="xMidYMid meet", so it scales to
                    fit the available space without overflowing. */}
                <SheetPreview
                  sheetWidth={sheetWidth}
                  sheetLength={sheetLength}
                  layout={sheetLayout}
                  fillContainer
                  maxWidth={800}
                  maxHeight={600}
                  colorMap={colorMap}
                  highlightedPartId={highlightedPartId}
                  onPartHover={handlePartHover}
                  onPartClick={handlePartClick}
                  showGrainDirection
                  showEdgeBanding
                  interactive
                />
              </div>
            </div>

            {/* Floating tooltip — positioned at bottom-left of the diagram area */}
            {tooltip && (
              <div className="absolute bottom-3 left-3 z-10 bg-popover text-popover-foreground border rounded-md shadow-md px-3 py-2 text-xs space-y-0.5 pointer-events-none max-w-[220px]">
                <div className="font-medium text-sm">{tooltip.label}</div>
                <div>
                  {Math.round(tooltip.w)} x {Math.round(tooltip.h)} mm
                </div>
                {tooltip.grain && tooltip.grain !== 'any' && (
                  <div>Grain: {tooltip.grain}</div>
                )}
                {tooltip.bandEdges && (
                  <div>Edges: {edgeLabel(tooltip.bandEdges)}</div>
                )}
              </div>
            )}
          </div>

          {/* Right: legend table (30%) */}
          <div className="flex-[3] min-w-[240px] max-w-[340px] overflow-y-auto p-3 border-l">
            <div className="text-sm font-medium text-muted-foreground mb-2">
              Parts Legend ({sheetLayout.placements.length} placements)
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1 pr-1 w-5"></th>
                  <th className="text-left py-1 pr-1 w-5"></th>
                  <th className="text-left py-1 pr-2">Part</th>
                  <th className="text-right py-1 pr-2 w-8">Qty</th>
                  <th className="text-right py-1 pr-2">L x W</th>
                  <th className="text-right py-1 pr-1">Info</th>
                </tr>
              </thead>
              <tbody>
                {legend.map((row) => {
                  const isActive = highlightedPartId != null && getBasePartName(highlightedPartId) === row.basePartId;
                  return (
                  <tr
                    key={row.basePartId}
                    className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer ${isActive ? 'bg-muted' : ''}`}
                    onMouseEnter={() => handleLegendHover(row.basePartId)}
                    onMouseLeave={() => handleLegendHover(null)}
                  >
                    <td className="py-1.5 pr-1">
                      <div
                        className="w-3.5 h-3.5 rounded-sm border"
                        style={{
                          backgroundColor: row.color.fill,
                          borderColor: row.color.stroke,
                        }}
                      />
                    </td>
                    <td className="py-1.5 pr-1 font-mono font-semibold text-muted-foreground">
                      {row.letter}
                    </td>
                    <td className="py-1.5 pr-2 font-medium truncate max-w-[100px]">
                      {row.baseName}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-muted-foreground">
                      {row.qty}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-muted-foreground whitespace-nowrap">
                      {Math.round(row.h)} x {Math.round(row.w)}
                    </td>
                    <td className="py-1.5 pl-1 text-right text-muted-foreground whitespace-nowrap">
                      {row.grain && row.grain !== 'any' ? (row.grain === 'length' ? '↕' : '↔') : ''}
                      {row.bandEdges ? ` ${edgeLabel(row.bandEdges)}` : ''}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Sheet stats */}
            <div className="mt-3 pt-2 border-t text-sm text-foreground/70 space-y-1">
              <div>
                Sheet: {Math.round(sheetWidth)} x {Math.round(sheetLength)} mm
              </div>
              {sheetLayout.used_area_mm2 != null && (
                <div>
                  Used:{' '}
                  {(
                    (sheetLayout.used_area_mm2 / (sheetWidth * sheetLength)) *
                    100
                  ).toFixed(1)}
                  %
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import * as React from 'react';
import { ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PedestalConfig } from '@/lib/configurator/templates/types';

interface PedestalPreviewProps {
  config: PedestalConfig;
}

// Colors (same palette as CupboardPreview / PigeonholePreview)
const PANEL_FILL = '#e2e8f0';
const PANEL_STROKE = '#64748b';
const BACK_FILL = '#f1f5f9';
const ADJUSTER_FILL = '#94a3b8';
const DIM_COLOR = '#94a3b8';
const DIM_TEXT = '#475569';
const LABEL_COLOR = '#334155';

// Drawer type colors
const DRAWER_FILL = '#dbeafe';     // light blue — standard drawers
const DRAWER_STROKE = '#3b82f6';
const PENCIL_FILL = '#fef3c7';     // light amber — pencil drawer
const PENCIL_STROKE = '#f59e0b';
const FILING_FILL = '#d1fae5';     // light green — filing drawer
const FILING_STROKE = '#10b981';

function DimensionH({ x1, x2, y, label, side = 'above', u }: {
  x1: number; x2: number; y: number; label: string; side?: 'above' | 'below'; u: number;
}) {
  const ext = side === 'above' ? -u * 3.5 : u * 3.5;
  const textY = side === 'above' ? y + ext - u : y + ext + u * 1.2;
  return (
    <g>
      <line x1={x1} y1={y} x2={x1} y2={y + ext} stroke={DIM_COLOR} strokeWidth={u * 0.1} />
      <line x1={x2} y1={y} x2={x2} y2={y + ext} stroke={DIM_COLOR} strokeWidth={u * 0.1} />
      <line x1={x1} y1={y + ext / 2} x2={x2} y2={y + ext / 2} stroke={DIM_COLOR} strokeWidth={u * 0.1} markerStart="url(#ped-arrow)" markerEnd="url(#ped-arrow)" />
      <text x={(x1 + x2) / 2} y={textY} textAnchor="middle" fill={DIM_TEXT} fontSize={u * 2.5} fontWeight="500" fontFamily="sans-serif">{label}</text>
    </g>
  );
}

function DimensionV({ y1, y2, x, label, side = 'left', u }: {
  y1: number; y2: number; x: number; label: string; side?: 'left' | 'right'; u: number;
}) {
  const ext = side === 'left' ? -u * 3.5 : u * 3.5;
  const textX = side === 'left' ? x + ext - u * 1.2 : x + ext + u * 1.2;
  return (
    <g>
      <line x1={x} y1={y1} x2={x + ext} y2={y1} stroke={DIM_COLOR} strokeWidth={u * 0.1} />
      <line x1={x} y1={y2} x2={x + ext} y2={y2} stroke={DIM_COLOR} strokeWidth={u * 0.1} />
      <line x1={x + ext / 2} y1={y1} x2={x + ext / 2} y2={y2} stroke={DIM_COLOR} strokeWidth={u * 0.1} markerStart="url(#ped-arrow)" markerEnd="url(#ped-arrow)" />
      <text x={textX} y={(y1 + y2) / 2} textAnchor="middle" dominantBaseline="central" fill={DIM_TEXT} fontSize={u * 2.5} fontWeight="500" fontFamily="sans-serif" transform={`rotate(-90, ${textX}, ${(y1 + y2) / 2})`}>{label}</text>
    </g>
  );
}

function PanelLabel({ x, y, label, u }: { x: number; y: number; label: string; u: number }) {
  return <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill={LABEL_COLOR} fontSize={u * 2} fontWeight="500" fontFamily="sans-serif">{label}</text>;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

export function PedestalPreview({ config }: PedestalPreviewProps) {
  const { width: W, height: H, depth: D, materialThickness: T } = config;
  const {
    drawerCount, hasPencilDrawer, pencilDrawerHeight,
    hasFilingDrawer, filingDrawerHeight, drawerGap,
    hasBack, backMaterialThickness: BT,
    adjusterHeight, shelfSetback, backRecess, backSlotDepth,
  } = config;

  // Derived dimensions
  const carcassHeight = H - adjusterHeight;
  const sideHeight = carcassHeight;
  const baseWidth = W - T * 2;
  const baseDepth = D - shelfSetback - (hasBack ? BT + backRecess : 0);

  // Drawer front calculations
  const totalFronts = drawerCount + (hasPencilDrawer ? 1 : 0) + (hasFilingDrawer ? 1 : 0);
  const totalGaps = totalFronts > 1 ? (totalFronts - 1) * drawerGap : 0;
  const pencilH = hasPencilDrawer ? pencilDrawerHeight : 0;
  const filingH = hasFilingDrawer ? filingDrawerHeight : 0;
  const standardTotal = carcassHeight - pencilH - filingH - totalGaps;
  const standardH = drawerCount > 0 ? standardTotal / drawerCount : 0;
  const frontWidth = baseWidth - drawerGap * 2;

  // View layout
  const rawW = W + D + 40;
  const rawH = H;
  const u = Math.min(rawW, rawH) / 100;
  const margin = u * 10;
  const viewGap = u * 5;
  const vbW = W + viewGap + D + margin * 2;
  const vbH = H + margin * 2;

  // Zoom & pan
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const panStart = React.useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const svgRef = React.useRef<SVGSVGElement>(null);

  const zoomedW = vbW / zoom;
  const zoomedH = vbH / zoom;
  const viewBox = `${pan.x} ${pan.y} ${zoomedW} ${zoomedH}`;

  const clampPan = React.useCallback((px: number, py: number, z: number) => {
    const zW = vbW / z;
    const zH = vbH / z;
    return {
      x: Math.max(0, Math.min(vbW - zW, px)),
      y: Math.max(0, Math.min(vbH - zH, py)),
    };
  }, [vbW, vbH]);

  const handleWheel = React.useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const fracY = (e.clientY - rect.top) / rect.height;
    setZoom(prev => {
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta));
      const oldW = vbW / prev;
      const oldH = vbH / prev;
      const newW = vbW / newZ;
      const newH = vbH / newZ;
      setPan(p => {
        const svgX = p.x + fracX * oldW;
        const svgY = p.y + fracY * oldH;
        return clampPan(svgX - fracX * newW, svgY - fracY * newH, newZ);
      });
      return newZ;
    });
  }, [vbW, vbH, clampPan]);

  const handleMouseDown = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [zoom, pan]);

  const handleMouseMove = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isPanning) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = (e.clientX - panStart.current.x) / rect.width * (vbW / zoom);
    const dy = (e.clientY - panStart.current.y) / rect.height * (vbH / zoom);
    setPan(clampPan(panStart.current.panX - dx, panStart.current.panY - dy, zoom));
  }, [isPanning, zoom, vbW, vbH, clampPan]);

  const handleMouseUp = React.useCallback(() => setIsPanning(false), []);

  const handleReset = React.useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  const zoomCenter = React.useCallback((delta: number) => {
    setZoom(z => {
      const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta));
      setPan(p => {
        const oldW = vbW / z;
        const oldH = vbH / z;
        const newW = vbW / newZ;
        const newH = vbH / newZ;
        return clampPan(p.x + (oldW - newW) / 2, p.y + (oldH - newH) / 2, newZ);
      });
      return newZ;
    });
  }, [vbW, vbH, clampPan]);

  React.useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const cursorStyle = zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default';

  // ── Front view origin ──
  const fx = margin;
  const fy = margin;

  // ── Side view origin ──
  const sx = margin + W + viewGap;
  const sy = margin;

  // ── Front view vertical positions ──
  // No top panel — sides go from very top of carcass
  const topY = fy;                                // top of carcass (top of sides)
  const baseTopY = fy + sideHeight;               // top of base panel
  const baseBottomY = baseTopY + T;               // bottom of base
  const adjusterBottomY = baseBottomY + adjusterHeight;

  // ── Front view horizontal positions ──
  const sideLeftOuterX = fx;                      // left edge of left side
  const sideLeftInnerX = fx + T;                  // inner edge of left side
  const sideRightInnerX = fx + W - T;             // inner edge of right side
  const sideRightOuterX = fx + W;                 // right edge of right side

  // ── Build drawer front list (top to bottom) ──
  const drawerFronts: Array<{
    y: number; height: number; type: 'pencil' | 'standard' | 'filing'; label: string;
    fill: string; stroke: string;
  }> = [];

  let curY = topY;
  if (hasPencilDrawer) {
    drawerFronts.push({
      y: curY, height: pencilH, type: 'pencil',
      label: `Pencil (${Math.round(pencilH)})`,
      fill: PENCIL_FILL, stroke: PENCIL_STROKE,
    });
    curY += pencilH + drawerGap;
  }
  for (let i = 0; i < drawerCount; i++) {
    drawerFronts.push({
      y: curY, height: standardH, type: 'standard',
      label: standardH >= 30 ? `Drawer (${Math.round(standardH)})` : '',
      fill: DRAWER_FILL, stroke: DRAWER_STROKE,
    });
    curY += standardH + (i < drawerCount - 1 || hasFilingDrawer ? drawerGap : 0);
  }
  if (hasFilingDrawer) {
    drawerFronts.push({
      y: curY, height: filingH, type: 'filing',
      label: `Filing (${Math.round(filingH)})`,
      fill: FILING_FILL, stroke: FILING_STROKE,
    });
  }

  // Side view depths
  const carcassDepth = D;

  const toolbar = (
    <div className="flex items-center gap-1 justify-end">
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => zoomCenter(-ZOOM_STEP * 2)} disabled={zoom <= MIN_ZOOM}>
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <span className="text-xs text-muted-foreground w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => zoomCenter(ZOOM_STEP * 2)} disabled={zoom >= MAX_ZOOM}>
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={handleReset} disabled={zoom <= MIN_ZOOM} title="Reset zoom">
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setIsFullscreen(fs => !fs)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );

  const svgContent = (
    <>
      <defs>
        <marker id="ped-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth={u * 0.8} markerHeight={u * 0.8} orient="auto-start-reverse">
          <path d="M 0 0 L 6 3 L 0 6 z" fill={DIM_COLOR} />
        </marker>
      </defs>

      {/* ═══════ FRONT VIEW ═══════ */}
      <text x={fx + W / 2} y={fy - u * 2} textAnchor="middle" fill={DIM_TEXT} fontSize={u * 2.8} fontWeight="600" fontFamily="sans-serif">Front View</text>

      {/* Left side panel (full carcass height, no top panel) */}
      <rect x={sideLeftOuterX} y={topY} width={T} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />

      {/* Right side panel */}
      <rect x={sideRightInnerX} y={topY} width={T} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />

      {/* Base panel (between sides) */}
      <rect x={sideLeftInnerX} y={baseTopY} width={baseWidth} height={T} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />
      <PanelLabel x={sideLeftInnerX + baseWidth / 2} y={baseTopY + T / 2} label={`Base (${T}mm)`} u={u} />

      {/* Drawer fronts */}
      {drawerFronts.map((d, i) => (
        <g key={`drawer-${i}`}>
          <rect
            x={sideLeftInnerX + drawerGap}
            y={d.y}
            width={frontWidth}
            height={d.height}
            fill={d.fill}
            stroke={d.stroke}
            strokeWidth={u * 0.15}
            rx={u * 0.3}
          />
          {d.label && d.height >= 15 && (
            <PanelLabel
              x={sideLeftInnerX + drawerGap + frontWidth / 2}
              y={d.y + d.height / 2}
              label={d.label}
              u={u}
            />
          )}
        </g>
      ))}

      {/* Adjusters */}
      {adjusterHeight > 0 && (
        <>
          <rect x={sideLeftOuterX + 5} y={baseBottomY} width={8} height={adjusterHeight} fill={ADJUSTER_FILL} rx={1} />
          <rect x={sideRightOuterX - 13} y={baseBottomY} width={8} height={adjusterHeight} fill={ADJUSTER_FILL} rx={1} />
        </>
      )}

      {/* Front view dimensions */}
      <DimensionH x1={fx} x2={fx + W} y={adjusterBottomY + u} label={`${W}`} side="below" u={u} />
      <DimensionV y1={topY} y2={adjusterBottomY} x={fx - u} label={`${H}`} side="left" u={u} />
      <DimensionH x1={sideLeftInnerX} x2={sideRightInnerX} y={topY - u} label={`${baseWidth} (carcass)`} side="above" u={u} />

      {/* ═══════ SIDE VIEW ═══════ */}
      <text x={sx + D / 2} y={sy - u * 2} textAnchor="middle" fill={DIM_TEXT} fontSize={u * 2.8} fontWeight="600" fontFamily="sans-serif">Side View</text>

      {/* Side panel cross-section (full carcass height, no top) */}
      <rect x={sx} y={sy} width={carcassDepth} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />

      {/* Base panel (side view) */}
      <rect x={sx} y={sy + sideHeight} width={baseDepth} height={T} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />

      {/* Back panel (side view) */}
      {hasBack && (
        <rect
          x={sx + carcassDepth - backRecess - Math.max(BT, 1)}
          y={sy}
          width={Math.max(BT, 1)}
          height={sideHeight + backSlotDepth}
          fill={BACK_FILL}
          stroke={PANEL_STROKE}
          strokeWidth={u * 0.1}
        />
      )}

      {/* Adjusters (side view) */}
      {adjusterHeight > 0 && (
        <>
          <rect x={sx + 5} y={sy + H - adjusterHeight} width={8} height={adjusterHeight} fill={ADJUSTER_FILL} rx={1} />
          <rect x={sx + carcassDepth - 13} y={sy + H - adjusterHeight} width={8} height={adjusterHeight} fill={ADJUSTER_FILL} rx={1} />
        </>
      )}

      {/* Side view dimensions */}
      <DimensionH x1={sx} x2={sx + D} y={sy + H + u} label={`${D}`} side="below" u={u} />
      <DimensionV y1={sy} y2={sy + H} x={sx + D + u} label={`${H}`} side="right" u={u} />
    </>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-medium text-muted-foreground">Pedestal — {W} &times; {H} &times; {D}mm ({totalFronts} drawers)</span>
          {toolbar}
        </div>
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
          <svg ref={svgRef} viewBox={viewBox} className="w-full h-full border rounded bg-background" style={{ cursor: cursorStyle }}
            onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
            {svgContent}
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden">
      <div className="mb-2">{toolbar}</div>
      <svg ref={svgRef} viewBox={viewBox} className="w-full border rounded" style={{ height: 400, cursor: cursorStyle }}
        onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        {svgContent}
      </svg>
    </div>
  );
}

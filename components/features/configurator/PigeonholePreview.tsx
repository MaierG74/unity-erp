'use client';

import * as React from 'react';
import { ZoomIn, ZoomOut, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PigeonholeConfig } from '@/lib/configurator/templates/types';

interface PigeonholePreviewProps {
  config: PigeonholeConfig;
}

// Colors (same palette as CupboardPreview)
const PANEL_FILL = '#e2e8f0';
const PANEL_STROKE = '#64748b';
const SHELF_STROKE = '#64748b';
const BACK_FILL = '#f1f5f9';
const ADJUSTER_FILL = '#94a3b8';
const TOP_FILL = '#bfdbfe';
const DIM_COLOR = '#94a3b8';
const DIM_TEXT = '#475569';
const LABEL_COLOR = '#334155';
const DIVIDER_FILL = '#cbd5e1';
const DOOR_FILL = '#dbeafe';
const DOOR_STROKE = '#3b82f6';

function DimensionH({ x1, x2, y, label, side = 'above', u }: {
  x1: number; x2: number; y: number; label: string; side?: 'above' | 'below'; u: number;
}) {
  const ext = side === 'above' ? -u * 3.5 : u * 3.5;
  const textY = side === 'above' ? y + ext - u : y + ext + u * 1.2;
  return (
    <g>
      <line x1={x1} y1={y} x2={x1} y2={y + ext} stroke={DIM_COLOR} strokeWidth={u * 0.1} />
      <line x1={x2} y1={y} x2={x2} y2={y + ext} stroke={DIM_COLOR} strokeWidth={u * 0.1} />
      <line x1={x1} y1={y + ext / 2} x2={x2} y2={y + ext / 2} stroke={DIM_COLOR} strokeWidth={u * 0.1} markerStart="url(#ph-arrow)" markerEnd="url(#ph-arrow)" />
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
      <line x1={x + ext / 2} y1={y1} x2={x + ext / 2} y2={y2} stroke={DIM_COLOR} strokeWidth={u * 0.1} markerStart="url(#ph-arrow)" markerEnd="url(#ph-arrow)" />
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

export function PigeonholePreview({ config }: PigeonholePreviewProps) {
  const { width: W, height: H, depth: D, materialThickness: T } = config;
  const { columns, rows, laminateTopBase, hasBack, backMaterialThickness: BT } = config;
  // Normalize legacy 'single'/'double' values to 'per-cell'
  const rawDoorStyle = config.doorStyle ?? 'none';
  const doorStyle = rawDoorStyle === 'single' || rawDoorStyle === 'double' ? 'per-cell' : rawDoorStyle;
  const doorGap = config.doorGap ?? 2;
  const { adjusterHeight, shelfSetback, backSlotDepth, backRecess } = config;
  const { topOverhangSides, topOverhangBack, baseOverhangSides, baseOverhangBack } = config;

  const TB = laminateTopBase ? T * 2 : T;

  // Derived
  const carcassWidth = W - Math.max(topOverhangSides, baseOverhangSides) * 2;
  const carcassDepth = D - Math.max(topOverhangBack, baseOverhangBack);
  const sideHeight = H - adjusterHeight - TB - TB;
  const internalWidth = carcassWidth - T * 2;
  const cellWidth = columns > 0 ? (internalWidth - T * (columns - 1)) / columns : internalWidth;
  const cellHeight = rows > 0 ? (sideHeight - T * (rows - 1)) / rows : sideHeight;
  const topDepth = carcassDepth + topOverhangBack;
  const baseDepth = carcassDepth + baseOverhangBack;

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
  const topY = fy;
  const topBottomY = fy + TB;
  const sideBottomY = topBottomY + sideHeight;
  const baseTopY = sideBottomY;
  const baseBottomY = sideBottomY + TB;
  const adjusterBottomY = baseBottomY + adjusterHeight;

  // ── Front view horizontal positions ──
  const overhangSides = Math.max(topOverhangSides, baseOverhangSides);
  const sideLeftOuterX = fx + overhangSides;
  const sideRightOuterX = fx + W - overhangSides;
  const sideLeftInnerX = sideLeftOuterX + T;
  const sideRightInnerX = sideRightOuterX - T;

  const topLeftX = fx + overhangSides - topOverhangSides;
  const topRightX = topLeftX + carcassWidth + topOverhangSides * 2;
  const baseLeftX = fx + overhangSides - baseOverhangSides;
  const baseRightX = baseLeftX + carcassWidth + baseOverhangSides * 2;

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
        <marker id="ph-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth={u * 0.8} markerHeight={u * 0.8} orient="auto-start-reverse">
          <path d="M 0 0 L 6 3 L 0 6 z" fill={DIM_COLOR} />
        </marker>
      </defs>

      {/* ═══════ FRONT VIEW ═══════ */}
      <text x={fx + W / 2} y={fy - u * 2} textAnchor="middle" fill={DIM_TEXT} fontSize={u * 2.8} fontWeight="600" fontFamily="sans-serif">Front View</text>

      {/* Top panel */}
      <rect x={topLeftX} y={topY} width={topRightX - topLeftX} height={TB} fill={TOP_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />
      {laminateTopBase && (
        <line x1={topLeftX} y1={topY + T} x2={topRightX} y2={topY + T} stroke={PANEL_STROKE} strokeWidth={u * 0.06} strokeDasharray={`${u * 0.6},${u * 0.4}`} />
      )}
      <PanelLabel x={(topLeftX + topRightX) / 2} y={topY + TB / 2} label={`Top (${TB}mm)`} u={u} />

      {/* Left side */}
      <rect x={sideLeftOuterX} y={topBottomY} width={T} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />

      {/* Right side */}
      <rect x={sideRightOuterX - T} y={topBottomY} width={T} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />

      {/* Vertical dividers */}
      {Array.from({ length: columns - 1 }, (_, i) => {
        const divX = sideLeftInnerX + (cellWidth + T) * (i + 1) - T;
        return (
          <rect key={`vd-${i}`} x={divX} y={topBottomY} width={T} height={sideHeight} fill={DIVIDER_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />
        );
      })}

      {/* Horizontal shelves */}
      {Array.from({ length: rows - 1 }, (_, r) => {
        const shelfY = topBottomY + (cellHeight + T) * (r + 1) - T;
        return Array.from({ length: columns }, (_, c) => {
          const shelfX = sideLeftInnerX + (cellWidth + T) * c;
          return (
            <rect key={`sh-${r}-${c}`} x={shelfX} y={shelfY} width={cellWidth} height={T} fill={PANEL_FILL} stroke={SHELF_STROKE} strokeWidth={u * 0.1} strokeDasharray={`${u * 0.4},${u * 0.2}`} />
          );
        });
      })}

      {/* Cell labels */}
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: columns }, (_, c) => {
          const cx = sideLeftInnerX + (cellWidth + T) * c + cellWidth / 2;
          const cy = topBottomY + (cellHeight + T) * r + cellHeight / 2;
          return (
            <text key={`cl-${r}-${c}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={LABEL_COLOR} fontSize={u * 1.5} fontWeight="400" fontFamily="sans-serif" opacity={0.4}>
              {r * columns + c + 1}
            </text>
          );
        })
      )}

      {/* Base panel */}
      <rect x={baseLeftX} y={baseTopY} width={baseRightX - baseLeftX} height={TB} fill={TOP_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />
      {laminateTopBase && (
        <line x1={baseLeftX} y1={baseTopY + T} x2={baseRightX} y2={baseTopY + T} stroke={PANEL_STROKE} strokeWidth={u * 0.06} strokeDasharray={`${u * 0.6},${u * 0.4}`} />
      )}
      <PanelLabel x={(baseLeftX + baseRightX) / 2} y={baseTopY + TB / 2} label={`Base (${TB}mm)`} u={u} />

      {/* Adjusters */}
      {adjusterHeight > 0 && (
        <>
          <rect x={sideLeftOuterX + 5} y={baseBottomY} width={8} height={adjusterHeight} fill={ADJUSTER_FILL} rx={1} />
          <rect x={sideRightOuterX - 13} y={baseBottomY} width={8} height={adjusterHeight} fill={ADJUSTER_FILL} rx={1} />
        </>
      )}

      {/* Doors (front view) — one per compartment */}
      {doorStyle === 'per-cell' && Array.from({ length: rows }, (_, r) =>
        Array.from({ length: columns }, (_, c) => {
          const cellX = sideLeftInnerX + (cellWidth + T) * c;
          const cellY = topBottomY + (cellHeight + T) * r;
          return (
            <rect
              key={`door-${r}-${c}`}
              x={cellX + doorGap} y={cellY + doorGap}
              width={cellWidth - doorGap * 2} height={cellHeight - doorGap * 2}
              fill={DOOR_FILL} stroke={DOOR_STROKE} strokeWidth={u * 0.15} opacity={0.7} rx={u * 0.3}
            />
          );
        })
      )}

      {/* Front view dimensions */}
      <DimensionH x1={fx} x2={fx + W} y={adjusterBottomY + u} label={`${W}`} side="below" u={u} />
      <DimensionV y1={topY} y2={adjusterBottomY} x={fx - u} label={`${H}`} side="left" u={u} />
      <DimensionH x1={sideLeftOuterX} x2={sideRightOuterX} y={topY - u} label={`${carcassWidth} (carcass)`} side="above" u={u} />

      {/* Cell width dimension (first cell) */}
      {cellWidth > 0 && (
        <DimensionH x1={sideLeftInnerX} x2={sideLeftInnerX + cellWidth} y={adjusterBottomY + u * 5} label={`${Math.round(cellWidth)} (cell)`} side="below" u={u} />
      )}

      {/* ═══════ SIDE VIEW ═══════ */}
      <text x={sx + D / 2} y={sy - u * 2} textAnchor="middle" fill={DIM_TEXT} fontSize={u * 2.8} fontWeight="600" fontFamily="sans-serif">Side View</text>

      {/* Top */}
      <rect x={sx} y={sy} width={topDepth} height={TB} fill={TOP_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />
      {laminateTopBase && (
        <line x1={sx} y1={sy + T} x2={sx + topDepth} y2={sy + T} stroke={PANEL_STROKE} strokeWidth={u * 0.06} strokeDasharray={`${u * 0.6},${u * 0.4}`} />
      )}
      <PanelLabel x={sx + topDepth / 2} y={sy + TB / 2} label={`Top ${TB}mm`} u={u} />

      {/* Side panel cross-section */}
      <rect x={sx} y={sy + TB} width={carcassDepth} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />

      {/* Base */}
      <rect x={sx} y={sy + TB + sideHeight} width={baseDepth} height={TB} fill={TOP_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />
      {laminateTopBase && (
        <line x1={sx} y1={sy + TB + sideHeight + T} x2={sx + baseDepth} y2={sy + TB + sideHeight + T} stroke={PANEL_STROKE} strokeWidth={u * 0.06} strokeDasharray={`${u * 0.6},${u * 0.4}`} />
      )}

      {/* Back panel (recessed from rear edge of sides) */}
      {hasBack && (
        <rect x={sx + carcassDepth - backRecess - Math.max(BT, 1)} y={sy + TB} width={Math.max(BT, 1)} height={sideHeight + backSlotDepth} fill={BACK_FILL} stroke={PANEL_STROKE} strokeWidth={u * 0.1} />
      )}

      {/* Shelves cross-section — show one row of shelves */}
      {Array.from({ length: rows - 1 }, (_, r) => {
        const shelfY = sy + TB + (cellHeight + T) * (r + 1) - T;
        const shelfW = carcassDepth - shelfSetback - (hasBack ? BT + backRecess : 0);
        return (
          <rect key={`side-sh-${r}`} x={sx} y={shelfY} width={shelfW} height={T} fill={PANEL_FILL} stroke={SHELF_STROKE} strokeWidth={u * 0.1} strokeDasharray={`${u * 0.4},${u * 0.2}`} />
        );
      })}

      {/* Adjusters */}
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
          <span className="text-sm font-medium text-muted-foreground">Pigeon Hole — {W} &times; {H} &times; {D}mm ({columns}&times;{rows})</span>
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

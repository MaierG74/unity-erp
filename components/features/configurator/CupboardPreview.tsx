'use client';

import * as React from 'react';
import type { CupboardConfig } from '@/lib/configurator/templates/types';

interface CupboardPreviewProps {
  config: CupboardConfig;
}

// Colors
const PANEL_FILL = '#e2e8f0';
const PANEL_STROKE = '#64748b';
const DOOR_FILL = '#dbeafe';
const DOOR_STROKE = '#3b82f6';
const SHELF_STROKE = '#64748b';
const BACK_FILL = '#f1f5f9';
const ADJUSTER_FILL = '#94a3b8';
const TOP_FILL = '#bfdbfe';
const DIM_COLOR = '#94a3b8';
const DIM_TEXT = '#475569';
const LABEL_COLOR = '#334155';

function DimensionH({ x1, x2, y, label, side = 'above', scale }: {
  x1: number; x2: number; y: number; label: string; side?: 'above' | 'below'; scale: number;
}) {
  const ext = side === 'above' ? -8 : 8;
  const textY = side === 'above' ? y + ext - 3 : y + ext + 4;
  const fontSize = Math.max(8, Math.min(11, 10 / scale));
  return (
    <g>
      <line x1={x1} y1={y} x2={x1} y2={y + ext} stroke={DIM_COLOR} strokeWidth={0.5} />
      <line x1={x2} y1={y} x2={x2} y2={y + ext} stroke={DIM_COLOR} strokeWidth={0.5} />
      <line x1={x1} y1={y + ext / 2} x2={x2} y2={y + ext / 2} stroke={DIM_COLOR} strokeWidth={0.5} markerStart="url(#arrow)" markerEnd="url(#arrow)" />
      <text x={(x1 + x2) / 2} y={textY} textAnchor="middle" fill={DIM_TEXT} fontSize={fontSize} fontFamily="sans-serif">{label}</text>
    </g>
  );
}

function DimensionV({ y1, y2, x, label, side = 'left', scale }: {
  y1: number; y2: number; x: number; label: string; side?: 'left' | 'right'; scale: number;
}) {
  const ext = side === 'left' ? -8 : 8;
  const textX = side === 'left' ? x + ext - 3 : x + ext + 3;
  const fontSize = Math.max(8, Math.min(11, 10 / scale));
  return (
    <g>
      <line x1={x} y1={y1} x2={x + ext} y2={y1} stroke={DIM_COLOR} strokeWidth={0.5} />
      <line x1={x} y1={y2} x2={x + ext} y2={y2} stroke={DIM_COLOR} strokeWidth={0.5} />
      <line x1={x + ext / 2} y1={y1} x2={x + ext / 2} y2={y2} stroke={DIM_COLOR} strokeWidth={0.5} markerStart="url(#arrow)" markerEnd="url(#arrow)" />
      <text x={textX} y={(y1 + y2) / 2} textAnchor="middle" dominantBaseline="central" fill={DIM_TEXT} fontSize={fontSize} fontFamily="sans-serif" transform={`rotate(-90, ${textX}, ${(y1 + y2) / 2})`}>{label}</text>
    </g>
  );
}

function PanelLabel({ x, y, label, scale }: { x: number; y: number; label: string; scale: number }) {
  const fontSize = Math.max(6, Math.min(9, 8 / scale));
  return <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill={LABEL_COLOR} fontSize={fontSize} fontFamily="sans-serif">{label}</text>;
}

export function CupboardPreview({ config }: CupboardPreviewProps) {
  const { width: W, height: H, depth: D, materialThickness: T } = config;
  const { shelfCount, doorStyle, hasBack, backMaterialThickness: BT } = config;
  const { doorGap, adjusterHeight, topOverhangSides, topOverhangBack, baseOverhangSides, baseOverhangBack, backSlotDepth } = config;

  const T2 = T * 2; // laminated thickness

  // Derived (same logic as generator)
  const carcassWidth = W - Math.max(topOverhangSides, baseOverhangSides) * 2;
  const carcassDepth = D - Math.max(topOverhangBack, baseOverhangBack);
  const sideHeight = H - adjusterHeight - T2 - T2; // minus top and base (both laminated)
  const topDepth = carcassDepth + topOverhangBack;
  const baseDepth = carcassDepth + baseOverhangBack;

  // View layout
  const viewGap = 40;
  const margin = 25;
  const vbW = W + viewGap + D + margin * 2;
  const vbH = H + margin * 2;
  const scale = Math.max(vbW / 600, vbH / 500);

  // Front view origin
  const fx = margin;
  const fy = margin;

  // Side view origin
  const sx = margin + W + viewGap;
  const sy = margin;

  // ── Front view vertical positions (top to bottom) ──
  const topY = fy;                                     // top of laminated top
  const topBottomY = fy + T2;                          // bottom of top = top of sides
  const sideBottomY = topBottomY + sideHeight;         // bottom of sides = top of base
  const baseTopY = sideBottomY;                        // top of laminated base
  const baseBottomY = sideBottomY + T2;                // bottom of base = top of adjusters
  const adjusterBottomY = baseBottomY + adjusterHeight; // floor level

  // ── Front view horizontal positions ──
  const overhangSides = Math.max(topOverhangSides, baseOverhangSides);
  const sideLeftOuterX = fx + overhangSides;
  const sideRightOuterX = fx + W - overhangSides;
  const sideLeftInnerX = sideLeftOuterX + T;
  const sideRightInnerX = sideRightOuterX - T;

  // Top panel horizontal (may differ from base if overhangs differ)
  const topLeftX = fx + overhangSides - topOverhangSides;
  const topRightX = topLeftX + carcassWidth + topOverhangSides * 2;
  const baseLeftX = fx + overhangSides - baseOverhangSides;
  const baseRightX = baseLeftX + carcassWidth + baseOverhangSides * 2;

  // ── Shelf positions (evenly spaced in interior between top and base) ──
  const interiorTopY = topBottomY;     // underside of top
  const interiorBottomY = sideBottomY; // top of base
  const interiorH = interiorBottomY - interiorTopY;
  const shelfPositions: number[] = [];
  if (shelfCount > 0 && interiorH > 0) {
    for (let i = 1; i <= shelfCount; i++) {
      shelfPositions.push(interiorTopY + (interiorH * i) / (shelfCount + 1));
    }
  }

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="w-full h-auto" style={{ maxHeight: 500 }}>
        <defs>
          <marker id="arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 6 3 L 0 6 z" fill={DIM_COLOR} />
          </marker>
        </defs>

        {/* ═══════ FRONT VIEW ═══════ */}
        <text x={fx + W / 2} y={fy - 14} textAnchor="middle" fill={DIM_TEXT} fontSize={Math.max(8, 10 / scale)} fontWeight="500" fontFamily="sans-serif">Front View</text>

        {/* Laminated Top (32mm) */}
        <rect x={topLeftX} y={topY} width={topRightX - topLeftX} height={T2} fill={TOP_FILL} stroke={PANEL_STROKE} strokeWidth={0.5} />
        <line x1={topLeftX} y1={topY + T} x2={topRightX} y2={topY + T} stroke={PANEL_STROKE} strokeWidth={0.3} strokeDasharray="3,2" />
        <PanelLabel x={(topLeftX + topRightX) / 2} y={topY + T2 / 2} label={`Top (${T2}mm)`} scale={scale} />

        {/* Left side panel */}
        <rect x={sideLeftOuterX} y={topBottomY} width={T} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={0.5} />
        <PanelLabel x={sideLeftOuterX + T / 2} y={topBottomY + sideHeight / 2} label="L" scale={scale} />

        {/* Right side panel */}
        <rect x={sideRightOuterX - T} y={topBottomY} width={T} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={0.5} />
        <PanelLabel x={sideRightOuterX - T / 2} y={topBottomY + sideHeight / 2} label="R" scale={scale} />

        {/* Laminated Base (32mm) */}
        <rect x={baseLeftX} y={baseTopY} width={baseRightX - baseLeftX} height={T2} fill={TOP_FILL} stroke={PANEL_STROKE} strokeWidth={0.5} />
        <line x1={baseLeftX} y1={baseTopY + T} x2={baseRightX} y2={baseTopY + T} stroke={PANEL_STROKE} strokeWidth={0.3} strokeDasharray="3,2" />
        <PanelLabel x={(baseLeftX + baseRightX) / 2} y={baseTopY + T2 / 2} label={`Base (${T2}mm)`} scale={scale} />

        {/* Shelves */}
        {shelfPositions.map((yPos, i) => (
          <g key={`shelf-${i}`}>
            <rect x={sideLeftInnerX} y={yPos - T / 2} width={sideRightInnerX - sideLeftInnerX} height={T} fill={PANEL_FILL} stroke={SHELF_STROKE} strokeWidth={0.5} strokeDasharray="2,1" />
            <PanelLabel x={(sideLeftInnerX + sideRightInnerX) / 2} y={yPos} label={`S${i + 1}`} scale={scale} />
          </g>
        ))}

        {/* Doors overlay */}
        {doorStyle === 'single' && (
          <rect x={sideLeftOuterX + doorGap} y={topBottomY + doorGap} width={carcassWidth - doorGap * 2} height={sideHeight - doorGap * 2} fill={DOOR_FILL} fillOpacity={0.4} stroke={DOOR_STROKE} strokeWidth={0.8} rx={1} />
        )}
        {doorStyle === 'double' && (() => {
          const dw = Math.floor((carcassWidth - doorGap * 3) / 2);
          return (
            <>
              <rect x={sideLeftOuterX + doorGap} y={topBottomY + doorGap} width={dw} height={sideHeight - doorGap * 2} fill={DOOR_FILL} fillOpacity={0.4} stroke={DOOR_STROKE} strokeWidth={0.8} rx={1} />
              <rect x={sideLeftOuterX + doorGap * 2 + dw} y={topBottomY + doorGap} width={dw} height={sideHeight - doorGap * 2} fill={DOOR_FILL} fillOpacity={0.4} stroke={DOOR_STROKE} strokeWidth={0.8} rx={1} />
            </>
          );
        })()}

        {/* Adjusters */}
        {adjusterHeight > 0 && (
          <>
            <rect x={sideLeftOuterX + 5} y={baseBottomY} width={8} height={adjusterHeight} fill={ADJUSTER_FILL} rx={1} />
            <rect x={sideRightOuterX - 13} y={baseBottomY} width={8} height={adjusterHeight} fill={ADJUSTER_FILL} rx={1} />
          </>
        )}

        {/* Front view dimensions */}
        <DimensionH x1={fx} x2={fx + W} y={adjusterBottomY + 5} label={`${W}`} side="below" scale={scale} />
        <DimensionV y1={topY} y2={adjusterBottomY} x={fx - 5} label={`${H}`} side="left" scale={scale} />
        <DimensionH x1={sideLeftOuterX} x2={sideRightOuterX} y={topY - 5} label={`${carcassWidth} (carcass)`} side="above" scale={scale} />

        {/* ═══════ SIDE VIEW ═══════ */}
        <text x={sx + D / 2} y={sy - 14} textAnchor="middle" fill={DIM_TEXT} fontSize={Math.max(8, 10 / scale)} fontWeight="500" fontFamily="sans-serif">Side View</text>

        {/* Laminated Top (uses topDepth, may differ from baseDepth) */}
        <rect x={sx} y={sy} width={topDepth} height={T2} fill={TOP_FILL} stroke={PANEL_STROKE} strokeWidth={0.5} />
        <line x1={sx} y1={sy + T} x2={sx + topDepth} y2={sy + T} stroke={PANEL_STROKE} strokeWidth={0.3} strokeDasharray="3,2" />
        <PanelLabel x={sx + topDepth / 2} y={sy + T} label={`Top ${T2}mm`} scale={scale} />

        {/* Side panel (cross-section) */}
        <rect x={sx} y={sy + T2} width={carcassDepth} height={sideHeight} fill={PANEL_FILL} stroke={PANEL_STROKE} strokeWidth={0.5} />

        {/* Laminated Base (uses baseDepth, may differ from topDepth) */}
        <rect x={sx} y={sy + T2 + sideHeight} width={baseDepth} height={T2} fill={TOP_FILL} stroke={PANEL_STROKE} strokeWidth={0.5} />
        <line x1={sx} y1={sy + T2 + sideHeight + T} x2={sx + baseDepth} y2={sy + T2 + sideHeight + T} stroke={PANEL_STROKE} strokeWidth={0.3} strokeDasharray="3,2" />

        {/* Back panel */}
        {hasBack && (
          <rect
            x={sx + carcassDepth - Math.max(BT, 1)}
            y={sy + T2}
            width={Math.max(BT, 1)}
            height={sideHeight + backSlotDepth}
            fill={BACK_FILL}
            stroke={PANEL_STROKE}
            strokeWidth={0.5}
          />
        )}

        {/* Shelves (cross-section) */}
        {shelfPositions.map((yPos, i) => {
          // Translate front-view Y to side-view Y (same offset from top)
          const sideShelfY = yPos;
          return (
            <rect key={`side-shelf-${i}`} x={sx} y={sideShelfY - T / 2} width={carcassDepth - (hasBack ? BT : 0) - config.shelfSetback} height={T} fill={PANEL_FILL} stroke={SHELF_STROKE} strokeWidth={0.5} strokeDasharray="2,1" />
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
        <DimensionH x1={sx} x2={sx + D} y={sy + H + 5} label={`${D}`} side="below" scale={scale} />
        <DimensionV y1={sy} y2={sy + H} x={sx + D + 5} label={`${H}`} side="right" scale={scale} />
      </svg>
    </div>
  );
}

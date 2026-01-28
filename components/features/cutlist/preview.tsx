import React from 'react';
import type { SheetLayout } from './packing';

interface SheetPreviewProps {
  sheetWidth: number;
  sheetLength: number;
  layout: SheetLayout;
  maxWidth?: number;
  maxHeight?: number;
  showDimensions?: boolean;
  showSheetDimensions?: boolean;
  /** When true, SVG scales to fill container width */
  responsive?: boolean;
}

export function SheetPreview({
  sheetWidth,
  sheetLength,
  layout,
  maxWidth = 320,
  maxHeight = 240,
  showDimensions = true,
  showSheetDimensions = true,
  responsive = false,
}: SheetPreviewProps) {
  const padding = 24; // Increased padding to accommodate edge labels
  const scale = Math.min((maxWidth - padding * 2) / sheetWidth, (maxHeight - padding * 2) / sheetLength);
  const widthPx = Math.max(50, sheetWidth * scale + padding * 2);
  const heightPx = Math.max(50, sheetLength * scale + padding * 2);

  // Font sizes based on scale
  const labelFont = Math.max(8, Math.min(11, 10 * scale));
  const dimFont = Math.max(7, Math.min(9, 8 * scale));

  // Sheet origin in SVG coordinates
  const sheetX = padding;
  const sheetY = padding;
  const sheetW = sheetWidth * scale;
  const sheetH = sheetLength * scale;

  return (
    <svg
      width={responsive ? '100%' : widthPx}
      height={responsive ? 'auto' : heightPx}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      preserveAspectRatio="xMidYMid meet"
      style={responsive ? { maxWidth: '100%', height: 'auto' } : undefined}
    >
      {/* Sheet background */}
      <rect
        x={sheetX}
        y={sheetY}
        width={sheetW}
        height={sheetH}
        fill="#fafafa"
        stroke="#374151"
        strokeWidth={1}
      />

      {/* Sheet dimensions on outside edges */}
      {showSheetDimensions && (
        <>
          {/* Width label at top */}
          <text
            x={sheetX + sheetW / 2}
            y={sheetY - 8}
            textAnchor="middle"
            fontSize={dimFont}
            fill="#6b7280"
          >
            {Math.round(sheetWidth)} mm
          </text>
          {/* Height label on left */}
          <text
            x={sheetX - 8}
            y={sheetY + sheetH / 2}
            textAnchor="middle"
            fontSize={dimFont}
            fill="#6b7280"
            transform={`rotate(-90 ${sheetX - 8}, ${sheetY + sheetH / 2})`}
          >
            {Math.round(sheetLength)} mm
          </text>
        </>
      )}

      {/* Part placements */}
      {layout.placements.map((pl, i) => {
        const x = sheetX + pl.x * scale;
        const y = sheetY + pl.y * scale;
        const w = pl.w * scale;
        const h = pl.h * scale;
        const centerX = x + w / 2;
        const centerY = y + h / 2;

        // Show dimensions only for larger parts
        const showWidth = showDimensions && w > 35;
        const showHeight = showDimensions && h > 35;

        // Display label (part name) or fall back to part_id
        const displayLabel = pl.label || pl.part_id;

        return (
          <g key={i}>
            {/* Part rectangle */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={1}
              ry={1}
              fill="#dbeafe"
              stroke="#3b82f6"
              strokeWidth={0.75}
            />

            {/* Width dimension (at top edge of part, bold) */}
            {showWidth && (
              <text
                x={centerX}
                y={y + 10}
                fontSize={dimFont}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#1e293b"
              >
                {Math.round(pl.w)}
              </text>
            )}

            {/* Height dimension (at left edge of part, rotated, bold) */}
            {showHeight && (
              <text
                x={x + 10}
                y={centerY}
                fontSize={dimFont}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#1e293b"
                transform={`rotate(-90 ${x + 10}, ${centerY})`}
              >
                {Math.round(pl.h)}
              </text>
            )}

            {/* Part label (centered, smaller, not bold) */}
            <text
              x={centerX}
              y={centerY}
              fontSize={dimFont}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#64748b"
            >
              {displayLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

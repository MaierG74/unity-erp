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
  const padding = 12; // px
  const scale = Math.min((maxWidth - padding * 2) / sheetWidth, (maxHeight - padding * 2) / sheetLength);
  const widthPx = Math.max(50, sheetWidth * scale + padding * 2);
  const heightPx = Math.max(50, sheetLength * scale + padding * 2);

  const baseFont = Math.max(9, 12 * Math.min(1, scale));
  const subFont = Math.max(8, baseFont * 0.8);

  return (
    <svg
      width={responsive ? '100%' : widthPx}
      height={responsive ? 'auto' : heightPx}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      preserveAspectRatio="xMidYMid meet"
      style={responsive ? { maxWidth: '100%', height: 'auto' } : undefined}
    >
      <rect x={padding} y={padding} width={sheetWidth * scale} height={sheetLength * scale} fill="#fafafa" stroke="#222" strokeWidth={1} />
      {showSheetDimensions && (
        <>
          <text x={padding + (sheetWidth * scale) / 2} y={padding - 6} textAnchor="middle" fontSize={subFont} fill="#555">
            {`${Math.round(sheetWidth)} mm`}
          </text>
          <text
            x={padding - 6}
            y={padding + (sheetLength * scale) / 2}
            textAnchor="middle"
            fontSize={subFont}
            fill="#555"
            transform={`rotate(-90 ${padding - 6}, ${padding + (sheetLength * scale) / 2})`}
          >
            {`${Math.round(sheetLength)} mm`}
          </text>
        </>
      )}
      {layout.placements.map((pl, i) => {
        const x = padding + pl.x * scale;
        const y = padding + pl.y * scale;
        const w = pl.w * scale;
        const h = pl.h * scale;
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        const widthLabel = `${Math.round(pl.w)} mm`;
        const lengthLabel = `${Math.round(pl.h)} mm`;
        const showWidthLabel = showDimensions && w > 32;
        const showLengthLabel = showDimensions && h > 32;
        const widthLabelY = y + Math.min(h / 4, subFont + 6);
        const lengthLabelX = x + Math.min(w / 4, subFont + 6);
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={2}
              ry={2}
              fill="#cfe8ff"
              stroke="#1d4ed8"
              strokeWidth={0.8}
            />
            <text
              x={centerX}
              y={centerY}
              fontSize={baseFont}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#0f172a"
            >
              {pl.part_id}
            </text>
            {showWidthLabel && (
              <text
                x={centerX}
                y={widthLabelY}
                fontSize={subFont}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#1e293b"
              >
                {widthLabel}
              </text>
            )}
            {showLengthLabel && (
              <text
                x={lengthLabelX}
                y={centerY}
                fontSize={subFont}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#1e293b"
                transform={`rotate(-90 ${lengthLabelX}, ${centerY})`}
              >
                {lengthLabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}



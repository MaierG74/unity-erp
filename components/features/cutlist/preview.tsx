import React from 'react';
import type { SheetLayout } from './packing';

export function SheetPreview({ sheetWidth, sheetLength, layout }: { sheetWidth: number; sheetLength: number; layout: SheetLayout }) {
  const padding = 8; // px
  const maxW = 320; const maxH = 240;
  const scale = Math.min((maxW - padding * 2) / sheetWidth, (maxH - padding * 2) / sheetLength);
  const widthPx = Math.max(50, sheetWidth * scale + padding * 2);
  const heightPx = Math.max(50, sheetLength * scale + padding * 2);

  return (
    <svg width={widthPx} height={heightPx} viewBox={`0 0 ${widthPx} ${heightPx}`}>
      <rect x={padding} y={padding} width={sheetWidth * scale} height={sheetLength * scale} fill="#fafafa" stroke="#222" strokeWidth={1} />
      {layout.placements.map((pl, i) => (
        <g key={i}>
          <rect
            x={padding + pl.x * scale}
            y={padding + pl.y * scale}
            width={pl.w * scale}
            height={pl.h * scale}
            fill="#cfe8ff"
            stroke="#1d4ed8"
            strokeWidth={0.8}
          />
          <text
            x={padding + (pl.x + pl.w / 2) * scale}
            y={padding + (pl.y + pl.h / 2) * scale}
            fontSize={10}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#111"
          >
            {pl.part_id}
          </text>
        </g>
      ))}
    </svg>
  );
}



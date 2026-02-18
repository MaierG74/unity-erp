import React from 'react';
import type { SheetLayout } from './packing';
import type { ColorEntry } from '@/lib/cutlist/colorAssignment';
import { getPartColor, getBasePartName, WASTE_COLOR } from '@/lib/cutlist/colorAssignment';

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
  /**
   * When true, SVG uses width="100%" height="100%" with preserveAspectRatio
   * to fill its container while maintaining aspect ratio. Use for zoom dialogs
   * where the container constrains the size, not the SVG.
   */
  fillContainer?: boolean;
  /** Color map from getPartColorMap — falls back to default blue when omitted */
  colorMap?: Map<string, ColorEntry>;
  /** Part ID or base name to visually highlight (others dim). Matches by base name. */
  highlightedPartId?: string | null;
  /** Called when user hovers a part (null on mouse leave) */
  onPartHover?: (partId: string | null) => void;
  /** Called when user clicks a part */
  onPartClick?: (partId: string) => void;
  /** Show grain direction overlay lines */
  showGrainDirection?: boolean;
  /** Show edge banding ticks on part edges */
  showEdgeBanding?: boolean;
  /** When false, skip hover/click handlers (for thumbnail cards) */
  interactive?: boolean;
}

const DEFAULT_COLOR: ColorEntry = {
  fill: '#dbeafe',
  stroke: '#3b82f6',
  text: '#1e293b',
};

const EDGE_BAND_COLOR = '#f97316'; // orange-500
const EDGE_BAND_THICKNESS = 3;

/** Approximate width of a character at a given font size (SVG units). */
const CHAR_WIDTH_RATIO = 0.6;

/** Minimum font size below which we hide the label entirely. */
const MIN_LABEL_FONT = 5;

export function SheetPreview({
  sheetWidth,
  sheetLength,
  layout,
  maxWidth = 320,
  maxHeight = 240,
  showDimensions = true,
  showSheetDimensions = true,
  responsive = false,
  fillContainer = false,
  colorMap,
  highlightedPartId,
  onPartHover,
  onPartClick,
  showGrainDirection = false,
  showEdgeBanding = false,
  interactive = false,
}: SheetPreviewProps) {
  // Extra padding in fillContainer mode for dimension labels that need room
  const padding = fillContainer ? 32 : 24;
  const scale = Math.min(
    (maxWidth - padding * 2) / sheetWidth,
    (maxHeight - padding * 2) / sheetLength,
  );
  const widthPx = Math.max(50, sheetWidth * scale + padding * 2);
  const heightPx = Math.max(50, sheetLength * scale + padding * 2);

  // Font sizes — larger range for interactive mode (zoom dialog)
  const dimFont = interactive
    ? Math.max(9, Math.min(12, 10 * scale))
    : Math.max(7, Math.min(9, 8 * scale));

  // Sheet origin in SVG coordinates
  const sheetX = padding;
  const sheetY = padding;
  const sheetW = sheetWidth * scale;
  const sheetH = sheetLength * scale;

  // Unique IDs for SVG patterns (avoid collisions when multiple previews render)
  const patternIdRef = React.useRef(
    `sp-${Math.random().toString(36).slice(2, 8)}`,
  );
  const pid = patternIdRef.current;

  const hasHighlight = highlightedPartId != null && highlightedPartId !== '';
  const highlightBase = hasHighlight ? getBasePartName(highlightedPartId!) : null;

  return (
    <svg
      width={fillContainer ? '100%' : responsive ? '100%' : widthPx}
      height={fillContainer ? '100%' : responsive ? 'auto' : heightPx}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      preserveAspectRatio="xMidYMid meet"
      style={
        fillContainer
          ? { display: 'block', maxWidth: '100%', maxHeight: '100%' }
          : responsive
            ? { maxWidth: '100%', height: 'auto' }
            : undefined
      }
    >
      {/* Reusable SVG pattern definitions */}
      <defs>
        {/* Pulsing stroke animation for highlighted parts */}
        <style>{`
          @keyframes pulse-stroke {
            0%, 100% { stroke-opacity: 1; }
            50% { stroke-opacity: 0.4; }
          }
          .part-highlighted { animation: pulse-stroke 1.5s ease-in-out infinite; }
        `}</style>
        {/* Grain direction: horizontal lines (grain along length / x-axis) */}
        <pattern
          id={`${pid}-grain-length`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="3"
            x2="6"
            y2="3"
            stroke="#000"
            strokeOpacity="0.12"
            strokeWidth="0.5"
          />
        </pattern>

        {/* Grain direction: vertical lines (grain along width / y-axis) */}
        <pattern
          id={`${pid}-grain-width`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="3"
            y1="0"
            x2="3"
            y2="6"
            stroke="#000"
            strokeOpacity="0.12"
            strokeWidth="0.5"
          />
        </pattern>

        {/* Waste area: diagonal crosshatch */}
        <pattern
          id={`${pid}-waste`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="8"
            y2="8"
            stroke="#94a3b8"
            strokeOpacity="0.15"
            strokeWidth="0.5"
          />
          <line
            x1="8"
            y1="0"
            x2="0"
            y2="8"
            stroke="#94a3b8"
            strokeOpacity="0.15"
            strokeWidth="0.5"
          />
        </pattern>

        {/* Per-part clipPaths for text overflow safety */}
        {layout.placements.map((pl, i) => {
          const cx = sheetX + pl.x * scale;
          const cy = sheetY + pl.y * scale;
          const cw = pl.w * scale;
          const ch = pl.h * scale;
          return (
            <clipPath key={i} id={`${pid}-clip-${i}`}>
              <rect x={cx} y={cy} width={cw} height={ch} />
            </clipPath>
          );
        })}
      </defs>

      {/* Sheet background with waste pattern */}
      <rect
        x={sheetX}
        y={sheetY}
        width={sheetW}
        height={sheetH}
        fill={WASTE_COLOR.fill}
        stroke="#374151"
        strokeWidth={1}
      />
      <rect
        x={sheetX}
        y={sheetY}
        width={sheetW}
        height={sheetH}
        fill={`url(#${pid}-waste)`}
      />

      {/* Sheet dimensions on outside edges */}
      {showSheetDimensions && (
        <>
          <text
            x={sheetX + sheetW / 2}
            y={sheetY - 8}
            textAnchor="middle"
            fontSize={dimFont}
            fill="#6b7280"
          >
            {Math.round(sheetWidth)} mm
          </text>
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

        // In thumbnail mode (!interactive), only show dimensions if part is large enough
        // and never show part labels. In interactive (zoom) mode, show everything.
        const minDimSize = interactive ? 35 : 45;
        const showWidth = showDimensions && w > minDimSize;
        const showHeight = showDimensions && h > minDimSize;
        const showLabel = interactive && w > 30 && h > 20;

        const displayLabel = pl.label || pl.part_id;

        // Per-part adaptive font sizing for the center label.
        // Scale down if the label text would overflow the part rect.
        let labelFont = dimFont;
        if (showLabel) {
          const textWidthEst = dimFont * CHAR_WIDTH_RATIO * displayLabel.length;
          const textHeightEst = dimFont * 1.2;
          const availW = w - 8; // 4px padding each side
          const availH = h - 8;
          if (textWidthEst > availW || textHeightEst > availH) {
            const scaleW = availW > 0 ? availW / (CHAR_WIDTH_RATIO * displayLabel.length) : dimFont;
            const scaleH = availH > 0 ? availH / 1.2 : dimFont;
            labelFont = Math.min(dimFont, scaleW, scaleH);
          }
        }
        const showLabelFinal = showLabel && labelFont >= MIN_LABEL_FONT;

        // Color: use colorMap if provided, else default blue
        const color = colorMap
          ? getPartColor(colorMap, pl.part_id)
          : DEFAULT_COLOR;

        // Highlight / dim logic — matches by base part name so all instances highlight together
        const partBase = getBasePartName(pl.part_id);
        const isHighlighted = hasHighlight && partBase === highlightBase;
        const isDimmed = hasHighlight && partBase !== highlightBase;
        const partOpacity = isDimmed ? 0.35 : 1;
        const strokeW = isHighlighted ? 2 : 0.75;

        // Grain pattern ID (only when grain overlay is enabled and placement has grain info)
        const grainPatternId =
          showGrainDirection && pl.grain && pl.grain !== 'any'
            ? `${pid}-grain-${pl.grain}`
            : null;

        // Edge banding flags
        const bands = showEdgeBanding && pl.band_edges ? pl.band_edges : null;

        return (
          <g
            key={i}
            clipPath={`url(#${pid}-clip-${i})`}
            style={{
              cursor: interactive ? 'pointer' : undefined,
              transition: 'opacity 150ms ease',
              opacity: partOpacity,
            }}
            onMouseEnter={
              interactive ? () => onPartHover?.(pl.part_id) : undefined
            }
            onMouseLeave={
              interactive ? () => onPartHover?.(null) : undefined
            }
            onClick={
              interactive ? () => onPartClick?.(pl.part_id) : undefined
            }
          >
            {/* Part rectangle */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={1}
              ry={1}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={strokeW}
              className={isHighlighted ? 'part-highlighted' : undefined}
              style={{ transition: 'stroke-width 150ms ease' }}
            />

            {/* Grain direction overlay */}
            {grainPatternId && (
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={1}
                ry={1}
                fill={`url(#${grainPatternId})`}
                pointerEvents="none"
              />
            )}

            {/* Edge banding ticks */}
            {bands?.top && (
              <rect
                x={x}
                y={y}
                width={w}
                height={Math.min(EDGE_BAND_THICKNESS, h * 0.15)}
                fill={EDGE_BAND_COLOR}
                opacity={0.7}
                pointerEvents="none"
              />
            )}
            {bands?.bottom && (
              <rect
                x={x}
                y={y + h - Math.min(EDGE_BAND_THICKNESS, h * 0.15)}
                width={w}
                height={Math.min(EDGE_BAND_THICKNESS, h * 0.15)}
                fill={EDGE_BAND_COLOR}
                opacity={0.7}
                pointerEvents="none"
              />
            )}
            {bands?.left && (
              <rect
                x={x}
                y={y}
                width={Math.min(EDGE_BAND_THICKNESS, w * 0.15)}
                height={h}
                fill={EDGE_BAND_COLOR}
                opacity={0.7}
                pointerEvents="none"
              />
            )}
            {bands?.right && (
              <rect
                x={x + w - Math.min(EDGE_BAND_THICKNESS, w * 0.15)}
                y={y}
                width={Math.min(EDGE_BAND_THICKNESS, w * 0.15)}
                height={h}
                fill={EDGE_BAND_COLOR}
                opacity={0.7}
                pointerEvents="none"
              />
            )}

            {/* Width dimension (at top edge of part) */}
            {showWidth && (
              <text
                x={centerX}
                y={y + 10}
                fontSize={dimFont}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={color.text}
                pointerEvents="none"
              >
                {Math.round(pl.w)}
              </text>
            )}

            {/* Height dimension (at left edge of part, rotated) */}
            {showHeight && (
              <text
                x={x + 10}
                y={centerY}
                fontSize={dimFont}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={color.text}
                transform={`rotate(-90 ${x + 10}, ${centerY})`}
                pointerEvents="none"
              >
                {Math.round(pl.h)}
              </text>
            )}

            {/* Part label (centered) — hidden in thumbnail mode, adaptively scaled */}
            {showLabelFinal && (
              <text
                x={centerX}
                y={centerY}
                fontSize={labelFont}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={color.text}
                opacity={0.8}
                pointerEvents="none"
              >
                {displayLabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

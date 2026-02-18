import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Svg,
  Line,
  Rect,
  Path,
  G,
  Text as SvgText,
} from '@react-pdf/renderer';
import type { SheetLayout, Placement } from '@/lib/cutlist/types';
import { getBasePartName } from '@/lib/cutlist/colorAssignment';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CuttingDiagramPDFProps {
  sheets: SheetLayout[];
  stockWidth: number;
  stockLength: number;
  materialLabel?: string;
  kerfMm?: number;
}

// ---------------------------------------------------------------------------
// Color palette (PDF-safe hex colors matching colorAssignment.ts)
// ---------------------------------------------------------------------------

const PDF_PALETTE = [
  { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a5f' },
  { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },
  { fill: '#fef3c7', stroke: '#d97706', text: '#78350f' },
  { fill: '#fce7f3', stroke: '#db2777', text: '#831843' },
  { fill: '#e0e7ff', stroke: '#4f46e5', text: '#312e81' },
  { fill: '#fed7aa', stroke: '#ea580c', text: '#7c2d12' },
  { fill: '#ccfbf1', stroke: '#0d9488', text: '#134e4a' },
  { fill: '#fde68a', stroke: '#ca8a04', text: '#713f12' },
  { fill: '#e9d5ff', stroke: '#9333ea', text: '#581c87' },
  { fill: '#fecaca', stroke: '#dc2626', text: '#7f1d1d' },
  { fill: '#cffafe', stroke: '#0891b2', text: '#155e75' },
  { fill: '#d1fae5', stroke: '#059669', text: '#064e3b' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assign a letter (A-Z, AA-AZ, BA-BZ, ...) to an index */
function indexToLetter(i: number): string {
  if (i < 26) return String.fromCharCode(65 + i);
  const prefix = String.fromCharCode(65 + Math.floor((i - 26) / 26));
  const suffix = String.fromCharCode(65 + ((i - 26) % 26));
  return prefix + suffix;
}

/** Build a global letter map across all sheets so parts have consistent letters */
function buildLetterMap(sheets: SheetLayout[]): Map<string, string> {
  const baseNames = new Set<string>();
  for (const sheet of sheets) {
    for (const p of sheet.placements) {
      baseNames.add(getBasePartName(p.part_id));
    }
  }
  const sorted = Array.from(baseNames).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  const map = new Map<string, string>();
  sorted.forEach((name, i) => {
    map.set(name, indexToLetter(i));
  });
  return map;
}

function buildColorMap(sheets: SheetLayout[]): Map<string, typeof PDF_PALETTE[0]> {
  const baseNames = new Set<string>();
  for (const sheet of sheets) {
    for (const p of sheet.placements) {
      baseNames.add(getBasePartName(p.part_id));
    }
  }
  const sorted = Array.from(baseNames).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  const map = new Map<string, typeof PDF_PALETTE[0]>();
  sorted.forEach((name, i) => {
    map.set(name, PDF_PALETTE[i % PDF_PALETTE.length]);
  });
  return map;
}

interface LegendRow {
  letter: string;
  name: string;
  qty: number;
  length_mm: number;
  width_mm: number;
  grain?: string;
  color: typeof PDF_PALETTE[0];
}

function buildLegend(
  placements: Placement[],
  letterMap: Map<string, string>,
  colorMap: Map<string, typeof PDF_PALETTE[0]>
): LegendRow[] {
  const grouped = new Map<
    string,
    { count: number; length_mm: number; width_mm: number; displayName: string; grain?: string }
  >();
  for (const p of placements) {
    const base = getBasePartName(p.part_id);
    const existing = grouped.get(base);
    if (existing) {
      existing.count += 1;
    } else {
      const rawLabel = p.label || p.part_id;
      const displayName = rawLabel === p.part_id ? base : rawLabel;
      grouped.set(base, {
        count: 1,
        length_mm: p.original_length_mm ?? p.h,
        width_mm: p.original_width_mm ?? p.w,
        displayName,
        grain: p.grain,
      });
    }
  }

  const rows: LegendRow[] = [];
  for (const [base, info] of grouped) {
    rows.push({
      letter: letterMap.get(base) ?? '?',
      name: info.displayName,
      qty: info.count,
      length_mm: Math.round(info.length_mm),
      width_mm: Math.round(info.width_mm),
      grain: info.grain,
      color: colorMap.get(base) ?? PDF_PALETTE[0],
    });
  }
  rows.sort((a, b) => a.letter.localeCompare(b.letter));
  return rows;
}

/**
 * Calculate total length of cuts for all placements on a sheet.
 * Sum of perimeters of all placed parts.
 */
function calcCutLength(placements: Placement[]): number {
  let totalMm = 0;
  for (const p of placements) {
    totalMm += 2 * (p.w + p.h);
  }
  return totalMm;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const DIM_OFFSET = 22; // space for dimension labels outside diagram
const ARROW_SIZE = 3;  // arrowhead size

const s = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 30,
    fontFamily: 'Helvetica',
    fontSize: 9,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 6,
  },
  headerTitle: { fontSize: 14, fontWeight: 'bold' },
  headerSub: { fontSize: 9, color: '#64748b' },
  diagramSection: {
    marginBottom: 6,
  },
  legendHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 2,
    marginBottom: 2,
  },
  legendRow: {
    flexDirection: 'row',
    paddingVertical: 1.5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  legendCell: { fontSize: 8 },
  legendCellBold: { fontSize: 8, fontWeight: 'bold' },
  colLetter: { width: 30 },
  colSwatch: { width: 14 },
  colName: { width: 130, paddingLeft: 4 },
  colGrain: { width: 40, textAlign: 'center' },
  colQty: { width: 30, textAlign: 'right' },
  colL: { width: 55, textAlign: 'right' },
  colW: { width: 55, textAlign: 'right' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    paddingTop: 4,
    marginTop: 4,
  },
  footerText: { fontSize: 8, color: '#64748b' },
  swatch: {
    width: 10,
    height: 10,
    borderWidth: 0.5,
    marginTop: 1,
  },
});

// ---------------------------------------------------------------------------
// Diagram area sizing
// ---------------------------------------------------------------------------

const DIAGRAM_CONTENT_MAX_W = 535 - DIM_OFFSET;

const PAGE_USABLE_H = 782;
const FIXED_CHROME_H = 78;
const LEGEND_ROW_H = 13;
const DIAGRAM_MAX_H_ABSOLUTE = 500;

function calcDiagramMaxH(legendRowCount: number): number {
  const legendH = legendRowCount * LEGEND_ROW_H;
  const available = PAGE_USABLE_H - FIXED_CHROME_H - legendH;
  return Math.max(120, Math.min(available, DIAGRAM_MAX_H_ABSOLUTE));
}

function calcScale(stockHoriz: number, stockVert: number, maxH: number) {
  const sx = DIAGRAM_CONTENT_MAX_W / stockHoriz;
  const sy = (maxH - DIM_OFFSET) / stockVert;
  return Math.min(sx, sy);
}

// ---------------------------------------------------------------------------
// SVG Arrowhead helper
// ---------------------------------------------------------------------------

/** Returns a Path `d` for an arrowhead pointing in the given direction */
function arrowPath(
  tipX: number,
  tipY: number,
  direction: 'left' | 'right' | 'up' | 'down'
): string {
  const s = ARROW_SIZE;
  switch (direction) {
    case 'right':
      return `M${tipX},${tipY} L${tipX - s},${tipY - s / 2} L${tipX - s},${tipY + s / 2} Z`;
    case 'left':
      return `M${tipX},${tipY} L${tipX + s},${tipY - s / 2} L${tipX + s},${tipY + s / 2} Z`;
    case 'down':
      return `M${tipX},${tipY} L${tipX - s / 2},${tipY - s} L${tipX + s / 2},${tipY - s} Z`;
    case 'up':
      return `M${tipX},${tipY} L${tipX - s / 2},${tipY + s} L${tipX + s / 2},${tipY + s} Z`;
  }
}

/** Data for positioning a vertical dimension overlay */
interface VertDimOverlay {
  /** Left edge of the part in SVG coords (px from SVG left) */
  left: number;
  /** Top edge of the part in SVG coords (px from SVG top) */
  top: number;
  /** Part height in SVG coords */
  height: number;
  /** Dimension text (e.g. "1726 mm") */
  text: string;
  /** Text color */
  color: string;
  /** Font size */
  fontSize: number;
}

// ---------------------------------------------------------------------------
// SVG Diagram Component
// ---------------------------------------------------------------------------

function DiagramSvg({
  sheet,
  scale,
  diagramW,
  diagramH,
  letterMap,
  colorMap,
}: {
  sheet: SheetLayout;
  scale: number;
  diagramW: number;
  diagramH: number;
  letterMap: Map<string, string>;
  colorMap: Map<string, typeof PDF_PALETTE[0]>;
}) {
  const svgW = diagramW + DIM_OFFSET;
  const svgH = diagramH + DIM_OFFSET;
  const ox = DIM_OFFSET; // sheet origin x
  const oy = DIM_OFFSET; // sheet origin y

  // Waste hatching lines (45° diagonal, spaced every 8pt)
  const HATCH_SPACING = 8;
  const hatchLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const totalSpan = diagramW + diagramH;
  for (let d = HATCH_SPACING; d < totalSpan; d += HATCH_SPACING) {
    const x1 = Math.max(0, d - diagramH);
    const y1 = Math.min(d, diagramH);
    const x2 = Math.min(d, diagramW);
    const y2 = Math.max(0, d - diagramW);
    hatchLines.push({ x1: ox + x1, y1: oy + y1, x2: ox + x2, y2: oy + y2 });
  }

  // Dimension line Y position (above sheet)
  const dimLineY = oy - 10;
  // Dimension line X position (left of sheet)
  const dimLineX = ox - 10;

  return (
    <Svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
      {/* === Top dimension line with arrows (sheet width) === */}
      <Line x1={ox} y1={dimLineY} x2={ox + diagramW} y2={dimLineY} stroke="#475569" strokeWidth="0.5" />
      <Path d={arrowPath(ox, dimLineY, 'left')} fill="#475569" />
      <Path d={arrowPath(ox + diagramW, dimLineY, 'right')} fill="#475569" />
      {/* Tick lines down to sheet edge */}
      <Line x1={ox} y1={dimLineY - 2} x2={ox} y2={oy} stroke="#94a3b8" strokeWidth="0.3" />
      <Line x1={ox + diagramW} y1={dimLineY - 2} x2={ox + diagramW} y2={oy} stroke="#94a3b8" strokeWidth="0.3" />

      {/* === Left dimension line with arrows (sheet length) === */}
      <Line x1={dimLineX} y1={oy} x2={dimLineX} y2={oy + diagramH} stroke="#475569" strokeWidth="0.5" />
      <Path d={arrowPath(dimLineX, oy, 'up')} fill="#475569" />
      <Path d={arrowPath(dimLineX, oy + diagramH, 'down')} fill="#475569" />
      {/* Tick lines across to sheet edge */}
      <Line x1={dimLineX - 2} y1={oy} x2={ox} y2={oy} stroke="#94a3b8" strokeWidth="0.3" />
      <Line x1={dimLineX - 2} y1={oy + diagramH} x2={ox} y2={oy + diagramH} stroke="#94a3b8" strokeWidth="0.3" />

      {/* Sheet background */}
      <Rect x={ox} y={oy} width={diagramW} height={diagramH} fill="#f1f5f9" stroke="#475569" strokeWidth="0.75" />

      {/* Waste hatching */}
      {hatchLines.map((l, i) => (
        <Line key={`h-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#94a3b8" strokeWidth="0.3" strokeOpacity="0.3" />
      ))}

      {/* Part rectangles + labels + horizontal dimensions + grain lines */}
      {sheet.placements.map((p, i) => {
        const base = getBasePartName(p.part_id);
        const letter = letterMap.get(base) ?? '?';
        const color = colorMap.get(base) ?? PDF_PALETTE[0];
        const px = ox + p.x * scale;
        const py = oy + p.y * scale;
        const pw = p.w * scale;
        const ph = p.h * scale;
        const cx = px + pw / 2;
        const cy = py + ph / 2;

        // Adaptive font sizes based on part size
        const minDim = Math.min(pw, ph);
        const letterSize = Math.max(10, Math.min(22, minDim * 0.35));
        const dimSize = Math.max(5.5, Math.min(11, minDim * 0.18));

        // Placed dimensions for display (matches visual size on sheet)
        const horizDim = Math.round(p.w);

        // Show horiz dim if part is wide enough
        const showHorizDim = pw > 24;

        // Grain indicator: simple line instead of arrow
        const showGrain = p.grain && p.grain !== 'any' && pw >= 20 && ph >= 20;
        const grainHoriz = p.grain === 'width';
        const grainCx = px + pw - 8;
        const grainCy = py + ph - 8;
        const grainLen = Math.min(12, minDim * 0.3) / 2;

        return (
          <G key={`part-${i}`}>
            {/* Part fill */}
            <Rect x={px} y={py} width={pw} height={ph} fill={color.fill} stroke={color.stroke} strokeWidth="0.75" />

            {/* Letter — centered */}
            <SvgText
              x={cx}
              y={cy + letterSize * 0.35}
              fill={color.text}
              textAnchor="middle"
              style={{ fontSize: letterSize, fontWeight: 'bold' }}
            >
              {letter}
            </SvgText>

            {/* Horizontal dimension — along top edge */}
            {showHorizDim && (
              <SvgText
                x={cx}
                y={py + dimSize + 2}
                fill={color.text}
                textAnchor="middle"
                opacity={0.8}
                style={{ fontSize: dimSize, fontWeight: 'bold' }}
              >
                {`${horizDim} mm`}
              </SvgText>
            )}

            {/* Grain direction line (vertical = length grain, horizontal = width grain) */}
            {showGrain && (
              grainHoriz ? (
                <Line
                  x1={grainCx - grainLen} y1={grainCy}
                  x2={grainCx + grainLen} y2={grainCy}
                  stroke="#475569" strokeWidth="0.75" strokeOpacity="0.5"
                />
              ) : (
                <Line
                  x1={grainCx} y1={grainCy - grainLen}
                  x2={grainCx} y2={grainCy + grainLen}
                  stroke="#475569" strokeWidth="0.75" strokeOpacity="0.5"
                />
              )
            )}
          </G>
        );
      })}
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Sheet Page Component
// ---------------------------------------------------------------------------

function SheetPage({
  sheet,
  sheetIndex,
  totalSheets,
  stockLength,
  stockWidth,
  materialLabel,
  kerfMm,
  letterMap,
  colorMap,
}: {
  sheet: SheetLayout;
  sheetIndex: number;
  totalSheets: number;
  stockLength: number;
  stockWidth: number;
  materialLabel?: string;
  kerfMm?: number;
  letterMap: Map<string, string>;
  colorMap: Map<string, typeof PDF_PALETTE[0]>;
}) {
  const sheetL = sheet.stock_length_mm || stockLength;
  const sheetW = sheet.stock_width_mm || stockWidth;

  const legend = buildLegend(sheet.placements, letterMap, colorMap);
  const maxH = calcDiagramMaxH(legend.length);

  // Match SheetPreview: x runs along width (horiz), y runs along length (vert)
  const scale = calcScale(sheetW, sheetL, maxH);
  const diagramW = sheetW * scale;
  const diagramH = sheetL * scale;

  const sheetArea = sheetL * sheetW;
  const usedArea = sheet.used_area_mm2 || 0;
  const efficiency = sheetArea > 0 ? (usedArea / sheetArea) * 100 : 0;
  const partsCount = sheet.placements.length;
  const cutLengthMm = calcCutLength(sheet.placements);
  const cutLengthM = (cutLengthMm / 1000).toFixed(2);

  const label = sheet.material_label || materialLabel || '';

  // Pre-compute vertical dimension overlay positions (same logic as DiagramSvg)
  const vertOverlays: VertDimOverlay[] = [];
  const ox = DIM_OFFSET;
  const oy = DIM_OFFSET;
  for (const p of sheet.placements) {
    const base = getBasePartName(p.part_id);
    const color = colorMap.get(base) ?? PDF_PALETTE[0];
    const px = ox + p.x * scale;
    const py = oy + p.y * scale;
    const pw = p.w * scale;
    const ph = p.h * scale;
    const minDim = Math.min(pw, ph);
    const dimSize = Math.max(5.5, Math.min(11, minDim * 0.18));
    const vertDim = Math.round(p.h);
    if (ph > 30) {
      vertOverlays.push({
        left: px,
        top: py,
        height: ph,
        text: `${vertDim} mm`,
        color: color.text,
        fontSize: dimSize,
      });
    }
  }

  return (
    <Page size="A4" style={s.page}>
      {/* Header */}
      <View style={s.headerRow}>
        <View>
          <Text style={s.headerTitle}>Cutting Diagram</Text>
          <Text style={s.headerSub}>
            {label ? `${label} ` : ''}
            {sheetL} x {sheetW} mm
            {kerfMm != null && kerfMm > 0 ? `  |  Kerf: ${kerfMm} mm` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' as const }}>
          <Text style={s.headerSub}>
            Sheet {sheetIndex + 1} / {totalSheets}
          </Text>
          <Text style={s.headerSub}>
            {new Date().toISOString().slice(0, 10)}
          </Text>
        </View>
      </View>

      {/* Diagram with SVG + text overlays */}
      <View style={s.diagramSection}>
        <DiagramSvg
          sheet={sheet}
          scale={scale}
          diagramW={diagramW}
          diagramH={diagramH}
          letterMap={letterMap}
          colorMap={colorMap}
        />
        {/* Sheet dimension text overlay (View/Text for reliable font rendering) */}
        <View style={{ position: 'absolute', left: 0, top: 0, width: diagramW + DIM_OFFSET, height: diagramH + DIM_OFFSET }}>
          {/* Top dimension text (sheet width) */}
          <View style={{ position: 'absolute', left: DIM_OFFSET, top: 0, width: diagramW, height: DIM_OFFSET - 12, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: '#334155' }}>{sheetW} mm</Text>
          </View>
          {/* Left dimension text (sheet length) — rotated vertical */}
          <View style={{ position: 'absolute', left: 2, top: DIM_OFFSET + diagramH, width: diagramH, height: DIM_OFFSET - 12, transform: 'rotate(-90deg)', transformOrigin: '0 0', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 2 }}>
            <Text style={{ fontSize: 7, fontWeight: 'bold', color: '#334155' }}>{sheetL} mm</Text>
          </View>
          {/* Vertical dimension labels for each part (rotated -90deg via View transform) */}
          {vertOverlays.map((v, i) => (
            <View
              key={`vdim-${i}`}
              style={{
                position: 'absolute',
                // Rotated -90deg around top-left: extends upward from bottom of panel
                left: v.left + v.fontSize * 0.6,
                top: v.top + v.height,
                width: v.height,
                height: v.fontSize + 2,
                transform: 'rotate(-90deg)',
                transformOrigin: '0 0',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: v.fontSize, fontWeight: 'bold', color: v.color, opacity: 0.8 }}>
                {v.text}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Legend table */}
      <View style={s.legendHeader}>
        <Text style={[s.legendCellBold, s.colLetter]}>Letter</Text>
        <View style={s.colSwatch} />
        <Text style={[s.legendCellBold, s.colName]}>Part Name</Text>
        <Text style={[s.legendCellBold, s.colGrain]}>Grain</Text>
        <Text style={[s.legendCellBold, s.colQty]}>Qty</Text>
        <Text style={[s.legendCellBold, s.colL]}>L (mm)</Text>
        <Text style={[s.legendCellBold, s.colW]}>W (mm)</Text>
      </View>
      {legend.map((row) => (
        <View key={row.letter} style={s.legendRow}>
          <Text style={[s.legendCellBold, s.colLetter]}>{row.letter}</Text>
          <View
            style={[
              s.swatch,
              s.colSwatch,
              {
                backgroundColor: row.color.fill,
                borderColor: row.color.stroke,
              },
            ]}
          />
          <Text style={[s.legendCell, s.colName]}>{row.name}</Text>
          <Text style={[s.legendCell, s.colGrain]}>
            {row.grain === 'length' ? '|' : row.grain === 'width' ? '-' : 'o'}
          </Text>
          <Text style={[s.legendCell, s.colQty]}>{row.qty}</Text>
          <Text style={[s.legendCell, s.colL]}>{row.length_mm}</Text>
          <Text style={[s.legendCell, s.colW]}>{row.width_mm}</Text>
        </View>
      ))}

      {/* Footer */}
      <View style={s.footer}>
        <Text style={s.footerText}>
          {partsCount} part{partsCount !== 1 ? 's' : ''} on this sheet
        </Text>
        <Text style={s.footerText}>
          Cuts: {cutLengthM} m  |  Efficiency: {efficiency.toFixed(1)}%  |  Used:{' '}
          {(usedArea / 1_000_000).toFixed(2)} m{'\u00B2'} of{' '}
          {(sheetArea / 1_000_000).toFixed(2)} m{'\u00B2'}
        </Text>
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function CuttingDiagramPDF({
  sheets,
  stockWidth,
  stockLength,
  materialLabel,
  kerfMm,
}: CuttingDiagramPDFProps) {
  const letterMap = buildLetterMap(sheets);
  const colorMap = buildColorMap(sheets);

  return (
    <Document>
      {sheets.map((sheet, idx) => (
        <SheetPage
          key={sheet.sheet_id}
          sheet={sheet}
          sheetIndex={idx}
          totalSheets={sheets.length}
          stockLength={stockLength}
          stockWidth={stockWidth}
          materialLabel={materialLabel}
          kerfMm={kerfMm}
          letterMap={letterMap}
          colorMap={colorMap}
        />
      ))}
    </Document>
  );
}

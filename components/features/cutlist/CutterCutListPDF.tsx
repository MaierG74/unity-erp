import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Svg,
  G,
  Line,
  Rect,
  Text as SvgText,
} from '@react-pdf/renderer';
import { getBasePartName } from '@/lib/cutlist/colorAssignment';
import { getPlacedBandEdges } from '@/lib/cutlist/cutter-cut-list-helpers';
import type { Placement, SheetLayout } from '@/lib/cutlist/types';
import type { CutterCutListPdfData } from '@/lib/cutlist/cutter-cut-list-types';

// Print-native styling: outlines only, black letters and dimensions, rotated
// edge labels. The PDF must be legible when printed grayscale on a panel-saw
// floor — color is dropped entirely so there is zero information loss on B&W
// printers.

type LegendRow = {
  base: string;
  letter: string;
  designation: string;
  qty: number;
  lengthMm: number;
  widthMm: number;
  grain?: string;
  edges: string;
};

type PanelSummaryRow = {
  key: string;
  qty: number;
  lengthMm: number;
  widthMm: number;
  parts: number;
};

// Portrait A4 — gives much more room for the diagram than landscape.
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 24;

// Per-sheet page diagram area: sheet length is drawn horizontally to fit
// the natural orientation of the cutting list reference output.
const SHEET_HEADER_HEIGHT = 64;
const SHEET_FOOTER_HEIGHT = 28;
const SHEET_GAP = 10;
const SHEET_DIAGRAM_W = PAGE_WIDTH - 2 * MARGIN;       // 547
const SHEET_DIAGRAM_H_MAX = 460;                       // cap; legend gets the rest

const STROKE = '#000000';
const STROKE_LIGHT = '#9ca3af';
const TEXT = '#000000';
const TEXT_MUTED = '#4b5563';

const s = StyleSheet.create({
  page: {
    padding: MARGIN,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: TEXT,
    backgroundColor: '#ffffff',
  },
  // Cover page
  coverHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: STROKE,
    paddingBottom: 10,
    marginBottom: 16,
  },
  headerCol: { flex: 1 },
  headerCenter: { flex: 1.15, alignItems: 'center' },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 9, color: TEXT_MUTED },
  material: { fontSize: 13, fontWeight: 'bold', textAlign: 'center' },
  backerTag: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: STROKE,
    fontSize: 9,
    fontWeight: 'bold',
  },
  sectionTitle: { fontSize: 11, fontWeight: 'bold', marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: STROKE,
    padding: 10,
  },
  statLabel: { fontSize: 8, color: TEXT_MUTED, textTransform: 'uppercase' },
  statValue: { fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  table: { borderWidth: 1, borderColor: STROKE },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottomWidth: 1,
    borderBottomColor: STROKE,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: STROKE_LIGHT,
  },
  th: { padding: 8, fontSize: 10, fontWeight: 'bold' },
  td: { padding: 8, fontSize: 10 },
  // Per-sheet page
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: STROKE,
    paddingBottom: 8,
    marginBottom: SHEET_GAP,
    height: SHEET_HEADER_HEIGHT,
  },
  sheetSideCol: { width: 150 },
  sheetSideColRight: { width: 150, alignItems: 'flex-end' },
  sheetCenterCol: { flex: 1, alignItems: 'center' },
  sheetTitle: { fontSize: 11, fontWeight: 'bold' },
  sheetSub: { fontSize: 9, color: TEXT_MUTED, marginTop: 2 },
  // Big, prominent material name in the per-sheet header — safety-critical
  // so the cutter pulls the right colour board without misreading.
  sheetMaterial: { fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
  sheetMaterialBacker: {
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: STROKE,
  },
  // Legend (below diagram). Generous top margin separates it visually from
  // the cutting diagram so the operator's eye doesn't bleed between them.
  legendBlock: { marginTop: 24 },
  legendHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: STROKE,
    paddingBottom: 6,
  },
  legendRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: STROKE_LIGHT,
    paddingVertical: 6,
    alignItems: 'center',
  },
  letterCell: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterText: { fontSize: 14, fontWeight: 'bold' },
  legendText: { fontSize: 11 },
  legendBold: { fontSize: 11, fontWeight: 'bold' },
  // Footer (absolute)
  footer: {
    position: 'absolute',
    left: MARGIN,
    right: MARGIN,
    bottom: MARGIN / 2,
    borderTopWidth: 1,
    borderTopColor: STROKE_LIGHT,
    paddingTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 8, color: TEXT_MUTED },
});

function indexToLetter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  const prefix = String.fromCharCode(65 + Math.floor((index - 26) / 26));
  const suffix = String.fromCharCode(65 + ((index - 26) % 26));
  return `${prefix}${suffix}`;
}

function buildLetterMap(layouts: SheetLayout[]): Map<string, string> {
  const bases = new Set<string>();
  for (const layout of layouts) {
    for (const placement of layout.placements) {
      bases.add(getBasePartName(placement.part_id));
    }
  }
  const sorted = Array.from(bases).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  return new Map(sorted.map((base, index) => [base, indexToLetter(index)]));
}

function getDesignation(placement: Placement, labels: Map<string, string>): string {
  const base = getBasePartName(placement.part_id);
  return labels.get(base) ?? placement.label ?? placement.part_id;
}

function getEdgeLabel(placement: Placement): string {
  const edges = getPlacedBandEdges(placement);
  const labels = [
    edges.top ? 'T' : '',
    edges.right ? 'R' : '',
    edges.bottom ? 'B' : '',
    edges.left ? 'L' : '',
  ].filter(Boolean);
  return labels.length > 0 ? labels.join('') : '-';
}

function buildLegendRows(
  placements: Placement[],
  letterMap: Map<string, string>,
  labels: Map<string, string>,
): LegendRow[] {
  const rows = new Map<string, LegendRow>();
  for (const placement of placements) {
    const base = getBasePartName(placement.part_id);
    const existing = rows.get(base);
    if (existing) {
      existing.qty += 1;
      continue;
    }
    rows.set(base, {
      base,
      letter: letterMap.get(base) ?? '?',
      designation: getDesignation(placement, labels),
      qty: 1,
      lengthMm: Math.round(placement.original_length_mm ?? placement.h),
      widthMm: Math.round(placement.original_width_mm ?? placement.w),
      grain: placement.grain,
      edges: getEdgeLabel(placement),
    });
  }
  return Array.from(rows.values()).sort((a, b) => a.letter.localeCompare(b.letter));
}

function buildPanelSummary(data: CutterCutListPdfData): PanelSummaryRow[] {
  const rows = new Map<string, PanelSummaryRow>();
  for (const layout of data.layouts) {
    const lengthMm = layout.stock_length_mm ?? data.group.stock_sheet_spec.length_mm;
    const widthMm = layout.stock_width_mm ?? data.group.stock_sheet_spec.width_mm;
    const key = `${lengthMm}x${widthMm}`;
    const existing = rows.get(key);
    if (existing) {
      existing.qty += 1;
      existing.parts += layout.placements.length;
    } else {
      rows.set(key, { key, qty: 1, lengthMm, widthMm, parts: layout.placements.length });
    }
  }
  return Array.from(rows.values());
}

function CoverPage({ data }: { data: CutterCutListPdfData }) {
  const panelRows = buildPanelSummary(data);
  const isoDate = new Date(data.generatedAt).toISOString().slice(0, 10);

  return (
    <Page size="A4" orientation="portrait" style={s.page}>
      <View style={s.coverHeader}>
        <View style={s.headerCol}>
          <Text style={s.title}>Cutter Cut List</Text>
          <Text style={s.subtitle}>Order {data.orderNumber}</Text>
          <Text style={s.subtitle}>{data.customerName}</Text>
        </View>
        <View style={s.headerCenter}>
          <Text style={s.material}>{data.materialName}</Text>
          <Text style={s.subtitle}>{data.group.board_type}</Text>
          {data.runKind === 'backer' && <Text style={s.backerTag}>Backer</Text>}
        </View>
        <View style={s.headerRight}>
          <Text style={s.subtitle}>{isoDate}</Text>
          <Text style={s.subtitle}>Generated</Text>
          <Text style={s.subtitle}>{data.generatedAt}</Text>
        </View>
      </View>

      <Text style={s.sectionTitle}>Statistics</Text>
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Sheets</Text>
          <Text style={s.statValue}>{data.sheetsRequired}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Parts</Text>
          <Text style={s.statValue}>{data.group.total_parts}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Waste %</Text>
          <Text style={s.statValue}>{data.group.waste_percent}</Text>
        </View>
      </View>

      <Text style={s.sectionTitle}>Panel Summary</Text>
      <View style={s.table}>
        <View style={s.tableHeader}>
          <Text style={[s.th, { width: 60 }]}>Qty</Text>
          <Text style={[s.th, { width: 110 }]}>Length (mm)</Text>
          <Text style={[s.th, { width: 110 }]}>Width (mm)</Text>
          <Text style={[s.th, { width: 160 }]}>Total Area (m2)</Text>
          <Text style={[s.th, { width: 80 }]}>Parts</Text>
        </View>
        {panelRows.map((row) => {
          const totalAreaM2 = (row.qty * row.lengthMm * row.widthMm) / 1_000_000;
          return (
            <View key={row.key} style={s.tableRow}>
              <Text style={[s.td, { width: 60 }]}>{row.qty}</Text>
              <Text style={[s.td, { width: 110 }]}>{row.lengthMm}</Text>
              <Text style={[s.td, { width: 110 }]}>{row.widthMm}</Text>
              <Text style={[s.td, { width: 160 }]}>{totalAreaM2.toFixed(2)}</Text>
              <Text style={[s.td, { width: 80 }]}>{row.parts}</Text>
            </View>
          );
        })}
      </View>
    </Page>
  );
}

type PlacementGeom = {
  px: number;
  py: number;
  pw: number;
  ph: number;
  letter: string;
  letterSize: number;
  dimSize: number;
  dimLengthMm: number;
  dimWidthMm: number;
};

function computePlacementGeom(
  placement: Placement,
  scale: number,
  letterMap: Map<string, string>,
): PlacementGeom {
  // Axis swap: sheet length is drawn horizontally on the page, so the data's
  // y-axis (along sheet length) maps to page-x, and data's x-axis (across
  // sheet width) maps to page-y.
  const px = placement.y * scale;
  const py = placement.x * scale;
  const pw = placement.h * scale;
  const ph = placement.w * scale;
  const minDim = Math.min(pw, ph);
  return {
    px,
    py,
    pw,
    ph,
    letter: letterMap.get(getBasePartName(placement.part_id)) ?? '?',
    letterSize: Math.max(11, Math.min(28, minDim * 0.42)),
    dimSize: Math.max(6, Math.min(9, minDim * 0.13)),
    dimLengthMm: Math.round(placement.h),
    dimWidthMm: Math.round(placement.w),
  };
}

function SheetDiagram({
  sheet,
  sheetLength,
  sheetWidth,
  letterMap,
}: {
  sheet: SheetLayout;
  sheetLength: number;
  sheetWidth: number;
  letterMap: Map<string, string>;
}) {
  const scale = Math.min(SHEET_DIAGRAM_W / sheetLength, SHEET_DIAGRAM_H_MAX / sheetWidth);
  const diagramW = sheetLength * scale;
  const diagramH = sheetWidth * scale;

  return (
    <View style={{ position: 'relative', width: diagramW, height: diagramH }}>
      {/* SVG layer: rectangles, edge bands, letter labels, horizontal top/bottom dims */}
      <Svg
        width={diagramW}
        height={diagramH}
        viewBox={`0 0 ${diagramW} ${diagramH}`}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Rect
          x={0}
          y={0}
          width={diagramW}
          height={diagramH}
          fill="#ffffff"
          stroke={STROKE}
          strokeWidth="1"
        />

        {sheet.offcut_summary?.reusableOffcuts?.map((offcut, index) => {
          const ox = offcut.y * scale;
          const oy = offcut.x * scale;
          const ow = offcut.h * scale;
          const oh = offcut.w * scale;
          return (
            <G key={`offcut-${index}`}>
              <Rect
                x={ox}
                y={oy}
                width={ow}
                height={oh}
                fill="#ffffff"
                stroke={STROKE_LIGHT}
                strokeWidth="0.6"
              />
              <SvgText
                x={ox + ow / 2}
                y={oy + oh / 2 + 3}
                textAnchor="middle"
                fill={TEXT_MUTED}
                style={{ fontSize: 7, fontWeight: 'bold' }}
              >
                OFFCUT
              </SvgText>
            </G>
          );
        })}

        {sheet.placements.map((placement, index) => {
          const g = computePlacementGeom(placement, scale, letterMap);
          const edges = getPlacedBandEdges(placement);
          return (
            <G key={`${placement.part_id}-${index}`}>
              <Rect
                x={g.px}
                y={g.py}
                width={g.pw}
                height={g.ph}
                fill="#ffffff"
                stroke={STROKE}
                strokeWidth="0.8"
              />
              {/* Edge-banding marks; getPlacedBandEdges accounts for placement
                  rotation. The diagram is drawn with sheet length horizontal,
                  so the placement's "top" edge is the page-left edge of the
                  rendered rectangle, "right" is bottom, etc. */}
              {edges.top && (
                <Line x1={g.px} y1={g.py} x2={g.px} y2={g.py + g.ph} stroke={STROKE} strokeWidth="2.5" />
              )}
              {edges.right && (
                <Line x1={g.px} y1={g.py + g.ph} x2={g.px + g.pw} y2={g.py + g.ph} stroke={STROKE} strokeWidth="2.5" />
              )}
              {edges.bottom && (
                <Line x1={g.px + g.pw} y1={g.py} x2={g.px + g.pw} y2={g.py + g.ph} stroke={STROKE} strokeWidth="2.5" />
              )}
              {edges.left && (
                <Line x1={g.px} y1={g.py} x2={g.px + g.pw} y2={g.py} stroke={STROKE} strokeWidth="2.5" />
              )}

              <SvgText
                x={g.px + g.pw / 2}
                y={g.py + g.ph / 2 + g.letterSize * 0.35}
                textAnchor="middle"
                fill={TEXT}
                style={{ fontSize: g.letterSize, fontWeight: 'bold' }}
              >
                {g.letter}
              </SvgText>

              {/* Top edge dimension only — opposite side is implied by the
                  rectangle. More vertical padding so the number doesn't
                  crowd the top edge. */}
              {g.pw > 30 && (
                <SvgText
                  x={g.px + g.pw / 2}
                  y={g.py + g.dimSize + 5}
                  textAnchor="middle"
                  fill={TEXT}
                  style={{ fontSize: g.dimSize }}
                >
                  {g.dimLengthMm} mm
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>

      {/* View overlay layer: rotated side-edge dimensions. @react-pdf/renderer
          doesn't reliably honor `transform` on SvgText, so we use absolutely-
          positioned Views with CSS rotation per the cutlist-pdf skill rules.
          With `rotate(-90deg)` and `transformOrigin: '0 0'`, the View's top-
          left stays put and the content rotates counterclockwise: pre-rotation
          width becomes post-rotation visual height, and the content extends
          UPWARD from the anchor. We render the LEFT edge only — the opposite
          side is implied by the rectangle. */}
      {sheet.placements.map((placement, index) => {
        const g = computePlacementGeom(placement, scale, letterMap);
        if (g.ph <= 30) return null;
        const labelText = `${g.dimWidthMm} mm`;
        const inset = g.dimSize * 0.6;
        return (
          <View
            key={`side-${placement.part_id}-${index}`}
            style={{
              position: 'absolute',
              left: g.px + inset,
              top: g.py + g.ph,
              width: g.ph,
              height: g.dimSize + 2,
              transform: 'rotate(-90deg)',
              transformOrigin: '0 0',
            }}
          >
            <Text
              style={{
                fontSize: g.dimSize,
                textAlign: 'center',
                color: TEXT,
              }}
            >
              {labelText}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Legend({ rows }: { rows: LegendRow[] }) {
  return (
    <View style={s.legendBlock}>
      <View style={s.legendHeader}>
        <Text style={[s.legendBold, { width: 28, textAlign: 'center' }]}>Code</Text>
        <Text style={[s.legendBold, { flex: 1, paddingLeft: 6 }]}>Designation</Text>
        <Text style={[s.legendBold, { width: 32, textAlign: 'right' }]}>Qty</Text>
        <Text style={[s.legendBold, { width: 50, textAlign: 'right' }]}>L (mm)</Text>
        <Text style={[s.legendBold, { width: 50, textAlign: 'right' }]}>W (mm)</Text>
        <Text style={[s.legendBold, { width: 36, textAlign: 'center' }]}>Grain</Text>
        <Text style={[s.legendBold, { width: 40, textAlign: 'center' }]}>Edge</Text>
      </View>
      {rows.map((row) => (
        <View key={row.base} style={s.legendRow}>
          <View style={s.letterCell}>
            <Text style={s.letterText}>{row.letter}</Text>
          </View>
          <Text style={[s.legendText, { flex: 1, paddingLeft: 6 }]}>{row.designation}</Text>
          <Text style={[s.legendText, { width: 32, textAlign: 'right' }]}>{row.qty}</Text>
          <Text style={[s.legendText, { width: 50, textAlign: 'right' }]}>{row.lengthMm}</Text>
          <Text style={[s.legendText, { width: 50, textAlign: 'right' }]}>{row.widthMm}</Text>
          <Text style={[s.legendText, { width: 36, textAlign: 'center' }]}>
            {row.grain === 'length' ? '|' : row.grain === 'width' ? '-' : 'o'}
          </Text>
          <Text style={[s.legendText, { width: 40, textAlign: 'center' }]}>{row.edges}</Text>
        </View>
      ))}
    </View>
  );
}

function SheetPage({
  data,
  sheet,
  sheetIndex,
  letterMap,
  labels,
}: {
  data: CutterCutListPdfData;
  sheet: SheetLayout;
  sheetIndex: number;
  letterMap: Map<string, string>;
  labels: Map<string, string>;
}) {
  const sheetLength = sheet.stock_length_mm ?? data.group.stock_sheet_spec.length_mm;
  const sheetWidth = sheet.stock_width_mm ?? data.group.stock_sheet_spec.width_mm;
  const rows = buildLegendRows(sheet.placements, letterMap, labels);

  return (
    <Page size="A4" orientation="portrait" style={s.page}>
      <View style={s.sheetHeader}>
        <View style={s.sheetSideCol}>
          <Text style={s.sheetTitle}>Order {data.orderNumber}</Text>
          <Text style={s.sheetSub}>{data.customerName}</Text>
        </View>
        <View style={s.sheetCenterCol}>
          {/* Safety-critical: big material name so the cutter pulls the right
              colour board. The thickness/board_type sits below as a smaller
              subtitle. Backer runs get a distinct boxed tag. */}
          <Text style={s.sheetMaterial}>{data.materialName}</Text>
          <Text style={s.sheetSub}>{data.group.board_type}</Text>
          {data.runKind === 'backer' && <Text style={s.sheetMaterialBacker}>Backer</Text>}
        </View>
        <View style={s.sheetSideColRight}>
          <Text style={s.sheetSub}>{sheetLength} x {sheetWidth} mm</Text>
          <Text style={s.sheetSub}>
            Page {sheetIndex + 2} / {data.layouts.length + 1}
          </Text>
        </View>
      </View>

      {/* Diagram (sheet length drawn horizontal on the page) */}
      <SheetDiagram
        sheet={sheet}
        sheetLength={sheetLength}
        sheetWidth={sheetWidth}
        letterMap={letterMap}
      />

      {/* Legend (below diagram) */}
      <Legend rows={rows} />

      <View style={s.footer} fixed>
        <Text style={s.footerText}>
          Grain follows length | {sheet.placements.length} parts
        </Text>
        <Text style={s.footerText}>
          Sheet {sheetIndex + 1} / {data.layouts.length}
        </Text>
      </View>
    </Page>
  );
}

export function CutterCutListPDF({ data }: { data: CutterCutListPdfData }) {
  const labels = new Map(data.partLabelEntries);
  const letterMap = buildLetterMap(data.layouts);

  return (
    <Document>
      <CoverPage data={data} />
      {data.layouts.map((sheet, index) => (
        <SheetPage
          key={sheet.sheet_id}
          data={data}
          sheet={sheet}
          sheetIndex={index}
          letterMap={letterMap}
          labels={labels}
        />
      ))}
    </Document>
  );
}

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

const PALETTE = [
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
];

type PdfColor = typeof PALETTE[number];

type LegendRow = {
  base: string;
  letter: string;
  designation: string;
  qty: number;
  lengthMm: number;
  widthMm: number;
  grain?: string;
  edges: string;
  color: PdfColor;
};

type PanelSummaryRow = {
  key: string;
  qty: number;
  lengthMm: number;
  widthMm: number;
  parts: number;
};

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 24;
const DIAGRAM_WIDTH = 560;
const DIAGRAM_HEIGHT = 362;

const s = StyleSheet.create({
  page: {
    padding: MARGIN,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#111827',
    backgroundColor: '#ffffff',
  },
  coverHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: '#111827',
    paddingBottom: 10,
    marginBottom: 18,
  },
  headerCol: { flex: 1 },
  headerCenter: { flex: 1.15, alignItems: 'center' },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { fontSize: 10, color: '#475569' },
  material: { fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
  backerTag: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#111827',
    fontSize: 9,
    fontWeight: 'bold',
  },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    padding: 12,
  },
  statLabel: { fontSize: 8, color: '#64748b', textTransform: 'uppercase' },
  statValue: { fontSize: 24, fontWeight: 'bold', marginTop: 4 },
  table: { borderWidth: 1, borderColor: '#cbd5e1' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderBottomWidth: 1, borderBottomColor: '#cbd5e1' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  th: { padding: 6, fontSize: 8, fontWeight: 'bold' },
  td: { padding: 6, fontSize: 8 },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    paddingBottom: 7,
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 13, fontWeight: 'bold' },
  sheetSub: { fontSize: 8, color: '#475569', marginTop: 2 },
  contentRow: { flexDirection: 'row', gap: 12 },
  diagramBox: { width: DIAGRAM_WIDTH },
  legendBox: { flex: 1 },
  legendHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#334155', paddingBottom: 3 },
  legendRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingVertical: 3 },
  chip: { width: 18, height: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  legendText: { fontSize: 7 },
  legendBold: { fontSize: 7, fontWeight: 'bold' },
  footer: {
    position: 'absolute',
    left: MARGIN,
    right: MARGIN,
    bottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
    paddingTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 8, color: '#64748b' },
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
  const sorted = Array.from(bases).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return new Map(sorted.map((base, index) => [base, indexToLetter(index)]));
}

function buildColorMap(layouts: SheetLayout[]): Map<string, PdfColor> {
  const bases = Array.from(buildLetterMap(layouts).keys());
  return new Map(bases.map((base, index) => [base, PALETTE[index % PALETTE.length]]));
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
  colorMap: Map<string, PdfColor>,
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
      color: colorMap.get(base) ?? PALETTE[0],
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

function materialLine(data: CutterCutListPdfData): string {
  const thickness = data.group.board_type;
  const tag = data.runKind === 'backer' ? ' | Backer' : '';
  return `${data.materialName} | ${thickness} | ${data.materialColor}${tag}`;
}

function CoverPage({ data }: { data: CutterCutListPdfData }) {
  const panelRows = buildPanelSummary(data);
  const isoDate = new Date(data.generatedAt).toISOString().slice(0, 10);

  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      <View style={s.coverHeader}>
        <View style={s.headerCol}>
          <Text style={s.title}>Cutter Cut List</Text>
          <Text style={s.subtitle}>Order {data.orderNumber}</Text>
          <Text style={s.subtitle}>{data.customerName}</Text>
        </View>
        <View style={s.headerCenter}>
          <Text style={s.material}>{data.materialName}</Text>
          <Text style={s.subtitle}>{data.group.board_type} | {data.materialColor}</Text>
          {data.runKind === 'backer' && <Text style={s.backerTag}>Backer</Text>}
        </View>
        <View style={s.headerRight}>
          <Text style={s.subtitle}>{isoDate}</Text>
          <Text style={s.subtitle}>Generated: {data.generatedAt}</Text>
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
          <Text style={[s.th, { width: 80 }]}>Qty</Text>
          <Text style={[s.th, { width: 130 }]}>Length</Text>
          <Text style={[s.th, { width: 130 }]}>Width</Text>
          <Text style={[s.th, { width: 170 }]}>Total Area mm2</Text>
          <Text style={[s.th, { width: 100 }]}>Parts</Text>
        </View>
        {panelRows.map((row) => (
          <View key={row.key} style={s.tableRow}>
            <Text style={[s.td, { width: 80 }]}>{row.qty}</Text>
            <Text style={[s.td, { width: 130 }]}>{row.lengthMm}</Text>
            <Text style={[s.td, { width: 130 }]}>{row.widthMm}</Text>
            <Text style={[s.td, { width: 170 }]}>{row.qty * row.lengthMm * row.widthMm}</Text>
            <Text style={[s.td, { width: 100 }]}>{row.parts}</Text>
          </View>
        ))}
      </View>
    </Page>
  );
}

function DiagramSvg({
  sheet,
  sheetLength,
  sheetWidth,
  letterMap,
  colorMap,
}: {
  sheet: SheetLayout;
  sheetLength: number;
  sheetWidth: number;
  letterMap: Map<string, string>;
  colorMap: Map<string, PdfColor>;
}) {
  const scale = Math.min(DIAGRAM_WIDTH / sheetWidth, DIAGRAM_HEIGHT / sheetLength);
  const diagramW = sheetWidth * scale;
  const diagramH = sheetLength * scale;

  return (
    <Svg width={DIAGRAM_WIDTH} height={DIAGRAM_HEIGHT} viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}>
      <Rect x={0} y={0} width={diagramW} height={diagramH} fill="#f8fafc" stroke="#111827" strokeWidth="1" />
      {sheet.offcut_summary?.reusableOffcuts?.map((offcut, index) => (
        <G key={`offcut-${index}`}>
          <Rect
            x={offcut.x * scale}
            y={offcut.y * scale}
            width={offcut.w * scale}
            height={offcut.h * scale}
            fill="#f1f5f9"
            stroke="#94a3b8"
            strokeWidth="1"
          />
          <SvgText
            x={(offcut.x + offcut.w / 2) * scale}
            y={(offcut.y + offcut.h / 2) * scale + 3}
            textAnchor="middle"
            fill="#64748b"
            style={{ fontSize: 7, fontWeight: 'bold' }}
          >
            OFFCUT
          </SvgText>
        </G>
      ))}
      {sheet.placements.map((placement, index) => {
        const base = getBasePartName(placement.part_id);
        const letter = letterMap.get(base) ?? '?';
        const color = colorMap.get(base) ?? PALETTE[0];
        const x = placement.x * scale;
        const y = placement.y * scale;
        const w = placement.w * scale;
        const h = placement.h * scale;
        const minDim = Math.min(w, h);
        const letterSize = Math.max(9, Math.min(18, minDim * 0.32));
        const dimSize = Math.max(5, Math.min(9, minDim * 0.18));
        const edges = getPlacedBandEdges(placement);

        return (
          <G key={`${placement.part_id}-${index}`}>
            <Rect x={x} y={y} width={w} height={h} fill={color.fill} stroke={color.stroke} strokeWidth="0.8" />
            {edges.top && <Line x1={x} y1={y} x2={x + w} y2={y} stroke="#111827" strokeWidth="2.5" />}
            {edges.right && <Line x1={x + w} y1={y} x2={x + w} y2={y + h} stroke="#111827" strokeWidth="2.5" />}
            {edges.bottom && <Line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke="#111827" strokeWidth="2.5" />}
            {edges.left && <Line x1={x} y1={y} x2={x} y2={y + h} stroke="#111827" strokeWidth="2.5" />}
            <SvgText
              x={x + w / 2}
              y={y + h / 2 + letterSize * 0.35}
              textAnchor="middle"
              fill={color.text}
              style={{ fontSize: letterSize, fontWeight: 'bold' }}
            >
              {letter}
            </SvgText>
            {w > 28 && (
              <SvgText x={x + w / 2} y={y + dimSize + 2} textAnchor="middle" fill={color.text} style={{ fontSize: dimSize }}>
                {Math.round(placement.w)} mm
              </SvgText>
            )}
            {h > 28 && (
              <SvgText x={x + 3} y={y + h / 2 + 2} fill={color.text} style={{ fontSize: dimSize }}>
                {Math.round(placement.h)} mm
              </SvgText>
            )}
          </G>
        );
      })}
    </Svg>
  );
}

function Legend({ rows }: { rows: LegendRow[] }) {
  return (
    <View style={s.legendBox}>
      <View style={s.legendHeader}>
        <Text style={[s.legendBold, { width: 24 }]}>Code</Text>
        <Text style={[s.legendBold, { width: 112 }]}>Designation</Text>
        <Text style={[s.legendBold, { width: 20, textAlign: 'right' }]}>Qty</Text>
        <Text style={[s.legendBold, { width: 34, textAlign: 'right' }]}>L</Text>
        <Text style={[s.legendBold, { width: 34, textAlign: 'right' }]}>W</Text>
        <Text style={[s.legendBold, { width: 28, textAlign: 'center' }]}>Grain</Text>
        <Text style={[s.legendBold, { width: 30, textAlign: 'center' }]}>Edge</Text>
      </View>
      {rows.map((row) => (
        <View key={row.base} style={s.legendRow}>
          <View style={[s.chip, { backgroundColor: row.color.fill, borderColor: row.color.stroke }]}>
            <Text style={s.legendBold}>{row.letter}</Text>
          </View>
          <Text style={[s.legendText, { width: 118, paddingLeft: 4 }]}>{row.designation}</Text>
          <Text style={[s.legendText, { width: 20, textAlign: 'right' }]}>{row.qty}</Text>
          <Text style={[s.legendText, { width: 34, textAlign: 'right' }]}>{row.lengthMm}</Text>
          <Text style={[s.legendText, { width: 34, textAlign: 'right' }]}>{row.widthMm}</Text>
          <Text style={[s.legendText, { width: 28, textAlign: 'center' }]}>{row.grain === 'length' ? '|' : row.grain === 'width' ? '-' : 'o'}</Text>
          <Text style={[s.legendText, { width: 30, textAlign: 'center' }]}>{row.edges}</Text>
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
  colorMap,
  labels,
}: {
  data: CutterCutListPdfData;
  sheet: SheetLayout;
  sheetIndex: number;
  letterMap: Map<string, string>;
  colorMap: Map<string, PdfColor>;
  labels: Map<string, string>;
}) {
  const sheetLength = sheet.stock_length_mm ?? data.group.stock_sheet_spec.length_mm;
  const sheetWidth = sheet.stock_width_mm ?? data.group.stock_sheet_spec.width_mm;
  const rows = buildLegendRows(sheet.placements, letterMap, colorMap, labels);

  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      <View style={s.sheetHeader}>
        <View>
          <Text style={s.sheetTitle}>Order {data.orderNumber} | {data.customerName}</Text>
          <Text style={s.sheetSub}>{materialLine(data)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.sheetSub}>{sheetLength} x {sheetWidth} mm</Text>
          <Text style={s.sheetSub}>Page {sheetIndex + 2} / {data.layouts.length + 1}</Text>
        </View>
      </View>
      <View style={s.contentRow}>
        <View style={s.diagramBox}>
          <DiagramSvg
            sheet={sheet}
            sheetLength={sheetLength}
            sheetWidth={sheetWidth}
            letterMap={letterMap}
            colorMap={colorMap}
          />
        </View>
        <Legend rows={rows} />
      </View>
      <View style={s.footer}>
        <Text style={s.footerText}>Grain follows length | {sheet.placements.length} parts</Text>
        <Text style={s.footerText}>Sheet {sheetIndex + 1} / {data.layouts.length}</Text>
      </View>
    </Page>
  );
}

export function CutterCutListPDF({ data }: { data: CutterCutListPdfData }) {
  const labels = new Map(data.partLabelEntries);
  const letterMap = buildLetterMap(data.layouts);
  const colorMap = buildColorMap(data.layouts);

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
          colorMap={colorMap}
          labels={labels}
        />
      ))}
    </Document>
  );
}

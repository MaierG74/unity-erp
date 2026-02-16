import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
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
  color: typeof PDF_PALETTE[0];
}

function buildLegend(
  placements: Placement[],
  letterMap: Map<string, string>,
  colorMap: Map<string, typeof PDF_PALETTE[0]>
): LegendRow[] {
  const grouped = new Map<
    string,
    { count: number; length_mm: number; width_mm: number; displayName: string }
  >();
  for (const p of placements) {
    const base = getBasePartName(p.part_id);
    const existing = grouped.get(base);
    if (existing) {
      existing.count += 1;
    } else {
      // Use label for display (preserves user-facing names like "Door #2"),
      // only strip instance suffixes from internal part_id
      const rawLabel = p.label || p.part_id;
      const displayName = rawLabel === p.part_id ? base : rawLabel;
      grouped.set(base, {
        count: 1,
        length_mm: p.original_length_mm ?? p.h,
        width_mm: p.original_width_mm ?? p.w,
        displayName,
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
      color: colorMap.get(base) ?? PDF_PALETTE[0],
    });
  }
  rows.sort((a, b) => a.letter.localeCompare(b.letter));
  return rows;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 30,
    fontFamily: 'Helvetica',
    fontSize: 9,
  },
  // Header
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
  // Diagram container
  diagramContainer: {
    borderWidth: 1,
    borderColor: '#94a3b8',
    backgroundColor: '#f8fafc',
    position: 'relative',
    marginBottom: 6,
  },
  partView: {
    position: 'absolute',
    borderWidth: 0.75,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  partLetter: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  partDims: {
    fontSize: 6,
    marginTop: 1,
  },
  // Dimension annotations
  dimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 6,
  },
  dimText: { fontSize: 7, color: '#64748b' },
  // Legend table
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
  colName: { width: 160, paddingLeft: 4 },
  colQty: { width: 30, textAlign: 'right' },
  colL: { width: 55, textAlign: 'right' },
  colW: { width: 55, textAlign: 'right' },
  // Footer
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

const DIAGRAM_MAX_W = 535; // pt (A4 landscape minus margins)
const DIAGRAM_MAX_H = 320; // pt

function calcScale(stockLength: number, stockWidth: number) {
  const sx = DIAGRAM_MAX_W / stockLength;
  const sy = DIAGRAM_MAX_H / stockWidth;
  return Math.min(sx, sy);
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
  letterMap,
  colorMap,
}: {
  sheet: SheetLayout;
  sheetIndex: number;
  totalSheets: number;
  stockLength: number;
  stockWidth: number;
  materialLabel?: string;
  letterMap: Map<string, string>;
  colorMap: Map<string, typeof PDF_PALETTE[0]>;
}) {
  const sheetL = sheet.stock_length_mm || stockLength;
  const sheetW = sheet.stock_width_mm || stockWidth;
  const scale = calcScale(sheetL, sheetW);
  const diagramW = sheetL * scale;
  const diagramH = sheetW * scale;

  const sheetArea = sheetL * sheetW;
  const usedArea = sheet.used_area_mm2 || 0;
  const efficiency = sheetArea > 0 ? (usedArea / sheetArea) * 100 : 0;
  const partsCount = sheet.placements.length;

  const legend = buildLegend(sheet.placements, letterMap, colorMap);

  const label = sheet.material_label || materialLabel || '';

  return (
    <Page size="A4" orientation="landscape" style={s.page}>
      {/* Header */}
      <View style={s.headerRow}>
        <View>
          <Text style={s.headerTitle}>Cutting Diagram</Text>
          <Text style={s.headerSub}>
            {label ? `${label} ` : ''}
            {sheetL} x {sheetW} mm
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

      {/* Diagram */}
      <View
        style={[
          s.diagramContainer,
          { width: diagramW, height: diagramH },
        ]}
      >
        {sheet.placements.map((p, i) => {
          const base = getBasePartName(p.part_id);
          const letter = letterMap.get(base) ?? '?';
          const color = colorMap.get(base) ?? PDF_PALETTE[0];
          const left = p.x * scale;
          const top = p.y * scale;
          const w = p.w * scale;
          const h = p.h * scale;
          const showDims = w > 28 && h > 20;
          return (
            <View
              key={`${p.part_id}-${i}`}
              style={[
                s.partView,
                {
                  left,
                  top,
                  width: w,
                  height: h,
                  backgroundColor: color.fill,
                  borderColor: color.stroke,
                },
              ]}
            >
              <Text style={[s.partLetter, { color: color.text }]}>
                {letter}
              </Text>
              {showDims && (
                <Text style={[s.partDims, { color: color.text }]}>
                  {Math.round(p.original_length_mm ?? p.h)} x{' '}
                  {Math.round(p.original_width_mm ?? p.w)}
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {/* Dimension annotation */}
      <View style={s.dimRow}>
        <Text style={s.dimText}>
          {'\u2190'} {sheetL} mm {'\u2192'}{'  '}|{'  '}{'\u2191'} {sheetW} mm {'\u2193'}
        </Text>
      </View>

      {/* Legend table */}
      <View style={s.legendHeader}>
        <Text style={[s.legendCellBold, s.colLetter]}>Letter</Text>
        <View style={s.colSwatch} />
        <Text style={[s.legendCellBold, s.colName]}>Part Name</Text>
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
          Efficiency: {efficiency.toFixed(1)}% | Used:{' '}
          {(usedArea / 1_000_000).toFixed(2)} m² of{' '}
          {(sheetArea / 1_000_000).toFixed(2)} m²
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
          letterMap={letterMap}
          colorMap={colorMap}
        />
      ))}
    </Document>
  );
}

/**
 * CSV Parser for SketchUp Cutlist Exports
 *
 * Handles semicolon-delimited CSV files exported from SketchUp's cutlist tools.
 * Parses dimensions, detects edge banding, and filters to Sheet Goods rows only.
 */

import type { CutlistDimensions, CutlistBandEdges } from './cutlistDimensions';

// ============================================================================
// Types
// ============================================================================

export interface SketchUpCSVRow {
  /** Row identifier (A, B, C, etc.) */
  no: string;
  /** Part name/label (e.g., "top#35", "side#6") */
  designation: string;
  /** Number of pieces */
  quantity: number;
  /** Length in mm */
  length_mm: number;
  /** Width in mm */
  width_mm: number;
  /** Thickness in mm */
  thickness_mm: number;
  /** Material type: "Sheet Goods" or "Edge Banding" */
  materialType: string;
  /** Material name (e.g., "Natural Oak") */
  materialName: string;
  /** Edge banding on length edge 1 (top) */
  edgeLength1: string;
  /** Edge banding on length edge 2 (bottom) */
  edgeLength2: string;
  /** Edge banding on width edge 1 (right) */
  edgeWidth1: string;
  /** Edge banding on width edge 2 (left) */
  edgeWidth2: string;
  /** Optional tags/category */
  tags: string;
  /** Original row index (0-based, excluding header) */
  rowIndex: number;
}

export interface RowValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ParsedCSVRow extends SketchUpCSVRow {
  validation: RowValidation;
}

export interface ParsedCSVResult {
  /** All parsed rows */
  allRows: ParsedCSVRow[];
  /** Only Sheet Goods rows (panels to import) */
  sheetGoodsRows: ParsedCSVRow[];
  /** Detected delimiter */
  delimiter: string;
  /** Original headers from CSV */
  headers: string[];
  /** Global parsing errors */
  errors: string[];
  /** Global parsing warnings */
  warnings: string[];
}

export interface ColumnMapping {
  no: number;
  designation: number;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  materialType: number;
  materialName: number;
  edgeLength1: number;
  edgeLength2: number;
  edgeWidth1: number;
  edgeWidth2: number;
  tags: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Expected SketchUp column headers (lowercase for matching) */
const SKETCHUP_COLUMN_MAP: Record<string, keyof ColumnMapping> = {
  'no.': 'no',
  'no': 'no',
  'designation': 'designation',
  'quantity': 'quantity',
  'length': 'length',
  'length - raw': 'length',
  'width': 'width',
  'width - raw': 'width',
  'thickness': 'thickness',
  'thickness - raw': 'thickness',
  'material type': 'materialType',
  'material name': 'materialName',
  'edge length 1': 'edgeLength1',
  'edge length 2': 'edgeLength2',
  'edge width 1': 'edgeWidth1',
  'edge width 2': 'edgeWidth2',
  'tags': 'tags',
};

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Detects the delimiter used in CSV content.
 * Prefers semicolon (SketchUp default), falls back to comma.
 */
export function detectDelimiter(content: string): string {
  const firstLine = content.split('\n')[0] || '';
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return semicolonCount >= commaCount ? ';' : ',';
}

/**
 * Strips UTF-8 BOM from content if present.
 */
export function stripBOM(content: string): string {
  return content.replace(/^\uFEFF/, '');
}

/**
 * Parses a dimension value, stripping " mm" suffix and handling comma decimals.
 * Returns 0 if parsing fails.
 */
export function parseDimension(value: string): number {
  if (!value || typeof value !== 'string') return 0;

  // Remove "mm" suffix (case insensitive) and trim whitespace
  let cleaned = value.replace(/\s*mm\s*/gi, '').trim();

  // Handle European decimal separator (comma → period)
  // But only if there's no period already (to avoid "1,234.56" → "1.234.56")
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.');
  }

  // Remove thousand separators (spaces or thin spaces)
  cleaned = cleaned.replace(/[\s\u00A0\u2009]/g, '');

  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Detects if an edge column value indicates edge banding is present.
 * Non-empty string = has banding.
 */
export function detectEdgeBanding(edgeValue: string): boolean {
  return Boolean(edgeValue?.trim());
}

/**
 * Parses a single CSV line, handling quoted fields.
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
      } else if (char === delimiter) {
        // Field separator
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  // Don't forget the last field
  fields.push(current.trim());

  return fields;
}

/**
 * Maps CSV headers to column indices.
 */
export function mapColumns(headers: string[]): { mapping: Partial<ColumnMapping>; unmapped: string[] } {
  const mapping: Partial<ColumnMapping> = {};
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const normalizedHeader = header.toLowerCase().trim();
    const mappedField = SKETCHUP_COLUMN_MAP[normalizedHeader];

    if (mappedField) {
      // Only use first occurrence if duplicate headers
      if (mapping[mappedField] === undefined) {
        mapping[mappedField] = index;
      }
    } else {
      unmapped.push(header);
    }
  });

  return { mapping, unmapped };
}

/**
 * Validates a parsed row for import readiness.
 */
export function validateRow(row: SketchUpCSVRow): RowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!row.length_mm || row.length_mm <= 0) {
    errors.push('Invalid or missing length');
  }
  if (!row.width_mm || row.width_mm <= 0) {
    errors.push('Invalid or missing width');
  }
  if (!row.quantity || row.quantity <= 0) {
    errors.push('Invalid or missing quantity');
  }

  // Optional but recommended
  if (!row.thickness_mm || row.thickness_mm <= 0) {
    warnings.push('No thickness specified');
  }
  if (!row.materialName?.trim()) {
    warnings.push('No material name');
  }
  if (!row.designation?.trim()) {
    warnings.push('No designation/name');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Main CSV parsing function.
 * Parses SketchUp cutlist CSV content and returns structured data.
 */
export function parseCSVContent(content: string): ParsedCSVResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Strip BOM and normalize line endings
  const cleanContent = stripBOM(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into lines and filter empty
  const lines = cleanContent.split('\n').filter((line) => line.trim());

  if (lines.length === 0) {
    return {
      allRows: [],
      sheetGoodsRows: [],
      delimiter: ';',
      headers: [],
      errors: ['CSV file is empty'],
      warnings,
    };
  }

  // Detect delimiter
  const delimiter = detectDelimiter(lines[0]);

  // Parse header row
  const headers = parseCSVLine(lines[0], delimiter);

  if (headers.length === 0) {
    return {
      allRows: [],
      sheetGoodsRows: [],
      delimiter,
      headers: [],
      errors: ['No headers found in CSV'],
      warnings,
    };
  }

  // Map columns
  const { mapping, unmapped } = mapColumns(headers);

  // Check for required columns
  const requiredColumns: (keyof ColumnMapping)[] = ['length', 'width', 'quantity'];
  const missingRequired = requiredColumns.filter((col) => mapping[col] === undefined);

  if (missingRequired.length > 0) {
    errors.push(`Missing required columns: ${missingRequired.join(', ')}`);
  }

  if (unmapped.length > 0) {
    warnings.push(`Unmapped columns: ${unmapped.join(', ')}`);
  }

  // Parse data rows
  const allRows: ParsedCSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fields = parseCSVLine(line, delimiter);

    const getValue = (col: keyof ColumnMapping): string => {
      const idx = mapping[col];
      return idx !== undefined ? fields[idx] || '' : '';
    };

    const row: SketchUpCSVRow = {
      no: getValue('no'),
      designation: getValue('designation'),
      quantity: parseInt(getValue('quantity'), 10) || 1,
      length_mm: parseDimension(getValue('length')),
      width_mm: parseDimension(getValue('width')),
      thickness_mm: parseDimension(getValue('thickness')),
      materialType: getValue('materialType'),
      materialName: getValue('materialName'),
      edgeLength1: getValue('edgeLength1'),
      edgeLength2: getValue('edgeLength2'),
      edgeWidth1: getValue('edgeWidth1'),
      edgeWidth2: getValue('edgeWidth2'),
      tags: getValue('tags'),
      rowIndex: i - 1,
    };

    const validation = validateRow(row);

    allRows.push({
      ...row,
      validation,
    });
  }

  // Filter to Sheet Goods only
  const sheetGoodsRows = allRows.filter(
    (row) => row.materialType.toLowerCase() === 'sheet goods' || !row.materialType
  );

  if (sheetGoodsRows.length === 0 && allRows.length > 0) {
    warnings.push('No "Sheet Goods" rows found. Showing all rows.');
  }

  return {
    allRows,
    sheetGoodsRows: sheetGoodsRows.length > 0 ? sheetGoodsRows : allRows,
    delimiter,
    headers,
    errors,
    warnings,
  };
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Converts a parsed CSV row to CutlistDimensions format for BOM insertion.
 */
export function rowToCutlistDimensions(row: SketchUpCSVRow): CutlistDimensions {
  const bandEdges: CutlistBandEdges = {
    top: detectEdgeBanding(row.edgeLength1),
    bottom: detectEdgeBanding(row.edgeLength2),
    right: detectEdgeBanding(row.edgeWidth1),
    left: detectEdgeBanding(row.edgeWidth2),
  };

  // Only include band_edges if at least one edge has banding
  const hasBanding = Object.values(bandEdges).some(Boolean);

  const dimensions: CutlistDimensions = {
    length_mm: row.length_mm,
    width_mm: row.width_mm,
    quantity_per: row.quantity,
    grain: 'length', // Default grain direction
  };

  if (row.thickness_mm > 0) {
    dimensions.thickness_mm = row.thickness_mm;
  }

  if (hasBanding) {
    dimensions.band_edges = bandEdges;
  }

  if (row.materialName?.trim()) {
    dimensions.material_label = row.materialName.trim();
  }

  if (row.designation?.trim()) {
    dimensions.notes = row.designation.trim();
  }

  return dimensions;
}

/**
 * Formats dimensions for display (e.g., "900 x 600 x 16").
 */
export function formatDimensionsDisplay(row: SketchUpCSVRow): string {
  const parts = [row.length_mm, row.width_mm];
  if (row.thickness_mm > 0) {
    parts.push(row.thickness_mm);
  }
  return parts.join(' x ');
}

/**
 * Formats edge banding for display (e.g., "T R B L" for all edges).
 */
export function formatEdgesDisplay(row: SketchUpCSVRow): string {
  const edges: string[] = [];
  if (detectEdgeBanding(row.edgeLength1)) edges.push('T');
  if (detectEdgeBanding(row.edgeWidth1)) edges.push('R');
  if (detectEdgeBanding(row.edgeLength2)) edges.push('B');
  if (detectEdgeBanding(row.edgeWidth2)) edges.push('L');
  return edges.length > 0 ? edges.join(' ') : '-';
}

export type CutlistGrain = 'any' | 'length' | 'width';
export type CutlistFinishSide = 'single' | 'double' | 'none';

export interface CutlistBandEdges {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
}

export interface CutlistLaminateOptions {
  enabled?: boolean;
  backer_component_id?: number | null;
}

export interface CutlistDimensions {
  length_mm?: number;
  width_mm?: number;
  thickness_mm?: number;
  quantity_per?: number;
  grain?: CutlistGrain;
  band_edges?: CutlistBandEdges;
  laminate?: CutlistLaminateOptions;
  material_code?: string;
  material_label?: string;
  colour_family?: string;
  finish_side?: CutlistFinishSide;
  notes?: string;
}

export interface ValidateCutlistDimensionsOptions {
  requireDimensions?: boolean;
}

export interface ValidateCutlistDimensionsResult {
  valid: boolean;
  value: CutlistDimensions | null;
  errors: string[];
  warnings: string[];
}

export const CUTLIST_DIMENSIONS_TEMPLATE = JSON.stringify(
  {
    length_mm: 0,
    width_mm: 0,
    thickness_mm: 16,
    quantity_per: 1,
    grain: 'length',
    band_edges: {
      top: true,
      right: true,
      bottom: true,
      left: true,
    },
    laminate: {
      enabled: false,
      backer_component_id: null,
    },
    material_code: 'MEL-WHITE-16',
    material_label: 'White Melamine 16mm',
    colour_family: 'White',
    finish_side: 'double',
    notes: 'Panel description',
  },
  null,
  2
);

const CUTLIST_EDGE_ORDER = ['top', 'right', 'bottom', 'left'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensurePositiveNumber(
  raw: unknown,
  field: string,
  { allowZero = false }: { allowZero?: boolean } = {}
): { value?: number; error?: string } {
  if (raw === undefined) {
    return {};
  }
  if (typeof raw !== 'number' || Number.isNaN(raw) || !Number.isFinite(raw)) {
    return { error: `${field} must be a number` };
  }
  if (!allowZero && raw <= 0) {
    return { error: `${field} must be greater than zero` };
  }
  if (allowZero && raw < 0) {
    return { error: `${field} cannot be negative` };
  }
  return { value: raw };
}

const ALLOWED_GRAIN: CutlistGrain[] = ['any', 'length', 'width'];
const ALLOWED_FINISH: CutlistFinishSide[] = ['single', 'double', 'none'];
const KNOWN_TOP_LEVEL_FIELDS = new Set([
  'length_mm',
  'width_mm',
  'thickness_mm',
  'quantity_per',
  'grain',
  'band_edges',
  'laminate',
  'material_code',
  'material_label',
  'colour_family',
  'finish_side',
  'notes',
]);

export function validateCutlistDimensions(
  input: unknown,
  options: ValidateCutlistDimensionsOptions = {}
): ValidateCutlistDimensionsResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(input)) {
    return { valid: false, value: null, errors: ['Cutlist dimensions must be a JSON object'], warnings };
  }

  const raw = input as Record<string, unknown>;
  const result: CutlistDimensions = {};

  Object.keys(raw).forEach((key) => {
    if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) {
      warnings.push(`Unknown field "${key}" will be ignored.`);
    }
  });

  const lengthCheck = ensurePositiveNumber(raw.length_mm, 'length_mm');
  if (lengthCheck.error) errors.push(lengthCheck.error);
  if (lengthCheck.value !== undefined) result.length_mm = lengthCheck.value;

  const widthCheck = ensurePositiveNumber(raw.width_mm, 'width_mm');
  if (widthCheck.error) errors.push(widthCheck.error);
  if (widthCheck.value !== undefined) result.width_mm = widthCheck.value;

  const thicknessCheck = ensurePositiveNumber(raw.thickness_mm, 'thickness_mm');
  if (thicknessCheck.error) errors.push(thicknessCheck.error);
  if (thicknessCheck.value !== undefined) result.thickness_mm = thicknessCheck.value;

  const quantityCheck = ensurePositiveNumber(raw.quantity_per, 'quantity_per', { allowZero: true });
  if (quantityCheck.error) {
    errors.push(quantityCheck.error);
  } else if (quantityCheck.value !== undefined) {
    result.quantity_per = quantityCheck.value;
  }

  if (raw.grain !== undefined) {
    if (typeof raw.grain !== 'string' || !ALLOWED_GRAIN.includes(raw.grain as CutlistGrain)) {
      errors.push('grain must be one of "any", "length", or "width"');
    } else {
      result.grain = raw.grain as CutlistGrain;
    }
  }

  if (raw.band_edges !== undefined) {
    if (!isPlainObject(raw.band_edges)) {
      errors.push('band_edges must be an object with top/right/bottom/left boolean flags');
    } else {
      const edgesRaw = raw.band_edges as Record<string, unknown>;
      const bandEdges: CutlistBandEdges = {};
      (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
        if (edgesRaw[edge] !== undefined) {
          if (typeof edgesRaw[edge] !== 'boolean') {
            errors.push(`band_edges.${edge} must be a boolean`);
          } else {
            bandEdges[edge] = edgesRaw[edge] as boolean;
          }
        }
      });
      Object.keys(edgesRaw).forEach((key) => {
        if (!['top', 'right', 'bottom', 'left'].includes(key)) {
          warnings.push(`Unknown band_edges field "${key}" will be ignored.`);
        }
      });
      if (Object.keys(bandEdges).length > 0) {
        result.band_edges = bandEdges;
      }
    }
  }

  if (raw.laminate !== undefined) {
    if (!isPlainObject(raw.laminate)) {
      errors.push('laminate must be an object with enabled/backer_component_id');
    } else {
      const laminateRaw = raw.laminate as Record<string, unknown>;
      const laminate: CutlistLaminateOptions = {};
      if (laminateRaw.enabled !== undefined) {
        if (typeof laminateRaw.enabled !== 'boolean') {
          errors.push('laminate.enabled must be a boolean');
        } else {
          laminate.enabled = laminateRaw.enabled;
        }
      }
      if (laminateRaw.backer_component_id !== undefined) {
        if (
          laminateRaw.backer_component_id !== null &&
          (!Number.isInteger(laminateRaw.backer_component_id) || Number(laminateRaw.backer_component_id) <= 0)
        ) {
          errors.push('laminate.backer_component_id must be a positive integer or null');
        } else {
          laminate.backer_component_id = laminateRaw.backer_component_id as number | null;
        }
      }
      Object.keys(laminateRaw).forEach((key) => {
        if (!['enabled', 'backer_component_id'].includes(key)) {
          warnings.push(`Unknown laminate field "${key}" will be ignored.`);
        }
      });
      if (Object.keys(laminate).length > 0) {
        result.laminate = laminate;
      }
    }
  }

  if (raw.material_code !== undefined) {
    if (typeof raw.material_code !== 'string') {
      errors.push('material_code must be a string');
    } else {
      const trimmed = raw.material_code.trim();
      if (trimmed.length > 0) {
        result.material_code = trimmed;
      }
    }
  }

  if (raw.material_label !== undefined) {
    if (typeof raw.material_label !== 'string') {
      errors.push('material_label must be a string');
    } else {
      const trimmed = raw.material_label.trim();
      if (trimmed.length > 0) {
        result.material_label = trimmed;
      }
    }
  }

  if (raw.colour_family !== undefined) {
    if (typeof raw.colour_family !== 'string') {
      errors.push('colour_family must be a string');
    } else {
      const trimmed = raw.colour_family.trim();
      if (trimmed.length > 0) {
        result.colour_family = trimmed;
      }
    }
  }

  if (raw.finish_side !== undefined) {
    if (typeof raw.finish_side !== 'string' || !ALLOWED_FINISH.includes(raw.finish_side as CutlistFinishSide)) {
      errors.push('finish_side must be "single", "double", or "none"');
    } else {
      result.finish_side = raw.finish_side as CutlistFinishSide;
    }
  }

  if (raw.notes !== undefined) {
    if (typeof raw.notes !== 'string') {
      errors.push('notes must be a string');
    } else {
      const trimmed = raw.notes.trim();
      if (trimmed.length > 0) {
        result.notes = trimmed;
      }
    }
  }

  const requireDimensions = Boolean(options.requireDimensions);
  if (requireDimensions) {
    if (result.length_mm === undefined || result.width_mm === undefined) {
      errors.push('length_mm and width_mm are required when forcing a cutlist default');
    }
  }

  const valid = errors.length === 0;
  return { valid, value: valid ? result : null, errors, warnings };
}

function formatMillimetres(value?: number | null): string | null {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const formatted = Number.isInteger(numeric)
    ? numeric.toString()
    : numeric.toFixed(2).replace(/\.?0+$/, '');
  return `${formatted}mm`;
}

export function summariseCutlistDimensions(
  dimensions: CutlistDimensions | null
): { headline: string | null; details: string[] } {
  if (!dimensions) {
    return { headline: null, details: [] };
  }

  const length = formatMillimetres(dimensions.length_mm ?? null);
  const width = formatMillimetres(dimensions.width_mm ?? null);
  const thickness = formatMillimetres(dimensions.thickness_mm ?? null);

  let headline: string | null = null;
  if (length && width) {
    headline = thickness ? `${length} × ${width} × ${thickness}` : `${length} × ${width}`;
  } else if (length) {
    headline = `Length ${length}`;
  } else if (width) {
    headline = `Width ${width}`;
  } else if (thickness) {
    headline = `Thickness ${thickness}`;
  }

  const details: string[] = [];
  if (thickness && headline && !headline.includes(thickness)) {
    details.push(`Thickness: ${thickness}`);
  }
  if (dimensions.quantity_per !== undefined && dimensions.quantity_per !== null) {
    details.push(`Quantity per: ${dimensions.quantity_per}`);
  }
  if (dimensions.grain) {
    details.push(`Grain: ${dimensions.grain}`);
  }
  if (dimensions.band_edges) {
    const edges = CUTLIST_EDGE_ORDER.filter((edge) => dimensions.band_edges?.[edge]);
    if (edges.length > 0) {
      const friendly = edges.map((edge) => edge.charAt(0).toUpperCase() + edge.slice(1));
      details.push(`Edgebanding: ${friendly.join(', ')}`);
    }
  }
  if (dimensions.finish_side) {
    details.push(`Finish side: ${dimensions.finish_side}`);
  }
  if (dimensions.material_label || dimensions.material_code) {
    const label = dimensions.material_label?.trim() ?? '';
    const code = dimensions.material_code?.trim() ?? '';
    const materialText = label || code ? `${label}${code ? (label ? ` (${code})` : code) : ''}` : 'Unspecified';
    details.push(`Material: ${materialText}`);
  }
  if (dimensions.colour_family) {
    details.push(`Colour: ${dimensions.colour_family}`);
  }
  if (dimensions.laminate?.enabled) {
    const suffix = dimensions.laminate.backer_component_id
      ? ` (backer component ${dimensions.laminate.backer_component_id})`
      : '';
    details.push(`Laminate: enabled${suffix}`);
  }
  if (dimensions.notes) {
    details.push(`Notes: ${dimensions.notes}`);
  }

  return { headline, details };
}

export function cloneCutlistDimensions(dim: unknown): CutlistDimensions | null {
  if (!dim || typeof dim !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(dim));
  } catch {
    return null;
  }
}

export function areCutlistDimensionsEqual(
  a: CutlistDimensions | null | undefined,
  b: CutlistDimensions | null | undefined
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

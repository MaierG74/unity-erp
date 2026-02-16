import type { Placement } from './types';

export interface ColorEntry {
  fill: string;
  stroke: string;
  text: string;
}

const PALETTE: ColorEntry[] = [
  { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a5f' }, // blue
  { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' }, // green
  { fill: '#fef3c7', stroke: '#d97706', text: '#78350f' }, // amber
  { fill: '#fce7f3', stroke: '#db2777', text: '#831843' }, // pink
  { fill: '#e0e7ff', stroke: '#4f46e5', text: '#312e81' }, // indigo
  { fill: '#fed7aa', stroke: '#ea580c', text: '#7c2d12' }, // orange
  { fill: '#ccfbf1', stroke: '#0d9488', text: '#134e4a' }, // teal
  { fill: '#fde68a', stroke: '#ca8a04', text: '#713f12' }, // yellow
  { fill: '#e9d5ff', stroke: '#9333ea', text: '#581c87' }, // purple
  { fill: '#fecaca', stroke: '#dc2626', text: '#7f1d1d' }, // red
  { fill: '#cffafe', stroke: '#0891b2', text: '#155e75' }, // cyan
  { fill: '#d1fae5', stroke: '#059669', text: '#064e3b' }, // emerald
];

export const WASTE_COLOR: ColorEntry = {
  fill: '#f1f5f9',
  stroke: '#94a3b8',
  text: '#64748b',
};

/**
 * Extract the base part name by stripping instance suffixes like #1, #2, etc.
 * e.g. "shelf#3" -> "shelf", "Part 1#2" -> "Part 1", "side" -> "side"
 */
export function getBasePartName(partId: string): string {
  const hashIndex = partId.lastIndexOf('#');
  if (hashIndex === -1) return partId;
  const suffix = partId.slice(hashIndex + 1);
  if (/^\d+$/.test(suffix)) {
    return partId.slice(0, hashIndex);
  }
  return partId;
}

/**
 * Build a color map from an array of placements.
 * Extracts unique base part names, sorts alphabetically, and assigns colors round-robin.
 */
export function getPartColorMap(
  placements: Placement[]
): Map<string, ColorEntry> {
  const baseNames = new Set<string>();
  for (const p of placements) {
    baseNames.add(getBasePartName(p.part_id));
  }

  const sorted = Array.from(baseNames).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  const map = new Map<string, ColorEntry>();
  for (let i = 0; i < sorted.length; i++) {
    map.set(sorted[i], PALETTE[i % PALETTE.length]);
  }
  return map;
}

/**
 * Look up the color for a specific part_id using the color map.
 * Falls back to the first palette color if the base name is not found.
 */
export function getPartColor(
  colorMap: Map<string, ColorEntry>,
  partId: string
): ColorEntry {
  const baseName = getBasePartName(partId);
  return colorMap.get(baseName) ?? PALETTE[0];
}

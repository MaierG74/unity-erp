export const MATERIAL_SIGNATURE_MARKER = 'MATERIAL_SIGNATURE_V1';
const MARKER_RE = /(?:^|\n)<MATERIAL_SIGNATURE_V1:([^>\n]+)>/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function stable(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return null;
}

function pickPart(part: any) {
  return stable({
    id: part?.id ?? part?.part_id ?? part?.name,
    name: part?.name,
    length_mm: part?.length_mm,
    width_mm: part?.width_mm,
    quantity: part?.quantity ?? part?.qty,
    band_edges: part?.band_edges,
    effective_board_id: part?.effective_board_id,
    effective_board_name: part?.effective_board_name,
    effective_edging_id: part?.effective_edging_id,
    effective_edging_name: part?.effective_edging_name,
    effective_thickness_mm: part?.effective_thickness_mm,
    effective_backer_id: part?.effective_backer_id,
    effective_backer_name: part?.effective_backer_name,
  });
}

export function canonicalizeCutlistMaterialSnapshot(snapshot: unknown): Json {
  const groups = Array.isArray(snapshot) ? snapshot : [];
  return groups.map((group: any) => stable({
    id: group?.source_group_id ?? group?.id ?? group?.group_id ?? group?.name,
    board_type: group?.board_type ?? group?.type,
    effective_backer_id: group?.effective_backer_id,
    effective_backer_name: group?.effective_backer_name,
    parts: (Array.isArray(group?.parts) ? group.parts : []).map(pickPart).sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })) as Json;
}

export function computeCutlistMaterialSignature(snapshot: unknown): string | null {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return null;
  const input = JSON.stringify(canonicalizeCutlistMaterialSnapshot(snapshot));
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function parseMaterialSignature(notes: string | null | undefined): string | null {
  const match = String(notes ?? '').match(MARKER_RE);
  return match?.[1] ?? null;
}

export function writeMaterialSignature(notes: string | null | undefined, hash: string | null): string | null {
  const human = String(notes ?? '').replace(/\n?<MATERIAL_SIGNATURE_V1:[^>\n]+>/g, '').trimEnd();
  if (!hash) return human || null;
  return `${human}${human ? '\n' : ''}<${MATERIAL_SIGNATURE_MARKER}:${hash}>`;
}

/**
 * Role fingerprint: order_detail_id|board_type|part_name|length_mm|width_mm
 * Uniquely identifies a physical part role per order line. Same-name parts with different
 * dimensions (e.g., "Left Side" in cupboard vs pedestal) are distinct roles, and parts
 * from different order lines are also kept separate.
 */
export function roleFingerprint(
  orderDetailId: number,
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
): string {
  return `${orderDetailId}|${boardType}|${partName}|${lengthMm}|${widthMm}`;
}

/**
 * A single material assignment: maps a part role to a board component.
 */
export type MaterialAssignment = {
  order_detail_id: number;
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  component_id: number;
  component_name: string;
};

/**
 * Backer material default — applies to all parts with -backer board types.
 */
export type BackerDefault = {
  component_id: number;
  component_name: string;
};

/**
 * Board-level edging default — one edging component per assigned board material.
 * All parts assigned to this board inherit this edging unless overridden.
 */
export type EdgingDefault = {
  board_component_id: number;     // links to a MaterialAssignment.component_id
  edging_component_id: number;    // FK to components (category 39)
  edging_component_name: string;
};

/**
 * Per-part edging override — rare exception (e.g., cherry top → black edging).
 * Keyed by the same role fingerprint as board assignments.
 */
export type EdgingOverride = {
  order_detail_id: number;
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  edging_component_id: number;
  edging_component_name: string;
};

/**
 * Persisted JSONB shape on orders.material_assignments.
 */
export type MaterialAssignments = {
  version: 1;
  assignments: MaterialAssignment[];
  backer_default: BackerDefault | null;
  edging_defaults: EdgingDefault[];
  edging_overrides: EdgingOverride[];
};

/**
 * Unique part role within a board type and order line — one row in the assignment grid.
 * Parts from different order lines are kept separate (order_detail_id is part of the key).
 */
export type PartRole = {
  order_detail_id: number;
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  /** Quantity for this part role on this order line */
  total_quantity: number;
  /** Product name for this order line (for grid sub-group header) */
  product_name: string;
  /** Current assignment (null if unassigned) */
  assigned_component_id: number | null;
  assigned_component_name: string | null;
  /** True if any band_edge is true — this part needs edging */
  has_edges: boolean;
};

/**
 * Look up an assignment by role fingerprint.
 */
export function findAssignment(
  assignments: MaterialAssignment[],
  orderDetailId: number,
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
): MaterialAssignment | undefined {
  return assignments.find(
    (a) =>
      a.order_detail_id === orderDetailId &&
      a.board_type === boardType &&
      a.part_name === partName &&
      a.length_mm === lengthMm &&
      a.width_mm === widthMm,
  );
}

/**
 * Set or update an assignment. Returns a new array (immutable).
 */
export function upsertAssignment(
  assignments: MaterialAssignment[],
  assignment: MaterialAssignment,
): MaterialAssignment[] {
  const idx = assignments.findIndex(
    (a) =>
      a.order_detail_id === assignment.order_detail_id &&
      a.board_type === assignment.board_type &&
      a.part_name === assignment.part_name &&
      a.length_mm === assignment.length_mm &&
      a.width_mm === assignment.width_mm,
  );
  if (idx >= 0) {
    const next = [...assignments];
    next[idx] = assignment;
    return next;
  }
  return [...assignments, assignment];
}

/**
 * Bulk-set the same material for multiple part roles. Returns a new array.
 */
export function bulkAssign(
  assignments: MaterialAssignment[],
  roles: Array<{ order_detail_id: number; board_type: string; part_name: string; length_mm: number; width_mm: number }>,
  componentId: number,
  componentName: string,
): MaterialAssignment[] {
  let result = [...assignments];
  for (const role of roles) {
    result = upsertAssignment(result, {
      order_detail_id: role.order_detail_id,
      board_type: role.board_type,
      part_name: role.part_name,
      length_mm: role.length_mm,
      width_mm: role.width_mm,
      component_id: componentId,
      component_name: componentName,
    });
  }
  return result;
}

import type { AggregateResponse } from '@/lib/orders/cutting-plan-types';

/**
 * Derive PartRole[] from aggregate data + assignments.
 * Groups parts by role fingerprint (including order_detail_id), sums quantities,
 * attaches assignments. Parts from different order lines are kept separate.
 */
export function buildPartRoles(
  agg: AggregateResponse | null,
  assignments: MaterialAssignments,
): PartRole[] {
  if (!agg) return [];
  const assignmentIndex = new Map(
    assignments.assignments.map((a) => [
      roleFingerprint(a.order_detail_id, a.board_type, a.part_name, a.length_mm, a.width_mm),
      a,
    ]),
  );

  const map = new Map<string, PartRole>();
  for (const group of agg.material_groups) {
    for (const part of group.parts) {
      if (part.quantity <= 0) continue;

      const fp = roleFingerprint(part.order_detail_id, group.board_type, part.name, part.length_mm, part.width_mm);
      const existing = map.get(fp);
      const match = assignmentIndex.get(fp);
      const partHasEdges = !!(
        part.band_edges?.top ||
        part.band_edges?.bottom ||
        part.band_edges?.left ||
        part.band_edges?.right
      );
      if (existing) {
        existing.total_quantity += part.quantity;
        existing.has_edges = existing.has_edges || partHasEdges;
      } else {
        map.set(fp, {
          order_detail_id: part.order_detail_id,
          board_type: group.board_type,
          part_name: part.name,
          length_mm: part.length_mm,
          width_mm: part.width_mm,
          total_quantity: part.quantity,
          product_name: part.product_name,
          assigned_component_id: match?.component_id ?? null,
          assigned_component_name: match?.component_name ?? null,
          has_edges: partHasEdges,
        });
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Validate a MaterialAssignments object. Returns error message or null.
 */
export function validateAssignments(data: unknown): string | null {
  if (!data || typeof data !== 'object') return 'Invalid data';
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return 'Invalid version';
  if (!Array.isArray(obj.assignments)) return 'assignments must be an array';
  for (const a of obj.assignments) {
    if (typeof a !== 'object' || !a) return 'Invalid assignment entry';
    const entry = a as Record<string, unknown>;
    if (typeof entry.board_type !== 'string' || !entry.board_type) return 'board_type required';
    if (typeof entry.order_detail_id !== 'number' || entry.order_detail_id <= 0) return 'order_detail_id must be positive';
    if (typeof entry.part_name !== 'string' || !entry.part_name) return 'part_name required';
    if (typeof entry.length_mm !== 'number' || entry.length_mm <= 0) return 'length_mm must be positive';
    if (typeof entry.width_mm !== 'number' || entry.width_mm <= 0) return 'width_mm must be positive';
    if (typeof entry.component_id !== 'number' || entry.component_id <= 0) return 'component_id must be positive';
    if (typeof entry.component_name !== 'string' || !entry.component_name) return 'component_name required';
  }
  if (obj.backer_default != null) {
    const bd = obj.backer_default as Record<string, unknown>;
    if (typeof bd.component_id !== 'number' || bd.component_id <= 0) return 'backer component_id invalid';
    if (typeof bd.component_name !== 'string' || !bd.component_name) return 'backer component_name invalid';
  }
  const edgingDefaults = (obj.edging_defaults ?? []) as unknown[];
  if (!Array.isArray(edgingDefaults)) return 'edging_defaults must be an array';
  for (const ed of edgingDefaults) {
    if (typeof ed !== 'object' || !ed) return 'Invalid edging_defaults entry';
    const entry = ed as Record<string, unknown>;
    if (typeof entry.board_component_id !== 'number' || entry.board_component_id <= 0) return 'edging board_component_id must be positive';
    if (typeof entry.edging_component_id !== 'number' || entry.edging_component_id <= 0) return 'edging_component_id must be positive';
    if (typeof entry.edging_component_name !== 'string' || !entry.edging_component_name) return 'edging_component_name required';
  }
  const edgingOverrides = (obj.edging_overrides ?? []) as unknown[];
  if (!Array.isArray(edgingOverrides)) return 'edging_overrides must be an array';
  for (const eo of edgingOverrides) {
    if (typeof eo !== 'object' || !eo) return 'Invalid edging_overrides entry';
    const entry = eo as Record<string, unknown>;
    if (typeof entry.board_type !== 'string' || !entry.board_type) return 'edging override board_type required';
    if (typeof entry.order_detail_id !== 'number' || entry.order_detail_id <= 0) return 'edging override order_detail_id must be positive';
    if (typeof entry.part_name !== 'string' || !entry.part_name) return 'edging override part_name required';
    if (typeof entry.length_mm !== 'number' || entry.length_mm <= 0) return 'edging override length_mm must be positive';
    if (typeof entry.width_mm !== 'number' || entry.width_mm <= 0) return 'edging override width_mm must be positive';
    if (typeof entry.edging_component_id !== 'number' || entry.edging_component_id <= 0) return 'edging override edging_component_id must be positive';
    if (typeof entry.edging_component_name !== 'string' || !entry.edging_component_name) return 'edging override edging_component_name required';
  }
  // Check for duplicate fingerprints
  const seen = new Set<string>();
  for (const a of obj.assignments as MaterialAssignment[]) {
    const fp = roleFingerprint(a.order_detail_id, a.board_type, a.part_name, a.length_mm, a.width_mm);
    if (seen.has(fp)) return `Duplicate assignment for ${fp}`;
    seen.add(fp);
  }
  return null;
}

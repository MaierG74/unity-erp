/**
 * Role fingerprint: board_type|part_name|length_mm|width_mm
 * Uniquely identifies a physical part role. Same-name parts with different
 * dimensions (e.g., "Left Side" in cupboard vs pedestal) are distinct roles.
 */
export function roleFingerprint(
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
): string {
  return `${boardType}|${partName}|${lengthMm}|${widthMm}`;
}

/**
 * A single material assignment: maps a part role to a board component.
 */
export type MaterialAssignment = {
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
 * Persisted JSONB shape on orders.material_assignments.
 */
export type MaterialAssignments = {
  version: 1;
  assignments: MaterialAssignment[];
  backer_default: BackerDefault | null;
};

/**
 * Unique part role within a board type — one row in the assignment grid.
 * Aggregates quantities across all order lines where the fingerprint matches.
 */
export type PartRole = {
  board_type: string;
  part_name: string;
  length_mm: number;
  width_mm: number;
  /** Total quantity across all order lines */
  total_quantity: number;
  /** Product names that contain this part */
  product_names: string[];
  /** Current assignment (null if unassigned) */
  assigned_component_id: number | null;
  assigned_component_name: string | null;
};

/**
 * Look up an assignment by role fingerprint.
 */
export function findAssignment(
  assignments: MaterialAssignment[],
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
): MaterialAssignment | undefined {
  return assignments.find(
    (a) =>
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
  roles: Array<{ board_type: string; part_name: string; length_mm: number; width_mm: number }>,
  componentId: number,
  componentName: string,
): MaterialAssignment[] {
  let result = [...assignments];
  for (const role of roles) {
    result = upsertAssignment(result, {
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
  // Check for duplicate fingerprints
  const seen = new Set<string>();
  for (const a of obj.assignments as MaterialAssignment[]) {
    const fp = roleFingerprint(a.board_type, a.part_name, a.length_mm, a.width_mm);
    if (seen.has(fp)) return `Duplicate assignment for ${fp}`;
    seen.add(fp);
  }
  return null;
}

type BandEdges = {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
};

export type EdgingByMaterialPart = {
  length_mm: number;
  width_mm: number;
  quantity: number;
  band_edges?: BandEdges;
  lamination_type?: string;
  lamination_group?: string;
  edging_material_id?: string;
};

export type EdgingByMaterialMaterial = {
  id: string;
  thickness_mm: number;
  isDefaultForThickness?: boolean;
};

function addLength(map: Map<string, number>, materialId: string | undefined, lengthMm: number) {
  if (!materialId || lengthMm <= 0) return;
  map.set(materialId, (map.get(materialId) ?? 0) + lengthMm);
}

function edgeLength(part: EdgingByMaterialPart, edges: BandEdges = part.band_edges ?? {}) {
  return (
    (edges.top ? part.width_mm : 0) +
    (edges.bottom ? part.width_mm : 0) +
    (edges.left ? part.length_mm : 0) +
    (edges.right ? part.length_mm : 0)
  );
}

export function computeEdgingByMaterialMap(
  parts: EdgingByMaterialPart[],
  edging: EdgingByMaterialMaterial[]
) {
  const lengths = new Map<string, number>();
  const edgingDefault = edging.find((e) => e.isDefaultForThickness);
  const defaultEdging16 = edging.find((e) => e.thickness_mm === 16 && e.isDefaultForThickness) || edgingDefault;
  const defaultEdging32 = edging.find((e) => e.thickness_mm === 32 && e.isDefaultForThickness) || edgingDefault;

  const laminationGroups = new Map<string, EdgingByMaterialPart[]>();
  const ungroupedParts: EdgingByMaterialPart[] = [];

  for (const part of parts) {
    if (part.lamination_group) {
      const group = laminationGroups.get(part.lamination_group) ?? [];
      group.push(part);
      laminationGroups.set(part.lamination_group, group);
    } else {
      ungroupedParts.push(part);
    }
  }

  for (const part of ungroupedParts) {
    if (part.length_mm <= 0 || part.width_mm <= 0 || part.quantity <= 0) continue;

    const laminationType = part.lamination_type || 'none';
    const finishedPartCount = laminationType === 'same-board'
      ? Math.floor(part.quantity / 2)
      : part.quantity;
    const totalEdge = edgeLength(part) * finishedPartCount;
    const defaultEdgingId = laminationType === 'none' ? defaultEdging16?.id : defaultEdging32?.id;

    addLength(lengths, part.edging_material_id || defaultEdgingId, totalEdge);
  }

  for (const groupParts of laminationGroups.values()) {
    if (groupParts.length === 0) continue;

    const memberCount = groupParts.length;
    const edgeThickness = 16 * memberCount;
    const refPart = groupParts[0];
    if (refPart.length_mm <= 0 || refPart.width_mm <= 0) continue;

    const mergedEdges: BandEdges = { top: false, right: false, bottom: false, left: false };
    for (const part of groupParts) {
      if (part.band_edges?.top) mergedEdges.top = true;
      if (part.band_edges?.right) mergedEdges.right = true;
      if (part.band_edges?.bottom) mergedEdges.bottom = true;
      if (part.band_edges?.left) mergedEdges.left = true;
    }

    const assemblies = Math.min(...groupParts.map((part) => part.quantity));
    const totalEdge = edgeLength(refPart, mergedEdges) * assemblies;

    if (memberCount === 1) {
      addLength(lengths, refPart.edging_material_id || defaultEdging16?.id, totalEdge);
    } else if (edgeThickness === 32) {
      addLength(lengths, refPart.edging_material_id || defaultEdging32?.id, totalEdge);
    } else {
      addLength(lengths, refPart.edging_material_id, totalEdge);
    }
  }

  return lengths;
}

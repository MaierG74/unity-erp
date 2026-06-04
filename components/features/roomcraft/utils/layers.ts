import type { FloorPlan, Layer } from '../types/floorPlan';

export function addLayer(fp: FloorPlan, init: { name: string; z: number }): FloorPlan {
  const layer: Layer = { id: crypto.randomUUID(), name: init.name, z: init.z, visible: true };
  return { ...fp, layers: [...fp.layers, layer] };
}

export function updateLayer(fp: FloorPlan, id: string, changes: Partial<Pick<Layer, 'name' | 'z' | 'visible'>>): FloorPlan {
  return { ...fp, layers: fp.layers.map((l) => (l.id === id ? { ...l, ...changes } : l)) };
}

export function removeLayer(fp: FloorPlan, id: string): FloorPlan {
  if (fp.layers.length <= 1) return fp;
  if (!fp.layers.some((l) => l.id === id)) return fp;
  const layers = fp.layers.filter((l) => l.id !== id);
  // Cascade-delete blocks on this layer; prune empty groups.
  const rooms = fp.rooms.map((p) => {
    const items = p.room.items.filter((i) => i.layerId !== id);
    const survivingGroupIds = new Set(items.map((i) => i.groupId).filter((g): g is string => !!g));
    const groups = p.room.groups.filter((g) => g.layerId !== id && survivingGroupIds.has(g.id));
    return { ...p, room: { ...p.room, items, groups } };
  });
  return { ...fp, layers, rooms };
}

export function reorderLayers(fp: FloorPlan, id: string, newIndex: number): FloorPlan {
  const idx = fp.layers.findIndex((l) => l.id === id);
  if (idx === -1) return fp;
  const layers = [...fp.layers];
  const [removed] = layers.splice(idx, 1);
  const insertAt = Math.max(0, Math.min(newIndex, layers.length));
  layers.splice(insertAt, 0, removed);
  return { ...fp, layers };
}

export function setLayerVisibility(fp: FloorPlan, id: string, visible: boolean): FloorPlan {
  return updateLayer(fp, id, { visible });
}

export function countBlocksOnLayer(fp: FloorPlan, layerId: string): number {
  return fp.rooms.reduce(
    (sum, p) => sum + p.room.items.filter((i) => i.layerId === layerId).length,
    0,
  );
}

export function getLayer(fp: FloorPlan, id: string): Layer | undefined {
  return fp.layers.find((l) => l.id === id);
}

import { useMemo } from 'react';
import type { FloorPlan } from '../types/floorPlan';
import { computeHeatmapGrid, type HeatmapGrid } from '../utils/heatmap';

export function useHeatmapData(
  floorPlan: FloorPlan | null,
  enabled: boolean,
): Map<string, HeatmapGrid> {
  return useMemo(() => {
    if (!enabled || !floorPlan) return new Map();
    const map = new Map<string, HeatmapGrid>();
    for (const placed of floorPlan.rooms) {
      map.set(placed.room.id, computeHeatmapGrid(placed.room));
    }
    return map;
  }, [floorPlan, enabled]);
}

import { footprintAABB, type FootprintAABB } from './blocks';
import type { Room } from '../types/room';

export interface HeatmapGrid {
  cols: number;
  rows: number;
  data: Float32Array;
}

export function computeHeatmapGrid(room: Room): HeatmapGrid {
  const { length, width } = room.dimensions;
  const cols = Math.ceil(length / 200);
  const rows = Math.ceil(width / 200);
  const data = new Float32Array(cols * rows);
  const blockAABBs: FootprintAABB[] = room.items.map(footprintAABB);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const cx = col * 200 + 100;
      const cy = row * 200 + 100;

      // Skip cells whose centres fall outside the room bounds.
      if (cx >= length || cy >= width) {
        data[i] = -1;
        continue;
      }

      // Cell centre inside a block footprint → obstacle.
      let obstacle = false;
      for (const aabb of blockAABBs) {
        if (cx >= aabb.minX && cx < aabb.maxX && cy >= aabb.minY && cy < aabb.maxY) {
          obstacle = true;
          break;
        }
      }
      if (obstacle) {
        data[i] = -1;
        continue;
      }

      // Cast axis-aligned rays in all four cardinal directions to the nearest obstacle.
      let northDist = cy;           // distance to north wall (y=0)
      let southDist = width - cy;   // distance to south wall
      let westDist = cx;            // distance to west wall (x=0)
      let eastDist = length - cx;   // distance to east wall

      for (const aabb of blockAABBs) {
        // North ray: block spans this x-column, south face is above the cell.
        if (aabb.minX <= cx && cx <= aabb.maxX && aabb.maxY <= cy) {
          northDist = Math.min(northDist, cy - aabb.maxY);
        }
        // South ray: block spans this x-column, north face is below the cell.
        if (aabb.minX <= cx && cx <= aabb.maxX && aabb.minY >= cy) {
          southDist = Math.min(southDist, aabb.minY - cy);
        }
        // West ray: block spans this y-row, east face is to the left of the cell.
        if (aabb.minY <= cy && cy <= aabb.maxY && aabb.maxX <= cx) {
          westDist = Math.min(westDist, cx - aabb.maxX);
        }
        // East ray: block spans this y-row, west face is to the right of the cell.
        if (aabb.minY <= cy && cy <= aabb.maxY && aabb.minX >= cx) {
          eastDist = Math.min(eastDist, aabb.minX - cx);
        }
      }

      // Passage width = tightest axial corridor: min of NS span and EW span.
      const nsSpan = northDist + southDist;
      const ewSpan = westDist + eastDist;
      data[i] = Math.min(Math.min(nsSpan, ewSpan), 3000);
    }
  }

  return { cols, rows, data };
}

export function clearanceToColor(mm: number): string {
  if (mm < 600) return '#ef4444';   // very tight — impassable
  if (mm < 900) return '#f97316';   // tight — single person squeeze
  if (mm < 1200) return '#eab308';  // passable
  if (mm < 1800) return '#22c55e';  // comfortable
  return '#3b82f6';                  // spacious
}

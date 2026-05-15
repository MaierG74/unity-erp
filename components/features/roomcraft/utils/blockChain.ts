import type { RoomItem } from '../types/room';
import { footprintAABB } from './blocks';

export interface BlockChain {
  axis: 'x' | 'y';
  blocks: RoomItem[];
  minEdge: number;
  maxEdge: number;
}

const DEFAULT_EPSILON = 0.5;

/**
 * Returns the contiguous chain of touching same-layer blocks that contains
 * `edgeValue` along the given axis, or null if no block's footprint along
 * the axis contains it.
 *
 * Two blocks are "touching" along an axis when their facing edges differ
 * by at most `epsilon` (default 0.5mm — same tolerance used elsewhere for
 * geometry comparisons).
 */
export function findChainAt(
  edgeValue: number,
  axis: 'x' | 'y',
  sameLayerOthers: RoomItem[],
  epsilon: number = DEFAULT_EPSILON,
): BlockChain | null {
  if (sameLayerOthers.length === 0) return null;

  // Sort by min-edge along the axis.
  const sorted = [...sameLayerOthers]
    .map((b) => {
      const aabb = footprintAABB(b);
      const min = axis === 'x' ? aabb.minX : aabb.minY;
      const max = axis === 'x' ? aabb.maxX : aabb.maxY;
      return { block: b, min, max };
    })
    .sort((a, b) => a.min - b.min);

  // Walk the sorted list, grouping touching blocks into chains.
  const chains: { blocks: RoomItem[]; minEdge: number; maxEdge: number }[] = [];
  let current: { blocks: RoomItem[]; minEdge: number; maxEdge: number } | null = null;
  for (const item of sorted) {
    if (!current) {
      current = { blocks: [item.block], minEdge: item.min, maxEdge: item.max };
      continue;
    }
    if (item.min - current.maxEdge <= epsilon) {
      // Touching (or close enough). Extend current chain.
      current.blocks.push(item.block);
      if (item.max > current.maxEdge) current.maxEdge = item.max;
    } else {
      // Gap. Close current chain, start a new one.
      chains.push(current);
      current = { blocks: [item.block], minEdge: item.min, maxEdge: item.max };
    }
  }
  if (current) chains.push(current);

  // Return the chain that contains edgeValue.
  for (const chain of chains) {
    if (edgeValue >= chain.minEdge - epsilon && edgeValue <= chain.maxEdge + epsilon) {
      return { axis, blocks: chain.blocks, minEdge: chain.minEdge, maxEdge: chain.maxEdge };
    }
  }
  return null;
}

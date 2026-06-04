export type WallSegmentType = 'full' | 'pre' | 'opening' | 'post';

export interface WallSegment {
  type: WallSegmentType;
  startMm: number;
  lengthMm: number;
}

export interface WallSegmentItem {
  positionMm: number;
  widthMm: number;
}

export function computeWallSegments(
  wallLengthMm: number,
  items: WallSegmentItem[],
): WallSegment[] {
  if (items.length === 0) {
    return [{ type: 'full', startMm: 0, lengthMm: wallLengthMm }];
  }

  const sorted = [...items].sort((a, b) => a.positionMm - b.positionMm);
  const segments: WallSegment[] = [];
  let cursor = 0;

  for (const item of sorted) {
    const gapLength = item.positionMm - cursor;
    if (gapLength > 0) {
      segments.push({ type: 'pre', startMm: cursor, lengthMm: gapLength });
    }
    if (item.widthMm > 0) {
      segments.push({ type: 'opening', startMm: item.positionMm, lengthMm: item.widthMm });
    }
    cursor = Math.max(cursor, item.positionMm + item.widthMm);
  }

  const tailLength = wallLengthMm - cursor;
  if (tailLength > 0) {
    segments.push({ type: 'post', startMm: cursor, lengthMm: tailLength });
  }

  return segments;
}
